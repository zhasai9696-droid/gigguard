import {today,validDate,addDays,validate} from './domain.mjs';
import {read,commit,withUndo,loadBackup} from './store.mjs?v=3';
import {readImage,imageKey} from './ocr.mjs?v=3';
import {readRoster,datesIn,collision} from './schedule.mjs?v=3';
import {isRoster,active,amount,tip,rm,name,monthRows,makeEvent,shiftMonth,emptyEvent,mergeRoster,rosterFields} from './ledger.mjs?v=3';

const $=s=>document.querySelector(s);
const main=$('#view'), sheet=$('#sheet'), panel=$('#sheet-body');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dayLabel=d=>Number(d.slice(5,7))+'月'+Number(d.slice(8))+'日';
const monthLabel=m=>m.slice(0,4)+'年'+Number(m.slice(5,7))+'月';
const dayOf=d=>new Date(d+'T00:00:00Z').getUTCDay();
const clock=t=>{const [h,m]=t.split(':').map(Number);return (h%12||12)+(m?':'+String(m).padStart(2,'0'):'')+(h<12?'am':'pm');};
const span=e=>clock(e.start)+'–'+clock(e.end)+(e.end<e.start?' +1日':'');
const dot=(kind,label='')=>'<i class="dot '+kind+'" '+(label?'role="img" aria-label="'+label+'"':'aria-hidden="true"')+'></i>';
const ctl=(label,action,style='',value='')=>'<button type="button" class="'+style+'" data-action="'+action+'" data-value="'+esc(value)+'">'+label+'</button>';
const field=(label,key,value,type='text',attrs='')=>'<label class="field">'+label+'<input name="'+key+'" type="'+type+'" value="'+esc(value)+'" '+attrs+'></label>';
const check=(label,key,value)=>'<label><input type="checkbox" name="'+key+'" '+(value?'checked':'')+'>'+label+'</label>';
let state, screen='calendar', selected=today(), month=selected.slice(0,7), closingMonth=month;
let editor, editorFrom, busy=false, modalSubmit, timer;
function tell(message,lasting=false){
  clearTimeout(timer);
  const el=$('#notice');el.hidden=!message;el.textContent=message;
  if(message&&!lasting) timer=setTimeout(()=>{el.hidden=true;},6500);
}
function open(title,html,submit){
  $('#sheet-title').textContent=title;panel.innerHTML=html;modalSubmit=submit;
  if(!sheet.open)sheet.showModal();
}
async function update(change){
  for(let i=0;i<3;i++){
    const current=await read();
    try{state=await commit(current.revision,change);return;}
    catch(e){if(i===2||!e.message.includes('另一页面'))throw e;}
  }
}
function navigate(date,scroll=false){
  selected=date;month=date.slice(0,7);screen='calendar';render();
  if(scroll)requestAnimationFrame(()=>$('#day-'+date)?.scrollIntoView({block:'start'}));
  else window.scrollTo(0,0);
}
function changeMonth(value){
  if(!validDate(value+'-01'))return;
  if(screen==='ledger'){closingMonth=value;render();}
  else navigate(value===today().slice(0,7)?today():value+'-01');
}
function monthBar(value){
  return '<div class="monthbar">'+ctl('‹','prev','',value)+ctl(monthLabel(value),'month','',value)+ctl('›','next','',value)+'</div>';
}
function dayInfo(date){
  const {active:events,clash,uncertain}=collision(state.events,date);
  const missed=state.events.filter(e=>e.date===date&&!active(e));
  const status=state.days?.[date];
  const unknown=!status||status==='pending'||state.pending?.[date]||state.rosterReview?.[date];
  const markers=(events.some(isRoster)?dot('roster','驻唱'):'')+
    (events.some(e=>!isRoster(e))?dot('manual','Event'):'')+(missed.length?dot('missed','没唱'):'')+
    (unknown?'<span class="question" aria-label="待确认">？</span>':'');
  return {events,missed,status,unknown,markers,clash,uncertain};
}
function gigLine(e,date){
  const parts=[e.start&&e.end?span(e):'时间待确认',e.lineup.replace(/^([234])\s*PCS$/i,'$1ps').replace(/^SOLO$/i,'Solo'),e.team,date!==e.date?'前一天开始':''].filter(Boolean);
  return '<button class="gig '+(!active(e)?'missed':'')+'" data-action="edit" data-value="'+esc(e.id)+'">'+
    dot(!active(e)?'missed':isRoster(e)?'roster':'manual')+'<span><strong>'+esc(!active(e)?'请假／没唱 · '+name(e):name(e))+'</strong><small class="detail">'+esc(parts.join(' · '))+'</small></span><span class="chevron" aria-hidden="true">›</span></button>';
}
function dayRow(date,info){
  const {events,missed,status,unknown,clash,uncertain}=info;
  let hint='';
  if(state.rosterReview?.[date])hint='月表变更待确认';
  else if(unknown&&!status&&events.some(e=>!isRoster(e)))hint='已有 Event · 驻唱月表未导入';
  else if(unknown&&!events.length&&!missed.length)hint=status?'待确认':'月表未导入';
  else if(unknown&&status==='pending')hint='驻唱待确认';
  else if(!events.length&&!missed.length)hint=status==='off'?'空档':'待确认';
  return '<article id="day-'+date+'" class="day '+(date===selected?'selected':'')+'"><div class="date"><strong>'+dayLabel(date)+'</strong><small>周'+'日一二三四五六'[dayOf(date)]+(date===today()?' · 今天':'')+'</small></div><div class="day-body">'+
    [...events,...missed].map(e=>gigLine(e,date)).join('')+(clash?'<p class="hint clash">撞场</p>':'')+
    (uncertain?'<p class="hint muted">同日有多场 · 时间待确认</p>':'')+(hint?'<p class="hint muted">'+hint+'</p>':'')+'</div></article>';
}
function calendar(){
  const first=month+'-01', next=shiftMonth(month,1)+'-01', dates=[];
  for(let d=first;d<next;d=addDays(d,1))dates.push(d);
  const info=dates.map(dayInfo);
  const ordered=dates.map((date,i)=>({date,i}));
  // Start the list at the selected date; the preceding dates remain reachable in the month grid.
  const start=Math.max(0,dates.indexOf(selected));
  return '<header class="head"><h1>档期 · '+monthLabel(month)+'</h1><div>'+ctl('今天','today')+ctl('查日期','search')+'</div></header>'+monthBar(month)+
    '<div class="grid week" aria-hidden="true">'+[...'日一二三四五六'].map(d=>'<span>'+d+'</span>').join('')+'</div><div class="grid" aria-label="月历">'+
    '<span></span>'.repeat(dayOf(first))+dates.map((d,i)=>'<button class="cell" data-action="date" data-value="'+d+'" aria-label="'+d+'" aria-pressed="'+(d===selected)+'" data-today="'+(d===today())+'">'+Number(d.slice(8))+'<span class="markers">'+info[i].markers+'</span></button>').join('')+'</div>'+
    '<div class="legend"><span>'+dot('roster')+'驻唱</span><span>'+dot('manual')+'Event</span><span>'+dot('missed')+'没唱</span><span>'+dot('off-dot')+'空档</span><span>？待确认</span></div>'+
    '<div class="actions">'+ctl(busy?'正在导入…':'导入图片','import','primary')+ctl('＋ 新增 Event','new','primary')+'</div>'+
    '<section aria-label="档期列表">'+ordered.slice(start).map(({date,i})=>dayRow(date,info[i])).join('')+'</section>'+
    (start?ctl('查看本月较早日期','earlier','subtle'):'')+ctl('备份／恢复','backup','subtle');
}
function ledger(){
  const rows=monthRows(state.events,closingMonth);
  const done=rows.filter(r=>r.state==='done'), missed=rows.filter(r=>r.state==='missed').length;
  const missing=done.filter(r=>amount(r.e)===null);
  const totals=done.reduce((a,r)=>({fee:a.fee+r.fee,gratuity:a.gratuity+r.gratuity,received:a.received+r.received,due:a.due+r.due}),{fee:0,gratuity:0,received:0,due:0});
  return '<h1>月结</h1>'+monthBar(closingMonth)+'<section class="summary"><p>总收入</p><p class="total">'+rm(totals.fee+totals.gratuity)+'</p><div class="totals">'+
    [['演出费',totals.fee],['小费',totals.gratuity],['已收',totals.received],['待收',totals.due]].map(([k,v])=>'<div>'+k+'<strong>'+rm(v)+'</strong></div>').join('')+
    '</div></section><div class="counts"><div>已唱<strong>'+done.length+' 场</strong></div><div>没唱<strong>'+missed+' 场</strong></div><div>排定<strong>'+(rows.length-done.length-missed)+' 场</strong></div></div>'+
    (missing.length?ctl('还有 '+missing.length+' 场未填演出费 ›','edit','quiet',missing[0].e.id):'')+
    '<h2>明细</h2>'+(rows.length?rows.map(({e,state:s,fee,gratuity,due,received})=>{
      const label=s==='missed'?'没唱 · 不计入':s==='planned'?'排定':due&&received?'部分已收':due?'未收':amount(e)===null&&tip(e)===null?'金额未填':'已收';
      return '<button class="ledger-row" data-action="edit" data-value="'+esc(e.id)+'"><span>'+dayLabel(e.date)+'</span><strong>'+esc(name(e))+'</strong><span class="ledger-amount">'+
        (s==='missed'?'':amount(e)===null&&tip(e)===null?'未填':rm(fee+gratuity))+'<small class="detail '+(s==='missed'?'missed':'')+'">'+label+' ›</small></span></button>';
    }).join(''):'<p class="empty">本月没有档期。</p>');
}
function edit(e){
  editor=e;editorFrom=screen;screen='edit';render();window.scrollTo(0,0);
}
function editPage(){
  const e=editor, min='min="0" max="10000000" step="0.01" inputmode="decimal" placeholder="未填"';
  const received=e.status==='paid'||((e.deposit||e.balance)&&(e.deposit+e.balance)>=e.fee);
  return '<header class="sheet-head">'+ctl('‹ 返回','back','quiet')+'<h2>'+(e.id?'修改档期':'新增 Event')+'</h2><span aria-hidden="true" style="width:52px"></span></header>'+
    '<form id="editor" class="editor">'+field('日期','date',e.date,'date','required')+field('地点／名称','venue',e.venue,'text',e.id?'':'required')+
    field('开始时间','start',e.start,'time')+field('结束时间','end',e.end,'time')+field('阵容','lineup',e.lineup,'text','placeholder="例如 2ps"')+
    field('谁的场','team',e.team)+field('演出费（RM）','feeInput',amount(e),'number',min)+field('小费（RM）','tip',tip(e),'number',min)+
    '<div class="checks">'+check('演出费已收','feePaid',e.feePaid??received)+check('小费已收','tipPaid',e.tipPaid)+'</div>'+
    '<label class="field">备注<textarea name="note" rows="2">'+esc(e.note)+'</textarea></label>'+
    '<div class="checks">'+check('手动标为已唱','done',e.status==='done'||e.status==='paid')+'</div>'+
    '<p id="edit-error" class="muted" role="status"></p><button class="wide primary" type="submit">'+(e.id?'保存修改':'保存 Event')+'</button>'+
    (e.id?'<div class="actions">'+ctl(active(e)?'标记没唱':'恢复档期','toggle','missed')+ctl('删除档期','delete','quiet')+'</div>':'')+'</form>';
}
function render(){
  if(!state)return;
  main.innerHTML=screen==='edit'?editPage():screen==='ledger'?ledger():calendar();
  $('#tabs').hidden=screen==='edit';
  document.querySelectorAll('#tabs button').forEach(b=>b.setAttribute('aria-current',b.dataset.action===screen?'page':'false'));
}
async function importFile(file){
  if(!file||busy)return;
  busy=true;sheet.close();render();tell('正在导入…',true);
  try{
    if(file.size>30*1024*1024)throw Error('图片过大');
    const key=await imageKey(file);
    if((await read()).rosterSources?.includes(key)){tell('这张图片已经记录。');return;}
    const result=readRoster(await readImage(file,'roster','en'),month.slice(0,4));
    let merged;
    await update(c=>{merged=mergeRoster(c,result,key);return merged.next;});
    if(merged.duplicate){tell('这张图片已经记录。');return;}
    if(screen==='calendar'&&!sheet.open) navigate(result.month===today().slice(0,7)?today():result.month+'-01');
    if(merged.initial){
      const rows=Object.values(result.days);
      tell('已记录 '+rows.filter(r=>r.status==='gig').length+' 个演出日，'+rows.filter(r=>r.status==='off').length+' 天休息'+
        (rows.some(r=>r.status==='pending')?'，'+rows.filter(r=>r.status==='pending').length+' 天待确认':''));
    }else tell(merged.changed.length?'月表有变动 · '+merged.changed.map(dayLabel).join('、'):'本月档期没有变化。');
  }catch{tell('导入未完成。请换一张清楚的图片或重试，原有档期已保留。');}
  finally{busy=false;if(screen!=='edit')render();}
}
function search(){
  open('查日期',field('选择日期','date',selected,'date')+field('输入日期','typed','','text','placeholder="04/02/2027"')+
    '<p class="muted" id="search-error"></p><button class="primary">查看</button>',()=>{
    const data=new FormData($('#sheet-form')), typed=data.get('typed').trim();
    const date=typed?datesIn(typed,month.slice(0,4))[0]:data.get('date');
    if(!validDate(date)){$('#search-error').textContent='请输入有效日期，例如 04/02/2027。';return false;}
    navigate(date);
  });
}
function exportBackup(){
  const {revision,undo,...backup}=state;
  const url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='gigguard-'+today()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function confirmAction(title,message,action){
  open(title,'<p>'+message+'</p><button class="primary">确认</button>',action);
}
function backups(){
  open('备份／恢复','<div class="actions">'+ctl('导出备份','export','primary')+
    (state.undo?ctl('撤销上次变更','undo','quiet'):'')+'</div><label class="file-label">恢复备份<input id="backup-file" type="file" accept=".json,application/json"></label>');
  $('#backup-file').onchange=async e=>{
    try{
      const backup=loadBackup(JSON.parse(await e.target.files[0].text()));
      confirmAction('恢复备份','用备份中的 '+backup.events.length+' 笔档期替换本机资料。',async()=>{
        await update(c=>withUndo(c,backup));render();tell('已恢复备份');
      });
    }catch{sheet.close();tell('无法读取备份，原有档期已保留。');}
  };
}
let saving=false;
async function saveEditor(form){
  if(saving)return;
  const old=editor, data=new FormData(form), next={...old};
  for(const key of ['date','venue','start','end','lineup','team','note']) next[key]=String(data.get(key)).trim();
  for(const key of ['feeInput','tip']) next[key]=data.get(key)===''?null:Number(data.get(key));
  // Preserve partial payments from old records unless the fee or its receipt checkbox changed.
  const previouslyPaid=Boolean(old.feePaid??(old.status==='paid'||((old.deposit||old.balance)&&(old.deposit+old.balance)>=old.fee)));
  if(!old.id||old.feePaid!==undefined||next.feeInput!==amount(old)||data.has('feePaid')!==previouslyPaid) next.feePaid=data.has('feePaid');
  next.tipPaid=data.has('tipPaid');
  if(next.feePaid!==undefined){next.fee=next.feeInput??0;next.deposit=0;next.balance=0;}
  next.status=!active(old)?'cancelled':data.has('done')?(old.status==='paid'&&next.feePaid===undefined?'paid':'done'):'booked';
  if(old.status==='paid'&&next.feePaid===undefined&&next.status!=='paid')next.feePaid=true;
  const error=!next.venue&&!isRoster(next)?'请填写地点或活动名称':validate({...next,team:next.team||next.kind});
  if(error){$('#edit-error').textContent=error;return;}
  if(isRoster(next)){
    next.locked=[...new Set([...(old.locked||[]),...['date',...rosterFields].filter(k=>old[k]!==next[k])])];
    next.teamEdited=old.teamEdited||old.team!==next.team;
    next.rosterDate=old.rosterDate||old.date;
  }
  saving=true;
  try{
    await update(c=>{
      if(old.id&&!c.events.some(e=>e.id===old.id))throw Error('这笔档期已删除。');
      return withUndo(c,{events:old.id?c.events.map(e=>e.id===old.id?{...next,updatedAt:new Date().toISOString()}:e):[...c.events,makeEvent(next)]});
    });
    navigate(next.date);tell('已保存档期');
  }catch(e){$('#edit-error').textContent=e.message||'保存失败，请重试。';}
  finally{saving=false;}
}
async function toggle(){
  const id=editor.id, date=editor.date, missed=!active(editor);
  await update(c=>withUndo(c,{events:c.events.map(e=>e.id===id?{...e,status:missed?(e.priorStatus||'booked'):'cancelled',priorStatus:missed?undefined:e.status,updatedAt:new Date().toISOString()}:e)}));
  navigate(date);tell(missed?'已恢复档期':'已标记没唱');
}
document.addEventListener('click',async event=>{
  const b=event.target.closest('[data-action]');
  if(!b||!state)return;
  const {action,value}=b.dataset;
  try{
    switch(action){
      case 'calendar':case 'ledger':screen=action;render();window.scrollTo(0,0);break;
      case 'today':navigate(today());break;
      case 'search':search();break;
      case 'date':navigate(value);break;
      case 'earlier':navigate(month+'-01');break;
      case 'prev':case 'next':changeMonth(shiftMonth(value,action==='prev'?-1:1));break;
      case 'month':open('选择年月',field('年月','month',value,'month','required')+
        field('手动输入年月','typed','','text','placeholder="2027-02"')+'<p class="muted" id="month-error"></p><button class="primary">查看</button>',()=>{
          const data=new FormData($('#sheet-form')), m=data.get('typed').trim()||data.get('month');
          if(!validDate(m+'-01')){$('#month-error').textContent='请输入有效年月，例如 2027-02。';return false;}changeMonth(m);
        });break;
      case 'import':
        if(busy)break;
        open('导入驻唱月表','<label class="file-label">选择月表图片<input id="roster-file" type="file" accept="image/*"></label>'+
          field('默认谁的场','team',state.defaultTeam||'','text','placeholder="例如 Paparazi"')+
          '<button class="primary">保存默认值</button>',async()=>{
            const defaultTeam=panel.querySelector('[name=team]').value.trim();
            await update(c=>withUndo(c,{defaultTeam}));tell('已保存默认值');
          });
        $('#roster-file').onchange=e=>void importFile(e.target.files[0]);break;
      case 'new':edit(emptyEvent(selected));break;
      case 'edit':{const e=state.events.find(e=>e.id===value);if(e)edit(e);break;}
      case 'back':screen=editorFrom;render();break;
      case 'toggle':await toggle();break;
      case 'delete':confirmAction('删除档期','删除这场演出？可从备份／恢复撤销。',async()=>{
        const {id,date,slot=0,rosterDate}=editor;
        await update(c=>withUndo(c,{events:c.events.filter(e=>e.id!==id),deletedSlots:isRoster(editor)?[...(c.deletedSlots||[]),(rosterDate||date)+'/'+slot]:c.deletedSlots}));
        navigate(date);tell('已删除档期');
      });break;
      case 'backup':backups();break;
      case 'export':exportBackup();break;
      case 'undo':confirmAction('撤销上次变更','恢复到上次变更之前。',async()=>{
        await update(c=>c.undo?{...c,...c.undo,undo:null}:c);render();tell('已撤销');
      });break;
      case 'close':sheet.close();break;
    }
  }catch{tell('保存失败，请重试。');}
});
document.addEventListener('submit',async event=>{
  if(event.target.id==='editor'){event.preventDefault();await saveEditor(event.target);return;}
  if(event.target.id!=='sheet-form')return;
  event.preventDefault();
  if(!modalSubmit||saving)return;
  saving=true;
  try{if(await modalSubmit()!==false)sheet.close();}
  catch{sheet.close();tell('操作失败，请重试。');}
  finally{saving=false;}
});
try{state=await read();render();}catch{main.textContent='无法读取本机档期，请重新打开应用。';}
window.addEventListener('focus',async()=>{
  try{const current=await read();if(current.revision!==state?.revision){state=current;if(screen!=='edit'&&!sheet.open)render();}}catch{}
});
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(console.warn);

