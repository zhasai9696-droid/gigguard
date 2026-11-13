const root = new URL('./ocr/', import.meta.url).href;
const canvas = (w,h) => Object.assign(document.createElement('canvas'), {width:w,height:h});

async function decode(file) {
  const url=URL.createObjectURL(file);
  try {
    const img=new Image();
    img.src=url;
    await img.decode();
    const scale=Math.min(1,3600/Math.max(img.width,img.height));
    const c=canvas(Math.round(img.width*scale),Math.round(img.height*scale));
    const ctx=c.getContext('2d',{willReadFrequently:true});
    ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);
    ctx.drawImage(img,0,0,c.width,c.height);
    return c;
  } finally {URL.revokeObjectURL(url);}
}

function gridLines(c) {
  const {width:w,height:h}=c;
  const {data}=c.getContext('2d').getImageData(0,0,w,h);
  const columns=new Uint32Array(w), rows=new Uint32Array(h);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const i=(y*w+x)*4;
    if(data[i]+data[i+1]+data[i+2]<290) {columns[x]++;rows[y]++;}
  }
  const peaks=(values,threshold)=>{
    const lines=[];
    for(let i=0;i<values.length;i++) {
      if(values[i]<threshold) continue;
      const start=i;
      while(values[i+1]>=threshold) i++;
      lines.push([start,i]);
    }
    return lines;
  };
  return {rows:peaks(rows,w*.79),columns:peaks(columns,h*.79)};
}

function tsvLines(tsv) {
  const groups=new Map();
  for(const line of tsv.split('\n').slice(1)) {
    const [level,page,block,para,row,,left,top,width,height,conf,...parts]=line.split('\t');
    const word=parts.join('\t').trim();
    if(level!=='5'||!word) continue;
    const key=[page,block,para,row].join('/');
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push({word,x:+left,y:+top,w:+width,h:+height,conf:+conf});
  }
  return [...groups.values()].map(words=>({
    text:words.map(w=>w.word).join(' '),
    confidence:Math.min(...words.map(w=>w.conf)),
    y:Math.min(...words.map(w=>w.y)),
    bottom:Math.max(...words.map(w=>w.y+w.h)),
    right:Math.max(...words.map(w=>w.x+w.w))
  })).sort((a,b)=>a.y-b.y);
}

async function recognize(worker,image,psm,whitelist='') {
  await worker.setParameters({tessedit_pageseg_mode:String(psm),tessedit_char_whitelist:whitelist});
  const {data}=await worker.recognize(image,{}, {text:true,tsv:true});
  return tsvLines(data.tsv);
}

async function rosterRows(c,worker,progress) {
  const {rows,columns}=gridLines(c);
  if(rows.length<4||columns.length<3||columns.length>6) return null;
  const gaps=rows.slice(1).map((r,i)=>r[0]-rows[i][0]).sort((a,b)=>a-b);
  const step=gaps[Math.floor(gaps.length/2)];
  const boundaries=rows.flatMap((r,i)=>{
    const next=rows[i+1]?.[0];
    const span=next-r[0], count=Math.round(span/step);
    if(count<2||count>8||Math.abs(span/count-step)>step*.09) return [r];
    return [r,...Array.from({length:count-1},(_,j)=>{
      const y=Math.round(r[0]+span*(j+1)/count);
      return [y,y];
    })];
  });
  const bands=boundaries.slice(0,-1).map((r,i)=>[r[1]+3,boundaries[i+1][0]-2]).filter(([a,b])=>b-a>=8);
  if(bands.length<3) return null;
  const scale=Math.max(1,Math.min(6,Math.round(1800/c.width)));
  const stride=Math.max(70,...bands.map(([a,b])=>(b-a)*scale+20));
  const cuts=columns.length===3&&columns[0][0]>10?[[0,-1],...columns]:columns;
  const out=bands.map(()=>({text:'',confidence:100}));
  for(let col=0;col<cuts.length-1;col++) {
    const x=cuts[col][1]+1, width=cuts[col+1][0]-x;
    if(width<5) continue;
    const strip=canvas(width*scale+24,bands.length*stride);
    const ctx=strip.getContext('2d');
    ctx.fillStyle='white';ctx.fillRect(0,0,strip.width,strip.height);
    bands.forEach(([a,b],i)=>ctx.drawImage(c,x+1,a,width-2,b-a,12,i*stride+10,(width-2)*scale,(b-a)*scale));
    const pixels=ctx.getImageData(0,0,strip.width,strip.height), d=pixels.data;
    for(let i=0;i<d.length;i+=4) {
      const v=Math.min(255,Math.max(0,(Math.max(d[i],d[i+1],d[i+2])-45)*1.35));
      d[i]=d[i+1]=d[i+2]=v;
    }
    ctx.putImageData(pixels,0,0);
    progress('读取表格栏位 '+(col+1)+'/'+(cuts.length-1));
    for(const row of await recognize(worker,strip,6,col===0?'0123456789/.-':'')) {
      const target=out[Math.floor((row.y+row.bottom)/2/stride)];
      if(!target) continue;
      target.text+=(target.text?' ':'')+row.text;
      target.confidence=Math.min(target.confidence,row.confidence);
    }
  }
  return out.map((r,i)=>({...r,text:r.text||'第 '+(i+1)+' 行未识别'}));
}

