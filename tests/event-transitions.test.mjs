import test from 'node:test';
import assert from 'node:assert/strict';
import {createBlankChart,validateChart,serializeChart,History} from '../src/editor/model.js';
import {eventValue,scrollDistance,invalidateAnimationCache} from '../src/editor/animation.js';
import {setEventValueMode} from '../src/editor/event-values.js';
import {BUILTIN_PRESETS,applyPreset,presetFromEvents,pasteEvents} from '../src/editor/presets.js';
const near=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const event=(id,time,value,options={})=>({id,time,duration:1,target:'all',property:'x',valueMode:'end',value,curve:'easeInOut',...options});
const chart=events=>validateChart({...createBlankChart(),bpm:120,offset:.25,notes:[{id:'a',time:8,x:.5,duration:0}],events});

test('end and delta events inherit channel state through gaps, edits, deletion, moves and undo',()=>{
  let c=chart([event('a',1,.2),event('b',3,-.1,{valueMode:'delta'}),event('c',5,.4)]);
  near(c.events[1].from,.2);near(c.events[1].to,.1);near(c.events[2].from,.1);
  const history=new History();history.push(c);c.events[0].value=.5;c=validateChart(c);
  near(c.events[1].from,.5);near(c.events[1].to,.4);near(c.events[2].from,.4);
  c=history.undo(c);near(c.events[1].from,.2);
  c.events=c.events.filter(e=>e.id!=='a');c=validateChart(c);near(c.events[0].from,0);near(c.events[0].to,-.1);
  c.events.find(e=>e.id==='c').time=0;c=validateChart(c);near(c.events[1].from,.4);near(c.events[1].to,.3);
});

test('auto channels remain independent of groups and layers; legacy explicit values survive roundtrip',()=>{
  const c=chart([event('a',1,.3),event('b',2,-.1,{layer:1}),event('c',3,.1,{target:'a',valueMode:'delta'}),
    {id:'old',target:'a',property:'opacity',time:0,duration:1,from:.2,to:.6,curve:'linear'}]);
  near(c.events.find(e=>e.id==='b').from,0);near(c.events.find(e=>e.id==='c').from,0);
  const old=JSON.parse(serializeChart(c)).events.find(e=>e.id==='old');near(old.from,.2);assert.equal(old.valueMode,undefined);
  const switched=c.events.find(e=>e.id==='a');setEventValueMode(switched,'delta');near(switched.value,.3);setEventValueMode(switched,'end');near(switched.value,.3);
  assert.throws(()=>chart([event('bad',0,-.5,{property:'opacity'})]),/终值/);
  assert.throws(()=>chart([event('bad',0,NaN)]));
  assert.throws(()=>chart([event('bad',0,1,{valueMode:'unknown'})]));
});

test('preview uses resolved endpoints and its exact speed integral equals exported explicit events',()=>{
  const c=chart([event('a',1,2,{property:'speed'}),event('b',3,-.5,{property:'speed',valueMode:'delta'})]);
  c.events[0].value=3;invalidateAnimationCache(c);
  near(eventValue(c,'speed',3.25),3);near(eventValue(c,'speed',4.25),2.5);
  const baked=JSON.parse(serializeChart(c));for(const e of baked.events){delete e.valueMode;delete e.value;}
  for(const t of [0,1.25,2,3.25,3.75,4.25,8]){
    near(eventValue(c,'speed',t),eventValue(baked,'speed',t));
    near(scrollDistance(c,c.notes[0],0,t),scrollDistance(baked,baked.notes[0],0,t));
  }
});

test('every built-in starts from current state and is continuous at all repeated segment boundaries',()=>{
  for(const preset of BUILTIN_PRESETS){
    const property=preset.events[0].property,base=property==='x'?.1:property==='opacity'?.6:1.6;
    const c=chart([event('prior',0,base,{property})]);
    const ids=applyPreset(c,preset,['all'],{start:2.25,beats:2,repeat:2,amount:.5});
    const generated=c.events.filter(e=>ids.includes(e.id));near(generated[0].from,base);
    for(const e of generated){near(eventValue(c,property,e.time+c.offset-1e-8),eventValue(c,property,e.time+c.offset),1e-6);}
    if(preset.id==='builtin:slow-down'){assert.ok(generated[0].to<base);near(generated[0].to,1.2);}
    if(['builtin:pulse','builtin:sway','builtin:slow-return'].includes(preset.id))near(generated.at(-1).to,base);
    validateChart(c);
  }
});

test('preset replacement reads the retained prior state; zero strength and failed application are atomic',()=>{
  const c=chart([event('prior',0,.4,{property:'opacity'}),event('replaced',2,.9,{property:'opacity'})]);
  const ids=applyPreset(c,BUILTIN_PRESETS[2],['all'],{start:2.25,replace:true});
  near(c.events.find(e=>e.id===ids[0]).from,.4);near(c.events.find(e=>e.id===ids[1]).to,.4);
  const before=serializeChart(c);assert.throws(()=>applyPreset(c,BUILTIN_PRESETS[2],['all'],{start:2.25}));assert.equal(serializeChart(c),before);
  const d=chart([event('prior',0,.3)]);applyPreset(d,BUILTIN_PRESETS[3],['all'],{start:3.25,amount:0});near(d.events.at(-1).from,.3);near(d.events.at(-1).to,.3);
  const snapshot=serializeChart(d);assert.throws(()=>applyPreset(d,BUILTIN_PRESETS[3],['all'],{start:5.25,repeat:8}));assert.equal(serializeChart(d),snapshot);
});

test('custom presets and clipboard preserve end/delta intent, and pasted events read their destination state',()=>{
  const c=chart([event('a',1,.2),event('b',3,.1,{valueMode:'delta'})]);
  const preset=presetFromEvents(c.events,'move');assert.equal(preset.events[1].valueMode,'delta');
  const ids=applyPreset(c,preset,['all'],{start:6.25,beats:4});near(c.events.find(e=>e.id===ids[0]).from,.3);near(c.events.find(e=>e.id===ids[1]).to,.3);
  assert.equal(c.events.find(e=>e.id===ids[1]).valueMode,'delta');
  const pasted=pasteEvents(c,[c.events.find(e=>e.id==='b')],10.25);const output=validateChart(c);near(output.events.find(e=>e.id===pasted[0]).from,.3);near(output.events.find(e=>e.id===pasted[0]).to,.4);
});

test('custom presets capture beat proportions across a BPM change',()=>{
  const c=chart([event('a',0,.1),event('b',1,.2,{duration:.5})]);
  c.bpmChanges=[{time:1,bpm:240}];
  const preset=presetFromEvents(c.events,'tempo',c);
  near(preset.events[0].duration,.5);near(preset.events[1].time,.5);near(preset.events[1].duration,.5);
  const ids=applyPreset(c,preset,['a'],{start:5.25,beats:4});
  near(c.events.find(e=>e.id===ids[0]).duration,.5);near(c.events.find(e=>e.id===ids[1]).duration,.5);
});
