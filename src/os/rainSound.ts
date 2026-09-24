import { afterReveal } from '../loadProgress'
import { audioBus, audioUnlocked, onAudioUnlock } from './sound'

/* =====================================================================
   Rain, heard from inside a warm room — the ambience for the window.

   Slight and cosy on purpose: a soft hush, a scatter of tiny ticks, and
   now and then a bigger drop tapping the glass. It sits well under the
   click effects (about 5-8 % of master) and never draws attention.

   THREE LAYERS, baked into looping stereo AudioBuffers:
     wash   band-limited pink-ish noise, ~250 Hz to 4 kHz, split into a
            low-mid and an upper band that breathe separately (0.1-0.3
            Hz), so the hush swells and thins like real rain
     ticks  many tiny droplets: a 0.3-1.2 ms noise burst ringing a 1-4 kHz
            resonator for 4-25 ms; random velocity (mostly quiet, a few
            loud), random pan, Poisson timing with clustered "showers"
     taps   a sparser, softer layer of bigger drops on glass and sill:
            300-900 Hz resonant taps with a glassy second partial

   THREE LOOPS (5.3 s, 7.1 s, 8.9 s) each carry all three layers with
   their own seed, pan and playback rate (about -0.6 % / +0.7 % / 0),
   so the combined pattern repeats only after hours.

   SEAMLESS LOOPS by construction, not by crossfade: the wash noise is
   counter-based (any sample is computable alone), so each filter is
   warmed up on the loop's own tail and the first sample continues the
   last; every slow modulation runs a whole number of cycles per loop;
   drops write modulo the loop length, so a tail that runs off the end
   rings on at the start.

   OFF THE HOT PATH: the build is a generator, ~670 steps of about a
   tenth of a millisecond each (50-90 ms of CPU all told). `stepRainBuild`
   advances it in slices, never a single block over a millisecond;
   `buildRainBuffers` runs the very same generator to completion for any
   BaseAudioContext, which is how an offline audition renders it.
   Deterministic (seeded): the audition file is exactly what plays.

   BUILT BEFORE IT IS WANTED. The loops used to be synthesised only after
   the visitor's first gesture (an AudioContext is the only way to learn
   the output rate, and there was none before then) at 1.5 ms a frame —
   under a tenth of the wall clock, so the rain arrived seconds late. Now
   they render into an OfflineAudioContext at a fixed rate (BUILD_RATE),
   in idle time once the loading veil has lifted, and are simply waiting
   when the gesture comes. Nothing is connected to an output until then.

   PLAYBACK: loop=true sources -> mix -> high-pass 120 Hz -> low-pass
   ~5 kHz (the indoor muffle) -> level gain -> the master bus in
   sound.ts. No timers, no per-note scheduling: the level is the only
   thing that ever moves, retargeted at most 10 times a second with
   setTargetAtTime (fade in ~3 s, out ~2 s), never a jump.

   This file owns the ambience; the per-frame driver is
   src/three/RainAudio.tsx. It needs no import from src/three: the
   driver hands in plain inputs.
   ===================================================================== */

/* ---------- tunables ---------- */

/** level gain into the master bus, as a fraction of it (0.4 downstream) */
export const RAIN_LEVEL = 0.07
export const STORM_LEVEL = 0.105
/** the OS fills the screen: about 30 % quieter */
export const SCREEN_MUL = 0.7
/** walking over to the bookcase: a touch lower */
export const LIBRARY_MUL = 0.85
/** the indoor muffle; a storm opens it a little */
export const RAIN_CUTOFF = 5000
export const STORM_CUTOFF = 6200

/** setTargetAtTime constants: 3 x tc is ~95 % of the way */
const FADE_IN_TC = 1.0 // in over ~3 s
const FADE_OUT_TC = 0.67 // out over ~2 s

/** The room's FIRST sound is a different moment from every later one.
    By the time it arrives the visitor has been watching rain run down
    the glass for several seconds with nothing to hear, so a three-second
    swell does not read as weather gathering — it reads as the sound
    being late. Every later change keeps FADE_IN_TC: rain returning as a
    storm passes, walking back from the bookcase, coming off mute. Only
    the first ramp of the page is quicker, and only once.

    0.3 s (about 0.9 s to 95 %) was chosen by rendering the real playback
    graph offline and measuring the envelope, not by arithmetic. From the
    point the bed first clears the room's hush to within a dB of its
    level is 0.62 s, against 2.12 s at FADE_IN_TC — brisk, but still a
    swell: the wash underneath breathes at 0.1-0.3 Hz, so its own
    thin-to-full takes 1.7-5 s, and a 0.6 s rise is of that family rather
    than a new sound switching on. Faster was auditioned and rejected:
    by 0.12 s the onset is an order of magnitude quicker than anything
    the material does on its own, and it starts to read as a clip. */
const FIRST_FADE_IN_TC = 0.3
/** raining enough to start / to stop (hysteresis on live.rain) */
const ON_RAIN = 0.03
const OFF_RAIN = 0.008
/** the level is retargeted at most this often */
const POLL_S = 0.1
/** per-frame build slice, in ms */
const SLICE_MS = 1.5

