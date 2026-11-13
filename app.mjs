import {today,validDate,addDays,timeLabel} from './domain.mjs';
import {read,commit,withUndo,loadBackup} from './store.mjs?v=2';
import {readImage,imageKey} from './ocr.mjs?v=2';
import {readRoster,datesIn,weddingIntent,collision} from './schedule.mjs';

const $=s=>document.querySelector(s);
const list=$('#schedule'), sheet=$('#sheet'), form=$('#sheet-form'), body=$('#sheet-body');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const eventKind=e=>/婚礼|wedding/i.test(e.kind)?'婚礼':'驻唱';
const monthLabel=date=>date.slice(0,4)+'年'+Number(date.slice(5,7))+'月';
const weekday=new Intl.DateTimeFormat('zh-MY',{weekday:'long',timeZone:'Asia/Kuala_Lumpur'});
let state, first=today(), count=62, focused='', busy=false, observer, submitAction;
function announce(message) {const el=$('#message');el.textContent=message;el.hidden=!message;}
function displayDay(date) {
  const {active,clash,uncertain}=collision(state.events,date);
  const status=state.days?.[date], pending=state.pending?.[date];
  const labels=active.length?[...new Set(active.map(eventKind))].join('、'):
    status==='pending'||pending||status==='gig'?'待确认':status==='off'?'空档':'月表未导入';
  const heading=active.length&&pending?labels+' · 待确认':labels;
  return '<article class="day '+(date===focused?'focus':'')+'" id="d-'+date+'"><div class="row-date"><time datetime="'+date+'">'+
    Number(date.slice(5,7))+'月'+Number(date.slice(8))+'日</time><small>'+weekday.format(new Date(date+'T12:00:00+08:00'))+(date===today()?' · 今天':'')+
    '</small></div><div><div class="row-status">'+heading+(clash?' <span class="clash">撞场</span>':'')+'</div>'+
    (uncertain?'<small class="detail">同日已有演出，时间待确认</small>':'')+
    active.map(e=>'<small class="detail">'+(active.length>1?eventKind(e)+' · ':'')+
      (e.start||e.end?esc(timeLabel(e)):'时间待确认')+(date!==e.date?' · 前一天开始':'')+'</small>').join('')+'</div></article>';
}
function render() {
  if(!state) return;
  observer?.disconnect();
  $('#month').textContent=monthLabel(first);
  list.innerHTML=Array.from({length:count},(_,i)=>displayDay(addDays(first,i))).join('');
  if('IntersectionObserver' in window) {
    observer=new IntersectionObserver(entries=>{
      const top=entries.filter(e=>e.isIntersecting).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top)[0];
      if(top) $('#month').textContent=monthLabel(top.target.id.slice(2));
    },{rootMargin:'-75px 0px -70% 0px'});
    list.querySelectorAll('.day').forEach(el=>observer.observe(el));
  }
}
function jump(date) {
  first=date;focused=date;count=62;render();window.scrollTo(0,0);
}
function open(title,html,action) {
  $('#sheet-title').textContent=title;body.innerHTML=html;submitAction=action;
  if(!sheet.open) sheet.showModal();
}
const button=(text,style='primary')=>'<button class="'+style+'" type="submit">'+text+'</button>';
const imageButton=(label,id)=>'<label>'+label+'<input id="'+id+'" type="file" accept="image/*"></label>';
const makeEvent=e=>({...e,id:crypto.randomUUID(),updatedAt:new Date().toISOString()});
async function update(fn) {
  for(let attempt=0;attempt<3;attempt++) {
    const current=await read();
    try {state=await commit(current.revision,fn);render();return;}
    catch(error){if(!error.message.includes('另一页面')||attempt===2) throw error;}
  }
}
function recordRoster(current,result,key) {
  const days={...current.days}, events=[...current.events];
  for(const [date,row] of Object.entries(result.days)) {
    const gigs=events.filter(e=>e.date===date&&e.status!=='cancelled'&&eventKind(e)==='驻唱');
    if(row.status==='pending'||(row.status==='off'&&gigs.length)){
      days[date]=days[date]==='gig'&&gigs.length?'gig':'pending';
      continue;
    }
    days[date]=row.status;
    for(const e of row.events) {
      if(!gigs.some(g=>(!g.start&&!g.end)||(!e.start&&!e.end)||(g.start===e.start&&g.end===e.end))) {
        const entry=makeEvent(e);events.push(entry);gigs.push(entry);
      }
    }
  }
  return withUndo(current,{days,events,sources:[...current.sources,key]});
}
async function processImage(file,type) {
  if(!file||busy) return;
  sheet.close();busy=true;$('#import').disabled=true;
  announce('正在读取图片…');
  try {
    if(file.size>30*1024*1024) throw Error('图片太大，请裁剪后重试。');
    const key=await imageKey(file);
    const current=await read();
    // Older imports stored the image hash before rest days existed.
    if(current.sources.includes(key)&&(type!=='roster'||current.rosterSources?.includes(key))) {
      announce('这张图片已经记录。');return;
    }
    const lines=await readImage(file,type==='roster'?'roster':'wedding',type==='roster'?'en':'simplified');
    if(type==='roster') {
      const result=readRoster(lines,first.slice(0,4));
      await update(c=>{
        if(c.rosterSources?.includes(key)) return c;
        const next=recordRoster(c,result,key);
        next.sources=[...new Set(next.sources)];
        next.rosterSources=[...(c.rosterSources||[]),key];
        return next;
      });
      const totals=Object.values(result.days).reduce((a,r)=>(a[r.status]++,a),{gig:0,off:0,pending:0});
      jump(today().startsWith(result.month)?today():result.month+'-01');
      announce('已记录 '+totals.gig+' 个演出日，'+totals.off+' 天休息，'+totals.pending+' 天待确认');
    } else {
      const intent=weddingIntent(lines.map(l=>l.text).join('\n'),first.slice(0,4));
      await saveWedding(intent,key);
    }
  } catch(e) {
    announce(/另一页面|保存/.test(e.message)?'保存失败，请再试一次。':'这张图片看不清，请换一张清楚的图片。');
  } finally {busy=false;$('#import').disabled=false;}
}
async function saveWedding(intent,key) {
  if(intent.type==='lookup') {
    jump(intent.date);announce('已查找 '+intent.date);return;
  }
  if(intent.type==='pending'&&!intent.dates.length) {
    announce('待确认 · 没有读到明确日期。');return;
  }
  let duplicate=false;
  await update(c=>{
    if(key&&c.sources.includes(key)){duplicate=true;return c;}
    const pending={...c.pending}, events=[...c.events];
    if(intent.type==='confirmed') {
      events.push(makeEvent(intent.event));delete pending[intent.date];
    } else {
      intent.dates.forEach(d=>{pending[d]='pending';});
    }
    return withUndo(c,{events,pending,sources:key?[...c.sources,key]:c.sources});
  });
  if(duplicate){announce('这张图片已经记录。');return;}
  jump(intent.date||intent.dates[0]);
  announce(intent.type==='confirmed'?'已记录婚礼':'待确认 · 没有新增婚礼档期');
}
function exportBackup() {
  const {schema,events,sources,days,pending,rosterSources}=state;
  const url=URL.createObjectURL(new Blob([JSON.stringify({schema,events,sources,days,pending,rosterSources},null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='gigguard-'+today()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function settings() {
  open('其他功能','<div class="buttons"><button type="button" id="export">导出备份</button><button type="button" id="undo" '+(state.undo?'':'disabled')+'>撤销上次变更</button></div>'+
    '<label>恢复备份<input id="restore" type="file" accept=".json,application/json"></label>'+
    '<details><summary>收入记录</summary>'+state.events.filter(e=>e.fee>0).map(e=>'<p>'+esc(e.date)+' · MYR '+e.fee.toFixed(2)+' · 已收 '+(e.deposit+e.balance).toFixed(2)+'</p>').join('')+'</details>');
  $('#export').onclick=exportBackup;
  $('#undo').onclick=()=>open('撤销上次变更','<p>恢复到上次变更之前。</p>'+button('撤销'),async()=>{
    await update(c=>c.undo?{...c,...c.undo,undo:null}:c);announce('已撤销');
  });
  $('#restore').onchange=async e=>{
    try {
      const data=loadBackup(JSON.parse(await e.target.files[0].text()));
      open('恢复备份','<p>用备份中的 '+data.events.length+' 笔档期替换本机档期。</p>'+button('恢复'),async()=>{
        await update(c=>withUndo(c,data));announce('已恢复备份');
      });
    }catch{announce('无法读取备份，现有档期已保留。');}
  };
}
$('#today').onclick=()=>{jump(today());announce('');};
$('#more-days').onclick=()=>{count+=62;render();};
$('#close').onclick=()=>sheet.close();
$('#settings').onclick=()=>{if(state)settings();};
$('#import').onclick=()=>{
  if(!state) return;
  open('导入图片',imageButton('驻唱月表','roster-file')+imageButton('婚礼截图','wedding-file')+'<button type="button" id="wedding-text">输入婚礼确认</button>');
  $('#roster-file').onchange=e=>void processImage(e.target.files[0],'roster');
  $('#wedding-file').onchange=e=>void processImage(e.target.files[0],'wedding');
  $('#wedding-text').onclick=()=>weddingForm();
};
function weddingForm(date='') {
  open('婚礼确认','<label>确认内容<input id="wedding-input" required value="'+esc(date?date+' 婚礼确认':'')+'" placeholder="12月30日婚礼确认"></label>'+button('保存'),async()=>{
    await saveWedding(weddingIntent($('#wedding-input').value,first.slice(0,4)));
  });
}
$('#search').onclick=()=>{
  open('查日期','<label>选择日期<input id="choose-date" type="date" value="'+first+'"></label><label>输入日期<input id="type-date" placeholder="04/02/2027" autocomplete="off"></label>'+
    '<p id="date-error" role="status"></p>'+button('查看')+'<button type="button" id="add-wedding">添加婚礼确认</button>',()=>{
      const date=targetDate();if(!date)return false;
      jump(date);announce('');
    });
  function targetDate(){
    const typed=$('#type-date').value.trim();
    const result=typed?datesIn(typed,first.slice(0,4))[0]:$('#choose-date').value;
    if(!validDate(result)){$('#date-error').textContent='请输入有效日期，例如 04/02/2027。';return '';}
    return result;
  }
  $('#add-wedding').onclick=()=>{const date=targetDate();if(date)weddingForm(date);};
};
form.addEventListener('submit',async e=>{
  e.preventDefault();
  if(!submitAction||busy) return;
  busy=true;
  try{if(await submitAction()!==false) sheet.close();}
  catch{announce('保存失败，请再试一次。');}
  finally{busy=false;}
});
try{state=await read();render();}catch{list.textContent='无法读取本机档期。请重新打开应用。';}
window.addEventListener('focus',async()=>{
  try{const latest=await read();if(latest.revision!==state?.revision){state=latest;render();}}catch{}
});
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.warn);

