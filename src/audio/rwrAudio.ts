/**
 * rwrAudio.ts — Web Audio API synthesizer for RWR / MAWS threat audio.
 *
 * All sounds are synthesized via OscillatorNode + GainNode — no audio files.
 * Call initRWRAudio() once on first user interaction to create the AudioContext.
 */

let ctx: AudioContext | null = null;

export function initRWRAudio(): void {
  if (ctx) return;
  ctx = new AudioContext();
}

function getCtx(): AudioContext | null {
  if (!ctx) return null;
  if (ctx.state === 'suspended') ctx.resume().catch(() => undefined);
  return ctx;
}

/** Single beep at given frequency and duration */
function beep(freqHz: number, durationS: number, gainPeak = 0.25, waveform: OscillatorType = 'sine'): void {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = waveform;
  osc.frequency.setValueAtTime(freqHz, c.currentTime);
  gain.gain.setValueAtTime(0, c.currentTime);
  gain.gain.linearRampToValueAtTime(gainPeak, c.currentTime + 0.005);
  gain.gain.setValueAtTime(gainPeak, c.currentTime + durationS - 0.01);
  gain.gain.linearRampToValueAtTime(0, c.currentTime + durationS);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + durationS);
}

/** Two-tone sweep */
function sweep(startHz: number, endHz: number, durationS: number, gainPeak = 0.25): void {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(startHz, c.currentTime);
  osc.frequency.linearRampToValueAtTime(endHz, c.currentTime + durationS);
  gain.gain.setValueAtTime(0, c.currentTime);
  gain.gain.linearRampToValueAtTime(gainPeak, c.currentTime + 0.01);
  gain.gain.setValueAtTime(gainPeak, c.currentTime + durationS - 0.015);
  gain.gain.linearRampToValueAtTime(0, c.currentTime + durationS);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + durationS);
}

/**
 * New radar contact detected (search/track).
 * Single mid-tone blip.
 */
export function playNewContact(): void {
  beep(880, 0.06, 0.2, 'sine');
}

/**
 * Periodic search-mode ping (low priority, played once per ~2 s while search only).
 * Subtle low tick.
 */
export function playSearchPing(): void {
  beep(440, 0.04, 0.12, 'sine');
}

/**
 * Radar lock acquired (STT track) — upgrade from search.
 * Two quick rising tones.
 */
export function playLockTone(): void {
  beep(900, 0.07, 0.22, 'square');
  setTimeout(() => beep(1200, 0.07, 0.22, 'square'), 100);
}

/**
 * Missile launch detected (LAUNCH warning).
 * Rapid repeating high-pitched warble.
 */
export function playLaunchWarning(): void {
  beep(1400, 0.08, 0.3, 'sawtooth');
  setTimeout(() => beep(1000, 0.08, 0.3, 'sawtooth'), 110);
  setTimeout(() => beep(1400, 0.08, 0.3, 'sawtooth'), 220);
  setTimeout(() => beep(1000, 0.08, 0.3, 'sawtooth'), 330);
}

/**
 * ARH seeker gone active (PITBULL).
 * Rising sweep — distinct from lock tone.
 */
export function playPitbullChirp(): void {
  sweep(600, 1800, 0.18, 0.28);
}

/**
 * MAWS first detect (missile motor plume).
 * Harsh sawtooth burst — most urgent warning.
 */
export function playMAWSWarning(): void {
  beep(1600, 0.07, 0.35, 'sawtooth');
  setTimeout(() => beep(1600, 0.07, 0.35, 'sawtooth'), 90);
  setTimeout(() => beep(1600, 0.07, 0.35, 'sawtooth'), 180);
}
