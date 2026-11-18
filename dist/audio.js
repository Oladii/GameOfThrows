import { GAME_AUDIO_ASSETS } from './audio-assets.js';

const SOUND_PREFERENCE = 'game-of-trows-sound-v1';
const VOLUME_PREFERENCE = 'game-of-trows-volume-v1';
const silentSound = () => {};
// Overall listening level, independent of the balance between individual cues.
export const GAME_MASTER_GAIN = 4.5;
// Quiet, damped table sounds with subdued movement and short interface ticks.
export const GAME_SOUND_PROFILES = {
  defeat: { gain: 1 / GAME_MASTER_GAIN, dry: true },
  victory: { gain: .0875 / GAME_MASTER_GAIN, dry: true },
  slide: { gain: .045, lowpass: 450, highpass: 220, duration: .10, attack: .015 },
  place: { gain: .04, lowpass: 400, highpass: 240, duration: .055, attack: .012 },
  remove: { gain: .06, lowpass: 10000 },
  click: { gain: .02, lowpass: 2500, highpass: 550, duration: .006, attack: .0005 },
  hover: { gain: .0875, lowpass: 10000 },
  // Preserve the approved timbres. The first strike is now 75% quieter and
  // the second 50% quieter; the volume slider/mute still applies to every cue.
  knock1: { gain: .25 / GAME_MASTER_GAIN, dry: true, immediate: true },
  knock2: { gain: .5 / GAME_MASTER_GAIN, dry: true, immediate: true },
  knock3: { gain: 1 / GAME_MASTER_GAIN, dry: true, immediate: true },
  scatter: { gain: 1 / GAME_MASTER_GAIN, dry: true, immediate: true }
};

// Decode the tiny embedded PCM16 cues synchronously on the first user gesture.
// This avoids losing the first knock while unrelated sounds decodeAudioData.
function tableKnockWavBuffer(context, bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = offset => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let format, data;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = view.getUint32(offset + 4, true), start = offset + 8;
    if (start + size > bytes.length) return null;
    if (tag(offset) === 'fmt ' && size >= 16) format = {
      code: view.getUint16(start, true), channels: view.getUint16(start + 2, true),
      rate: view.getUint32(start + 4, true), bits: view.getUint16(start + 14, true)
    };
    if (tag(offset) === 'data') data = { start, size };
    offset = start + size + (size % 2);
  }
  if (!format || !data || format.code !== 1 || format.bits !== 16
    || ![1, 2].includes(format.channels) || data.size % (2 * format.channels)) return null;
  const length = data.size / (2 * format.channels);
  const buffer = context.createBuffer(format.channels, length, format.rate);
  for (let channel = 0; channel < format.channels; channel++) {
    const output = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) output[i] = view.getInt16(data.start + (i * format.channels + channel) * 2, true) / 32768;
  }
  return buffer;
}

// Only a straight, unobstructed route slides. A bend or an intermediate
// occupied cell means the piece is lifted and placed at the destination.
export function movementSoundKind(route, pieces) {
  if (route.length < 2) return null;
  const dq = route[1].q - route[0].q, dr = route[1].r - route[0].r;
  if (route.slice(1).some((cell, index) => {
    const stepQ = cell.q - route[index].q, stepR = cell.r - route[index].r;
    return stepQ * dr !== stepR * dq || stepQ * dq + stepR * dr <= 0;
  })) return 'place';
  const occupied = new Set(pieces.map(piece => `${piece.q},${piece.r}`));
  return route.slice(1, -1).some(cell => occupied.has(`${cell.q},${cell.r}`)) ? 'place' : 'slide';
}

