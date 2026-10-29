export const EVENT_DEFAULTS = {x: 0, opacity: 1, speed: 1};

// Authoring values are retained alongside baked from/to values for the game.
// Channels are independent: a layer never reads another layer's contribution.
export function resolveEventValues(events) {
  const channels = new Map();
  for (const event of events) {
    const key = JSON.stringify([event.target, event.property, event.layer || 0]);
    if (!channels.has(key)) channels.set(key, []);
    channels.get(key).push(event);
  }
  for (const channel of channels.values()) {
    channel.sort((a, b) => a.time - b.time);
    let value = EVENT_DEFAULTS[channel[0].property];
    for (const event of channel) {
      if (event.valueMode) {
        event.from = value;
        event.to = event.valueMode === 'delta' ? value + event.value : event.value;
      }
      value = event.to;
    }
  }
  return events;
}

export function setEventValueMode(event, mode) {
  event.valueMode = mode;
  event.value = mode === 'delta' ? event.to - event.from : event.to;
}
