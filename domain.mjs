export const ZONE = 'Asia/Kuala_Lumpur';
const DAY = 86400000;
const pad = n => String(n).padStart(2, '0');
export const today = () => new Intl.DateTimeFormat('sv-SE', {timeZone: ZONE, year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date());
export const addDays = (date,n) => new Date(Date.parse(date+'T00:00:00Z')+n*DAY).toISOString().slice(0,10);
export const validDate = date => typeof date === 'string' && /^\d{4}-\d\d-\d\d$/.test(date) && !isNaN(Date.parse(date)) && addDays(date,0) === date;
const validTime = time => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
export const blank = (date = '') => ({date,start:'',end:'',venue:'',team:'',lineup:'',kind:'演出',note:'',status:'booked',fee:0,deposit:0,balance:0});
export const statuses = {booked:'已安排', done:'已完成', paid:'已收清', cancelled:'已取消'};
export function validate(e) {
  if (!validDate(e.date)) return '请填写有效日期';
  if (!e.venue.trim() && !e.team.trim()) return '请填写场地或团队';
  if ([e.start,e.end].some(t => t && !validTime(t))) return '时间格式无效';
  if (e.start && e.start === e.end) return '开始和结束时间相同，请核对';
  if (![e.fee,e.deposit,e.balance].every(n => Number.isFinite(n) && n >= 0 && n <= 1e7 && Math.abs(n*100-Math.round(n*100))<1e-5)) return '金额须为有效的非负数，最多两位小数';
  if (Math.round(e.deposit*100)+Math.round(e.balance*100)>Math.round(e.fee*100)) return '已收金额超过总酬劳';
  if (!Object.hasOwn(statuses,e.status)) return '状态无效';
  return '';
}
export function interval(e) {
  if (!validDate(e.date)) return null;
  const base = Date.parse(e.date+'T00:00:00+08:00');
  if (!validTime(e.start) || !validTime(e.end) || e.start === e.end) return {from:base,to:base+DAY,unknown:true};
  const from=Date.parse(e.date+'T'+e.start+':00+08:00');
  const end=Date.parse(e.date+'T'+e.end+':00+08:00');
  return {from,to:end<from?end+DAY:end,unknown:false};
}
const normalize = s => s.normalize('NFKC').toLowerCase().replace(/[\s\p{P}]+/gu,'');
export const signature = e => JSON.stringify([e.date,e.start,e.end,normalize(e.venue),normalize(e.team),normalize(e.kind)]);
export function overlap(a,b) {
  const x=interval(a), y=interval(b);
  return a.status!=='cancelled' && b.status!=='cancelled' && x && y && x.from<y.to && y.from<x.to;
}
export function onDate(e,date) {
  const r=interval(e), base=Date.parse(date+'T00:00:00+08:00');
  return r && r.from<base+DAY && r.to>base;
}
export function flags(e, others) {
  return {
    duplicate:others.some(x=>signature(x)===signature(e)),
    conflict:others.some(x=>overlap(e,x)),
    missing:!e.start||!e.end
  };
}
export function timeLabel(e) {
  return e.start && e.end ? e.start+'–'+e.end+(e.end<e.start?' +1 日':'') : [e.start||'待定',e.end||'待定'].join('–');
}
const dateToken = /(?<![\d:])(?:(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?|(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{4}|\d{2}))?|(\d{1,2})月(\d{1,2})日)(?![\d:]|\s*(?:AM|PM)\b)/giu;
const range = /(?<!\d)(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\s*(AM|PM)?(?:\s*[-–—~～至到]\s*|(?<=M)\s+)(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\s*(AM|PM)?(?!\w)/iu;
const roster = /\b(SUN|MON|TUE|WED|THU|FRI|SAT)\b/i;
function parseTime(hour,min,period) {
  let h=Number(hour);
  if (period) {
    if (h<1 || h>12) return '';
    h=h%12+(period.toUpperCase()==='PM'?12:0);
  }
  const t=pad(h)+':'+(min||'00');
  return validTime(t)?t:'';
}
export function parseRows(lines, mode, year) {
  const rows=[], skipped=[], unresolved=[];
  let team='', previousDate='';
  for (const entry of lines) {
    const raw=typeof entry==='string'?entry:entry.text;
    const line=raw.normalize('NFKC').trim().replace(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu,'');
    if (!line) continue;
    const marks=[...line.matchAll(dateToken)];
    if (!marks.length && mode==='wedding' && /^(?:F\s*5|Paparazi)$/i.test(line)) {
      team=/^F/i.test(line)?'F5':'Paparazi'; continue;
    }
    if (!marks.length && (mode!=='roster' || !previousDate || !range.test(line))) {
      if (!/婚礼日期|^\d{1,2}:\d\d$/.test(line)) unresolved.push(raw);
      continue;
    }
    const chunks=marks.length?marks:[null];
    for (const [i,m] of chunks.entries()) {
      const date=m?[m[1] || (m[6]?.length===2?'20'+m[6]:m[6]) || year,pad(m[2]||m[5]||m[7]),pad(m[3]||m[4]||m[8])].join('-'):previousDate;
      if (!validDate(date)) {unresolved.push(raw);continue;}
      previousDate=date;
      const body=(m?line.slice(m.index+m[0].length,marks[i+1]?.index):line).replace(/^[\s)）|]+/,'').trim();
      if (mode==='roster' && /\bTAKE\s*OFF\b/i.test(body) && !entry.issue) {skipped.push(date);continue;}
      const weekday=body.match(roster)?.[0].toUpperCase();
      const expected=['SUN','MON','TUE','WED','THU','FRI','SAT'][new Date(date+'T00:00:00Z').getUTCDay()];
      const detail=mode==='roster'?body.replace(roster,'').replace(/^[\s|]+/,''):body;
      const performances=mode==='roster'?detail.split(/\s*[;；]\s*|\s+\|\s+(?=[\p{L}])/u):[detail];
      for (const original of performances) {
        const performance=original
          .replace(/(\d)\s+(\d)(?=\s*(?:AM|PM)\b)/gi,'$1$2')
          .replace(/(?:[({]\s*)?([234])\s*P\s*[(C]\s*[S5]\s*\)?$/i,'($1PCS)');
        const t=performance.match(range);
        const lineup=performance.match(/\b(SOLO|[234]\s*PCS)\b/i)?.[0].replace(/\s/g,'').toUpperCase()||'';
        const e=blank(date);
        if(t) {
          e.start=parseTime(t[1],t[2],t[3]||t[6]);
          e.end=parseTime(t[4],t[5],t[6]||t[3]);
        }
        if (mode==='wedding') {
          e.kind='婚礼';
          e.team=team;
          e.note=[(entry.green||/[✅✓✔]/u.test(performance))?'原图绿色勾号（含义待确认）':'',performance.replace(/[✅✓✔]/gu,'').replace(entry.green?/^\s*[vV]\s*$/:/$^/,'').trim()].filter(Boolean).join(' · ');
        } else {
          const rest=performance.replace(t?.[0]||/$^/,' ').replace(/\(?\b(?:SOLO|[234]\s*PCS)\b\)?/i,' ').trim();
          e.venue=rest.replace(/^[\s,|:-]+|[\s,|:-]+$/g,'');
          e.lineup=lineup;
        }
        rows.push({event:e,raw,confidence:entry.confidence??null,selected:true,ack:false,
          issues:[entry.issue,weekday&&weekday!==expected?'日期与星期不符':'',!m?'沿用上一行日期':'',m&&!m[1]&&!m[6]&&!m[7]?'使用所选年份':'',m?.[7]?'使用所选年份':'',entry.confidence!=null&&entry.confidence<78?'OCR 低置信度':'',!t&&mode==='roster'?'检查时间栏':''].filter(Boolean)});
      }
    }
  }
  return {rows,skipped,unresolved};
}

