import { useSystem } from './store'
import { afterReveal } from '../loadProgress'

/* =====================================================================
   SoubhikOS sound chip — every SFX is synthesized with WebAudio.
   No audio files. A single AudioContext lives at module level (so it is
   StrictMode-safe), suspended until the visitor's first gesture. Every
   play* function:
     - is a silent no-op while useSystem.muted is true
     - never throws, even if audio is unavailable or suspended
   ===================================================================== */

let ctx: AudioContext | null = null
let master: GainNode | null = null
let unlockBound = false
/** a gesture has happened: ambience layers (rainSound.ts) may start */
let unlocked = false
const unlockListeners = new Set<() => void>()

function createContext(): void {
  if (ctx || typeof window === 'undefined') return
  try {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = 0.4
    master.connect(ctx.destination)
  } catch {
    ctx = null
    master = null
  }
}

/* ---------------------------------------------------------------------
   Warming — why the context is built before anyone asks for a sound.

   Measured in Chromium at 1440x900 (see the click profile): the FIRST
   `new AudioContext()` in a renderer is a ~126 ms SYNCHRONOUS block —
   it stands up the whole audio infrastructure. Every later one costs
   ~0.3 ms, and `resume()` on a context that already exists costs
   ~0.1 ms. Autoplay policy does not change that arithmetic: a context
   constructed before a gesture is perfectly legal, it simply starts in
   state 'suspended', and only the gesture may resume it. So the 126 ms
   is paid once, wherever we choose to put it — and putting it in the
   `pointerdown` handler meant the visitor paid it as part of clicking
   the monitor, on top of the zoom.

   So: build it on the first sign the visitor is THERE (a mouse move, a
   wheel) rather than on the first thing they commit to, and hand the
   build to an idle callback so it never sits inside an input handler.
   A mouse always moves before it clicks — you cannot reach the CRT
   without crossing the room first — so by the time the monitor is
   clicked the block is long since paid. A visitor whose pointer never
   moves gets it SETTLE_MS after the reveal instead, by which time the
   opening dolly (CameraRig, lambda 1.8) has come to rest and a block
   on a still room costs nothing anyone can see.

   Four guards keep it honest:
     - held until `afterReveal` (loadProgress): it can never compete
       with the first load or delay the veil
     - skipped entirely while muted — nobody's audio device gets woken
       on behalf of a visitor who has asked for silence
     - preferentially run in an idle slot; the short timeout is there
       for the slow machine that never offers one, which is exactly the
       machine where paying this on the click hurts most
     - purely an optimisation: if nothing warms it, `unlock`/`out()`
       still build it on demand exactly as before.
   --------------------------------------------------------------------- */

/** the opening dolly has settled by here (ms after the reveal) */
const SETTLE_MS = 2500

type IdleCb = () => void
function idle(fn: IdleCb): void {
  const w = window as unknown as {
    requestIdleCallback?: (cb: IdleCb, o?: { timeout: number }) => void
  }
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 600 })
  else window.setTimeout(fn, 60)
}

/** Presence, not commitment: events that mean "a person is here" and
    that fire in a task of their own, BEFORE the click. `pointerdown`
    and `keydown` are deliberately absent — those are the gestures
    `unlock` already handles, and on a touch screen they arrive in the
    same task as the tap, so there would be nothing left to win. */
const PRESENCE = ['pointermove', 'pointerover', 'wheel'] as const

let warmArmed = false

function armWarm(): void {
  if (warmArmed || typeof window === 'undefined') return
  warmArmed = true
  let timer = 0
  const go = (): void => {
    for (const e of PRESENCE) window.removeEventListener(e, go)
    window.clearTimeout(timer)
    if (ctx) return
    try {
      if (useSystem.getState().muted) return
    } catch {
      return
    }
    idle(createContext)
  }
  afterReveal(() => {
    if (ctx) return
    for (const e of PRESENCE) window.addEventListener(e, go, { passive: true })
    timer = window.setTimeout(go, SETTLE_MS)
  })
}

