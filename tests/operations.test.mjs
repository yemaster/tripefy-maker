import test from 'node:test';
import assert from 'node:assert/strict';
import {createBlankChart,validateChart} from '../src/editor/model.js';
import {copySelection,pasteSelection,moveSelection,mirrorSelection,deleteSelection,resizeHold,changeNoteType} from '../src/editor/operations.js';
function fixture(){const c=createBlankChart();c.notes=[{id:'a',time:2,x:.2,duration:2,opacity:.6,speed:1.4,path:[{time:0,x:.2,curve:'linear'},{time:1,x:.8,curve:'easeInOut'},{time:2,x:.5,curve:'linear'}]},{id:'b',time:3,x:.4,duration:0}];c.events=[{id:'e',target:'a',property:'opacity',time:1,duration:1,from:1,to:.5,curve:'linear'}];return validateChart(c);}
test('multi-note paste preserves paths, opacity, speed, timing and remaps attached events',()=>{const c=fixture();const cb=copySelection(c,new Set(['a','b']));const ids=pasteSelection(c,cb,10);const a=c.notes.find(n=>n.id===ids[0]);assert.equal(a.time,10);assert.equal(c.notes.find(n=>n.id===ids[1]).time,11);assert.deepEqual(a.path,cb.notes[0].path);assert.equal(a.opacity,.6);assert.equal(a.speed,1.4);assert.equal(c.events[1].target,a.id);assert.equal(c.events[1].time,9);assert.notEqual(c.events[1].id,'e');validateChart(c);});
test('group movement constrains all curve nodes and moves attached events together',()=>{const before=fixture(),after=structuredClone(before);moveSelection(after,before,new Set(['a','b']),4,.7);assert.ok(Math.abs(after.notes[0].path[1].x-1)<1e-9);assert.ok(Math.abs(after.notes[1].x-.6)<1e-9);assert.equal(after.notes[0].time,6);assert.equal(after.events[0].time,5);validateChart(after);});
test('mirror and deletion include path nodes and target events',()=>{const c=fixture();mirrorSelection(c,new Set(['a']));assert.equal(c.notes[0].x,.8);assert.ok(Math.abs(c.notes[0].path[1].x-.2)<1e-9);deleteSelection(c,new Set(['a']));assert.equal(c.notes.length,1);assert.equal(c.events.length,0);validateChart(c);});
test('resizing a curve preserves relative node timing',()=>{const c=fixture(),n=c.notes[0];resizeHold(n,4);assert.deepEqual(n.path.map(p=>p.time),[0,2,4]);validateChart(c);resizeHold(n,0);assert.deepEqual(n.path,[]);});

test('type conversion clears incompatible paths and preserves other attributes',()=>{
  const c=fixture(),n=c.notes[0],old=structuredClone(n);
  changeNoteType(n,'hold');assert.deepEqual(n,old);
  changeNoteType(n,'heartap');assert.equal(n.duration,0);assert.deepEqual(n.path,[]);
  assert.equal(n.opacity,old.opacity);assert.equal(n.speed,old.speed);assert.equal(n.id,old.id);
  changeNoteType(n,'drag');assert.equal(n.type,'drag');
  changeNoteType(n,'hold',.75);assert.equal(n.duration,.75);
  assert.deepEqual(n.path,[{time:0,x:n.x,curve:'smooth'},{time:.75,x:n.x,curve:'smooth'}]);
  resizeHold(n,0);assert.equal(n.type,'tap');validateChart(c);
  assert.throws(()=>changeNoteType(n,'hold',0),/长度/);
  assert.throws(()=>changeNoteType(n,'unknown'),/类型/);
});

test('copy, paste and mirror retain every note type',()=>{
  const c=fixture();changeNoteType(c.notes[1],'drag');
  c.notes.push({...structuredClone(c.notes[1]),id:'purple',type:'heartap',time:4});
  const types=c.notes.map(n=>n.type),ids=new Set(c.notes.map(n=>n.id));
  mirrorSelection(c,ids);const pasted=pasteSelection(c,copySelection(c,ids),10);
  assert.deepEqual(c.notes.filter(n=>pasted.includes(n.id)).map(n=>n.type),types);
  validateChart(c);
});

test('clipboard is independent and excludes global or unselected automation',()=>{
  const c=fixture();c.events.push({id:'global',target:'all',property:'x',time:0,duration:0,from:0,to:.1,curve:'linear'});
  const clipboard=copySelection(c,new Set(['a']));
  assert.deepEqual(clipboard.notes.map(n=>n.id),['a']);assert.deepEqual(clipboard.events.map(e=>e.id),['e']);
  clipboard.notes[0].path[1].x=.1;clipboard.events[0].to=.2;
  assert.equal(c.notes[0].path[1].x,.8);assert.equal(c.events[0].to,.5);
});

