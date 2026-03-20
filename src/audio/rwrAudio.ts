/**
 * rwrAudio.ts — Web Audio API synthesizer for RWR / MAWS threat audio.
 *
 * All sounds are synthesized via OscillatorNode + GainNode — no audio files.
 * Call initRWRAudio() once on first user interaction to create the AudioContext.
 *
 * Looping functions (startLockTone, startLaunchWarble, startMAWSAlarm,
 * startSearchPing) manage their own setInterval handles and must be stopped
 * by calling the corresponding stop* function or stopAllLoops().
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

/** Single synthesized beep */
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

/** Frequency sweep */
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

// ── One-shot tones (for transition events) ───────────────────────────────────

/** New radar contact — plays once on first detection */
export function playNewContact(): void {
  beep(880, 0.06, 0.2, 'sine');
}

/** ARH seeker gone active (pitbull) — rising sweep, plays once */
export function playPitbullChirp(): void {
  sweep(600, 1800, 0.18, 0.28);
}

// ── Looping tone handles ──────────────────────────────────────────────────────

let lockLoopId: ReturnType<typeof setInterval> | null = null;
let launchLoopId: ReturnType<typeof setInterval> | null = null;
let mawsLoopId: ReturnType<typeof setInterval> | null = null;
let searchLoopId: ReturnType<typeof setInterval> | null = null;

/**
 * Start repeating STT lock tone (~2×/sec).
 * Plays immediately, then every 500 ms until stopLockTone() is called.
 */
export function startLockTone(): void {
  if (lockLoopId) return;
  const play = () => beep(900, 0.07, 0.18, 'square');
  play();
  lockLoopId = setInterval(play, 500);
}

export function stopLockTone(): void {
  if (lockLoopId) { clearInterval(lockLoopId); lockLoopId = null; }
}

/**
 * Start rapid launch/active warble (~7.7 Hz alternating tones).
 * Highest-priority warning — runs until stopLaunchWarble() is called.
 */
export function startLaunchWarble(): void {
  if (launchLoopId) return;
  let toggle = false;
  const play = () => {
    beep(toggle ? 1400 : 1000, 0.08, 0.25, 'sawtooth');
    toggle = !toggle;
  };
  play();
  launchLoopId = setInterval(play, 130);
}

export function stopLaunchWarble(): void {
  if (launchLoopId) { clearInterval(launchLoopId); launchLoopId = null; }
}

/**
 * Start MAWS pulsing alarm (~3.3×/sec harsh sawtooth).
 * Runs until stopMAWSAlarm() is called.
 */
export function startMAWSAlarm(): void {
  if (mawsLoopId) return;
  const play = () => beep(1600, 0.07, 0.3, 'sawtooth');
  play();
  mawsLoopId = setInterval(play, 300);
}

export function stopMAWSAlarm(): void {
  if (mawsLoopId) { clearInterval(mawsLoopId); mawsLoopId = null; }
}

/**
 * Start periodic radar search ping (~1× per sweep cycle).
 * @param sweepIntervalMs milliseconds between pings (default 6000 = 6s sweep)
 */
export function startSearchPing(sweepIntervalMs = 6000): void {
  if (searchLoopId) return;
  const play = () => beep(440, 0.04, 0.08, 'sine');
  play();
  searchLoopId = setInterval(play, sweepIntervalMs);
}

export function stopSearchPing(): void {
  if (searchLoopId) { clearInterval(searchLoopId); searchLoopId = null; }
}

/** Stop ALL active loops immediately (call on sim reset, pause, or unmount) */
export function stopAllLoops(): void {
  stopLockTone();
  stopLaunchWarble();
  stopMAWSAlarm();
  stopSearchPing();
}
