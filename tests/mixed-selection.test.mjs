import test from 'node:test';
import assert from 'node:assert/strict';
import {createBlankChart,validateChart} from '../src/editor/model.js';
import {copySelection,pasteSelection,moveSelection,mirrorSelection} from '../src/editor/operations.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const event=(id,time,value,options={})=>({id,time,duration:1,target:'all',property:'x',valueMode:'end',value,curve:'easeInOut',...options});
const chart=events=>validateChart({...createBlankChart(),bpm:120,offset:.25,notes:[{id:'a',time:8,x:.5,duration:0}],events});

test('mixed selection copies and moves explicit global events once alongside note automation',()=>{
  const c=chart([event('global',7,.1),event('local',7,.1,{target:'a',valueMode:'delta'})]);
  const source=copySelection(c,new Set(['a']),new Set(['global','local']));
  assert.equal(source.events.length,2);const ids=pasteSelection(c,source,12.25);
  near(c.notes.find(n=>n.id===ids[0]).time,13);assert.equal(c.events.filter(e=>e.time===12).length,2);
  const snapshot=structuredClone(c);moveSelection(c,snapshot,new Set(['a']),2,0,0,new Set(['global','local']));near(c.events.find(e=>e.id==='local').time,9);near(c.events.find(e=>e.id==='global').time,9);
  mirrorSelection(c,new Set(['a']));near(c.events.find(e=>e.id==='local').value,-.1);validateChart(c);
});