test('paste clamps the whole group including earlier events at negative offsets',()=>{
  const source=fixture(),clipboard=copySelection(source,new Set(['a','b']));
  const target=createBlankChart();target.offset=-2;target.duration=2;
  const ids=pasteSelection(target,clipboard,0);
  assert.equal(target.notes.find(n=>n.id===ids[0]).time+target.offset,1);
  assert.equal(target.events[0].time+target.offset,0);
  assert.equal(target.notes.find(n=>n.id===ids[1]).time-target.notes[0].time,1);
  assert.equal(target.duration,3);validateChart(target);
  target.notes[0].path[1].x=.2;assert.equal(clipboard.notes[0].path[1].x,.8);
});

test('paste extends duration for attached events and accepts legacy event omissions',()=>{
  const source=fixture();source.events[0].time=20;source.events[0].duration=5;
  const target=createBlankChart();target.duration=1;
  pasteSelection(target,copySelection(source,new Set(['a'])),10);
  assert.equal(target.duration,33);validateChart(target);
  const legacy=createBlankChart();delete legacy.events;
  const result=pasteSelection(legacy,{notes:[{id:'old',time:2,x:.2,duration:0}]},3);
  assert.equal(result.length,1);assert.deepEqual(legacy.events,[]);validateChart(legacy);
  assert.deepEqual(pasteSelection(legacy,{notes:[]},0),[]);
});

test('group movement is snapshot based and respects both time edges including events',()=>{
  const before=fixture();before.offset=-.5;
  const after=structuredClone(before);moveSelection(after,before,new Set(['a','b']),-100,-100);
  assert.equal(after.events[0].time+after.offset,0);assert.equal(after.notes[0].time,1.5);
  assert.equal(after.notes[0].x,0);assert.equal(after.notes[0].path[0].x,0);
  moveSelection(after,before,new Set(['a','b']),2,.1);
  assert.equal(after.notes[0].time,4);assert.ok(Math.abs(after.notes[0].x-.3)<1e-9);
  assert.equal(before.notes[0].time,2);assert.equal(before.notes[0].x,.2);
  const shorter=structuredClone(before);shorter.duration=6;shorter.offset=1;
  moveSelection(shorter,before,new Set(['a','b']),100,0);
  assert.equal(shorter.notes[0].time,3);assert.equal(shorter.notes[0].time+shorter.offset+shorter.notes[0].duration,6);
  validateChart(after);validateChart(shorter);
});

test('mirror flips selected local x events and leaves global events unchanged',()=>{
  const chart=fixture();chart.events.push(
    {id:'local-x',target:'a',property:'x',time:1,duration:2,from:-.1,to:.2,curve:'easeOut'},
    {id:'global-x',target:'all',property:'x',time:1,duration:2,from:-.1,to:.2,curve:'easeOut'});
  const before=structuredClone(chart);mirrorSelection(chart,new Set(['a']));
  assert.equal(chart.events.find(e=>e.id==='local-x').from,.1);
  assert.equal(chart.events.find(e=>e.id==='local-x').to,-.2);
  assert.deepEqual(chart.events.find(e=>e.id==='global-x'),before.events.find(e=>e.id==='global-x'));
  assert.deepEqual(chart.notes[1],before.notes[1]);
  mirrorSelection(chart,new Set(['a']));
  for(let i=0;i<chart.notes[0].path.length;i++)assert.ok(Math.abs(chart.notes[0].path[i].x-before.notes[0].path[i].x)<1e-9);
  validateChart(chart);deleteSelection(chart,new Set(['a']));
  assert.deepEqual(chart.events.map(e=>e.id),['global-x']);validateChart(chart);
});

test('resizing clamps negative lengths to taps and rejects non-finite input without mutation',()=>{
  const hold=fixture().notes[0];const before=structuredClone(hold);
  assert.throws(()=>resizeHold(hold,Infinity),/有效数字/);assert.deepEqual(hold,before);
  resizeHold(hold,-1);assert.equal(hold.duration,0);assert.deepEqual(hold.path,[]);
  resizeHold(hold,3);assert.deepEqual(hold.path,[{time:0,x:.2,curve:'smooth'},{time:3,x:.2,curve:'smooth'}]);
});

test('invalid moves fail before mutation, and long paths do not overflow argument limits',()=>{
  const source=fixture(),target=structuredClone(source),before=structuredClone(target);
  assert.throws(()=>moveSelection(target,source,new Set(['a']),NaN,0),/有效数字/);assert.deepEqual(target,before);
  target.duration=.1;const shortBefore=structuredClone(target);
  assert.throws(()=>moveSelection(target,source,new Set(['a']),0,0),/无法放入/);assert.deepEqual(target,shortBefore);
  const long=createBlankChart();long.notes=[{id:'long',time:1,x:.2,duration:100,path:Array.from({length:150001},(_,i)=>({time:i/1500,x:.2+(i%2)*.6,curve:'linear'}))}];
  const moved=structuredClone(long);moveSelection(moved,long,new Set(['long']),0,.7);
  assert.ok(Math.abs(moved.notes[0].path[1].x-1)<1e-9);
});