/** Bind once at module load — browsers only allow audio after a gesture. */
function bindUnlock(): void {
  if (unlockBound || typeof window === 'undefined') return
  unlockBound = true
  const unlock = (): void => {
    createContext()
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume().catch(() => undefined)
    }
    unlocked = true
    for (const fn of unlockListeners) {
      try {
        fn()
      } catch {
        /* a listener must never break the unlock */
      }
    }
  }
  window.addEventListener('pointerdown', unlock, { passive: true })
  window.addEventListener('keydown', unlock, { passive: true })
}
bindUnlock()
armWarm()

/** Returns the live output bus, or null when muted / unavailable. */
function out(): { ac: AudioContext; bus: GainNode } | null {
  try {
    if (useSystem.getState().muted) return null
    createContext()
    if (!ctx || !master) return null
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
    return { ac: ctx, bus: master }
  } catch {
    return null
  }
}

/** The same bus, named for ambience layers that live in their own file
    (rainSound.ts): the one AudioContext, the one master gain. */
export { out as audioBus }
/** Has the visitor made a gesture yet? (browsers gate audio until then) */
export function audioUnlocked(): boolean {
  return unlocked
}
/** Called on every pointerdown/keydown after the context is created.
    Returns the unsubscribe. */
export function onAudioUnlock(fn: () => void): () => void {
  unlockListeners.add(fn)
  return () => {
    unlockListeners.delete(fn)
  }
}

/* ---------- tiny synth helpers ---------- */

const lastAt = new Map<string, number>()

/** true = drop this call (double-fired effect / key repeat spam guard). */
function throttled(key: string, ms: number): boolean {
  const now = performance.now()
  const prev = lastAt.get(key) ?? -Infinity
  if (now - prev < ms) return true
  lastAt.set(key, now)
  return false
}

interface ToneOpts {
  type: OscillatorType
  freq: number
  t0: number
  dur: number
  peak: number
  /** cents */
  detune?: number
  /** exponential glide target frequency */
  glideTo?: number
  attack?: number
}

function tone(ac: AudioContext, dest: AudioNode, o: ToneOpts): void {
  const osc = ac.createOscillator()
  osc.type = o.type
  osc.frequency.setValueAtTime(o.freq, o.t0)
  if (o.glideTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(o.glideTo, o.t0 + o.dur)
  }
  if (o.detune !== undefined) osc.detune.setValueAtTime(o.detune, o.t0)
  const g = ac.createGain()
  const attack = o.attack ?? 0.015
  g.gain.setValueAtTime(0.0001, o.t0)
  g.gain.exponentialRampToValueAtTime(o.peak, o.t0 + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, o.t0 + o.dur)
  osc.connect(g)
  g.connect(dest)
  osc.start(o.t0)
  osc.stop(o.t0 + o.dur + 0.06)
}

let noiseBuf: AudioBuffer | null = null

function noise(ac: AudioContext): AudioBuffer {
  if (!noiseBuf || noiseBuf.sampleRate !== ac.sampleRate) {
    noiseBuf = ac.createBuffer(1, Math.ceil(ac.sampleRate * 0.08), ac.sampleRate)
    const d = noiseBuf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  }
  return noiseBuf
}

/* =====================================================================
   Public SFX
   ===================================================================== */

/** Short filtered mechanical tick — buttons, menus, icons. */
export function playClick(): void {
  try {
    if (throttled('click', 35)) return
    const o = out()
    if (!o) return
    const { ac, bus } = o
    const t = ac.currentTime

    // band-passed noise burst (the "plastic" of the click)
    const src = ac.createBufferSource()
    src.buffer = noise(ac)
    const bp = ac.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 2600
    bp.Q.value = 2.4
    const g = ac.createGain()
    g.gain.setValueAtTime(0.3, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045)
    src.connect(bp)
    bp.connect(g)
    g.connect(bus)
    src.start(t)
    src.stop(t + 0.05)

    // tiny falling square blip underneath (the "switch")
    tone(ac, bus, {
      type: 'square',
      freq: 1350,
      glideTo: 420,
      t0: t,
      dur: 0.035,
      peak: 0.05,
      attack: 0.003,
    })
  } catch {
    /* stay silent */
  }
}