/** Levels inside the buffers (full scale = 1). The wash of each loop is
    levelled to this RMS; drops are absolute, so a loud drop stands well
    clear of the hush without the hush ever being turned up for it. */
const WASH_RMS = 0.095
/** a tick / tap at velocity 1 (the loudest, rare); most are far softer */
const TICK_ABS = 0.8
const TAP_ABS = 0.34
const PEAK_CEIL = 0.98
/** average children per parent tick in a cluster */
const CHILD_MEAN = 1.4
/** control-point spacing of the slow modulations, in samples */
const CTRL = 64

/* ---------- the loops ---------- */

interface Term {
  /** whole cycles per loop: keeps the loop seamless */
  k: number
  a: number
  /** phase, in cycles */
  ph: number
}

interface LoopSpec {
  seconds: number
  seed: number
  /** -1 left ... +1 right, gentle */
  pan: number
  /** playbackRate: a touch of detune so no two loops stay in step */
  rate: number
  /** ticks per second, children included */
  tickRate: number
  /** taps per second */
  tapRate: number
  /** breathing of the low-mid and the upper wash band */
  low: readonly Term[]
  high: readonly Term[]
  /** linear depth of one loop's breathing (0.58 is about +4 / -7.5 dB
      at the extreme; three loops in the mix average to about +-3) */
  depth: number
  /** drop-density swell: cycles per loop and phases */
  dk1: number
  dk2: number
  dp1: number
  dp2: number
}

export const RAIN_LOOPS: readonly LoopSpec[] = [
  {
    seconds: 5.3,
    seed: 0x5a17c3,
    pan: -0.22,
    rate: 0.994,
    tickRate: 13,
    tapRate: 1.5,
    low: [{ k: 1, a: 1, ph: 0.1 }],
    high: [{ k: 1, a: 1, ph: 0.42 }],
    depth: 0.58,
    dk1: 3,
    dk2: 5,
    dp1: 0.2,
    dp2: 0.7,
  },
  {
    seconds: 7.1,
    seed: 0x8c3f61,
    pan: 0.18,
    rate: 1.007,
    tickRate: 12,
    tapRate: 1.6,
    low: [
      { k: 1, a: 0.65, ph: 0.3 },
      { k: 2, a: 0.35, ph: 0.8 },
    ],
    high: [
      { k: 2, a: 0.6, ph: 0.1 },
      { k: 1, a: 0.4, ph: 0.55 },
    ],
    depth: 0.58,
    dk1: 4,
    dk2: 7,
    dp1: 0.55,
    dp2: 0.1,
  },
  {
    seconds: 8.9,
    seed: 0x2e91d5,
    pan: 0.02,
    rate: 1,
    tickRate: 8,
    tapRate: 2.2,
    low: [
      { k: 1, a: 0.5, ph: 0 },
      { k: 2, a: 0.5, ph: 0.35 },
    ],
    high: [
      { k: 1, a: 0.5, ph: 0.6 },
      { k: 2, a: 0.5, ph: 0.15 },
    ],
    depth: 0.58,
    dk1: 5,
    dk2: 8,
    dp1: 0.85,
    dp2: 0.4,
  },
]

/** which layers to render (all by default; the switches exist so the
    audition can measure each layer alone, at its true mixed level) */
export interface BuildOptions {
  wash?: boolean
  ticks?: boolean
  taps?: boolean
}

/** how many drops the last build laid down, per loop (for the audition) */
export const rainStats: { ticks: number[]; taps: number[] } = { ticks: [], taps: [] }

/* ---------- small DSP kit ---------- */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** counter-based white noise in [-1, 1): sample `i` of stream `key`
    computed on its own, which is what lets a filter be primed on the
    tail of the loop it is about to write */
function whiteAt(key: number, i: number): number {
  let x = (i ^ key) >>> 0
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d)
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b)
  x ^= x >>> 16
  return (x >>> 0) / 2147483648 - 1
}

