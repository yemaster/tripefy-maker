import {createId, NOTE_TYPES} from './model.js';
import {snapHorizontal, constrainHorizontalShift} from './lanes.js';
import {completeGroupIds} from './groups.js';
const copy = value => structuredClone(value);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function copySelection(chart, ids, eventIds = new Set()) {
  const notes=chart.notes.filter(n=>ids.has(n.id)),groups=(chart.groups||[]).filter(group=>notes.some(note=>note.group===group.id));
  const targets=new Set([...ids,...groups.map(group=>group.id)]);
  return {notes:copy(notes),events:copy((chart.events||[]).filter(e=>targets.has(e.target)||eventIds.has(e.id))),
    ...(eventIds.size?{selectedEventIds:[...eventIds]}:{}),...(groups.length?{groups:copy(groups)}:{})};
}

export function pasteSelection(chart, clipboard, effectiveStart, {mirror = false} = {}) {
  if(!clipboard.notes.length) return [];
  if(!Number.isFinite(effectiveStart)) throw new Error('粘贴时间必须是有效数字。');
  const explicitEvents=new Set(clipboard.selectedEventIds||[]);
  const origin=Math.min(clipboard.notes.reduce((minimum,n)=>Math.min(minimum,n.time),Infinity),...(clipboard.events||[]).filter(e=>explicitEvents.has(e.id)).map(e=>e.time));
  const selectedIds=new Set(clipboard.notes.map(n=>n.id));
  for(const group of clipboard.groups||[])selectedIds.add(group.id);
  const attachedEvents=(clipboard.events||[]).filter(e=>selectedIds.has(e.target)||explicitEvents.has(e.id));
  const earliest=attachedEvents.reduce((minimum,e)=>Math.min(minimum,e.time),origin);
  const shift=Math.max(effectiveStart-chart.offset-origin,Math.max(0,-chart.offset)-earliest);
  const ids=new Map(clipboard.notes.map(n=>[n.id,createId()]));
  for(const group of clipboard.groups||[])ids.set(group.id,createId());
  const groups=(clipboard.groups||[]).map(group=>({...copy(group),id:ids.get(group.id),name:`${group.name.slice(0,77)} 副本`,hidden:false,locked:false}));
  const notes=clipboard.notes.map(n=>({...copy(n),id:ids.get(n.id),...(n.group?{group:ids.get(n.group)||n.group}:{}),time:n.time+shift}));
  const events=attachedEvents.map(e=>({...copy(e),id:createId(),target:ids.get(e.target)||e.target,time:e.time+shift}));
  if(mirror) mirrorSelection({notes,events,groups},new Set(notes.map(note=>note.id)));
  if(groups.length)(chart.groups||=[]).push(...groups);
  chart.notes.push(...notes);(chart.events ||= []).push(...events);
  chart.duration=notes.reduce((end,n)=>Math.max(end,n.time+chart.offset+n.duration),chart.duration);
  chart.duration=events.reduce((end,e)=>Math.max(end,e.time+chart.offset+e.duration),chart.duration);
  return notes.map(n=>n.id);
}

export function deleteSelection(chart, ids) {
  chart.notes=chart.notes.filter(n=>!ids.has(n.id));
  chart.events=(chart.events||[]).filter(e=>!ids.has(e.target));
}

export function mirrorSelection(chart, ids) {
  const groupIds=new Set();
  for(const group of [...chart.groups||[]]){
    const members=chart.notes.filter(note=>note.group===group.id),selected=members.filter(note=>ids.has(note.id));
    if(!selected.length)continue;
    if(selected.length===members.length){groupIds.add(group.id);group.x=-(group.x||0);continue;}
    // A shared group animation must not change unselected notes.
    const next={...copy(group),id:createId(),name:`${group.name.slice(0,77)} 镜像`,x:-(group.x||0)};
    chart.groups.push(next);for(const note of selected)note.group=next.id;
    chart.events.push(...chart.events.filter(event=>event.target===group.id).map(event=>({...copy(event),id:createId(),target:next.id})));
    groupIds.add(next.id);
  }
  chart.notes.forEach(n=>{if(ids.has(n.id)){n.x=1-n.x;n.path?.forEach(p=>p.x=1-p.x);}});
  chart.events?.forEach(e=>{if((ids.has(e.target)||groupIds.has(e.target))&&e.property==='x'){e.from=-e.from;e.to=-e.to;if(e.valueMode)e.value=-e.value;}});
}

