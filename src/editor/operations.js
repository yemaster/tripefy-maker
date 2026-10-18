import {createId} from './model.js';
const copy = value => structuredClone(value);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function copySelection(chart, ids) {
  return {notes:copy(chart.notes.filter(n=>ids.has(n.id))), events:copy((chart.events||[]).filter(e=>ids.has(e.target)))};
}

export function pasteSelection(chart, clipboard, effectiveStart) {
  if(!clipboard.notes.length) return [];
  if(!Number.isFinite(effectiveStart)) throw new Error('粘贴时间必须是有效数字。');
  const origin=clipboard.notes.reduce((minimum,n)=>Math.min(minimum,n.time),Infinity);
  const selectedIds=new Set(clipboard.notes.map(n=>n.id));
  const attachedEvents=(clipboard.events||[]).filter(e=>selectedIds.has(e.target));
  const earliest=attachedEvents.reduce((minimum,e)=>Math.min(minimum,e.time),origin);
  const shift=Math.max(effectiveStart-chart.offset-origin,Math.max(0,-chart.offset)-earliest);
  const ids=new Map(clipboard.notes.map(n=>[n.id,createId()]));
  const notes=clipboard.notes.map(n=>({...copy(n),id:ids.get(n.id),time:n.time+shift}));
  const events=attachedEvents.map(e=>({...copy(e),id:createId(),target:ids.get(e.target),time:e.time+shift}));
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
  chart.notes.forEach(n=>{if(ids.has(n.id)){n.x=1-n.x;n.path?.forEach(p=>p.x=1-p.x);}});
  chart.events?.forEach(e=>{if(ids.has(e.target)&&e.property==='x'){e.from=-e.from;e.to=-e.to;}});
}

/** Translate the snapshot into destination; preserve the relative arrangement and attached automation. */
export function moveSelection(destination, snapshot, ids, dt, dx) {
  if(!Number.isFinite(dt)||!Number.isFinite(dx)) throw new Error('移动距离必须是有效数字。');
  const destinationNotes=new Map(destination.notes.map(n=>[n.id,n]));
  const destinationEvents=new Map((destination.events||[]).map(e=>[e.id,e]));
  const notes=snapshot.notes.filter(n=>ids.has(n.id)&&destinationNotes.has(n.id));
  if(!notes.length)return;
  const existingIds=new Set(notes.map(n=>n.id));
  const events=(snapshot.events||[]).filter(e=>existingIds.has(e.target)&&destinationEvents.has(e.id));
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
  const shiftX=clamp(dx,-left,1-right);
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
  if(duration<=0){note.path=[];return;}
  if(old>0&&note.path?.length) note.path=note.path.map(p=>({...p,time:p.time/old*duration}));
  else note.path=[{time:0,x:note.x,curve:'linear'},{time:duration,x:note.x,curve:'linear'}];
  note.path[0].time=0;note.path[0].x=note.x;note.path[note.path.length-1].time=duration;
}