function greenNextTo(c,row) {
  const left=Math.max(0,row.right-row.bottom+row.y);
  const width=Math.min(c.width-left,Math.max(100,(row.bottom-row.y)*4));
  const y=Math.max(0,row.y-4);
  const {data}=c.getContext('2d').getImageData(left,y,width,Math.min(c.height-y,row.bottom-y+5));
  let greens=0;
  for(let i=0;i<data.length;i+=4) if(data[i+1]>105&&data[i+1]>data[i]*1.4&&data[i+1]>data[i+2]*1.4) greens++;
  return greens>25;
}

export async function readImage(file,mode,language,progress=()=>{}) {
  if(!globalThis.Tesseract) throw Error('OCR 引擎加载失败，请重新打开应用。');
  if(file.size>30*1024*1024) throw Error('图片超过 30 MB，请先裁剪。');
  const c=await decode(file).catch(()=>{throw Error('无法读取图片，请尝试 JPEG、PNG 或屏幕截图。');});
  const langs=language==='en'?['eng']:language==='traditional'?['eng','chi_tra']:['eng','chi_sim'];
  let worker, timeout, expired=false;
  try {
    const work=async()=>{
      worker=await Tesseract.createWorker(langs,1,{
        workerPath:root+'worker.min.js',corePath:root,langPath:root,workerBlobURL:false,
        logger:m=>progress(({recognizing:'正在识别'}[m.status]||m.status)+' '+Math.round((m.progress||0)*100)+'%'),
        errorHandler:message=>{throw Error(String(message));}
      });
      if(expired) {await worker.terminate();return [];}
      if(mode==='roster') {
        const grid=await rosterRows(c,worker,progress);
        if(grid) return grid;
      }
      const image=canvas(c.width,c.height);
      const ctx=image.getContext('2d',{willReadFrequently:true});
      ctx.drawImage(c,0,0);
      if(mode==='wedding') {
        const pixels=ctx.getImageData(0,0,c.width,c.height), d=pixels.data;
        const dark=d[0]+d[1]+d[2]<250;
        for(let i=0;i<d.length;i+=4) {
          const green=d[i+1]>90&&d[i+1]>d[i]*1.4&&d[i+1]>d[i+2]*1.4;
          for(let k=0;k<3;k++) d[i+k]=green?255:(dark?255-d[i+k]:d[i+k]);
        }
        ctx.putImageData(pixels,0,0);
      }
      return (await recognize(worker,image,mode==='wedding'?11:6)).map(r=>({...r,green:mode==='wedding'&&greenNextTo(c,r)}));
    };
    return await Promise.race([work(),new Promise((_,reject)=>{
      timeout=setTimeout(()=>{expired=true;reject(Error('识别超时，请裁剪图片后重试，或手动添加。'));},180000);
    })]);
  } finally {clearTimeout(timeout);if(worker&&!expired) await worker.terminate();else if(worker) void worker.terminate();}
}

export async function imageKey(file) {
  const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
  return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
}

