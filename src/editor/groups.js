import {createId} from './model.js';
const cache = new WeakMap();
const noteIndexes = new WeakMap();
export function groupMap(chart) {
  let entry=cache.get(chart);
  if(!entry||entry.source!==chart.groups||entry.length!==(chart.groups||[]).length){entry={length:(chart.groups||[]).length,source:chart.groups,map:new Map((chart.groups||[]).map(group=>[group.id,group]))};cache.set(chart,entry);}
  return entry.map;
}
export function noteVisible(note,state) {
  if(state.view==='preview')return true;
  const group=groupMap(state.chart).get(note.group),filter=state.groupFilter||'all';
  return !group?.hidden&&(filter==='all'||filter===(note.group||'ungrouped'));
}
export function noteEditable(note,state) { return noteVisible(note,state)&&!groupMap(state.chart).get(note.group)?.locked; }
export function targetEditable(chart,target) {
  let index=noteIndexes.get(chart);
  if(!index||index.source!==chart.notes||index.length!==chart.notes.length){index={source:chart.notes,length:chart.notes.length,notes:new Map(chart.notes.map(note=>[note.id,note]))};noteIndexes.set(chart,index);}
  const group=groupMap(chart).get(target)||groupMap(chart).get(index.notes.get(target)?.group);
  return !group?.locked;
}
export function createGroup(chart,ids=new Set(),name='新建组') {
  const id=createId();
  (chart.groups||=[]).push({id,name,x:0,opacity:1,speed:1,hidden:false,locked:false});
  for(const note of chart.notes)if(ids.has(note.id))note.group=id;
  return id;
}
export function assignGroup(chart,ids,groupId) {
  if(groupId&&!chart.groups?.some(group=>group.id===groupId))throw new Error('目标组不存在。');
  if(groupId&&chart.groups.find(group=>group.id===groupId).locked)throw new Error('请先解锁目标组。');
  for(const note of chart.notes)if(ids.has(note.id)){if(groupId)note.group=groupId;else delete note.group;}
}
export function dissolveGroup(chart,id) {
  chart.groups=(chart.groups||[]).filter(group=>group.id!==id);
  for(const note of chart.notes)if(note.group===id)delete note.group;
  chart.events=chart.events.filter(event=>event.target!==id);
}
export function completeGroupIds(chart,ids) {
  const counts=new Map();
  for(const note of chart.notes)if(note.group){
    const pair=counts.get(note.group)||[0,0];pair[0]++;if(ids.has(note.id))pair[1]++;counts.set(note.group,pair);
  }
  return new Set([...counts].filter(([,pair])=>pair[0]===pair[1]).map(([id])=>id));
}