export function alignSelection(chart, ids, mode) {
  for (const note of chart.notes) if (ids.has(note.id)) {
    note.x = snapHorizontal(note.x, mode);
    for (const node of note.path || []) node.x = snapHorizontal(node.x, mode);
  }
}

/** Translate the snapshot into destination; preserve the relative arrangement and attached automation. */
export function moveSelection(destination, snapshot, ids, dt, dx, horizontalStep = 0, eventIds = new Set()) {
  if(!Number.isFinite(dt)||!Number.isFinite(dx)) throw new Error('移动距离必须是有效数字。');
  const destinationNotes=new Map(destination.notes.map(n=>[n.id,n]));
  const destinationEvents=new Map((destination.events||[]).map(e=>[e.id,e]));
  const notes=snapshot.notes.filter(n=>ids.has(n.id)&&destinationNotes.has(n.id));
  const existingIds=new Set(notes.map(n=>n.id));
  const targets=new Set([...existingIds,...completeGroupIds(snapshot,existingIds)]);
  const events=(snapshot.events||[]).filter(e=>(targets.has(e.target)||eventIds.has(e.id))&&destinationEvents.has(e.id));
  if(!notes.length&&!events.length)return;
  let first=Infinity,last=-Infinity,left=Infinity,right=-Infinity;
  for(const n of notes){
    first=Math.min(first,n.time);last=Math.max(last,n.time+n.duration);
    left=Math.min(left,n.x);right=Math.max(right,n.x);
    for(const p of n.path||[]){left=Math.min(left,p.x);right=Math.max(right,p.x);}
  }
  for(const e of events){first=Math.min(first,e.time);last=Math.max(last,e.time+e.duration);}
  const minimumTime=Math.max(0,-destination.offset)-first;
  const maximumTime=destination.duration-destination.offset-last;
  if(minimumTime>maximumTime+1e-9) throw new Error('所选内容无法放入当前谱面长度。');
  const shiftTime=clamp(dt,minimumTime,Math.max(minimumTime,maximumTime));
  const shiftX=notes.length?constrainHorizontalShift(dx,-left,1-right,horizontalStep):0;
  for(const source of notes){
    const n=destinationNotes.get(source.id);
    n.time=source.time+shiftTime;n.x=source.x+shiftX;n.path=(source.path||[]).map(p=>({...p,x:p.x+shiftX}));
  }
  for(const source of events)destinationEvents.get(source.id).time=source.time+shiftTime;
}

export function resizeHold(note, duration) {
  if(!Number.isFinite(duration)) throw new Error('长按长度必须是有效数字。');
  duration=Math.max(0,duration);
  const old=note.duration;
  note.duration=duration;
  if(duration<=0){if(note.type==='hold')note.type='tap';note.path=[];return;}
  note.type='hold';
  if(old>0&&note.path?.length) note.path=note.path.map(p=>({...p,time:p.time/old*duration}));
  else note.path=[{time:0,x:note.x,curve:'smooth'},{time:duration,x:note.x,curve:'smooth'}];
  note.path[0].time=0;note.path[0].x=note.x;note.path[note.path.length-1].time=duration;
}

/** Keep type conversions atomic so undo restores the complete path and timing. */
export function changeNoteType(note, type, defaultDuration = .5) {
  if (!NOTE_TYPES.includes(type)) throw new Error('音符类型无效。');
  if (type === 'hold') {
    const duration = note.duration > 0 ? note.duration : defaultDuration;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('此位置没有足够的 Hold 长度。');
    resizeHold(note, duration);
  } else {
    note.duration = 0;
    note.path = [];
  }
  note.type = type;
}
