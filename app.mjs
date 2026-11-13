import {blank,today,validDate,addDays,onDate,flags,timeLabel,statuses,validate,parseRows,signature} from './domain.mjs';
import {read,commit,withUndo,loadBackup} from './store.mjs';
import {readImage,imageKey} from './ocr.mjs';

const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>new Intl.NumberFormat('en-MY',{style:'currency',currency:'MYR'}).format(n);
const main=$('#main'), dialog=$('#editor'), editForm=$('#edit-form');
let state, date=today(), month=date.slice(0,7), editId=null, editRevision=0, noticeTimer, saving=false;
let draft={mode:'roster',language:'en',year:date.slice(0,4),raw:'',rows:[],skipped:[],unresolved:[],url:'',key:'',message:'',running:false};
const makeEvent=e=>({...e,id:crypto.randomUUID(),updatedAt:new Date().toISOString()});
const getRoute=()=>['calendar','import','money','data'].includes(location.hash.slice(1))?location.hash.slice(1):'calendar';
const byDate=(a,b)=>(a.date+a.start).localeCompare(b.date+b.start);
const name=e=>[e.venue,e.team].filter(Boolean).join(' · ')||e.kind;
const badges=f=>[f.duplicate?'疑似重复':'',f.conflict?'可能撞档':'',f.missing?'时间待核对':''].filter(Boolean);
const jump=d=>{if(validDate(d)){date=d;month=d.slice(0,7);render();}};
function notice(message) {
  const el=$('#notice');el.textContent=message;el.hidden=false;
  clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{el.hidden=true;},5000);
}
function approve(message) {
  return new Promise(resolve=>{
    const prompt=document.createElement('dialog');
    prompt.innerHTML='<form method="dialog" class="stack"><h2>确认操作</h2><p></p><div class="actions"><button value="no" autofocus>返回</button><button class="primary" value="yes">确认</button></div></form>';
    prompt.querySelector('p').textContent=message;
    document.body.append(prompt);
    prompt.addEventListener('close',()=>{resolve(prompt.returnValue==='yes');prompt.remove();},{once:true});
    prompt.showModal();
  });
}
async function save(change,revision=state.revision) {
  if(saving) return false;
  saving=true;
  try {state=await commit(revision,change);render();return true;}
  catch(e){notice(e.message||'保存失败');try{state=await read();render();}catch{}return false;}
  finally{saving=false;}
}
const hero=(title,subtitle,actions='')=>'<div class="hero"><div><h1>'+title+'</h1><p>'+subtitle+'</p></div><div class="actions">'+actions+'</div></div>';
const btn=(label,action,style='')=>'<button type="button" class="'+style+'" data-action="'+action+'">'+label+'</button>';
function eventButton(e,day=date) {
  const f=flags(e,state.events.filter(x=>x.id!==e.id));
  const warning=badges(f);
  return '<button class="event" data-edit="'+esc(e.id)+'"><strong>'+esc(name(e))+'</strong><small>'+esc((e.date!==day?e.date+' 起 · ':'')+timeLabel(e)+' · '+statuses[e.status]+(e.lineup?' · '+e.lineup:''))+'</small>'+
    (warning.length?'<br><small class="warning">'+warning.join(' · ')+'</small>':'')+'</button>';
}
function calendar() {
  const first=month+'-01', offset=new Date(first+'T00:00:00Z').getUTCDay();
  const cells=Array.from({length:42},(_,i)=>{
    const d=addDays(first,i-offset);
    const gigs=state.events.filter(e=>onDate(e,d));
    return '<button class="day '+(d===date?'selected ':'')+(d===today()?'today ':'')+(d.slice(0,7)!==month?'inactive':'')+'" data-day="'+d+'" aria-pressed="'+(d===date)+'" aria-label="'+d+'，'+gigs.length+' 笔"><strong>'+Number(d.slice(8))+'</strong>'+
      gigs.slice(0,2).map(e=>'<small>'+esc(name(e))+'</small>').join('')+
      (gigs.length?'<span class="count">'+gigs.length+'</span>':'')+'</button>';
  }).join('');
  const list=state.events.filter(e=>onDate(e,date)).sort(byDate);
  const pending=state.events.filter(e=>e.status!=='cancelled'&&(!e.start||!e.end)).sort(byDate);
  return hero('演出档期','马来西亚时间 · '+month.replace('-',' 年 ')+' 月',btn('新增档期','new','primary')+'<a href="#import">图片导入</a>')+
    '<div class="dashboard"><section class="panel"><div class="calendar-head"><h2>'+month+'</h2><div class="actions">'+btn('‹','prev')+btn('今天','today')+btn('›','next')+'</div></div>'+
    '<div class="week">'+[...'日一二三四五六'].map(x=>'<span>'+x+'</span>').join('')+'</div><div class="calendar">'+cells+'</div></section>'+
    '<aside class="stack"><section class="panel stack"><label>查询日期<input id="lookup" type="date" value="'+date+'"></label><h2>'+date+'</h2>'+
    (list.length?list.map(e=>eventButton(e)).join(''):'<p class="muted">当天没有档期。</p>')+'</section>'+
    '<section class="panel stack"><h2>时间待核对 <small>'+pending.length+'</small></h2>'+
    (pending.length?pending.slice(0,5).map(e=>eventButton(e,'')).join('')+(pending.length>5?'<details class="stack"><summary>其余 '+(pending.length-5)+' 笔</summary>'+pending.slice(5).map(e=>eventButton(e,'')).join('')+'</details>':''):'<p class="muted">目前没有缺少时间的档期。</p>')+'</section></aside></div>';
}
function field(key,label,value,type='text') {
  return '<label>'+label+'<input name="'+key+'" type="'+type+'" value="'+esc(value)+'" '+(type==='number'?'min="0" max="10000000" step="0.01"':'')+'></label>';
}
function fields(e,full=false) {
  return '<div class="fields">'+field('date','日期',e.date,'date')+field('start','开始',e.start,'time')+field('end','结束',e.end,'time')+
    field('venue','场地',e.venue)+field('team','团队',e.team)+field('lineup','阵容',e.lineup)+field('kind','类别',e.kind)+
    '<label>状态<select name="status">'+Object.entries(statuses).map(([k,v])=>'<option value="'+k+'" '+(k===e.status?'selected':'')+'>'+v+'</option>').join('')+'</select></label>'+
    (full?field('fee','总酬劳 MYR',e.fee,'number')+field('deposit','已收订金 MYR',e.deposit,'number')+field('balance','已收尾款 MYR',e.balance,'number'):'')+
    '<label class="span">备注<textarea name="note" rows="2">'+esc(e.note)+'</textarea></label></div>';
}
function rowWarnings(row,index) {
  const f=flags(row.event,[...state.events,...draft.rows.filter((r,i)=>i!==index&&r.selected).map(r=>r.event)]);
  return [...new Set([...row.issues,...badges(f),validate(row.event)].filter(Boolean))].join(' · ');
}
function review() {
  const checked=draft.rows.filter(r=>r.selected).length;
  return '<div class="review"><aside class="panel stack">'+
    (draft.url?'<a href="'+esc(draft.url)+'" target="_blank" rel="noopener"><img class="preview" src="'+esc(draft.url)+'" alt="待识别原图，点击打开"></a>':'')+
    '<label>原文 / 粘贴排班<textarea id="raw" rows="8" placeholder="28/11/2026  Crown Plaza 6PM–11PM (4PCS)">'+esc(draft.raw)+'</textarea></label>'+
    btn('从文本生成候选','parse')+'<small>文本按规则提取日期和时间。多场可用分号分隔。语音可使用系统键盘听写。</small>'+
    (draft.skipped.length?'<p class="muted">TAKE OFF 已跳过 '+draft.skipped.length+' 行</p>':'')+
    (draft.unresolved.length?'<details><summary>未解析原文 '+draft.unresolved.length+' 行</summary><p class="raw">'+draft.unresolved.map(esc).join('<br>')+'</p></details>':'')+'</aside>'+
    '<section class="panel stack"><div class="between"><h2>核对候选 <small id="selected-count">'+checked+' / '+draft.rows.length+'</small></h2>'+btn('手动加一笔','add-row')+'</div>'+
    (draft.rows.length?'<div class="actions">'+btn('全选','select-all')+btn('取消全选','select-none')+btn('确认导入所选','import','primary')+'</div>':'<p class="muted">识别完成后可在这里逐笔核对，也可手动添加。</p>')+
    draft.rows.map((r,i)=>'<article class="row stack" data-row="'+i+'"><div class="between"><label class="check"><input type="checkbox" name="selected" '+(r.selected?'checked':'')+'>选中第 '+(i+1)+' 笔</label>'+
      '<label class="check"><input type="checkbox" name="ack" '+(r.ack?'checked':'')+'>已核对</label></div>'+
      (r.raw?'<small class="raw">'+esc(r.raw)+(r.confidence===null?'':' · OCR '+Math.round(r.confidence)+'%')+'</small>':'')+
      fields(r.event)+'<p class="warning row-warning">'+esc(rowWarnings(r,i))+'</p></article>').join('')+
    '</section></div>';
}
function importer() {
  const options=(data,value)=>Object.entries(data).map(([k,v])=>'<option value="'+k+'" '+(k===value?'selected':'')+'>'+v+'</option>').join('');
  return hero('导入档期','在设备上识别图片，核对后写入档期。')+
    '<div class="stack"><section class="panel stack"><div class="fields"><label>图片类型<select id="mode">'+options({roster:'驻唱排班表',wedding:'婚礼日期清单'},draft.mode)+'</select></label>'+
    '<label>识别语言<select id="language">'+options({en:'英文',simplified:'简中 + 英文',traditional:'繁中 + 英文'},draft.language)+'</select></label>'+
    '<label>原文省略年份时使用<input id="year" type="number" min="1900" max="2199" value="'+esc(draft.year)+'"></label></div>'+
    '<label>选择图片<input id="image" type="file" accept="image/*" '+(draft.running?'disabled':'')+'></label>'+
    '<p class="warning" id="ocr-message" role="status">'+esc(draft.message)+'</p></section>'+review()+'</div>';
}
let moneyMonth=today().slice(0,7);
function finances() {
  const events=state.events.filter(e=>e.date.startsWith(moneyMonth)&&e.status!=='cancelled').sort(byDate);
  const sums=events.reduce((a,e)=>[a[0]+Math.round(e.fee*100),a[1]+Math.round(e.deposit*100)+Math.round(e.balance*100)],[0,0]);
  return hero('演出收入','按演出日期汇总总酬劳与实际填写的收款。')+
    '<section class="panel stack"><label>月份<input id="money-month" type="month" value="'+esc(moneyMonth)+'"></label>'+
    '<div class="stats">'+[['总酬劳',sums[0]],['已收',sums[1]],['待收',sums[0]-sums[1]]].map(([l,v])=>'<div><small>'+l+'</small><strong>'+money(v/100)+'</strong></div>').join('')+'</div>'+
    (events.length?events.map(e=>'<div class="row">'+eventButton(e,'')+'<small>总额 '+money(e.fee)+' · 订金 '+money(e.deposit)+' · 尾款 '+money(e.balance)+'</small></div>').join(''):'<p class="muted">本月没有可汇总的档期。</p>')+'</section>';
}
function dataPage() {
  return hero('本机数据','备份可用于恢复档期或迁移到另一台设备。')+
    '<div class="split"><section class="panel stack"><h2>备份与恢复</h2><p>'+state.events.length+' 笔档期 · '+state.sources.length+' 张已导入图片</p>'+
    '<div class="actions">'+btn('导出 JSON 备份','backup','primary')+(state.undo?btn('撤销上次数据变更','undo'):'')+'</div>'+
    '<label>选择 JSON 备份<input id="restore" type="file" accept=".json,application/json"></label><small>恢复前会显示记录数量，并要求确认整库替换。</small></section>'+
    '<section class="panel stack"><h2>安装到主屏幕</h2><p>iPhone Safari 打开部署网址，点分享 → 添加到主屏幕。</p><p class="muted">图片在本机处理。清除网站数据、使用不同浏览器或更换网址可能需要从备份恢复。</p></section></div>';
}
function render() {
  if(!state) return;
  const route=getRoute();
  document.querySelectorAll('nav a').forEach(a=>a.hash==='#'+route?a.setAttribute('aria-current','page'):a.removeAttribute('aria-current'));
  main.innerHTML={calendar,import:importer,money:finances,data:dataPage}[route]();
}
function readForm(form) {
  const data=new FormData(form), e=blank();
  for(const key of Object.keys(e)) if(data.has(key)) e[key]=typeof e[key]==='number'?Number(data.get(key)):String(data.get(key)).trim();
  return e;
}
function showEditor(e) {
  editId=e.id||null;
  editRevision=state.revision;
  $('#editor-title').textContent=editId?'修改档期':'新增档期';
  $('#delete-event').hidden=!editId;
  $('#edit-fields').innerHTML=fields(e,true)+(!editId?
    '<label>每周重复至（可留空）<input name="repeat" type="date"></label>':'');
  $('#edit-warning').textContent='';
  dialog.showModal();
}
function updateWarnings() {
  main.querySelectorAll('[data-row]').forEach((el,i)=>{el.querySelector('.row-warning').textContent=rowWarnings(draft.rows[i],i);});
  if($('#selected-count')) $('#selected-count').textContent=draft.rows.filter(r=>r.selected).length+' / '+draft.rows.length;
}
function setDraft(result) {Object.assign(draft,result);render();}
async function startOCR(file) {
  if(draft.running) return;
  if(draft.rows.length&&!await approve('用新图片替换当前候选？')) return;
  if(draft.url) URL.revokeObjectURL(draft.url);
  setDraft({running:true,message:'正在读取图片…',url:URL.createObjectURL(file),key:'',rows:[],skipped:[],unresolved:[],raw:''});
  const mode=draft.mode, language=draft.language, year=draft.year;
  const progress=message=>{draft.message=message;if($('#ocr-message')) $('#ocr-message').textContent=message;};
  try {
    if(file.size>30*1024*1024) throw Error('图片超过 30 MB，请先裁剪。');
    const key=await imageKey(file);
    if(state.sources.includes(key)) throw Error('这张图片已有导入记录。可在档期中编辑，或撤销最近一次导入后重试。');
    const lines=await readImage(file,mode,language,progress);
    const parsed=parseRows(lines,mode,year);
    setDraft({...parsed,key,raw:lines.map(r=>r.text+(r.green?' ✅':'')).join('\n'),message:parsed.rows.length?'识别完成。请比对原图、核对每笔选中记录。':'未解析出档期。请调整图片类型、修改原文或手动添加。'});
  } catch(e) {progress(e.message+' 可粘贴原文或手动添加。');}
  finally {setDraft({running:false});}
}
async function importSelected() {
  if(draft.running) return;
  const selected=draft.rows.filter(r=>r.selected);
  if(!selected.length) return notice('请先选中至少一笔档期');
  if(selected.some(r=>!r.ack)) return notice('请逐笔勾选「已核对」');
  const error=selected.map(r=>validate(r.event)).find(Boolean);
  if(error) return notice(error);
  const seen=new Set(state.events.map(signature));
  for(const r of selected) {
    const k=signature(r.event);
    if(seen.has(k)) return notice('有重复档期，请取消选择重复项或更正字段。');
    seen.add(k);
  }
  if(!await approve('新增 '+selected.length+' 笔档期？时间待核对或可能撞档的项目会继续显示提示。')) return;
  if(await save(current=>{
    if(draft.key&&current.sources.includes(draft.key)) throw Error('图片已导入');
    return withUndo(current,{events:[...current.events,...selected.map(r=>makeEvent(r.event))],sources:draft.key?[...current.sources,draft.key]:current.sources});
  })){
    if(draft.url) URL.revokeObjectURL(draft.url);
    const d=selected[0].event.date;
    setDraft({rows:[],raw:'',key:'',url:'',message:'',unresolved:[],skipped:[]});
    jump(d);location.hash='calendar';notice('已导入 '+selected.length+' 笔');
  }
}
function backup() {
  const {schema,events,sources}=state;
  const url=URL.createObjectURL(new Blob([JSON.stringify({schema,events,sources},null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='gigguard-'+today()+'.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function restore(file) {
  const revision=state.revision;
  try {
    if(file.size>30*1024*1024) throw Error('备份文件过大');
    const data=loadBackup(JSON.parse(await file.text()));
    if(await approve('用备份中的 '+data.events.length+' 笔记录替换本机的 '+state.events.length+' 笔记录？可撤销此次恢复。')&&
      await save(current=>withUndo(current,data),revision)) notice('备份已恢复');
  }catch(e){notice('恢复失败 · '+e.message);}
}
main.addEventListener('input',event=>{
  const el=event.target, item=el.closest('[data-row]');
  if(el.id==='raw') draft.raw=el.value;
  if(el.id==='year') draft.year=el.value;
  if(!item) return;
  const row=draft.rows[Number(item.dataset.row)];
  if(el.name==='selected'||el.name==='ack') row[el.name]=el.checked;
  else if(Object.hasOwn(row.event,el.name)){row.event[el.name]=el.value.trim();row.ack=false;item.querySelector('[name=ack]').checked=false;}
  updateWarnings();
});
main.addEventListener('change',event=>{
  const el=event.target;
  if(el.id==='lookup') jump(el.value);
  if(el.id==='money-month'&&/^\d{4}-\d\d$/.test(el.value)){moneyMonth=el.value;render();}
  if(el.id==='mode') {draft.mode=el.value;draft.language=el.value==='roster'?'en':'simplified';render();}
  if(el.id==='language') draft.language=el.value;
  if(el.id==='image'&&el.files[0]) {const file=el.files[0];el.value='';void startOCR(file);}
  if(el.id==='restore'&&el.files[0]) {const file=el.files[0];el.value='';void restore(file);}
});
main.addEventListener('click',async event=>{
  const b=event.target.closest('button');
  if(!b) return;
  if(b.dataset.day) jump(b.dataset.day);
  if(b.dataset.edit) {const e=state.events.find(x=>x.id===b.dataset.edit);if(e) showEditor(e);}
  switch(b.dataset.action) {
    case 'today':jump(today());break;
    case 'prev':jump(addDays(month+'-01',-1).slice(0,7)+'-01');break;
    case 'next':jump(addDays(month+'-01',32).slice(0,7)+'-01');break;
    case 'new':showEditor(blank(date));break;
    case 'parse':
      if(draft.running) break;
      if(draft.rows.length&&!await approve('用当前原文替换候选和核对状态？')) break;
      setDraft({...parseRows(draft.raw.split(/\r?\n/),draft.mode,draft.year),message:'文本解析完成，请核对候选。'});break;
    case 'add-row':
      if(draft.running) break;
      draft.rows.push({event:{...blank(date),...(draft.mode==='wedding'?{kind:'婚礼'}:{})},raw:'',issues:[],confidence:null,selected:true,ack:false});
      render();main.querySelector('[data-row]:last-child')?.scrollIntoView({block:'nearest'});break;
    case 'select-all':case 'select-none':
      draft.rows.forEach(r=>{r.selected=b.dataset.action==='select-all';});render();break;
    case 'import':await importSelected();break;
    case 'backup':backup();break;
    case 'undo':
      if(state.undo&&await approve('撤销最近一次导入、编辑、删除或恢复？')&&await save(c=>({...c,...c.undo,undo:null}))) notice('已撤销');
      break;
  }
});
dialog.addEventListener('click',e=>{if(e.target.closest('[data-close]')) dialog.close();});
$('#delete-event').onclick=async()=>{
  if(editId&&await approve('删除这笔档期？可在数据页撤销。')&&await save(c=>withUndo(c,{events:c.events.filter(e=>e.id!==editId)}),editRevision)){dialog.close();notice('已删除');}
};
editForm.addEventListener('input',()=>{
  const e=readForm(editForm), f=flags(e,state.events.filter(x=>x.id!==editId));
  $('#edit-warning').textContent=badges(f).join(' · ');
});
editForm.addEventListener('submit',async event=>{
  event.preventDefault();
  const e=readForm(editForm), error=validate(e), warning=$('#edit-warning');
  if(error){warning.textContent=error;return;}
  const until=editForm.elements.repeat?.value, candidates=[e];
  if(until) {
    if(!validDate(until)||until<e.date||until>addDays(e.date,366)){warning.textContent='重复截止日须在开始日后的 366 天内';return;}
    for(let d=addDays(e.date,7);d<=until;d=addDays(d,7)) candidates.push({...e,date:d});
  }
  const others=state.events.filter(x=>x.id!==editId);
  const checks=candidates.map(x=>flags(x,others));
  if(checks.some(f=>f.duplicate)){warning.textContent='存在重复档期，请检查日期、时间、团队和场地。';return;}
  if((candidates.length>1||checks.some(f=>f.conflict||f.missing))&&!await approve('保存 '+candidates.length+' 笔档期？'+[...new Set(checks.flatMap(badges))].join(' · '))) return;
  if(await save(c=>withUndo(c,{events:editId?c.events.map(x=>x.id===editId?{...e,id:editId,updatedAt:new Date().toISOString()}:x):[...c.events,...candidates.map(makeEvent)]}),editRevision)){
    dialog.close();jump(e.date);notice('已保存');
  }
});
window.addEventListener('hashchange',()=>{render();window.scrollTo(0,0);});
window.addEventListener('focus',async()=>{try{const latest=await read();if(state&&latest.revision!==state.revision){state=latest;render();}}catch{}});
try {state=await read();render();}
catch(e){main.textContent='无法读取本机数据。请检查浏览器存储权限后重新打开。'+e.message;}
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.warn);


