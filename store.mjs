import {blank,validate,validDate} from './domain.mjs';
export const empty = () => ({schema:1,events:[],sources:[],days:{},pending:{},revision:0});
const database = new Promise((resolve,reject)=>{
  const request=indexedDB.open('GigGuard',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('workspace');
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
  request.onblocked=()=>reject(Error('请关闭其他 GigGuard 页面后重试'));
});

export async function read() {
  const db=await database;
  return new Promise((resolve,reject)=>{
    const request=db.transaction('workspace').objectStore('workspace').get('personal');
    request.onsuccess=()=>resolve(request.result||empty());
    request.onerror=()=>reject(request.error);
  });
}

export async function commit(expected,change) {
  const db=await database;
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('workspace','readwrite'), store=tx.objectStore('workspace');
    const request=store.get('personal');
    let next,error;
    request.onsuccess=()=>{
      const current=request.result||empty();
      try {
        if(current.revision!==expected) throw Error('另一页面已更新数据，请核对后重试。');
        next=change(current);
        next.revision=current.revision+1;
        store.put(next,'personal');
      } catch(e) {error=e;tx.abort();}
    };
    tx.oncomplete=()=>resolve(next);
    tx.onabort=()=>reject(error||tx.error||Error('保存失败'));
  });
}
const snapshot = ({events,sources,days={},pending={},rosterSources=[],rosterImports={},rosterReview={},deletedSlots=[],defaultTeam=""})=>({events,sources,days,pending,rosterSources,rosterImports,rosterReview,deletedSlots,defaultTeam});
export function withUndo(current,updated) {
  return {...current,...updated,undo:snapshot(current)};
}
export function loadBackup(raw) {
  if(!raw||raw.schema!==1||!Array.isArray(raw.events)||!Array.isArray(raw.sources)) throw Error('无法读取此备份版本');
  if(raw.events.length>30000||raw.sources.length>30000) throw Error('备份超出容量限制');
  if(raw.sources.some(x=>typeof x!=='string'||!/^[a-f0-9]{64}$/.test(x))) throw Error('备份图片索引无效');
  const ids=new Set();
  const events=raw.events.map(row=>{
    if(!row||typeof row.id!=='string'||!row.id||ids.has(row.id)) throw Error('备份记录 ID 无效或重复');
    ids.add(row.id);
    const fields=blank();
    for(const key of Object.keys(fields)) {
      if(typeof row[key]!==typeof fields[key]) throw Error('备份字段类型无效：'+key);
      fields[key]=row[key];
    }
    const simple=row.source==="manual"||row.source==="roster"||['驻唱','婚礼'].includes(fields.kind);
    const error=validate(simple?{...fields,team:fields.team||fields.kind}:fields);
    if(error) throw Error('备份记录无效：'+error);
    return {...fields,...validateExtra(row),id:row.id,updatedAt:typeof row.updatedAt==='string'?row.updatedAt:''};
  });
  const map=(value,allowed)=>{
    if(value===undefined) return {};
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>30000||
       Object.entries(value).some(([date,status])=>!validDate(date)||!allowed.includes(status))) throw Error('备份日期状态无效');
    return Object.fromEntries(Object.entries(value));
  };
  const rosterSources=raw.rosterSources??[];
  if(!Array.isArray(rosterSources)||rosterSources.some(x=>!raw.sources.includes(x))) throw Error('月表索引无效');
  const rosterImports=Object.fromEntries(Object.entries(raw.rosterImports||{}).filter(([key,refs])=>
    rosterSources.includes(key)&&Array.isArray(refs)&&refs.length<=30000&&refs.every(id=>typeof id==='string')));
  return {events,sources:[...new Set(raw.sources)],days:map(raw.days,['gig','off','pending']),pending:map(raw.pending,['pending']),rosterSources:[...new Set(rosterSources)],rosterImports,rosterReview:map(raw.rosterReview,[true]),deletedSlots:Array.isArray(raw.deletedSlots)?raw.deletedSlots.filter(x=>typeof x==="string"&&/^\d{4}-\d{2}-\d{2}\/\d+$/.test(x)):[],defaultTeam:typeof raw.defaultTeam==="string"?raw.defaultTeam:""};
}

const ROSTER_FIELDS=["venue","start","end","lineup"];
function validateExtra(row){
  const fields={};
  for(const k of ['feeInput','tip','retainedDeposit']){
    if(row[k]===undefined)continue;
    if(row[k]!==null&&(!Number.isFinite(row[k])||row[k]<0||row[k]>1e7||Math.abs(Math.round(row[k]*100)-row[k]*100)>1e-5)) throw Error('备份金额无效');
    fields[k]=row[k];
  }
  for(const k of ['feePaid','tipPaid','teamEdited','kindEdited','kindReview']) if(typeof row[k]==='boolean') fields[k]=row[k];
  if(['manual','roster'].includes(row.source)) fields.source=row.source;
  if(['pending','confirmed','cancelled'].includes(row.bookingStatus)) fields.bookingStatus=row.bookingStatus;
  if(['booked','done','paid'].includes(row.priorStatus)) fields.priorStatus=row.priorStatus;
  if(validDate(row.rosterDate)) fields.rosterDate=row.rosterDate;
  if(Number.isInteger(row.slot)&&row.slot>=0) fields.slot=row.slot;
  if(Array.isArray(row.locked)) fields.locked=row.locked.filter(k=>['date',...ROSTER_FIELDS].includes(k));
  if(row.baseline&&typeof row.baseline==='object') fields.baseline=Object.fromEntries(ROSTER_FIELDS.map(k=>[k,typeof row.baseline[k]==='string'?row.baseline[k]:'']));
  return fields;
}


