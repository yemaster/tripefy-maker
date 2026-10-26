export const EVENT_RANGES = {speed: [.1,8], opacity: [0,1], x: [-1,1]};
const curves = ['linear','easeIn','easeOut','easeInOut'];
function finite(value, min, max, label) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label}必须在 ${min} 到 ${max} 之间。`);
  return value;
}
export function normalizeGroups(value = []) {
  if (!Array.isArray(value) || value.length > 256) throw new Error('最多支持 256 个音符组。');
  const ids = new Set();
  return value.map(group => {
    if (!group || typeof group.id !== 'string' || !group.id || group.id === 'all' || ids.has(group.id)) throw new Error('音符组 ID 无效或重复。');
    ids.add(group.id);
    if (typeof group.name !== 'string' || !group.name.trim() || group.name.length > 80) throw new Error('组名需要 1–80 个字符。');
    for (const key of ['hidden','locked']) if (group[key] !== undefined && typeof group[key] !== 'boolean') throw new Error('组的隐藏和锁定必须为布尔值。');
    return {id: group.id, name: group.name.trim(), hidden: group.hidden ?? false, locked: group.locked ?? false,
      x: finite(group.x ?? 0,-1,1,'组位置'), opacity: finite(group.opacity ?? 1,0,1,'组透明度'), speed: finite(group.speed ?? 1,.1,8,'组速度')};
  });
}
export function normalizePresets(value = []) {
  if (!Array.isArray(value) || value.length > 100) throw new Error('最多保存 100 个动画预设。');
  const ids = new Set();
  return value.map(preset => {
    if (!preset || typeof preset.id !== 'string' || !preset.id || ids.has(preset.id)
      || typeof preset.name !== 'string' || !preset.name.trim() || preset.name.length > 80) throw new Error('预设名称或 ID 无效。');
    ids.add(preset.id);
    if (!Array.isArray(preset.events) || !preset.events.length || preset.events.length > 500) throw new Error('单个预设应包含 1–500 个事件。');
    const channels = new Map();
    const events = preset.events.map(item => {
      if (!item || !EVENT_RANGES[item.property] || !curves.includes(item.curve)) throw new Error('预设事件属性或缓动无效。');
      const [min,max] = EVENT_RANGES[item.property];
      const time = finite(item.time,0,1,'预设时间'), duration = finite(item.duration,0,1,'预设长度');
      if (time + duration > 1 + 1e-9) throw new Error('预设事件不能越过预设结尾。');
      const layer = finite(item.layer ?? 0,0,3,'事件层'); if (!Number.isInteger(layer)) throw new Error('事件层必须为整数。');
      const event = {property:item.property,time,duration,from:finite(item.from,min,max,'起始值'),to:finite(item.to,min,max,'结束值'),curve:item.curve,layer};
      const key = `${layer}:${item.property}`; if (!channels.has(key)) channels.set(key,[]); channels.get(key).push(event);
      return event;
    });
    for (const channel of channels.values()) {
      channel.sort((a,b)=>a.time-b.time);
      if (channel.some((event,i)=>i&&(event.time === channel[i-1].time || event.time < channel[i-1].time+channel[i-1].duration-1e-9))) throw new Error('预设同层事件不能重叠。');
    }
    return {id:preset.id,name:preset.name.trim(),events};
  });
}
