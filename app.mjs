import {today,validDate,addDays,validate} from './domain.mjs';
import {read,commit,withUndo,loadBackup} from './store.mjs?v=5';
import {readImage,imageKey} from './ocr.mjs?v=5';
import {readRoster,datesIn,collision} from './schedule.mjs?v=5';
import {isRoster,active,pendingEvent,cancelledEvent,amount,tip,cents,rm,name,monthRows,makeEvent,shiftMonth,emptyEvent,mergeRoster,hasRosterImport,rosterFields} from './ledger.mjs?v=5';

import {relation,comparePlans,clearSchedule} from './conflicts.mjs?v=5';
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
  const missed=state.events.filter(e=>e.date===date&&e.status==='cancelled'&&!cancelledEvent(e));
  const cancelled=state.events.filter(e=>e.date===date&&cancelledEvent(e));
  const markers=(events.some(isRoster)?dot('roster','驻唱'):'')+
    (events.some(e=>!isRoster(e)&&!pendingEvent(e))?dot('manual','Event'):'')+
    (events.some(pendingEvent)?dot('pending-event','待定 Event'):'')+(missed.length?dot('missed','没唱'):'');
  return {events,missed,cancelled,markers,clash,uncertain};
}
function gigLine(e,date){
  const parts=[e.start&&e.end?span(e):'时间待确认',e.lineup.replace(/^([234])\s*PCS$/i,'$1ps').replace(/^SOLO$/i,'Solo'),e.team,date!==e.date?'前一天开始':''].filter(Boolean);
  const cancelled=cancelledEvent(e), missed=!cancelled&&!active(e);
  const prefix=cancelled?'已取消 · ':missed?'请假／没唱 · ':pendingEvent(e)?'待定 · ':'';
  return '<button class="gig '+(missed?'missed':'')+'" data-action="edit" data-value="'+esc(e.id)+'">'+
    dot(cancelled?'off-dot':missed?'missed':isRoster(e)?'roster':pendingEvent(e)?'pending-event':'manual')+'<span><strong>'+esc(prefix+name(e))+'</strong><small class="detail">'+esc(parts.join(' · '))+'</small></span><span class="chevron" aria-hidden="true">›</span></button>';
}
function dayRow(date,info){
  const {events,missed,cancelled,clash,uncertain}=info;
  let hint='';
  if(!events.length&&!missed.length)hint='空档';
  else if(state.rosterReview?.[date])hint='月表变更待确认';
  return '<article id="day-'+date+'" class="day '+(date===selected?'selected':'')+'"><div class="date"><strong>'+dayLabel(date)+'</strong><small>周'+'日一二三四五六'[dayOf(date)]+(date===today()?' · 今天':'')+'</small></div><div class="day-body">'+
    [...events,...missed,...cancelled].map(e=>gigLine(e,date)).join('')+(clash?'<p class="hint clash">撞场</p>':'')+
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
    '<div class="legend"><span>'+dot('roster')+'驻唱</span><span>'+dot('manual')+'Event</span><span>'+dot('pending-event')+'待定</span><span>'+dot('missed')+'没唱</span><span>'+dot('off-dot')+'空档</span></div>'+
    '<div class="actions">'+ctl(busy?'正在导入…':'导入图片','import','primary')+ctl('＋ 新增 Event','new','primary')+'</div>'+
    '<section aria-label="档期列表">'+ordered.slice(start).map(({date,i})=>dayRow(date,info[i])).join('')+'</section>'+
    (start?ctl('查看本月较早日期','earlier','subtle'):'')+ctl('备份／恢复','backup','subtle');
}
function ledger(){
  const rows=monthRows(state.events,closingMonth);
  const done=rows.filter(r=>r.state==='done'), missed=rows.filter(r=>r.state==='missed').length;
  const planned=rows.filter(r=>r.state==='planned'||r.state==='pending').length;
  const retained=rows.filter(r=>r.state==='cancelled').reduce((sum,{e})=>sum+cents(e.retainedDeposit??e.deposit),0);
  const missing=done.filter(r=>amount(r.e)===null);
  const totals=done.reduce((a,r)=>({fee:a.fee+r.fee,gratuity:a.gratuity+r.gratuity,received:a.received+r.received,due:a.due+r.due}),{fee:0,gratuity:0,received:0,due:0});
  return '<h1>月结</h1>'+monthBar(closingMonth)+'<section class="summary"><p>总收入</p><p class="total">'+rm(totals.fee+totals.gratuity)+'</p><div class="totals">'+
    [['演出费',totals.fee],['小费',totals.gratuity],['已收',totals.received],['待收',totals.due]].map(([k,v])=>'<div>'+k+'<strong>'+rm(v)+'</strong></div>').join('')+
    '</div></section>'+(retained?'<p class="hint">取消档期保留的订金 '+rm(retained)+'</p>':'')+'<div class="counts"><div>已唱<strong>'+done.length+' 场</strong></div><div>没唱<strong>'+missed+' 场</strong></div><div>排定<strong>'+planned+' 场</strong></div></div>'+
    (missing.length?ctl('还有 '+missing.length+' 场未填演出费 ›','edit','quiet',missing[0].e.id):'')+
    '<h2>明细</h2>'+(rows.length?rows.map(({e,state:s,fee,gratuity,due,received})=>{
      const label=s==='cancelled'?'已取消'+((e.retainedDeposit??e.deposit)?' · 订金 '+rm(cents(e.retainedDeposit??e.deposit)):''):s==='pending'?'待定 · 预计':s==='missed'?'没唱 · 不计入':s==='planned'?'排定':due&&received?'部分已收':due?'未收':amount(e)===null&&tip(e)===null?'金额未填':'已收';
      return '<button class="ledger-row" data-action="edit" data-value="'+esc(e.id)+'"><span>'+dayLabel(e.date)+'</span><strong>'+esc(name(e))+'</strong><span class="ledger-amount">'+
        (['missed','cancelled'].includes(s)?'':amount(e)===null&&tip(e)===null?'未填':rm(fee+gratuity))+'<small class="detail '+(s==='missed'?'missed':'')+'">'+label+' ›</small></span></button>';
    }).join(''):'<p class="empty">本月没有档期。</p>');
}
function edit(e){
  editor=e;editorFrom=screen;screen='edit';render();window.scrollTo(0,0);
}
function editPage(){
  const e=editor, min='min="0" max="10000000" step="0.01" inputmode="decimal" placeholder="未填"';
  const received=e.status==='paid'||((e.deposit||e.balance)&&(e.deposit+e.balance)>=e.fee);
  const booking=e.bookingStatus||'confirmed';
  const statusField=isRoster(e)?'':'<label class="field">档期状态<select name="bookingStatus">'+
    Object.entries({pending:'待定',confirmed:'已确认',cancelled:'已取消'}).map(([value,label])=>'<option value="'+value+'" '+(booking===value?'selected':'')+'>'+label+'</option>').join('')+'</select></label>';
  return '<header class="sheet-head">'+ctl('‹ 返回','back','quiet')+'<h2>'+(e.id?'修改档期':'新增 Event')+'</h2><span aria-hidden="true" style="width:52px"></span></header>'+
    '<form id="editor" class="editor">'+field('日期','date',e.date,'date','required')+field('地点／名称','venue',e.venue,'text',e.id?'':'required')+
    field('开始时间','start',e.start,'time')+field('结束时间','end',e.end,'time')+field('阵容','lineup',e.lineup,'text','placeholder="例如 2ps"')+
    field('谁的场','team',e.team)+statusField+field('演出费（RM）','feeInput',amount(e),'number',min)+field('小费（RM）','tip',tip(e),'number',min)+
    (!isRoster(e)?field('保留订金（RM）','retainedDeposit',e.retainedDeposit??(e.deposit||null),'number',min):'')+
    '<div class="checks">'+check('演出费已收','feePaid',e.feePaid??received)+check('小费已收','tipPaid',e.tipPaid)+'</div>'+
    '<label class="field">备注<textarea name="note" rows="2">'+esc(e.note)+'</textarea></label>'+
    '<div class="checks">'+check('手动标为已唱','done',e.status==='done'||e.status==='paid')+'</div>'+
    '<p id="edit-error" class="muted" role="status"></p><button class="wide primary" type="submit">'+(e.id?'保存修改':'保存 Event')+'</button>'+
    (e.id?'<div class="actions">'+(booking==='confirmed'?ctl(active(e)?'标记没唱':'恢复档期','toggle','missed'):'')+ctl('删除档期','delete','quiet')+'</div>':'')+'</form>';
}
function render(){
  if(!state)return;
  main.innerHTML=screen==='edit'?editPage():screen==='ledger'?ledger():calendar();
  if(screen==='edit')syncBookingControls();
  $('#tabs').hidden=screen==='edit';
  document.querySelectorAll('#tabs button').forEach(b=>b.setAttribute('aria-current',b.dataset.action===screen?'page':'false'));
}
async function importFile(file){
  if(!file||busy)return;
  busy=true;sheet.close();render();tell('正在导入…',true);
  try{
    if(file.size>30*1024*1024)throw Error('图片过大');
    const key=await imageKey(file);
    const before=await read();
    if(hasRosterImport(before,key)){tell('这张图片已经记录。');return;}
    const result=readRoster(await readImage(file,'roster','en'),month.slice(0,4));
    const current=await read();
    if(current.clearEpoch!==before.clearEpoch){tell('档期已清空，请重新选择图片。');return;}
    const merged=mergeRoster(current,result,key);
    if(merged.duplicate){tell('这张图片已经记录。');return;}
    const issues=comparePlans(current,merged.next);
    if(issues.length){
      tell('');
      const choice=await chooseConflict(issues);
      if(choice==='cancel'){tell('已取消导入');return;}
      resolveImport(current,merged,issues,choice);
    }
    const importedIds=merged.next.events.filter(e=>isRoster(e)&&result.days[e.rosterDate||e.date]?.status==='gig').map(e=>e.id);
    merged.next.rosterImports={...current.rosterImports,[key]:importedIds};
    state=await commit(current.revision,()=>merged.next);
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
const describe=e=>esc(e.date+' · '+name(e)+' · '+(e.start&&e.end?span(e):'时间未填'));
const cancelBooking=e=>({...e,bookingStatus:'cancelled',updatedAt:new Date().toISOString()});
function syncBookingControls(){
  const form=$('#editor'), status=form.elements.bookingStatus;
  if(!status)return;
  const sync=()=>{
    form.elements.done.disabled=status.value!=='confirmed';
    form.elements.retainedDeposit.closest('label').hidden=status.value!=='cancelled';
  };
  status.onchange=sync;
  sync();
}
function chooseConflict(issues){
  const labels={overlap:'时间重叠',unknown:'同日时间未填',duplicate:'重复记录',change:'月表变更',remove:'新版月表移除档期'};
  return new Promise(resolve=>{
    let choice='cancel';
    open('档期需要确认','<p>保留会沿用原档期；替换会采用新档期。重复记录只保留一笔。</p>'+
      issues.map(({kind,existing,incoming})=>'<p class="hint"><strong>'+labels[kind]+'</strong><br>已有 '+describe(existing)+
        (pendingEvent(existing)?' · 待定':'')+(incoming?'<br>新档 '+describe(incoming):'')+'</p>').join('')+
      '<div class="actions"><button type="button" id="keep-plan">保留</button><button type="button" id="replace-plan" class="primary">替换</button><button type="button" id="cancel-plan">取消</button></div>');
    sheet.addEventListener('close',()=>resolve(choice),{once:true});
    for(const action of ['keep','replace','cancel']) $('#'+action+'-plan').onclick=()=>{choice=action;sheet.close();};
  });
}
function resolveImport(current,merged,issues,choice){
  const previous=new Map(current.events.map(e=>[e.id,e]));
  const accepted=new Map(merged.next.events.map(e=>[e.id,e]));
  for(const {kind,incoming,existing} of issues){
    if(choice==='keep'){
      if(incoming){const old=previous.get(incoming.id);if(old)accepted.set(old.id,old);else accepted.delete(incoming.id);}
      if(previous.has(existing.id))accepted.set(existing.id,previous.get(existing.id));
    }else if(!['change','remove'].includes(kind)&&accepted.has(incoming.id)){
      // An exact duplicate retains the existing record and its payment details.
      if(kind==='duplicate'&&previous.has(existing.id)){
        const old=previous.get(incoming.id);
        if(old)accepted.set(old.id,old);else accepted.delete(incoming.id);
      }else if(pendingEvent(existing)&&previous.has(existing.id))accepted.set(existing.id,cancelBooking(existing));
      else accepted.delete(existing.id);
    }
  }
  const restored=[...accepted.values()];
  const priorPairs=new Set(current.events.flatMap((e,i)=>current.events.slice(i+1).filter(x=>relation(e,x)==='overlap').map(x=>[e.id,x.id].sort().join('/'))));
  if(restored.some((e,i)=>restored.slice(i+1).some(x=>relation(e,x)==='overlap'&&!priorPairs.has([e.id,x.id].sort().join('/')))))
    throw Error('仍有冲突，请取消并先调整原有档期');
  merged.next.events=restored;
  if(choice==='keep'){
    const dates=new Set(issues.map(x=>x.incoming?.rosterDate||x.incoming?.date||x.existing.rosterDate||x.existing.date));
    merged.changed=merged.changed.filter(d=>!dates.has(d));
    for(const date of dates){
      if(current.days?.[date])merged.next.days[date]=current.days[date];
      else delete merged.next.days[date];
      if(current.rosterReview?.[date])merged.next.rosterReview[date]=true;
      else delete merged.next.rosterReview[date];
    }
  }
}
function backups(){
  open('备份／恢复','<div class="actions">'+ctl('导出备份','export','primary')+
    (state.undo?ctl('撤销上次变更','undo','quiet'):'')+'</div><label class="file-label">恢复备份<input id="backup-file" type="file" accept=".json,application/json"></label>'+
    ctl('清空全部档期记录','clear','missed'));
  $('#backup-file').onchange=async e=>{
    try{
      const backup=loadBackup(JSON.parse(await e.target.files[0].text()));
      confirmAction('恢复备份','用备份中的 '+backup.events.length+' 笔档期替换本机资料。',async()=>{
        await update(c=>withUndo(c,backup));render();tell('已恢复备份');
      });
    }catch{sheet.close();tell('无法读取备份，原有档期已保留。');}
  };
}
function requestClear(){
  if(busy){tell('请等本次图片导入结束。');return;}
  open('清空全部档期记录','<p>所有驻唱、Event、工资、收款和档期状态都会删除。清空无法撤销，建议先导出备份。</p>'+
    '<div class="actions">'+ctl('先导出备份','export','primary')+ctl('继续清空','clear-final','missed')+'</div>');
}
let saving=false;
async function saveEditor(form){
  if(saving)return;
  const old=editor, data=new FormData(form), next={...old};
  for(const key of ['date','venue','start','end','lineup','team','note']) next[key]=String(data.get(key)).trim();
  for(const key of ['feeInput','tip']) next[key]=data.get(key)===''?null:Number(data.get(key));
  if(data.has('bookingStatus')){
    next.bookingStatus=data.get('bookingStatus');
    if(next.bookingStatus==='cancelled'&&data.get('retainedDeposit')!=='')next.retainedDeposit=Number(data.get('retainedDeposit'));
  }
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
    if(!await writeEvent(old,next))return;
    navigate(next.date);tell('已保存档期');
  }catch(e){$('#edit-error').textContent=e.message||'保存失败，请重试。';}
  finally{saving=false;}
}
async function writeEvent(old,next){
  const current=await read();
  if(old.id&&!current.events.some(e=>e.id===old.id&&e.updatedAt===old.updatedAt))throw Error('这笔档期已变更，请返回后重新打开。');
  const scheduleChanged=!old.id||active(old)!==active(next)||['date','venue','start','end','bookingStatus'].some(k=>old[k]!==next[k]&&
    (k!=='bookingStatus'||(old[k]||'confirmed')!==next[k]));
  const issues=scheduleChanged&&active(next)?current.events.map(existing=>({kind:relation(next,existing),incoming:next,existing})).filter(x=>x.kind):[];
  if(issues.some(x=>x.kind==='duplicate'&&!pendingEvent(x.existing))){tell('已有相同日期、时间和地点的档期。');return false;}
  if(issues.length&&await chooseConflict(issues)!=='replace')return false;
  const replace=new Set(issues.map(x=>x.existing.id));
  const events=current.events.filter(e=>!replace.has(e.id)||pendingEvent(e)).map(e=>replace.has(e.id)?cancelBooking(e):e);
  const entry=old.id?{...next,updatedAt:new Date().toISOString()}:makeEvent(next);
  state=await commit(current.revision,c=>withUndo(c,{events:old.id?events.map(e=>e.id===old.id?entry:e):[...events,entry]}));
  return true;
}
async function toggle(){
  const {date}=editor, missed=!active(editor);
  if(!await writeEvent(editor,{...editor,status:missed?(editor.priorStatus||'booked'):'cancelled',priorStatus:missed?undefined:editor.status}))return;
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
      case 'clear':requestClear();break;
      case 'clear-final':open('再次确认清空','<p>确定永久清空全部档期和月结记录？此操作无法撤销。</p><button class="primary">确认永久清空</button>',async()=>{
        await update(clearSchedule);navigate(today());tell('全部档期记录已清空');
      });break;
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