function streamKey(seed: number, stream: number): number {
  return (Math.imul(seed, 0x9e3779b1) ^ Math.imul(stream, 0x85ebca6b)) >>> 0
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/** RBJ 2nd-order low/high-pass, transposed direct form II */
class Biquad {
  b0 = 0
  b1 = 0
  b2 = 0
  a1 = 0
  a2 = 0
  z1 = 0
  z2 = 0
  constructor(kind: 'lp' | 'hp', fs: number, f: number, q = Math.SQRT1_2) {
    const w = (2 * Math.PI * Math.min(f, fs * 0.45)) / fs
    const c = Math.cos(w)
    const al = Math.sin(w) / (2 * q)
    const a0 = 1 + al
    if (kind === 'lp') {
      this.b0 = (1 - c) / 2 / a0
      this.b1 = (1 - c) / a0
    } else {
      this.b0 = (1 + c) / 2 / a0
      this.b1 = -(1 + c) / a0
    }
    this.b2 = this.b0
    this.a1 = (-2 * c) / a0
    this.a2 = (1 - al) / a0
  }
  run(x: number): number {
    const y = this.b0 * x + this.z1
    this.z1 = this.b1 * x - this.a1 * y + this.z2
    this.z2 = this.b2 * x - this.a2 * y
    return y
  }
}

/** one noise stream: pink tilt, a walls-and-glass roll-off from 1.3 kHz,
    then 250 Hz .. 4 kHz, split at 800 Hz into the two breathing bands */
class WashStream {
  b0 = 0
  b1 = 0
  b2 = 0
  /** one-pole low-pass state and coefficient */
  t = 0
  ta: number
  hp: Biquad
  lp: Biquad
  split: Biquad
  low = 0
  high = 0
  constructor(fs: number) {
    this.ta = 1 - Math.exp((-2 * Math.PI * 1300) / fs)
    this.hp = new Biquad('hp', fs, 250)
    this.lp = new Biquad('lp', fs, 4000)
    this.split = new Biquad('lp', fs, 800)
  }
  step(w: number): void {
    // Paul Kellet's economy pinking filter, about -3 dB/octave
    this.b0 = 0.99765 * this.b0 + w * 0.099046
    this.b1 = 0.963 * this.b1 + w * 0.2965164
    this.b2 = 0.57 * this.b2 + w * 1.0526913
    const pink = this.b0 + this.b1 + this.b2 + w * 0.1848
    // indoors the highs are the first thing the room takes away
    this.t += this.ta * (pink - this.t)
    const band = this.lp.run(this.hp.run(this.t))
    const lo = this.split.run(band)
    this.low = lo
    this.high = band - lo
  }
}

function breath(terms: readonly Term[], x: number): number {
  let s = 0
  for (const t of terms) s += t.a * Math.sin(2 * Math.PI * (t.k * x + t.ph))
  return s
}

/** density swell of the drops (periodic in the loop, mean about 1) */
function densityMod(spec: LoopSpec, x: number, shift: number): number {
  const m =
    1 +
    0.5 * Math.sin(2 * Math.PI * (spec.dk1 * x + spec.dp1 + shift)) +
    0.25 * Math.sin(2 * Math.PI * (spec.dk2 * x + spec.dp2 + shift * 2))
  return clamp(m, 0.25, 1.75)
}

/** thinned Poisson arrivals over one loop, as sample positions */
function poissonTimes(
  rate: number,
  spec: LoopSpec,
  rnd: () => number,
  N: number,
  fs: number,
  shift: number,
): number[] {
  const out: number[] = []
  if (rate <= 0) return out
  const lmax = rate * 1.75
  const T = N / fs
  let t = 0
  for (;;) {
    t += -Math.log(1 - rnd()) / lmax
    if (t >= T) break
    if (rnd() * 1.75 < densityMod(spec, t / T, shift)) out.push(Math.floor(t * fs))
  }
  return out
}

function poissonCount(mean: number, rnd: () => number): number {
  const l = Math.exp(-mean)
  let k = 0
  let p = 1
  do {
    k++
    p *= rnd()
  } while (p > l && k < 8)
  return k - 1
}

/* ---------- the wash ---------- */

/** Writes the wash into L/R (when `write`) and returns its energy
    (sum of squares over both channels). Generated on a circle. */
function* renderWash(
  L: Float32Array,
  R: Float32Array,
  N: number,
  fs: number,
  spec: LoopSpec,
  write: boolean,
): Generator<void, number, void> {
  const kx = streamKey(spec.seed, 1)
  const ky = streamKey(spec.seed, 2)
  const sx = new WashStream(fs)
  const sy = new WashStream(fs)

  // prime every filter on the loop's own tail: sample 0 continues N-1
  const warm = Math.min(N, 8192)
  for (let i = N - warm; i < N; i++) {
    sx.step(whiteAt(kx, i))
    sy.step(whiteAt(ky, i))
  }

  // breathing, sampled at segment boundaries and interpolated linearly;
  // the last control point is the first: the loop closes exactly
  const M = Math.ceil(N / CTRL)
  const cLow = new Float64Array(M + 1)
  const cHigh = new Float64Array(M + 1)
  for (let j = 0; j < M; j++) {
    const x = Math.floor((j * N) / M) / N
    cLow[j] = 1 + spec.depth * breath(spec.low, x)
    cHigh[j] = 1 + spec.depth * breath(spec.high, x)
  }
  cLow[M] = cLow[0]
  cHigh[M] = cHigh[0]

  // stereo: the low-mid is mostly common to both ears, the upper hush
  // is wide. L = a X + b Y, R = a X - b Y  =>  correlation rho
  const RHO_LO = 0.7
  const RHO_HI = 0.25
  const aLo = Math.sqrt((1 + RHO_LO) / 2)
  const bLo = Math.sqrt((1 - RHO_LO) / 2)
  const aHi = Math.sqrt((1 + RHO_HI) / 2)
  const bHi = Math.sqrt((1 - RHO_HI) / 2)
  // the upper band sits a little back: cosy, not hissy
  const LOW_W = 1
  const HIGH_W = 1

  let energy = 0
  for (let j = 0; j < M; j++) {
    const i0 = Math.floor((j * N) / M)
    const i1 = Math.floor(((j + 1) * N) / M)
    const len = i1 - i0
    let gl = cLow[j] * LOW_W
    let gh = cHigh[j] * HIGH_W
    const dgl = (cLow[j + 1] * LOW_W - gl) / len
    const dgh = (cHigh[j + 1] * HIGH_W - gh) / len
    for (let i = i0; i < i1; i++) {
      sx.step(whiteAt(kx, i))
      sy.step(whiteAt(ky, i))
      const lo = gl * aLo * sx.low
      const hi = gh * aHi * sx.high
      const loY = gl * bLo * sy.low
      const hiY = gh * bHi * sy.high
      const l = lo + loY + hi + hiY
      const r = lo - loY + hi - hiY
      if (write) {
        L[i] = l
        R[i] = r
      }
      energy += l * l + r * r
      gl += dgl
      gh += dgh
    }
    if ((j & 31) === 31) yield
  }
  return energy
}

/* ---------- the drops ---------- */

interface Ring {
  f: number
  tau: number
  /** excitation length, s */
  ex: number
  /** second partial: frequency ratio (0 = none) and weight */
  ratio: number
  partW: number
}

/** Ticks and taps, laid onto the loop's circle after the wash. Absolute
    levels; a layer that is switched off is still drawn (so the random
    stream, and every other layer, is identical) but never written. */
function* renderDrops(
  L: Float32Array,
  R: Float32Array,
  N: number,
  fs: number,
  spec: LoopSpec,
  rnd: () => number,
  opts: Required<BuildOptions>,
  stats: { ticks: number; taps: number },
): Generator<void, void, void> {
  const scratch = new Float32Array(Math.ceil(fs * 0.3))
  const maxItd = 0.00035 * fs

  /** ring a resonator with a short noise burst, normalise its peak to
      `peak`, pan it and add it to the circle */
  const lay = (at: number, peak: number, pan: number, write: boolean, g: Ring): void => {
    const exN = Math.max(6, Math.round(g.ex * fs))
    const n = Math.min(scratch.length, Math.ceil(5.5 * g.tau * fs) + exN)
    const r1 = Math.exp(-1 / (g.tau * fs))
    const c1 = 2 * r1 * Math.cos((2 * Math.PI * g.f) / fs)
    const d1 = r1 * r1
    const n1 = 1 - r1
    const r2 = Math.exp(-1 / (g.tau * 0.55 * fs))
    const c2 = 2 * r2 * Math.cos((2 * Math.PI * Math.min(g.f * g.ratio, fs * 0.4)) / fs)
    const d2 = r2 * r2
    const n2 = (1 - r2) * g.partW
    let y1a = 0
    let y1b = 0
    let y2a = 0
    let y2b = 0
    let top = 1e-12
    for (let k = 0; k < n; k++) {
      const e = k < exN ? (rnd() * 2 - 1) * Math.sin((Math.PI * (k + 0.5)) / exN) : 0
      const y1 = e + c1 * y1a - d1 * y1b
      y1b = y1a
      y1a = y1
      let y = y1 * n1
      if (g.partW > 0) {
        const y2 = e + c2 * y2a - d2 * y2b
        y2b = y2a
        y2a = y2
        y += y2 * n2
      }
      // let the last 15 % fade, so a truncated tail never clicks
      const tail = k - n * 0.85
      if (tail > 0) y *= 0.5 * (1 + Math.cos((Math.PI * tail) / (n * 0.15)))
      scratch[k] = y
      const a = y < 0 ? -y : y
      if (a > top) top = a
    }
    if (!write) return
    const scale = peak / top
    const th = ((pan + 1) * Math.PI) / 4
    const gl = Math.cos(th) * scale
    const gr = Math.sin(th) * scale
    // the far ear hears it a hair later
    const dl = pan > 0 ? Math.round(pan * maxItd) : 0
    const dr = pan < 0 ? Math.round(-pan * maxItd) : 0
    const base = ((at % N) + N) % N
    for (let k = 0; k < n; k++) {
      const s = scratch[k]
      let il = base + k + dl
      if (il >= N) il -= N
      if (il >= N) il %= N
      let ir = base + k + dr
      if (ir >= N) ir -= N
      if (ir >= N) ir %= N
      L[il] += gl * s
      R[ir] += gr * s
    }
  }

  const drawPan = (): number => {
    // roughly Gaussian, most of it well inside the room
    const g = (rnd() + rnd() + rnd() - 1.5) / 1.5
    return clamp(g * 0.9, -0.9, 0.9)
  }

  const tick = (at: number, v: number, pan: number): void => {
    const f = 1200 * Math.pow(3.6, Math.pow(rnd(), 1.1))
    const tau = clamp(0.0008 + 0.0037 * Math.pow(rnd(), 1.5) * Math.pow(2000 / f, 0.4), 0.0008, 0.0045)
    const ex = 0.00025 + 0.0009 * rnd()
    const withPart = rnd() < 0.5
    const ratio = 1.7 + 0.9 * rnd()
    lay(at, TICK_ABS * v, pan, opts.ticks, {
      f,
      tau,
      ex,
      ratio: withPart ? ratio : 0,
      partW: withPart ? 0.35 : 0,
    })
    stats.ticks++
  }

  // isolated drops, and parents that shed a few softer children a few
  // ms to a few tens of ms apart: a shower, never a metronome
  const isoRate = spec.tickRate * 0.5
  const parentRate = (spec.tickRate * 0.5) / (1 + CHILD_MEAN)
  const iso = poissonTimes(isoRate, spec, rnd, N, fs, 0)
  const parents = poissonTimes(parentRate, spec, rnd, N, fs, 0.05)
  let done = 0
  // mostly soft, a few loud
  const draw = (): number => 0.18 + 0.82 * Math.pow(rnd(), 2)
  for (const at of iso) {
    tick(at, draw(), drawPan())
    if ((++done & 15) === 0) yield
  }
  for (const at of parents) {
    let v = draw()
    const pan = drawPan()
    tick(at, v, pan)
    let t = at
    const kids = poissonCount(CHILD_MEAN, rnd)
    for (let c = 0; c < kids; c++) {
      t += Math.round(fs * (0.006 - 0.028 * Math.log(1 - rnd())))
      v *= 0.55 + 0.4 * rnd()
      tick(t, v, clamp(pan + (rnd() - 0.5) * 0.3, -0.9, 0.9))
    }
    if ((++done & 15) === 0) yield
  }

  // the bigger, softer drops: glass and sill
  const taps = poissonTimes(spec.tapRate, spec, rnd, N, fs, 0.5)
  for (const at of taps) {
    const f = 300 * Math.pow(3, rnd())
    const tau = clamp(0.01 + 0.022 * Math.pow(rnd(), 1.2), 0.008, 0.032) * Math.pow(500 / f, 0.3)
    const v = 0.25 + 0.75 * Math.pow(rnd(), 2)
    lay(at, TAP_ABS * v, drawPan(), opts.taps, {
      f,
      tau,
      ex: 0.0012 + 0.0018 * rnd(),
      ratio: 2.1 + 0.8 * rnd(),
      partW: 0.3,
    })
    stats.taps++
    yield
  }
}

/* ---------- one loop, and all of them ---------- */

function* renderLoop(
  ac: BaseAudioContext,
  spec: LoopSpec,
  opts: Required<BuildOptions>,
  stats: { ticks: number; taps: number },
): Generator<void, AudioBuffer, void> {
  const fs = ac.sampleRate
  const N = Math.max(4096, Math.round(spec.seconds * fs))
  const buf = ac.createBuffer(2, N, fs)
  const L = buf.getChannelData(0)
  const R = buf.getChannelData(1)
  yield
  const rnd = mulberry32(spec.seed)

  // the wash first, then levelled to WASH_RMS whatever the filters gave
  const washEnergy = yield* renderWash(L, R, N, fs, spec, opts.wash)
  if (opts.wash && washEnergy > 0) {
    const gw = WASH_RMS / Math.sqrt(washEnergy / (2 * N))
    for (let i0 = 0; i0 < N; i0 += 16384) {
      const i1 = Math.min(N, i0 + 16384)
      for (let i = i0; i < i1; i++) {
        L[i] *= gw
        R[i] *= gw
      }
      yield
    }
  }
  yield* renderDrops(L, R, N, fs, spec, rnd, opts, stats)

  // balance (equal power: the centre stays 1), and a ceiling that no
  // pile-up of loud drops can exceed
  const th = ((spec.pan + 1) * Math.PI) / 4
  const gl = Math.SQRT2 * Math.cos(th)
  const gr = Math.SQRT2 * Math.sin(th)
  let peak = 0
  for (let i0 = 0; i0 < N; i0 += 16384) {
    const i1 = Math.min(N, i0 + 16384)
    for (let i = i0; i < i1; i++) {
      const l = L[i] * gl
      const r = R[i] * gr
      L[i] = l
      R[i] = r
      const a = Math.max(l < 0 ? -l : l, r < 0 ? -r : r)
      if (a > peak) peak = a
    }
    yield
  }
  if (peak > PEAK_CEIL) {
    const k = PEAK_CEIL / peak
    for (let i0 = 0; i0 < N; i0 += 16384) {
      const i1 = Math.min(N, i0 + 16384)
      for (let i = i0; i < i1; i++) {
        L[i] *= k
        R[i] *= k
      }
      yield
    }
  }
  return buf
}

/** The whole build as a steppable job: every `yield` is a good place to
    give the frame back. Pure: same context sample rate, same samples. */
export function* rainBufferJob(
  ac: BaseAudioContext,
  opts: BuildOptions = {},
): Generator<void, AudioBuffer[], void> {
  const full: Required<BuildOptions> = {
    wash: opts.wash ?? true,
    ticks: opts.ticks ?? true,
    taps: opts.taps ?? true,
  }
  const out: AudioBuffer[] = []
  const ticks: number[] = []
  const taps: number[] = []
  for (const spec of RAIN_LOOPS) {
    const stats = { ticks: 0, taps: 0 }
    out.push(yield* renderLoop(ac, spec, full, stats))
    ticks.push(stats.ticks)
    taps.push(stats.taps)
  }
  rainStats.ticks = ticks
  rainStats.taps = taps
  return out
}

/** Builds the loops for any BaseAudioContext (live or offline) in one go.
    Blocks for the whole build, so the live app uses `stepRainBuild`;
    this is for offline renders and tests. */
export function buildRainBuffers(ac: BaseAudioContext, opts: BuildOptions = {}): AudioBuffer[] {
  const job = rainBufferJob(ac, opts)
  for (;;) {
    const r = job.next()
    if (r.done) return r.value
  }
}

/* ---------- the shared, time-sliced build (live app) ---------- */

/** The rate the loops are synthesised at.

    The build must not wait for the visitor's first gesture — that was
    most of the old delay — and before a gesture there is no AudioContext
    to ask for the output rate: constructing one early works, but Chrome
    logs an autoplay warning for it and it wakes the audio device for a
    visitor who may never make a sound. So the build renders into an
    OfflineAudioContext at the rate every current browser opens its
    output at, and a device that runs at 44.1 kHz gets these very same
    buffers. That is not a compromise: an AudioBufferSourceNode resamples
    any buffer whose rate differs from its context's, which is already
    the normal path here — two of the three loops are detuned to 0.994
    and 1.007, so they are resampled whatever the rate. Measured, offline:
    these loops rendered through the playback graph into a 44.1 kHz
    context sit within 0.15 dB of loops built natively at 44.1 kHz across
    120 Hz - 3 kHz, and within 0.12 dB of themselves at 48 kHz in every
    band — on a bed band-limited to 4 kHz in synthesis and 5 kHz again on
    playback there is nothing left to hear. So nothing is ever built
    twice, and the ambience is now sample-identical on every machine
    instead of one render per output rate. */
const BUILD_RATE = 48000

let cache: { rate: number; buffers: AudioBuffer[] } | null = null
let job: { rate: number; gen: Generator<void, AudioBuffer[], void> } | null = null
/** nothing but a factory for `createBuffer`: never rendered, never
    connected to anything, dropped as soon as the build is done */
let factory: BaseAudioContext | null = null
/** measured: the longest single step, the whole build, slices taken,
    and the moment the loops were finished (performance.now, -1 = not) */
const telemetry = { maxStepMs: 0, totalMs: 0, steps: 0, readyAt: -1 }

/** The silent context the shared build renders into. */
function buildContext(): BaseAudioContext | null {
  if (!factory) {
    try {
      factory = new OfflineAudioContext(1, 1, BUILD_RATE)
    } catch {
      return null
    }
  }
  return factory
}

/** The finished loops for this sample rate, or null while not built. */
export function readyBuffers(ac: BaseAudioContext): AudioBuffer[] | null {
  return cache && cache.rate === ac.sampleRate ? cache.buffers : null
}

/** The finished loops whatever rate they were rendered at (see
    BUILD_RATE) — what the live ambience plays. */
export function builtBuffers(): AudioBuffer[] | null {
  return cache ? cache.buffers : null
}

/** Advance the shared build by at most about `budgetMs`. Returns the
    loops once done (and forever after). Steps are small — a tenth of a
    millisecond typically, never over one — so the budget is overshot by
    less than a step. */
export function stepRainBuild(ac: BaseAudioContext, budgetMs: number): AudioBuffer[] | null {
  const ready = readyBuffers(ac)
  if (ready) return ready
  if (!job || job.rate !== ac.sampleRate) {
    job = { rate: ac.sampleRate, gen: rainBufferJob(ac) }
    telemetry.maxStepMs = 0
    telemetry.totalMs = 0
    telemetry.steps = 0
  }
  const t0 = performance.now()
  for (;;) {
    const s0 = performance.now()
    const r = job.gen.next()
    const now = performance.now()
    telemetry.maxStepMs = Math.max(telemetry.maxStepMs, now - s0)
    telemetry.totalMs += now - s0
    telemetry.steps++
    if (r.done) {
      cache = { rate: job.rate, buffers: r.value }
      job = null
      telemetry.readyAt = now
      return r.value
    }
    if (now - t0 >= budgetMs) return null
  }
}

/* ---------- getting it built before anyone asks to hear it ---------- */

/** Idle slice, ms. The deadline is honoured and then some — a slot that
    says it has 8 ms left gets 6, and 6 is the ceiling however much time
    a slot claims. The whole build is only 50-90 ms, so a dozen or so
    unhurried slots finish it within half a second of the reveal; there
    is nothing to be gained by leaning harder on the frames that carry
    the intro dolly. */
const IDLE_MAX_MS = 6
const IDLE_MIN_MS = 2
/** headroom left at the end of an idle slot, ms */
const IDLE_MARGIN_MS = 2

interface Deadline {
  timeRemaining(): number
  didTimeout: boolean
}
type IdleFn = (d: Deadline) => void

const idle: (fn: IdleFn) => void =
  typeof window === 'undefined'
    ? () => undefined
    : 'requestIdleCallback' in window
      ? (fn) =>
          (
            window as unknown as {
              requestIdleCallback(f: IdleFn, o: { timeout: number }): void
            }
          ).requestIdleCallback(fn, { timeout: 400 })
      : // no requestIdleCallback (Safari < 16.4): a small slice off the
        // back of the frame instead, with the per-frame net underneath
        (fn) => window.setTimeout(() => fn({ timeRemaining: () => 5, didTimeout: false }), 16)

/** armed: the ambience has asked for the loops at least once */
let armed = false
/** the room is on screen — the build may have the idle time it wants */
let unveiled = false

function pump(d: Deadline): void {
  if (cache) return
  const ac = buildContext()
  if (!ac) return
  // a slot that fired on its timeout is not idle at all: take the floor
  const budget = d.didTimeout
    ? IDLE_MIN_MS
    : clamp(d.timeRemaining() - IDLE_MARGIN_MS, IDLE_MIN_MS, IDLE_MAX_MS)
  try {
    if (stepRainBuild(ac, budget)) {
      factory = null
      return
    }
  } catch {
    return
  }
  idle(pump)
}

/** Get the loops made. Idempotent, and silent: this synthesises samples
    and nothing else — no node is connected to an output and nothing can
    play until the visitor's first gesture.

    Held back until the loading veil has lifted (src/loadProgress.ts) and
    then run in genuine idle time, so it can never be the reason a frame
    of the first load or the intro dolly is late. */
export function primeRainBuild(): void {
  if (armed) return
  armed = true
  afterReveal(() => {
    unveiled = true
    if (!cache) idle(pump)
  })
}

/** Armed, revealed, and still not finished — the frame loop keeps a net
    under the idle build for a tab that never gets an idle slot. */
function buildPending(): boolean {
  return unveiled && !cache
}

/* ---------- the playback graph (live and offline alike) ---------- */

export interface RainGraph {
  readonly ctx: BaseAudioContext
  /** the ambience level: the one thing that ever moves */
  readonly level: GainNode
  /** the indoor muffle */
  readonly filter: BiquadFilterNode
  readonly sources: readonly AudioBufferSourceNode[]
  /** sources still playing */
  running(): number
  /** start every loop at `at`; `offsets` are seconds into each loop */
  start(at: number, offsets?: readonly number[]): void
  /** fade out over about `fade` s, stop, and disconnect every node */
  release(fade: number): void
}

const graphs = new Set<RainGraph>()

export function createRainGraph(
  ac: BaseAudioContext,
  dest: AudioNode,
  buffers: readonly AudioBuffer[],
): RainGraph {
  const mix = ac.createGain()
  const hp = ac.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 120
  hp.Q.value = 0.6
  const lp = ac.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = RAIN_CUTOFF
  lp.Q.value = 0.5
  const level = ac.createGain()
  level.gain.value = 0
  mix.connect(hp)
  hp.connect(lp)
  lp.connect(level)
  level.connect(dest)

  const sources = buffers.map((b, i) => {
    const s = ac.createBufferSource()
    s.buffer = b
    s.loop = true
    s.playbackRate.value = RAIN_LOOPS[i]?.rate ?? 1
    s.connect(mix)
    return s
  })

  let started = 0
  let ended = 0
  let gone = false
  const dispose = (): void => {
    if (gone) return
    gone = true
    for (const n of [...sources, mix, hp, lp, level]) {
      try {
        n.disconnect()
      } catch {
        /* already disconnected */
      }
    }
    graphs.delete(graph)
  }
  for (const s of sources) {
    s.onended = () => {
      if (++ended >= started) dispose()
    }
  }

  const graph: RainGraph = {
    ctx: ac,
    level,
    filter: lp,
    sources,
    running: () => (gone ? 0 : started - ended),
    start(at, offsets) {
      sources.forEach((s, i) => {
        const dur = s.buffer?.duration ?? 0
        const off = offsets?.[i] ?? 0
        try {
          s.start(at, dur > 0 ? off % dur : 0)
          started++
        } catch {
          /* already started */
        }
      })
    },
    release(fade) {
      if (gone) return
      if (started === 0) {
        dispose()
        return
      }
      const now = ac.currentTime
      try {
        const p = level.gain
        p.cancelScheduledValues(now)
        p.setValueAtTime(p.value, now)
        p.setTargetAtTime(0, now, Math.max(0.005, fade) / 6)
      } catch {
        /* the stop below still silences it */
      }
      for (const s of sources) {
        try {
          s.stop(now + fade + 0.05)
        } catch {
          /* already stopped */
        }
      }
    },
  }
  graphs.add(graph)
  return graph
}

/* ---------- the ambience: level policy + lifecycle ---------- */

export interface RainInputs {
  /** live.rain: 0 clear ... 1 raining (already damped) */
  rain: number
  storm: boolean
  /** the OS fills the screen */
  screen: boolean
  /** the camera has walked over to the bookcase */
  library: boolean
  muted: boolean
}

/** Level gain for these inputs: 0 when clear or muted, slight for rain,
    a little more for a storm; quieter with the OS up, a touch lower in
    the library. */
export function rainLevel(i: RainInputs): number {
  if (i.muted) return 0
  const base = i.storm ? STORM_LEVEL : RAIN_LEVEL
  return base * clamp(i.rain, 0, 1) * (i.screen ? SCREEN_MUL : 1) * (i.library ? LIBRARY_MUL : 1)
}

export interface RainAmbience {
  /** every frame: builds in small slices, retargets the level 10 x/s */
  frame(dt: number, inputs: RainInputs): void
  /** react right now (a mute click) instead of at the next tick */
  poke(inputs: RainInputs): void
  /** release everything */
  dispose(): void
}

const IDLE: RainInputs = { rain: 0, storm: false, screen: false, library: false, muted: false }

function randomOffsets(buffers: readonly AudioBuffer[]): number[] {
  return buffers.map((b) => Math.random() * b.duration)
}

/** Has the rain been heard at all yet? Module level, so it is once per
    page load and not once per ambience: the scene is torn down and
    rebuilt on the way to /library and back, and that return is a later
    change like any other, not the room's first sound. */
let heardYet = false

export function createRainAmbience(): RainAmbience {
  let disposed = false
  let graph: RainGraph | null = null
  let last: RainInputs = IDLE
  let acc = 0
  /** the last level handed to the gain, -1 = none yet */
  let applied = -1
  let appliedCut = 0

  const hidden = (): boolean =>
    typeof document !== 'undefined' && document.visibilityState === 'hidden'

  const letGo = (fade: number): void => {
    if (!graph) return
    graph.release(fade)
    graph = null
    applied = -1
    appliedCut = 0
  }

  const evaluate = (i: RainInputs): void => {
    last = i
    if (disposed) return
    try {
      // it is raining today and the visitor can hear: get the loops made
      // now, in idle time, so that the first gesture is the only thing
      // the rain is ever waiting for
      if (!i.muted && i.rain > 0) primeRainBuild()

      const away = hidden()
      const wants = !i.muted && !away && i.rain > (graph ? OFF_RAIN : ON_RAIN)
      if (!wants) {
        // mute and a hidden tab cut fast (still ramped); rain going away
        // has already faded with live.rain
        if (graph) letGo(i.muted || away ? 0.15 : 0.5)
        return
      }
      if (!audioUnlocked()) return

      if (!graph) {
        const bus = audioBus()
        if (!bus) return
        const buffers = builtBuffers()
        if (!buffers) return
        if (bus.ac.state !== 'running') return
        graph = createRainGraph(bus.ac, bus.bus, buffers)
        graph.start(bus.ac.currentTime, randomOffsets(buffers))
        applied = 0
      }

      const now = graph.ctx.currentTime
      const target = rainLevel(i)
      if (Math.abs(target - applied) > 0.0004) {
        const up = target > applied
        // the quick ramp is for the one that leaves silence (applied is
        // 0 only on a graph that has just been started), never for a
        // level nudge on rain that is already playing
        const first = up && !heardYet && applied === 0
        if (first) heardYet = true
        const tc = up ? (first ? FIRST_FADE_IN_TC : FADE_IN_TC) : FADE_OUT_TC
        const p = graph.level.gain
        p.cancelScheduledValues(now)
        p.setValueAtTime(p.value, now)
        p.setTargetAtTime(target, now, tc)
        applied = target
      }
      const cut = i.storm ? STORM_CUTOFF : RAIN_CUTOFF
      if (cut !== appliedCut) {
        graph.filter.frequency.setTargetAtTime(cut, now, 1.0)
        appliedCut = cut
      }
    } catch {
      /* stay silent */
    }
  }

  const onVisibility = (): void => evaluate(last)
  const offUnlock = onAudioUnlock(() => evaluate(last))
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility)
  }

  return {
    frame(dt, i) {
      if (disposed) return
      last = i
      // the net under the idle build, for a tab that never gets an idle
      // slot: a tiny slice a frame, and only while frames are healthy —
      // it must never be the reason a frame is late
      if (buildPending() && dt < 0.022) {
        const ac = buildContext()
        if (ac) {
          try {
            stepRainBuild(ac, SLICE_MS)
          } catch {
            /* the idle pump will not get any further either */
          }
        }
      }
      acc += dt
      // while the rain is waiting to come in, look every frame rather
      // than ten times a second: the loops are already made, so the
      // first gesture is the last thing standing between it and sound
      const eager = !graph && audioUnlocked() && !i.muted && i.rain > ON_RAIN
      if (!eager && acc < POLL_S) return
      acc = 0
      evaluate(i)
    },
    poke(i) {
      evaluate(i)
    },
    dispose() {
      if (disposed) return
      disposed = true
      offUnlock()
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility)
      }
      letGo(0.4)
    },
  }
}

/* ---------- a window into it, for dev hooks and tests ---------- */

export function rainProbe(): {
  /** the newest graph's level gain right now */
  level: number
  /** sources still playing, fading ones included */
  sources: number
  ctx: string
  built: boolean
  building: boolean
  cutoff: number
  maxStepMs: number
  buildMs: number
  steps: number
  /** the sample rate the loops were rendered at */
  rate: number
  /** performance.now() when the loops were finished, -1 if they are not */
  readyAt: number
} {
  let newest: RainGraph | null = null
  let sources = 0
  for (const g of graphs) {
    newest = g
    sources += g.running()
  }
  return {
    level: newest ? newest.level.gain.value : 0,
    sources,
    ctx: newest ? newest.ctx.state : 'none',
    built: cache !== null,
    building: job !== null,
    cutoff: newest ? newest.filter.frequency.value : 0,
    maxStepMs: telemetry.maxStepMs,
    buildMs: telemetry.totalMs,
    steps: telemetry.steps,
    rate: cache ? cache.rate : BUILD_RATE,
    readyAt: telemetry.readyAt,
  }
}
