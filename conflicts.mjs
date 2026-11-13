import {interval} from './domain.mjs';
import {active,isRoster} from './ledger.mjs?v=4';

const place=e=>(e.venue||'').normalize('NFKC').trim().toLowerCase().replace(/[\s\p{P}]+/gu,'');
const timed=e=>e.start&&e.end&&e.start!==e.end;
export function relation(a,b){
  if(a.id&&a.id===b.id)return '';
  const sameDay=a.date===b.date, samePlace=Boolean(place(a))&&place(a)===place(b);
  if(sameDay&&samePlace&&a.start===b.start&&a.end===b.end)return 'duplicate';
  if(!active(a)||!active(b))return '';
  const x=interval(a),y=interval(b);
  if(!x||!y||x.from>=y.to||y.from>=x.to)return '';
  return timed(a)&&timed(b)?'overlap':'unknown';
}
export function comparePlans(current,next){
  const old=new Map(current.events.map(e=>[e.id,e])), after=new Map(next.events.map(e=>[e.id,e]));
  const changed=next.events.filter(e=>{
    const before=old.get(e.id);
    return !before||['date','start','end','venue','status'].some(k=>before[k]!==e[k]);
  });
  const issues=[];
  for(const e of changed){
    const previous=old.get(e.id);
    if(previous&&active(previous)&&['date','start','end','venue'].some(k=>previous[k]!==e[k])&&isRoster(e))
      issues.push({kind:'change',incoming:e,existing:previous});
    for(const other of next.events){
      const kind=relation(e,other);
      if(!kind||changed.includes(other)&&e.id>other.id)continue;
      const earlier=old.get(other.id);
      if(previous&&earlier&&relation(previous,earlier)===kind&&
        [e,other].every(x=>['date','start','end','venue','status'].every(k=>old.get(x.id)?.[k]===x[k])))continue;
      issues.push({kind,incoming:e,existing:other});
    }
  }
  for(const e of current.events)if(!after.has(e.id))issues.push({kind:'remove',incoming:null,existing:e});
  return issues;
}
export function clearSchedule(current){
  return {...current,events:[],sources:[],days:{},pending:{},rosterSources:[],rosterReview:{},deletedSlots:[],undo:null,clearEpoch:(current.clearEpoch||0)+1};
}

