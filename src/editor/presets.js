import {createId} from './model.js';
import {normalizePresets} from './authoring-schema.js';
import {beatAtTime,timeAtBeat} from './timing.js';
import {eventValue,invalidateAnimationCache} from './animation.js';
import {resolveEventValues} from './event-values.js';

const event=(property,time,duration,from,to,curve='easeInOut')=>({property,time,duration,from,to,curve,layer:0});
export const BUILTIN_PRESETS=[
  {id:'builtin:fade-in',name:'渐入',events:[event('opacity',0,1,0,1,'easeOut')]},
  {id:'builtin:fade-out',name:'渐出',events:[event('opacity',0,1,1,0,'easeIn')]},
  {id:'builtin:pulse',name:'明暗呼吸',events:[event('opacity',0,.5,1,.25),event('opacity',.5,.5,.25,1)]},
  {id:'builtin:from-left',name:'向左移动',events:[event('x',0,1,0,-.25,'easeOut')]},
  {id:'builtin:from-right',name:'向右移动',events:[event('x',0,1,0,.25,'easeOut')]},
  {id:'builtin:sway',name:'左右摆动',events:[event('x',0,.25,0,-.2),event('x',.25,.5,-.2,.2),event('x',.75,.25,.2,0)]},
  {id:'builtin:speed-up',name:'逐渐加速',events:[event('speed',0,1,1,2,'easeIn')]},
  {id:'builtin:slow-down',name:'逐渐减速',events:[event('speed',0,1,1,.5,'easeOut')]},
  {id:'builtin:slow-return',name:'减速回归',events:[event('speed',0,.5,1,.35),event('speed',.5,.5,.35,1)]},
];
export function overlapping(a,b) {
  return a.target===b.target&&a.property===b.property&&(a.layer||0)===(b.layer||0)
    &&(Math.abs(a.time-b.time)<1e-9||(a.time<b.time+b.duration-1e-9&&b.time<a.time+a.duration-1e-9));
}
export function insertEvents(chart,events,{replace=false}={}) {
  const key=event=>JSON.stringify([event.target,event.property,event.layer||0]),channels=new Map();
  for(const event of events){const id=key(event);if(!channels.has(id))channels.set(id,[]);channels.get(id).push(event);}
  for(const channel of channels.values()){
    channel.sort((a,b)=>a.time-b.time);
    if(channel.some((event,index)=>index&&overlapping(channel[index-1],event)))throw new Error('生成的事件在同一目标、属性和层内重叠。');
  }
  const conflicts=chart.events.filter(existing=>{
    const channel=channels.get(key(existing));if(!channel)return false;
    let low=0,high=channel.length;
    while(low<high){const mid=(low+high)>>>1;if(channel[mid].time<=existing.time)low=mid+1;else high=mid;}
    return (low>0&&overlapping(existing,channel[low-1]))||(low<channel.length&&overlapping(existing,channel[low]));
  });
  if(conflicts.length&&!replace)throw new Error('当前目标的这一层已有重叠事件，请换一层或启用「替换重叠事件」。');
  if(replace){const ids=new Set(conflicts.map(event=>event.id));chart.events=chart.events.filter(event=>!ids.has(event.id));}
  chart.events.push(...events);
  return events.map(event=>event.id);
}
export function applyPreset(chart,preset,targets,{start,beats=2,repeat=1,amount=1,stagger=0,layer=0,relative=false,replace=false}={}) {
  preset=normalizePresets([preset])[0];
  if(!Number.isFinite(start)||!Number.isFinite(beats)||beats<=0||!Number.isInteger(repeat)||repeat<1||repeat>32
    ||!Number.isFinite(amount)||amount<0||amount>1||!Number.isFinite(stagger)||stagger<0||!Number.isInteger(layer)||layer<0||layer>3)throw new Error('预设时间、次数或强度无效。');
  if(!targets.length)throw new Error('请先选择音符或组。');
  if(targets.length*repeat*preset.events.length>50000)throw new Error("生成的事件过多，请减少目标或重复次数。");
  const events=[],workingChannels=new Map();
  const channelKey=(target,property,layer)=>JSON.stringify([target,property,layer]);
  for(const event of chart.events){const key=channelKey(event.target,event.property,event.layer||0);if(!workingChannels.has(key))workingChannels.set(key,{offset:chart.offset,events:[]});workingChannels.get(key).events.push({...event});}
  const notesById=new Map(chart.notes.map(note=>[note.id,note]));
  const templateChannels=new Map();
  for(const item of preset.events){const key=JSON.stringify([item.property,item.layer||0]);if(!templateChannels.has(key))templateChannels.set(key,[]);templateChannels.get(key).push(item);}
  for(const channel of templateChannels.values())channel.sort((a,b)=>a.time-b.time);
  for(const [index,target] of targets.entries()){
    const note=notesById.get(target);
    const origin=relative&&note?beatAtTime(chart,note.time+chart.offset)-beats*repeat:beatAtTime(chart,start);
    for(let cycle=0;cycle<repeat;cycle++)for(const channel of templateChannels.values()){
      const initial=channel[0],eventLayer=layer+(initial.layer||0);
      if(eventLayer>3)throw new Error('预设超出第 4 层，请降低起始层。');
      const key=channelKey(target,initial.property,eventLayer);
      if(!workingChannels.has(key))workingChannels.set(key,{offset:chart.offset,events:[]});
      const working=workingChannels.get(key);
      const originBeat=origin+(relative?0:index*stagger)+cycle*beats;
      const intervals=channel.map(item=>{const time=timeAtBeat(chart,originBeat+item.time*beats)-chart.offset;return {item,time,duration:timeAtBeat(chart,originBeat+(item.time+item.duration)*beats)-chart.offset-time};});
      // Replacement must read the state before the replaced span, not its stale values.
      if(replace){working.events=working.events.filter(existing=>!intervals.some(({item,time,duration})=>overlapping(existing,{target,property:item.property,layer:eventLayer,time,duration})));invalidateAnimationCache(working);}
      const baseline=eventValue(working,initial.property,intervals[0].time+chart.offset,target,eventLayer);
      for(const {item,time,duration} of intervals){
        let value;
        if(item.valueMode==='end')value=baseline+(item.value-baseline)*amount;
        else if(item.valueMode==='delta')value=eventValue(working,item.property,time+chart.offset,target,eventLayer)+item.value*amount;
        else if(preset.id==='builtin:fade-in')value=baseline+(1-baseline)*amount;
        else if(item.property==='x'||initial.from===0)value=baseline+(item.to-initial.from)*amount;
        else value=baseline*(1+(item.to/initial.from-1)*amount);
        const generated={id:createId(),target,property:item.property,time,duration,from:baseline,to:value,
          valueMode:'end',value,curve:item.curve,...(eventLayer?{layer:eventLayer}:{})};
        if(item.valueMode==='delta'||(preset.id.startsWith('builtin:')&&item.property==='x')){
          generated.valueMode='delta';generated.value=(item.valueMode==='delta'?item.value:item.to-item.from)*amount;
        }
        events.push(generated);working.events.push(generated);
        invalidateAnimationCache(working);
      }
      resolveEventValues(working.events);invalidateAnimationCache(working);
    }
  }
  if(events.length>50000)throw new Error('生成的事件过多，请减少目标或重复次数。');
  if(events.some(event=>event.time<0||event.time+chart.offset<0||event.time+event.duration+chart.offset>chart.duration+1e-9))throw new Error('预设超出谱面时间，请调整开始时间或长度。');
  const candidate={...chart,events:chart.events.map(e=>({...e}))};
  const ids=insertEvents(candidate,events,{replace});
  resolveEventValues(candidate.events);
  for(const event of candidate.events){const [min,max]={x:[-1,1],opacity:[0,1],speed:[.1,8]}[event.property];if(event.from<min-1e-9||event.from>max+1e-9||event.to<min-1e-9||event.to>max+1e-9)throw new Error('预设结果超出属性范围，请降低强度或重复次数。');}
  chart.events=candidate.events;invalidateAnimationCache(chart);
  return ids;
}
export function presetFromEvents(events,name,chart=null) {
  if(!events.length)throw new Error('请先选择事件。');
  if(new Set(events.map(event=>event.target)).size!==1)throw new Error('保存预设时请选择同一个目标的事件。');
  const coordinate=time=>chart?beatAtTime(chart,time+chart.offset):time;
  const start=Math.min(...events.map(event=>coordinate(event.time)));
  const end=Math.max(...events.map(event=>coordinate(event.time+event.duration)));
  if(end-start<1e-9)throw new Error('预设至少需要一个具有长度的事件。');
  const layer=Math.min(...events.map(event=>event.layer||0));
  return normalizePresets([{id:createId(),name,events:events.map(event=>({property:event.property,time:(coordinate(event.time)-start)/(end-start),duration:(coordinate(event.time+event.duration)-coordinate(event.time))/(end-start),from:event.from,to:event.to,curve:event.curve,layer:(event.layer||0)-layer,...(event.valueMode?{valueMode:event.valueMode,value:event.value}:{})}))}])[0];
}
export function pasteEvents(chart,events,start,target=null) {
  if(!events.length)return [];
  const origin=Math.min(...events.map(event=>event.time));
  const copied=events.map(event=>({...structuredClone(event),id:createId(),target:target||event.target,time:event.time+start-chart.offset-origin}));
  return insertEvents(chart,copied);
}
