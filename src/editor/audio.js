const PEAK_COUNT = 2048;
const now = () => performance.now() / 1000;
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function makePeaks(buffer) {
  const peaks = new Float32Array(PEAK_COUNT);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let bucket = 0; bucket < PEAK_COUNT; bucket += 1) {
      const start = Math.floor(bucket * data.length / PEAK_COUNT);
      const end = Math.min(data.length, Math.max(start + 1, Math.floor((bucket + 1) * data.length / PEAK_COUNT)));
      const stride = Math.max(1, Math.floor((end - start) / 256));
      let peak = peaks[bucket];
      for (let sample = start; sample < end; sample += stride) peak = Math.max(peak, Math.abs(data[sample]));
      peaks[bucket] = Math.min(1, peak);
    }
  }
  return peaks;
}

export class AudioEngine {
  constructor() {
    this._context = null;
    this._master = null;
    this._buffer = null;
    this._file = null;
    this._source = null;
    this._effects = new Set();
    this._playing = false;
    this._position = 0;
    this._anchor = 0;
    this._clock = "silent";
    this._rate = 1;
    this._volume = 0.5;
    this._generation = 0;
    this._loadGeneration = 0;
  }

  _ensureContext() {
    if (this._context) return this._context;
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context) throw new Error("此浏览器不支持音频预览。");
    const context = new Context();
    const master = context.createGain();
    master.gain.value = this._volume;
    master.connect(context.destination);
    this._context = context;
    this._master = master;
    return context;
  }

  async resumeContext() {
    const context = this._ensureContext();
    if (context.state === "suspended") await context.resume();
  }

  /** Decode before committing so a failed or superseded import keeps the old audio intact. */
  async load(file) {
    const request = ++this._loadGeneration;
    if (!file || typeof file.arrayBuffer !== "function") throw new Error("请选择有效的音频文件。");
    const context = this._ensureContext();
    let buffer;
    try {
      const data = await file.arrayBuffer();
      buffer = await context.decodeAudioData(data);
    } catch (error) {
      const failure = new Error("无法读取此音频，请尝试有效的 MP3、OGG 或 WAV 文件。");
      failure.cause = error;
      throw failure;
    }
    if (request !== this._loadGeneration) {
      const failure = new Error("此次音频载入已被更新的选择取消。");
      failure.name = "AbortError";
      throw failure;
    }
    if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) throw new Error("音频文件没有可播放的内容。");
    const peaks = makePeaks(buffer);
    this.pause();
    this._buffer = buffer;
    this._file = file;
    this._position = 0;
    this._clock = "silent";
    return { duration: buffer.duration, peaks, name: typeof file.name === "string" ? file.name : "audio" };
  }

  get duration() { return this._buffer?.duration || 0; }
  get file() { return this._file; }

  cancelPendingLoad() {
    this._loadGeneration += 1;
  }

  get time() {
    if (!this._playing) return this._position;
    const clock = this._clock === "audio" ? this._context.currentTime : now();
    const position = this._position + Math.max(0, clock - this._anchor) * this._rate;
    if (this._clock === "audio" && position >= this.duration) {
      this._finishAudio();
      return this._position;
    }
    return position;
  }

  get playing() {
    // The clock check also handles throttled onended callbacks in background tabs.
    if (this._playing && this._clock === "audio") void this.time;
    return this._playing;
  }

  _stopSource() {
    this._generation += 1;
    const source = this._source;
    this._source = null;
    if (!source) return;
    source.onended = null;
    try { source.stop(); } catch { /* A naturally ended source may already be stopped. */ }
    source.disconnect();
  }

  _finishAudio() {
    this._position = this.duration;
    this._playing = false;
    this._stopSource();
  }

  play(time = this.time, rate = 1) {
    this.pause();
    this._position = Math.max(0, finite(time));
    this._rate = clamp(finite(rate, 1), 0.1, 4);
    if (this._buffer && this._position < this.duration) {
      const context = this._ensureContext();
      const source = context.createBufferSource();
      source.buffer = this._buffer;
      source.playbackRate.value = this._rate;
      source.connect(this._master);
      this._clock = "audio";
      this._anchor = context.currentTime;
      this._source = source;
      const generation = this._generation;
      source.onended = () => {
        if (this._source !== source || generation !== this._generation) return;
        this._finishAudio();
      };
      try {
        source.start(0, this._position);
      } catch (error) {
        this._stopSource();
        throw error;
      }
    } else {
      // Empty charts and chart sections after the audio use an unrestricted silent clock.
      this._clock = "silent";
      this._anchor = now();
    }
    this._playing = true;
  }

  pause() {
    this._position = this.time;
    this._playing = false;
    this._stopSource();
    return this._position;
  }

  seek(time) {
    const playing = this.playing;
    if (playing) this.play(time, this._rate);
    else this._position = Math.max(0, finite(time));
  }

  setRate(rate) {
    const nextRate = clamp(finite(rate, 1), 0.1, 4);
    if (this.playing) this.play(this.time, nextRate);
    else this._rate = nextRate;
  }

  setVolume(value) {
    this._volume = clamp(finite(value), 0, 1);
    if (this._master) this._master.gain.setTargetAtTime(this._volume, this._context.currentTime, 0.01);
  }

  _tone(frequency, endFrequency, gain, duration) {
    // Effects never create or resume a context; an explicit playback gesture unlocks it.
    const context = this._context;
    if (!context || context.state !== "running" || this._volume === 0) return;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const start = context.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(gain, start + 0.003);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(this._master);
    const effect = { oscillator, envelope };
    this._effects.add(effect);
    oscillator.onended = () => {
      this._effects.delete(effect);
      oscillator.disconnect();
      envelope.disconnect();
    };
    oscillator.start(start);
    oscillator.stop(start + duration + 0.005);
  }

  tick(accent = false) {
    this._tone(accent ? 880 : 660, accent ? 720 : 540, accent ? 0.075 : 0.05, 0.045);
  }

  hit() {
    this._tone(520, 260, 0.055, 0.035);
  }

  clear() {
    this._loadGeneration += 1;
    this.pause();
    for (const { oscillator, envelope } of this._effects) {
      oscillator.onended = null;
      try { oscillator.stop(); } catch { /* Already ended. */ }
      oscillator.disconnect();
      envelope.disconnect();
    }
    this._effects.clear();
    this._buffer = null;
    this._file = null;
    this._position = 0;
    this._clock = "silent";
  }
}
