import {createGroup,assignGroup,dissolveGroup,groupMap,noteEditable,targetEditable} from './groups.js';
import {BUILTIN_PRESETS,applyPreset,presetFromEvents,pasteEvents} from './presets.js';
import {normalizePresets} from './authoring-schema.js';
import {copySelection,pasteSelection} from './operations.js';
import {bpmAtTime,secondsForBeats} from './timing.js';
import {createId} from './model.js';

export function authoringSnapshot(state,eventClipboard) {
  const chart=state.chart,notes=chart.notes.filter(n=>state.selected.has(n.id));
  const counts=new Map();for(const note of chart.notes)counts.set(note.group,(counts.get(note.group)||0)+1);
  return {groups:(chart.groups||[]).map(g=>({...g,count:counts.get(g.id)||0})),presets:chart.animationPresets||[],
    bpmChanges:(chart.bpmChanges||[]).map(p=>({...p,time:p.time+chart.offset})),groupFilter:state.groupFilter,activeGroupId:state.activeGroupId,
    noteGroup:notes.every(n=>n.group===notes[0]?.group)?notes[0]?.group||'':'mixed',selectedNoteIds:[...(state.eventTarget==='selected'?state.eventNoteTargets:state.selected)],
    selectedEventIds:[...state.selectedEvents],eventLayer:state.eventLayer,eventTarget:state.eventTarget,eventClipboard:!!eventClipboard.length,loop:{...state.loop}};
}
export function eventVisible(event,state) {
  return (state.eventLayer===-1||(event.layer||0)===(state.eventLayer||0))&&(state.eventTarget==='*'||!state.eventTarget||event.target===state.eventTarget||state.eventTarget==='selected'&&(state.eventNoteTargets||state.selected).has(event.target));
}
export function attachAuthoring({state,commit,sync,toast,emit,snap,pause,download,selectEvents,copyEvents,pasteEventClipboard}) {
  window.addEventListener('editor:authoring',({detail:d})=>{
    const chart=state.chart,groups=groupMap(chart),group=groups.get(d.id);
    try {
      if(d.type==='error')throw new Error(d.message);
      if(d.type==='filter-group'){state.groupFilter=d.id;state.activeGroupId=groups.has(d.id)?d.id:state.activeGroupId;state.selected=new Set([...state.selected].filter(id=>noteEditable(chart.notes.find(n=>n.id===id),state)));}
      if(d.type==='active-group')state.activeGroupId=d.id;
      if(d.type==='create-group'){
        let id;if(commit(c=>id=createGroup(c,d.empty?new Set():state.selected,`分组 ${(c.groups||[]).length+1}`))){state.activeGroupId=id;emit('panel',{panel:'groups'});}
      }
      if(d.type==='group-field'){
        if(group?.locked&&!['locked','hidden'].includes(d.key))throw new Error('请先解锁分组。');
        commit(c=>Object.assign(c.groups.find(g=>g.id===d.id),{[d.key]:d.value}));
      }
      if(d.type==='assign-group')commit(c=>assignGroup(c,state.selected,d.id));
      if(d.type==='dissolve-group'){
        if(group?.locked)throw new Error('请先解锁分组。');
        commit(c=>dissolveGroup(c,d.id));
      }
      if(d.type==='select-group'){state.groupFilter='all';state.selected=new Set(chart.notes.filter(n=>n.group===d.id&&noteEditable(n,state)).map(n=>n.id));state.selectedEvents.clear();state.selectedEventId=null;}
      if(d.type==='duplicate-group'){
        const members=chart.notes.filter(n=>n.group===d.id),source=copySelection(chart,new Set(members.map(n=>n.id)));let ids=[];
        if(!members.length){commit(c=>createGroup(c,new Set(),`${group.name.slice(0,77)} 副本`));}
        else if(commit(c=>ids=pasteSelection(c,source,Math.min(...members.map(n=>n.time+c.offset))))){state.groupFilter='all';state.selected=new Set(ids);state.activeGroupId=state.chart.notes.find(n=>n.id===ids[0]).group;}
      }
      if(d.type==='add-bpm')commit(c=>(c.bpmChanges||=[]).push({time:snap(state.time)-c.offset,bpm:bpmAtTime(c,state.time)}));
      if(d.type==='delete-bpm')commit(c=>c.bpmChanges.splice(d.index,1));
      if(d.type==='bpm-field')commit(c=>c.bpmChanges[d.index][d.key]=d.value-(d.key==='time'?c.offset:0));
      if(d.type==='event-filter'){if(d.key==='eventTarget'&&d.value==='selected'&&state.selected.size)state.eventNoteTargets=new Set(state.selected);state[d.key]=d.value;state.selectedEvents.clear();state.selectedEventId=null;}
      if(d.type==='select-events')selectEvents(chart.events.filter(e=>eventVisible(e,state)&&targetEditable(chart,e.target)).map(e=>e.id));
      if(d.type==='batch-events'){
        if(commit(c=>{for(const event of c.events)if(state.selectedEvents.has(event.id)){if(d.key==='shift')event.time+=d.value;else event[d.key]=d.value;}})&&d.key==='layer')state.eventLayer=d.value;
      }
      if(d.type==='copy-events')copyEvents();
      if(d.type==='paste-events')pasteEventClipboard();
      if(d.type==='delete-events')commit(c=>c.events=c.events.filter(e=>!state.selectedEvents.has(e.id)));
      if(d.type==='apply-preset'){
        const preset=[...BUILTIN_PRESETS,...chart.animationPresets||[]].find(p=>p.id===d.id);
        const targets=d.scope==='all'?['all']:d.scope==='group'?[state.activeGroupId].filter(Boolean):chart.notes.filter(n=>state.selected.has(n.id)).map(n=>n.id);
        if(d.options.relative&&d.scope!=='selection')throw new Error('到达时刻对齐仅用于所选音符。');
        if(targets.some(id=>!targetEditable(chart,id)))throw new Error('目标组已锁定。');
        let ids=[];pause();
        if(commit(c=>ids=applyPreset(c,preset,targets,{...d.options,start:snap(state.time)}))){state.eventLayer=new Set(state.chart.events.filter(e=>ids.includes(e.id)).map(e=>e.layer||0)).size>1?-1:d.options.layer;state.eventTarget='*';selectEvents(ids);emit('panel',{panel:'events'});toast(`已生成 ${ids.length} 个事件`);}
      }
      if(d.type==='save-preset')commit(c=>(c.animationPresets||=[]).push(presetFromEvents(c.events.filter(e=>state.selectedEvents.has(e.id)),d.name)));
      if(d.type==='rename-preset')commit(c=>c.animationPresets.find(p=>p.id===d.id).name=d.name);
      if(d.type==='delete-preset')commit(c=>c.animationPresets=c.animationPresets.filter(p=>p.id!==d.id));
      if(d.type==='export-presets')download(new Blob([JSON.stringify({format:'tripefy.presets',version:1,presets:chart.animationPresets},null,2)],{type:'application/json'}),'Tripefy.presets.json');
      if(d.type==='import-presets'){
        const data=JSON.parse(d.text);if(data.format!=='tripefy.presets'||data.version!==1)throw new Error('预设库格式不支持。');
        const presets=normalizePresets(data.presets).map(p=>({...p,id:createId()}));commit(c=>(c.animationPresets||=[]).push(...presets));
      }
      if(d.type==='loop-mark'||d.type==='loop-field'){
        const loop={...state.loop,[d.key]:d.type==='loop-mark'?snap(state.time):d.value};
        if(d.type==='loop-mark'&&loop.end-loop.start<.05){
          if(d.key==='start')loop.end=Math.min(chart.duration,loop.start+secondsForBeats(chart,loop.start,4));
          else loop.start=Math.max(0,loop.end-secondsForBeats(chart,Math.max(0,loop.end-2),4));
        }
        if(!Number.isFinite(loop.start)||!Number.isFinite(loop.end)||loop.start<0||loop.end>chart.duration||loop.end-loop.start<.05)throw new Error('循环终点需比起点晚至少 0.05 秒，且位于歌曲内。');
        state.loop=loop;
      }
      sync();
      if(d.type==='duplicate-group')emit('panel',{panel:'groups'});
    }catch(error){toast(error.message);sync();}
  });
}
