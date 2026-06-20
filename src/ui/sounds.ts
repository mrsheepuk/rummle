// Lightweight sound effects synthesised with the Web Audio API — no audio
// files to ship or fetch. The AudioContext is created lazily and resumed on
// first use, satisfying browsers' autoplay policies (every sound here is
// triggered by a user action or a game event following one).

const MUTE_KEY = "rummle:muted";

let ctx: AudioContext | null = null;
let muted = readMuted();

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** A short, woody "clack" — a decaying filtered-noise burst plus a low tick. */
export function playClack(volume = 0.6): void {
  if (muted) return;
  const ac = getCtx();
  if (!ac) return;
  const now = ac.currentTime;
  const dur = 0.06;

  const buffer = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const t = i / data.length;
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3);
  }
  const noise = ac.createBufferSource();
  noise.buffer = buffer;
  const band = ac.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 1900;
  band.Q.value = 0.8;
  const noiseGain = ac.createGain();
  noiseGain.gain.value = volume;
  noise.connect(band).connect(noiseGain).connect(ac.destination);
  noise.start(now);
  noise.stop(now + dur);

  const osc = ac.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(200, now);
  const oscGain = ac.createGain();
  oscGain.gain.setValueAtTime(volume * 0.5, now);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
  osc.connect(oscGain).connect(ac.destination);
  osc.start(now);
  osc.stop(now + 0.05);
}

function chime(freqs: number[], step: number, peak: number): void {
  if (muted) return;
  const ac = getCtx();
  if (!ac) return;
  const now = ac.currentTime;
  freqs.forEach((f, i) => {
    const t = now + i * step;
    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.value = f;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.3);
  });
}

/** A gentle two-note rise played when a turn passes to the next player. */
export function playTurnComplete(): void {
  chime([523.25, 659.25], 0.11, 0.22); // C5 -> E5
}

/** A brighter four-note flourish for a win. */
export function playWin(): void {
  chime([523.25, 659.25, 783.99, 1046.5], 0.1, 0.28); // C E G C
}