export class GameAudio {
  constructor({ assets = GAME_AUDIO_ASSETS, createContext = () => new globalThis.AudioContext(),
    storage = () => globalThis.localStorage, hidden = () => Boolean(globalThis.document?.hidden),
    now = () => performance.now() } = {}) {
    Object.assign(this, { assets, createContext, storage, hidden, now });
    this.enabled = true; this.volume = .5; this.context = null; this.buffers = {}; this.loading = null;
    this.epoch = 0; this.voices = new Set(); this.lastClick = -Infinity;
    this.lastHover = -Infinity; this.hoverKey = null;
    this.hoverVoice = silentSound; this.clickVoice = silentSound;
    try {
      const saved = this.storage()?.getItem(VOLUME_PREFERENCE);
      if (saved != null && saved.trim() !== '' && Number.isFinite(Number(saved))) {
        this.volume = Math.max(0, Math.min(1, Number(saved)));
        this.enabled = this.volume > 0;
      } else if (this.storage()?.getItem(SOUND_PREFERENCE) === 'off') {
        this.enabled = false; this.volume = 0;
      }
    } catch {}
  }
  // Called in a user gesture. Never create an audio context on page load.
  unlock() {
    if (!this.enabled || this.hidden()) return Promise.resolve();
    try {
      this.context ||= this.createContext();
      const resumed = this.context.state !== 'running' ? this.context.resume().catch(() => {}) : Promise.resolve();
      this.resuming = resumed;
      if (typeof this.context.createBuffer === 'function') {
        for (const name of ['knock1', 'knock2', 'knock3', 'scatter']) {
          if (this.buffers[name] || !this.assets[name]) continue;
          try {
            const bytes = Uint8Array.from(atob(this.assets[name].split(',')[1]), char => char.charCodeAt(0));
            const buffer = tableKnockWavBuffer(this.context, bytes);
            if (buffer) this.buffers[name] = buffer;
          } catch { /* Fall back to the normal decoder if PCM decoding fails. */ }
        }
      }
      this.loading ||= Promise.all(Object.entries(this.assets).map(async ([name, data]) => {
        if (this.buffers[name]) return;
        try {
          const bytes = Uint8Array.from(atob(data.split(',')[1]), char => char.charCodeAt(0));
          this.buffers[name] = await this.context.decodeAudioData(bytes.buffer);
        } catch { /* A missing sound must never interrupt a move. */ }
      }));
      return Promise.all([resumed, this.loading]);
    } catch { return Promise.resolve(); }
  }
  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (this.enabled && this.volume === 0) this.volume = .5;
    if (!this.enabled) this.stopAll();
    try {
      this.storage()?.setItem(SOUND_PREFERENCE, this.enabled ? 'on' : 'off');
      this.storage()?.setItem(VOLUME_PREFERENCE, String(this.enabled ? this.volume : 0));
    } catch {}
    if (this.enabled) void this.unlock();
  }
  setVolume(volume) {
    if (!Number.isFinite(volume)) return;
    this.volume = Math.max(0, Math.min(1, volume));
    this.setEnabled(this.volume > 0);
  }
  stopAll() {
    this.epoch++;
    this.hoverKey = null;
    for (const stop of [...this.voices]) stop();
    this.hoverVoice = silentSound; this.clickVoice = silentSound;
  }
  play(name, { duration = null, gainScale = 1 } = {}) {
    if (!this.enabled || this.hidden()) return silentSound;
    const profile = GAME_SOUND_PROFILES[name];
    if (!profile) return silentSound;
    if (profile.immediate) void this.unlock();
    const sample = profile.sample || name;
    const epoch = this.epoch, requested = this.now();
    let cancelled = false, source = null, gain = null, filter = null, highpass = null;
    const cleanup = () => { this.voices.delete(stop); source?.disconnect(); highpass?.disconnect(); filter?.disconnect(); gain?.disconnect(); };
    const stop = () => {
      if (cancelled) return;
      cancelled = true;
      this.voices.delete(stop);
      if (source) {
        try {
          const time = this.context.currentTime;
          gain.gain.cancelScheduledValues(time);
          gain.gain.setTargetAtTime(0, time, .004);
          source.stop(time + .02);
        } catch { cleanup(); }
      } else cleanup();
    };
    // Cap overlapping clicks without changing the sound's approved gain.
    if (this.voices.size >= 8) this.voices.values().next().value();
    this.voices.add(stop);
    const start = () => {
      if (cancelled || epoch !== this.epoch || !this.enabled || this.hidden()
        || this.now() - requested > 150 || this.context?.state !== 'running' || !this.buffers[sample]) {
        cleanup(); return;
      }
      try {
        source = this.context.createBufferSource(); gain = this.context.createGain();
        source.buffer = this.buffers[sample];
        if (profile.highpass) {
          highpass = this.context.createBiquadFilter(); highpass.type = 'highpass';
          highpass.frequency.value = profile.highpass; highpass.Q.value = .5;
          source.connect(highpass);
        }
        if (profile.dry) source.connect(gain);
        else {
          filter = this.context.createBiquadFilter(); filter.type = 'lowpass';
          filter.frequency.value = profile.lowpass; filter.Q.value = .5;
          (highpass || source).connect(filter); filter.connect(gain);
        }
        gain.connect(this.context.destination);
        const time = this.context.currentTime;
        const level = profile.gain * GAME_MASTER_GAIN * (this.volume / .5) * gainScale;
        const length = Math.min(source.buffer.duration, duration ?? Infinity, profile.duration ?? Infinity);
        const attack = Math.min(profile.attack || 0, length * .2);
        // Keep the recorded pitch; shorten friction with a soft end, never speed it up.
        gain.gain.setValueAtTime(attack ? 0 : level, time);
        if (attack) gain.gain.linearRampToValueAtTime(level, time + attack);
        if (length < source.buffer.duration) {
          gain.gain.setValueAtTime(level, time + Math.max(0, length - Math.min(.035, length * .6)));
          gain.gain.linearRampToValueAtTime(0, time + length);
        }
        source.onended = cleanup;
        source.start(time); source.stop(time + length);
      } catch { cleanup(); }
    };
    if (this.buffers[sample] && this.context?.state === 'running') start();
    else if (profile.immediate && this.buffers[sample]) void this.resuming.then(start).catch(cleanup);
    else void this.unlock().then(start).catch(cleanup);
    return stop;
  }
  click(cellKey, { silent = false, soft = false } = {}) {
    // Remember the clicked cell even when replacing its DOM triggers focusout.
    if (cellKey !== undefined) this.hoverKey = cellKey;
    if (silent) {
      this.lastHover = this.now(); this.hoverVoice(); this.clickVoice();
      return;
    }
    if (this.now() - this.lastClick < 35) return;
    this.lastClick = this.now(); this.lastHover = this.now();
    this.hoverVoice(); this.clickVoice();
    this.clickVoice = this.play('click', { gainScale: soft ? .7 : 1 });
  }
  hover(cellKey) {
    if (cellKey === this.hoverKey) return;
    this.hoverKey = cellKey;
    // Hover never unlocks audio, queues delayed ticks, or replays missed cells.
    if (!cellKey || !this.enabled || this.hidden() || this.context?.state !== 'running'
      || !this.buffers.hover || this.now() - this.lastHover < 65) return;
    this.lastHover = this.now();
    this.hoverVoice(); this.hoverVoice = this.play('hover');
  }
  movement(route, pieces, durationMs, { instant = false } = {}) {
    const kind = movementSoundKind(route, pieces), epoch = this.epoch;
    const audible = this.enabled && !this.hidden();
    let finished = false;
    const stopSlide = audible && kind === 'slide'
      ? this.play('slide', { duration: instant ? .22 : durationMs / 1000 }) : silentSound;
    let stopPlace = silentSound;
    return {
      finish: () => {
        if (finished) return;
        finished = true;
        if (!instant) stopSlide();
        if (audible && kind === 'place' && epoch === this.epoch) stopPlace = this.play('place');
      },
      cancel: () => { finished = true; stopSlide(); stopPlace(); }
    };
  }
}
