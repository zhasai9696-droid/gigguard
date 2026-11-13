import {addDays,blank,interval,validDate} from './domain.mjs';
import {withUndo} from './store.mjs?v=4';

export const rosterFields=['venue','start','end','lineup'];
export const isRoster=e=>e.source==='roster'||(!e.source&&!/婚礼|wedding|event|派对|活动/i.test(e.kind));
export const active=e=>e.status!=='cancelled';
export const amount=e=>e.feeInput!==undefined?e.feeInput:(e.fee||e.status==='paid'?e.fee:null);
export const tip=e=>e.tip??null;
export const cents=n=>Math.round((n??0)*100);
export const rm=n=>'RM'+(n/100).toLocaleString('en-MY',{maximumFractionDigits:2});
export const name=e=>e.venue||(!isRoster(e)&&e.kind!=='演出'?e.kind:'')||e.team||(isRoster(e)?'驻唱':'Event');
export function performed(e,now=Date.now()){
  if(!active(e)) return false;
  if(e.status==='done'||e.status==='paid') return true;
  const r=interval(e);
  return r&&r.to<=now;
}
export function money(e){
  const fee=cents(amount(e)), gratuity=cents(tip(e));
  const gotFee=e.feePaid!==undefined?(e.feePaid?fee:0):e.status==='paid'?fee:Math.min(fee,cents(e.deposit)+cents(e.balance));
  const received=gotFee+(e.tipPaid?gratuity:0);
  return {fee,gratuity,received,due:fee+gratuity-received};
}
export function monthRows(events,month,now=Date.now()){
  return events.filter(e=>e.date.slice(0,7)===month)
    .sort((a,b)=>(a.date+a.start).localeCompare(b.date+b.start))
    .map(e=>({e,state:!active(e)?'missed':performed(e,now)?'done':'planned',...money(e)}));
}
export const makeEvent=e=>({...e,id:crypto.randomUUID(),updatedAt:new Date().toISOString()});
export function shiftMonth(month,by){
  const [y,m]=month.split('-').map(Number);
  const index=y*12+m-1+by;
  return String(Math.floor(index/12)).padStart(4,'0')+'-'+String(index%12+1).padStart(2,'0');
}
export function emptyEvent(date){return {...blank(date),source:'manual',kind:'Event',feeInput:null,tip:null,feePaid:false,tipPaid:false};}
const equal=(a,b)=>rosterFields.every(k=>(a[k]||'')===(b[k]||''));
export function mergeRoster(current,result,key){
  if(current.rosterSources?.includes(key)) return {next:current,duplicate:true};
  const days={...current.days}, review={...current.rosterReview}, events=[...current.events], changed=[];
  const initial=!Object.keys(days).some(d=>d.startsWith(result.month));
  const deleted=current.deletedSlots||[];
  for(const [date,row] of Object.entries(result.days)){
    const oldStatus=days[date];
    const slots=events.filter(e=>isRoster(e)&&(e.rosterDate||e.date)===date);
    let differs=false, warning=false;
    if(row.status==='pending'){
      if(!oldStatus){days[date]='pending';differs=true;}
      warning=Boolean(oldStatus&&oldStatus!=='pending');
    }else if(row.status==='off'){
      days[date]='off';
      for(const e of slots){
        if(!e.rosterDate||e.locked?.length||e.status!=='booked'||amount(e)!==null||tip(e)!==null||e.teamEdited||e.note||e.feePaid||e.tipPaid){
          warning=true;continue;
        }
        events.splice(events.indexOf(e),1);differs=true;
      }
    }else{
      days[date]='gig';
      const remaining=[...slots];
      for(const [slot,incoming] of row.events.entries()){
        if(deleted.includes(date+'/'+slot)){warning=true;continue;}
        const match=remaining.find(e=>equal(e.baseline||e,incoming))||
          remaining.find(e=>e.start&&e.start===incoming.start&&e.end===incoming.end)||
          remaining.find(e=>e.slot===slot)||(remaining.length===1&&row.events.length===1?remaining[0]:null);
        const baseline=Object.fromEntries(rosterFields.map(k=>[k,incoming[k]||'']));
        if(!match){
          if(remaining.length){warning=true;continue;}
          events.push(makeEvent({...incoming,source:'roster',rosterDate:date,slot,baseline,team:current.defaultTeam||''}));differs=true;continue;
        }
        remaining.splice(remaining.indexOf(match),1);
        const next={...match,source:'roster',rosterDate:date,slot,baseline};
        const locked=match.locked??(match.baseline?[]:rosterFields.filter(k=>Boolean(match[k])&&match[k]!==incoming[k]));
        next.locked=locked;
        if(locked.includes('date')&&match.date!==date) warning=true;
        for(const k of rosterFields){
          if(!incoming[k]) continue;
          if(locked.includes(k)){if(match[k]!==incoming[k]) warning=true;continue;}
          next[k]=incoming[k];
        }
        if(!match.teamEdited&&!match.team) next.team=current.defaultTeam||'';
        if(!equal(next,match)||next.team!==match.team) differs=true;
        events[events.indexOf(match)]=next;
      }
      if(remaining.length) warning=true;
    }
    if(warning) review[date]=true;else delete review[date];
    if(differs||oldStatus!==days[date]||Boolean(current.rosterReview?.[date])!==warning) changed.push(date);
  }
  return {initial,changed,next:withUndo(current,{days,events,rosterReview:review,sources:[...new Set([...current.sources,key])],rosterSources:[...(current.rosterSources||[]),key]})};
}


