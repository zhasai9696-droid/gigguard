import {blank,validDate,addDays,parseRows,interval,onDate} from './domain.mjs';

const normalized = text => text.normalize('NFKC').replace(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu,'');
const datePattern = /(?<![\d/])(?:\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?|\d{1,2}\/\d{1,2}\/\d{4}|\d{1,2}月\d{1,2}日)(?![\d/])/gu;
const pad = value => String(value).padStart(2,'0');
const ISO = (y,m,d) => [y,pad(m),pad(d)].join('-');
export function datesIn(text,year) {
  return [...normalized(text).matchAll(datePattern)].map(m=>{
    const parts=m[0].match(/\d+/g);
    if(parts.length===2) return ISO(year,...parts);
    return parts[0].length===4?ISO(...parts):ISO(parts[2],parts[1],parts[0]);
  }).filter(validDate);
}
const weekdays=['SUN','MON','TUE','WED','THU','FRI','SAT'];
export const eventLabel=/\b(?:EVENT|WEDDING|PARTY)\b|婚礼|婚禮|派对|派對/i;
const dayName=date=>weekdays[new Date(date+'T00:00:00Z').getUTCDay()];
function getTimes(text,date) {
  const cleaned=normalized(text).replace(/(\d)\s+(\d)(?=\s*(?:AM|PM)\b)/gi,'$1$2');
  const event=parseRows([date+' '+cleaned],'roster',date.slice(0,4)).rows[0]?.event;
  if(event?.start && event.end && event.start!==event.end) return {start:event.start,end:event.end};
  return {start:'',end:''};
}
export const gig=(date,kind,times={})=>({...blank(date),kind,...times});
export function readRoster(lines,year) {
  const found=new Map(), ambiguous=new Set(), anchors=new Map();
  for(const row of lines) {
    const text=normalized(row.text).trim();
    const match=text.match(/^(?:\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?|\d{1,2}\/\d{1,2}\/\d{4})(?![\d/])/);
    const date=match&&datesIn(match[0],year)[0];
    if(!date) continue;
    const body=text.slice(match[0].length).trim();
    const wd=(row.cells?.[1]||body).match(/^(SUN|MON|TUE|WED|THU|FRI|SAT)\b/i)?.[0].toUpperCase();
    // A date needs an independently matching weekday or a strong date cell.
    if((wd&&wd!==dayName(date))||(!wd&&(row.dateConfidence??row.confidence??0)<70)) continue;
    const month=date.slice(0,7);
    anchors.set(month,(anchors.get(month)||0)+1);
    if(found.has(date)) {ambiguous.add(date);continue;}
    if(/\bTAKE\s*OFF\b/i.test(body)) {found.set(date,{status:'off',events:[]});continue;}
    const performances=(row.cells?.slice(2).filter(Boolean).join(' ')||body.replace(/^(SUN|MON|TUE|WED|THU|FRI|SAT)\s+/i,'')).split(/\s*[;；]\s*/);
    const events=performances.map(part=>{
      const times=getTimes(part,date);
      const known=times.start||/\b(?:EVENT|SOLO|[234]\s*P[CS(]|SCLO)\b/i.test(part);
      const lineup=part.match(/\b(SOLO|SCLO|[234]\s*P\s*[(C]?\s*[S5]|[234]\s*0C5)\b/i)?.[0];
      const venue=part.replace(/\s*[{(]?\s*(?:SOLO|SCLO|[234]\s*P\s*[(C]?\s*[S5]|[234]\s*0C5)\)?\s*$/i,'')
        .replace(/\s+\d{1,2}(?::\d{2})?\s*(?:AM|PM)?\s*(?:[-–—~]|\s)\s*\d{1,2}(?::\d{2})?\s*(?:AM|PM)?\s*$/i,'')
        .replace(/\s+[A-Z0-9:]+\s*[-–]\s*\d[\d:]*\s*(?:AM|PM)\s*$/i,'')
        .replace(/\s+\d{1,2}(?::\d{2})?\s*(?:AM|PM)\s*[-–]\s*$/i,'')
        .trim().replace(/^HAIDILA[DC]$/i,'HAIDILAO');
      const kind=eventLabel.test(part)?'Event':'驻唱';
      return known||kind==='Event'?gig(date,kind,{...times,venue,lineup:lineup?(/^\d/.test(lineup)?lineup[0]+'ps':'Solo'):'',
        ...(!lineup&&kind==='驻唱'?{kindReview:true}:{})}):null;
    });
    found.set(date,events.every(Boolean)?{status:'gig',events}:{status:'pending',events:[]});
  }
  const month=[...anchors].sort((a,b)=>b[1]-a[1])[0]?.[0];
  const resolved=[...found].filter(([d,r])=>d.startsWith(month||'?')&&!ambiguous.has(d)&&r.status!=='pending').length;
  if(!month||resolved<3) throw Error('这张月表看不清，请换一张清楚的图片。');
  const days={};
  for(let date=month+'-01';date.startsWith(month);date=addDays(date,1)) {
    days[date]=!ambiguous.has(date)&&found.get(date)||{status:'pending',events:[]};
  }
  return {month,days};
}
const inquiry=/(?:有没有空|有空吗|可以吗|能接吗|问档|询问|待定|待确认|等(?:待)?[^。！？\n]{0,14}(?:答复|回复|确认)|还没确认|未确认|尚未确认|不确认|不能确认|未定|请确认|确认了吗|确认吗|取消|改期|\bavailable\b|\bavailability\b|not confirmed|pending|tentative|cancelled|canceled)/iu;
const confirmation=/(?:婚礼\s*(?:已)?确认|确认(?:接下|接档|这场|了)?\s*婚礼|婚礼\s*已定|已确认|已经确认|确定了|确认接档|\bconfirmed\b|\bbooking confirmed\b)/iu;
export function weddingIntent(text,year) {
  const source=normalized(text);
  const dates=[...new Set(datesIn(source,year))];
  if(dates.length!==1) return {type:'pending',dates};
  const [date]=dates;
  if(inquiry.test(source)) return {type:'lookup',date};
  if(!confirmation.test(source)) return {type:'pending',dates};
  return {type:'confirmed',date,event:gig(date,'婚礼',getTimes(source.replace(datePattern,''),date))};
}
export function collision(events,date) {
  const base=Date.parse(date+'T00:00:00+08:00'), end=base+86400000;
  const active=events.filter(e=>e.status!=='cancelled'&&e.bookingStatus!=='cancelled'&&onDate(e,date));
  let clash=false, uncertain=false;
  for(let i=0;i<active.length;i++) {
    const a=interval(active[i]);
    for(const other of active.slice(i+1)) {
      const b=interval(other);
      if(Math.max(a.from,b.from,base)>=Math.min(a.to,b.to,end)) continue;
      if(a.unknown||b.unknown) uncertain=true;
      else clash=true;
    }
  }
  return {active,clash,uncertain};
}

