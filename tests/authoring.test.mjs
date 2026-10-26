import test from 'node:test';
import assert from 'node:assert/strict';
import {createBlankChart,validateChart,serializeChart,History,snapTime} from '../src/editor/model.js';
import {createGroup,assignGroup,dissolveGroup,noteEditable,noteVisible} from '../src/editor/groups.js';
import {copySelection,pasteSelection,mirrorSelection,moveSelection} from '../src/editor/operations.js';
import {BUILTIN_PRESETS,applyPreset,presetFromEvents,pasteEvents} from '../src/editor/presets.js';
import {beatAtTime,timeAtBeat,secondsForBeats} from '../src/editor/timing.js';
import {stepTime} from '../src/editor/navigation.js';
import {noteX,noteOpacity,eventValue,scrollDistance} from '../src/editor/animation.js';
const near=(a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const fixture=()=>validateChart({...createBlankChart(),bpm:120,offset:.25,duration:40,notes:[{id:'a',time:8,x:.2,duration:0},{id:'b',time:9,x:.7,duration:2}]});
const event=(target,property,layer=0)=>({id:`${target}-${property}-${layer}`,target,property,time:1,duration:2,from:property==='x'?0:1,to:property==='x'?.1:property==='opacity'?.5:2,curve:'easeInOut',layer});

test('groups, timing points, presets and four event layers survive export; legacy stays v1',()=>{
  const c=fixture(),id=createGroup(c,new Set(['a','b']),'旋律');c.bpmChanges=[{time:4,bpm:180}];
  c.animationPresets=[BUILTIN_PRESETS[0]];c.events=[event(id,'speed'),event(id,'speed',1)];
  const normalized=validateChart(JSON.parse(serializeChart(c)));
  assert.equal(normalized.version,2);assert.equal(normalized.groups[0].name,'旋律');assert.equal(normalized.notes[0].group,id);
  assert.equal(normalized.events[1].layer,1);assert.equal(normalized.bpmChanges[0].bpm,180);assert.equal(normalized.animationPresets.length,1);
  assert.equal(validateChart(fixture()).version,1);
  for(const modify of [x=>x.notes[0].group='missing',x=>x.groups[0].id='a',x=>x.events[0].layer=4,x=>x.groups[0].speed=0,x=>x.bpmChanges.push({time:4,bpm:120}),x=>x.events.push({...x.events[0],id:'duplicate'})]){
    const bad=structuredClone(normalized);modify(bad);assert.throws(()=>validateChart(bad));
  }
});
test('hiding and locking groups only affect editing, and dissolving preserves member notes',()=>{
  const c=fixture(),id=createGroup(c,new Set(['a']));c.events=[event(id,'x'),event('a','opacity')];const state={chart:c,view:'edit',groupFilter:'all'};
  c.groups[0].locked=true;assert.equal(noteEditable(c.notes[0],state),false);assert.equal(noteVisible(c.notes[0],state),true);
  c.groups[0].hidden=true;assert.equal(noteVisible(c.notes[0],state),false);assert.equal(noteVisible(c.notes[0],{...state,view:'preview'}),true);
  assert.throws(()=>assignGroup(c,new Set(['b']),id));
  dissolveGroup(c,id);assert.equal(c.notes.length,2);assert.equal(c.notes[0].group,undefined);assert.deepEqual(c.events.map(e=>e.target),['a']);
});
test('copying part of a group clones group automation and remaps references without affecting originals',()=>{
  const c=fixture(),id=createGroup(c,new Set(['a','b']));c.events=[event(id,'x'),event('a','opacity')];
  const source=copySelection(c,new Set(['a'])),ids=pasteSelection(c,source,15.25);const pasted=c.notes.find(n=>n.id===ids[0]);
  assert.notEqual(pasted.group,id);assert.equal(c.groups.length,2);assert.equal(c.events.filter(e=>e.target===pasted.group).length,1);
  assert.equal(c.notes.find(n=>n.id==='b').group,id);validateChart(c);
});
test('partial mirror isolates group transforms; whole group mirror and time movement preserve other members',()=>{
  const c=fixture(),id=createGroup(c,new Set(['a','b']));c.groups[0].x=.05;c.events=[event(id,'x')];const before=structuredClone(c);
  mirrorSelection(c,new Set(['a']));const a=c.notes.find(n=>n.id==='a');
  near(noteX(c,a,2.25),1-noteX(before,before.notes[0],2.25));near(noteX(c,c.notes[1],2.25),noteX(before,before.notes[1],2.25));
  const full=structuredClone(before);mirrorSelection(full,new Set(['a','b']));near(full.groups[0].x,-.05);near(full.events[0].to,-.1);
  moveSelection(full,structuredClone(full),new Set(['a','b']),2,0);near(full.events[0].time,3);validateChart(full);
});
test('beat mapping is continuous and reversible across changing BPM, offsets and tuplets',()=>{
  const c=fixture();c.bpmChanges=[{time:2,bpm:180},{time:5,bpm:75}];
  near(beatAtTime(c,2.25),4);near(beatAtTime(c,5.25),13);
  for(let t=-1;t<40;t+=.137)near(timeAtBeat(c,beatAtTime(c,t)),t);
  for(const division of [3,5,7])for(const t of [2.2,2.3,5.2,5.3,10]){
    const snapped=snapTime(t,c,division);near(beatAtTime(c,snapped)*division,Math.round(beatAtTime(c,snapped)*division));
    assert.ok(stepTime(t,1,c,division)>t);assert.ok(stepTime(t,-1,c,division)<t);
  }
  near(secondsForBeats(c,1.75,4),.5+1);
});
test('preset expansion honors beat changes, repeat, stagger, strength, layers and per-note ending',()=>{
  const c=fixture();c.bpmChanges=[{time:2,bpm:180}];
  const ids=applyPreset(c,BUILTIN_PRESETS[3],['a','b'],{start:1.25,beats:4,repeat:2,stagger:1,amount:.5,layer:2});
  assert.equal(ids.length,4);near(c.events[0].duration,1+2/3);near(c.events[0].from,-.125);assert.equal(c.events[0].layer,2);validateChart(c);
  const aligned=fixture();applyPreset(aligned,BUILTIN_PRESETS[0],['a'],{start:0,beats:2,repeat:2,relative:true});
  near(aligned.events.at(-1).time+aligned.events.at(-1).duration,aligned.notes[0].time);
});
test('all built-in presets are editable ordinary events, conflict replacement and undo are atomic',()=>{
  for(const preset of BUILTIN_PRESETS){const c=fixture();applyPreset(c,preset,['a'],{start:2.25});validateChart(c);}
  const c=fixture(),history=new History();history.push(c);applyPreset(c,BUILTIN_PRESETS[0],['a'],{start:2.25});
  const before=JSON.stringify(c);assert.throws(()=>applyPreset(c,BUILTIN_PRESETS[0],['a'],{start:2.25}));assert.equal(JSON.stringify(c),before);
  applyPreset(c,BUILTIN_PRESETS[1],['a'],{start:2.25,replace:true});assert.equal(c.events.length,1);near(c.events[0].to,0);
  assert.equal(history.undo(c).events.length,0);
});
test('custom presets capture normalized multi-layer events; event clipboard preserves intervals',()=>{
  const c=fixture();c.events=[event('a','x',1),event('a','opacity',2)];const preset=presetFromEvents(c.events,'出现');
  assert.equal(preset.events[0].time,0);assert.equal(preset.events[0].duration,1);assert.deepEqual(preset.events.map(e=>e.layer),[0,1]);
  applyPreset(c,preset,['b'],{start:6.25,beats:3,layer:1});validateChart(c);
  const ids=pasteEvents(c,c.events.slice(0,2),20.25,'b');assert.equal(ids.length,2);near(c.events.at(-1).time,20);validateChart(c);
  assert.throws(()=>presetFromEvents(c.events,'混合目标'));assert.throws(()=>applyPreset(c,preset,['a'],{start:39.25,beats:8}));
});
test('global, group and note animation layers compose and exact speed integration matches independent quadrature',()=>{
  const c=fixture(),id=createGroup(c,new Set(['a']));c.groups[0].x=.05;c.groups[0].opacity=.8;c.groups[0].speed=1.3;
  for(const target of ['all',id,'a'])for(const property of ['speed','x','opacity'])for(const layer of [0,1,2,3]){
    const e=event(target,property,layer);e.to=property==='speed'?1.2:property==='opacity'?.9:.01;e.curve=['linear','easeIn','easeOut','easeInOut'][layer];c.events.push(e);
  }
  const chart=validateChart(c),note=chart.notes[0];near(noteX(chart,note,4),.37);near(noteOpacity(chart,note,4),.8*.9**12);
  for(const [a,b] of [[0,4],[1.25,2.25],[2.25,3.25],[7,1],[1.9,2.7]]){
    const low=Math.min(a,b),high=Math.max(a,b),steps=12000,dt=(high-low)/steps;
    const speed=t=>1.3*['all',id,'a'].reduce((v,target)=>v*eventValue(chart,'speed',t,target),1);
    let sum=speed(low)+speed(high);for(let i=1;i<steps;i++)sum+=(i%2?4:2)*speed(low+i*dt);
    near(scrollDistance(chart,note,a,b),sum*dt/3*Math.sign(b-a),2e-7);
  }
});