/** Square-wave POST beep — straight off a 90s motherboard. */
export function playBeep(): void {
  try {
    if (throttled('beep', 60)) return
    const o = out()
    if (!o) return
    const { ac, bus } = o
    const t = ac.currentTime
    const lp = ac.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 3600
    lp.connect(bus)
    tone(ac, lp, {
      type: 'square',
      freq: 880,
      t0: t,
      dur: 0.13,
      peak: 0.1,
      attack: 0.005,
    })
  } catch {
    /* stay silent */
  }
}

/** Warm rising arpeggio with slight detune — desktop is about to appear. */
export function playStartup(): void {
  try {
    if (throttled('startup', 600)) return
    const o = out()
    if (!o) return
    const { ac, bus } = o
    const t = ac.currentTime + 0.03

    const lp = ac.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(900, t)
    lp.frequency.exponentialRampToValueAtTime(3600, t + 0.9)
    lp.Q.value = 0.7
    lp.connect(bus)

    // G3 - D4 - G4 - B4: a warm major bloom
    const notes = [196.0, 293.66, 392.0, 493.88]
    notes.forEach((freq, i) => {
      const t0 = t + i * 0.17
      const dur = 0.95 - i * 0.06
      tone(ac, lp, { type: 'triangle', freq, t0, dur, peak: 0.13, detune: -6 })
      tone(ac, lp, { type: 'triangle', freq, t0, dur, peak: 0.13, detune: 6 })
      tone(ac, lp, { type: 'sine', freq: freq / 2, t0, dur: dur * 0.95, peak: 0.08 })
    })
    // faint sparkle on top as the chord settles
    tone(ac, lp, { type: 'sine', freq: 987.77, t0: t + 0.68, dur: 0.6, peak: 0.04, attack: 0.05 })
  } catch {
    /* stay silent */
  }
}

/** Descending resolve — the machine says goodnight. */
export function playShutdown(): void {
  try {
    if (throttled('shutdown', 600)) return
    const o = out()
    if (!o) return
    const { ac, bus } = o
    const t = ac.currentTime + 0.03

    const lp = ac.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(3000, t)
    lp.frequency.exponentialRampToValueAtTime(600, t + 1.4)
    lp.Q.value = 0.7
    lp.connect(bus)

    // B4 - G4 - D4 - G3: the startup chord, laid to rest
    const notes = [493.88, 392.0, 293.66, 196.0]
    notes.forEach((freq, i) => {
      const t0 = t + i * 0.21
      const dur = i < 3 ? 0.55 : 1.1
      tone(ac, lp, { type: 'triangle', freq, t0, dur, peak: 0.12, detune: -5 })
      tone(ac, lp, { type: 'triangle', freq, t0, dur, peak: 0.12, detune: 5 })
    })
    // low sub swell under the final note
    tone(ac, lp, { type: 'sine', freq: 98.0, t0: t + 0.63, dur: 1.05, peak: 0.06, attack: 0.08 })
  } catch {
    /* stay silent */
  }
}

/** Distant thunder, `delayMs` after the flash — the storm is a few km
    off. Two seconds of low noise through a lowpass that sinks from
    180 Hz to 60 Hz as the rumble rolls away. Peak gain 0.12 (agreed
    cap). Silent until the first gesture: a suspended context would
    queue every rumble and dump them all when it finally resumes. */
export function playThunder(delayMs = 1500): void {
  try {
    if (throttled('thunder', 800)) return
    const o = out()
    if (!o) return
    const { ac, bus } = o
    if (ac.state !== 'running') return
    const dur = 2
    const t = ac.currentTime + Math.max(0, delayMs) / 1000

    // brown-ish noise: a leaky integrator over white, so it rumbles
    const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate)
    const d = buf.getChannelData(0)
    let last = 0
    for (let i = 0; i < d.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
      d[i] = last * 3.5
    }
    const src = ac.createBufferSource()
    src.buffer = buf

    const lp = ac.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(180, t)
    lp.frequency.exponentialRampToValueAtTime(60, t + dur)
    lp.Q.value = 0.9

    // the crack, a second roll, then the long fade
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.12)
    g.gain.exponentialRampToValueAtTime(0.045, t + 0.55)
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.8)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)

    src.connect(lp)
    lp.connect(g)
    g.connect(bus)
    src.start(t)
    src.stop(t + dur + 0.05)
  } catch {
    /* stay silent */
  }
}
