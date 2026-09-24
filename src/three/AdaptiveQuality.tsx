import { useEffect, useRef, useState } from 'react'
import { useFrame, useStore, useThree } from '@react-three/fiber'
import type { WebGLRenderer } from 'three'
import { useDevice } from '../device'
import { useLoad } from '../loadProgress'
import { useSystem } from '../os/store'
import { LITE_ACTIVE_HZ, useFrameGoverned } from './FrameGovernor'
import { useLibrary } from './libraryState'
import { usePins } from './pinState'

/* =====================================================================
   Adaptive resolution.

   The room is fill-rate bound (every lit pixel pays for several lights),
   so the canvas resolution is the one dial that scales the cost of the
   whole picture — and it is also what decides whether the lettering in
   the room (nameplate, drawer cards, posters, spines, the clock plate)
   reads sharp. A canvas below the display's own ratio is stretched by the
   browser: at the old 1.25 cap a Retina screen blew every label up 1.6x
   and blurred it. So:

   - The ceiling is the display's own ratio, up to 2 (TOP).
   - Where the GPU is known to be fast (Apple silicon, discrete NVIDIA /
     AMD) the canvas STARTS at the ceiling; anywhere else it starts at
     1.25 and has to earn its way up.
   - A light meter then measures the room view (8 x 250 ms windows,
     judged on the median; ~6 s of sustained sag before it steps down,
     so a passing hitch never costs sharpness). When the rate
     sags it steps down in ONE move
     to the rung the measured fps says the GPU can carry (fill cost ~
     ratio²), not one 0.25 rung per 2 s — a slow machine never sits
     through seconds of stutter at 2x. When it has headroom it climbs one
     rung at a time, back to the ceiling.
   - Every step down is a probe: if the next verdict shows it bought
     (almost) no frames, the time is going somewhere else (main thread,
     a GPU shared with other tabs) and lower resolution would only have
     cost sharpness — the rung goes back up and becomes a floor. (The old
     monitor walked such machines all the way to 0.75x: a blurry room
     that was no faster.)
   - Hysteresis: separate decline/incline bounds, and after a few real
     reversals (down, up, down...) it stops climbing and keeps the lower
     rung, so it never visibly pumps.
   - Lettering views (the library shelf, the cork board up close) get two
     rungs more than the room, up to the ceiling: that is where the text
     is, and the camera is parked while you read.
   - While the CRT fills the screen the 3D behind the glass barely
     matters (the OS is DOM and unaffected by the canvas resolution), so
     the canvas is capped at 1.0 there and restored when the camera pulls
     back.

   The monitor only starts once the room has been revealed (SceneReady's
   warm-up frames are not drawn and must not count as a slow machine).

   LITE (phones) — the ceiling moves, the ladder does not. A phone
   reports devicePixelRatio 3 and carries a fraction of a laptop's fill
   rate, so honouring the display's own ratio would ask a mobile GPU for
   ~9x the pixels of a 1x canvas for a room that already pays for ten
   lights per fragment. On lite the ceiling drops to 1.25 and the ladder
   starts at 1.0 and has to earn the rest — the same meter, the same
   hysteresis, a lower roof. This is the highest-leverage dial on a
   phone by a wide margin: everything else in the frame scales with the
   pixel count this number sets.
   ===================================================================== */

/** the ladder of pixel ratios */
const STEPS = [0.75, 1, 1.25, 1.5, 1.75, 2]
/** never above this, whatever the display */
const MAX_DPR = 2
/** lite: never above this, whatever the phone claims its ratio is */
const LITE_MAX_DPR = 1.25
/** where an unknown / integrated GPU starts */
const SLOW_START_DPR = 1.25
/** lite: where the ladder starts — a phone climbs to its ceiling, it is
    never handed it (an iPhone reports "Apple GPU" and would otherwise
    pass the fast-GPU probe and start at the top) */
const LITE_START_DPR = 1
/** cap while the OS is on screen */
const SCREEN_DPR = 1
/** extra rungs for the lettering views (library, cork board) */
const TEXT_BOOST = 2
/** on a high-density display the room never goes below this: 1.0 is
    already the pixel count of a plain 1x laptop, and 0.75 on a Retina
    panel stretches every label 2.7x (the fill model can overshoot to it
    when a busy machine sags for a few seconds) */
const HIDPI_FLOOR_DPR = 1
/** frames after the reveal before the monitor listens (or SETTLE_MS,
    whichever comes first — a GPU that can't carry the start rung must
    not sit through 90 slow frames before anyone looks) */
const SETTLE_FRAMES = 90
const SETTLE_MS = 1200
/** ...or after this many frames whatever the load state says */
const SETTLE_FALLBACK = 600
/** direction reversals before the rung is pinned (no pumping) */
const MAX_REVERSALS = 3
/** the meter: this many windows of this length per verdict (~2 s) */
const WINDOW_MS = 250
const WINDOWS = 8
/** verdicts in a row before the rung moves: ~6 s of sag to step down
    (a lazy build, a busy tab next door or a GC must not cost the room
    its sharpness), ~4 s of headroom to climb back */
const SUSTAIN_DOWN = 3
const SUSTAIN_UP = 2
/** lite: relief sooner (~4 s). On a desk a sag is usually another tab or
    a lazy build and costing the room its sharpness for it would be
    wrong; on a phone a sustained sag is simply the truth about the GPU. */
const LITE_SUSTAIN_DOWN = 2

function stepFor(dpr: number): number {
  let best = 0
  for (let i = 0; i < STEPS.length; i++) if (STEPS[i] <= dpr + 1e-6) best = i
  return best
}

/** The unmasked renderer string says whether 2x is affordable. */
function isFastGpu(gl: WebGLRenderer): boolean {
  try {
    const ctx = gl.getContext()
    let name = String(ctx.getParameter(ctx.RENDERER) ?? '')
    // Chrome/Safari mask RENDERER as "WebKit WebGL" and keep the real
    // name behind the debug extension. Firefox reports it (sanitised)
    // directly and warns when the extension is touched, so only ask
    // when masked.
    if (/^webkit webgl$/i.test(name.trim())) {
      const ext = ctx.getExtension('WEBGL_debug_renderer_info')
      if (ext) name = String(ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? name)
    }
    if (/swiftshader|llvmpipe|software|basic render/i.test(name)) return false
    return /apple (m\d|gpu)|nvidia|geforce|rtx|quadro|radeon (rx|pro)/i.test(name)
  } catch {
    return false
  }
}

/** The canvas ratio for a view, given the room's chosen rung. */
function dprFor(view: string, textView: boolean, rung: number, top: number): number {
  if (view === 'screen') return Math.min(STEPS[rung], SCREEN_DPR)
  if (textView) return STEPS[Math.min(top, rung + TEXT_BOOST)]
  return STEPS[rung]
}

export default function AdaptiveQuality() {
  const gl = useThree((s) => s.gl)
  const view = useSystem((s) => s.view)
  const libraryOpen = useLibrary((s) => s.open)
  const boardOpen = usePins((s) => s.open)
  const revealed = useLoad((s) => s.revealed)
  /* the one reactive read of the tier: a flip (a phone rotated, a desk
     window dragged narrow) re-renders this component, which moves the
     ceiling and re-seats the ladder below. Constant on the desk. */
  const lite = useDevice((s) => s.lite)
  const [settled, setSettled] = useState(false)
  const frames = useRef(0)
  const sinceReveal = useRef(0)
  const revealedAt = useRef(0)
  // FrameGovernor drops the render loop to ~30Hz after ~8s idle; without
  // this, that governed rate reads to the meter as a slow
  // machine and it pumps the DPR down, then back up the moment input
  // resumes and the loop returns to full rate — visible pumping from a
  // deliberate idle optimisation, not an actual perf problem. Idle just
  // pauses the meter; the chosen rung is kept as-is until active again.
  const governed = useFrameGoverned()

  /** the highest rung this display can use */
  const top = stepFor(
    Math.min(lite ? LITE_MAX_DPR : MAX_DPR, Math.max(1, window.devicePixelRatio || 1)),
  )
  /** the GPU verdict is asked once — it cannot change under us */
  const [fast] = useState(() => isFastGpu(gl))
  const startRung =
    fast && !lite ? top : Math.min(top, stepFor(lite ? LITE_START_DPR : SLOW_START_DPR))
  /** the rung the monitor has chosen for the room view */
  const rung = useRef(startRung)
  const lastMove = useRef<'up' | 'down' | null>(null)
  const reversals = useRef(0)
  /** climbing stops once the rung has been pinned */
  const pinned = useRef(false)

  const textView = libraryOpen || boardOpen

  /* The ratio this monitor wants, held against the Canvas's own `dpr`
     prop. R3F re-applies that prop ([1, 2]) every time <Canvas> renders,
     and it renders whenever App does (view, power, paper, shelf changes):
     without this, the OS view's 1.0 cap and every step down lasted only
     until the next such render, which put the canvas straight back at
     the display ratio.

     It is held at the DOOR, not cleaned up afterwards. Losing the
     argument and winning the rematch still costs two full drawing-buffer
     reallocations, and on a Retina panel reading the OS those are
     2880x1800 each: ~140 ms of frozen main thread, landing on the render
     that flips power to 'desktop' — i.e. the moment the OS appears,
     right after the click that is the whole point of the site. So the
     wanted ratio is imposed on `setDpr` itself: the prop's value never
     reaches the store, R3F's own "did the dpr change?" test sees no
     change, and no resize happens at all. The subscription below stays
     as a backstop for anything that writes viewport.dpr directly. */
  const store = useStore()
  const want = useRef(0)
  const place = (dpr: number) => {
    want.current = dpr
    store.getState().setDpr(dpr)
  }
  useEffect(() => {
    const raw = store.getState().setDpr
    store.setState({ setDpr: (dpr) => raw(want.current > 0 ? want.current : dpr) })
    const off = store.subscribe((s) => {
      const w = want.current
      if (w > 0 && Math.abs(s.viewport.dpr - w) > 1e-6) s.setDpr(w)
    })
    return () => {
      off()
      store.setState({ setDpr: raw })
    }
  }, [store])

  const apply = () => place(dprFor(view, textView, rung.current, top))

  // wait for the reveal to settle, without re-rendering every frame
  useFrame(() => {
    if (settled) return
    frames.current++
    if (useLoad.getState().revealed) {
      const now = performance.now()
      if (sinceReveal.current++ === 0) revealedAt.current = now
      if (sinceReveal.current >= SETTLE_FRAMES || now - revealedAt.current >= SETTLE_MS) {
        setSettled(true)
        return
      }
    }
    if (frames.current >= SETTLE_FALLBACK) setSettled(true)
  })

  /** the tier the current ladder was climbed for */
  const laddersTier = useRef(lite)

  // before the first drawn frame, and on every view change (and on a
  // tier flip, which moves `top` under the rung — clamped here, re-seated
  // properly by the frame loop below)
  useEffect(() => {
    want.current = dprFor(view, textView, Math.min(rung.current, top), top)
    store.getState().setDpr(want.current)
  }, [view, textView, top, store])

  const move = (dir: 'up' | 'down', to: number) => {
    if (to === rung.current) return
    if (lastMove.current && lastMove.current !== dir && ++reversals.current >= MAX_REVERSALS) {
      // pumping between rungs: keep the lower one and stop climbing
      pinned.current = true
      to = Math.min(to, rung.current)
    }
    rung.current = to
    lastMove.current = dir
    apply()
  }

  // only the plain room view is measured: zooming, the OS and the
  // lettering views have their own cost and their own rule above
  const monitoring = settled && revealed && view === 'room' && !textView && !governed

  /* The meter: WINDOWS windows of WINDOW_MS, judged on their median. */
  const meter = useRef({ t0: 0, n: 0, samples: [] as number[], hz: 0 })
  /** the last step down, until the next verdict says whether it helped */
  const probe = useRef<{ from: number; fps: number } | null>(null)
  /** never below this: a drop that bought no frames proved the machine
      is not fill-bound, so lower resolution would only cost sharpness */
  const floor = useRef(top >= stepFor(1.5) ? stepFor(HIDPI_FLOOR_DPR) : 0)

  /** consecutive verdicts below / above the bounds */
  const streak = useRef({ bad: 0, good: 0 })

  const judge = (fps: number, hz: number) => {
    // 60 Hz: step down under 45 fps, up at (nearly) full rate;
    // 120 Hz panels: 80 / 110.
    // lite: the loop itself is capped at LITE_ACTIVE_HZ (FrameGovernor),
    // so the bounds follow the CAP, not the panel — a 120 Hz phone
    // holding its 30 Hz ceiling perfectly would otherwise be judged
    // against 110 fps and walked to the floor for a sag that is ours.
    const [down, up] = lite
      ? [LITE_ACTIVE_HZ * 0.8, LITE_ACTIVE_HZ * 0.95]
      : hz > 100
        ? [80, 110]
        : [45, 57]
    const st = streak.current
    const p = probe.current
    if (p) {
      probe.current = null
      if (fps < up && fps < p.fps * 1.15) {
        // the last drop bought (almost) nothing: the time goes elsewhere
        // (main thread, a GPU shared with other tabs). Put the
        // sharpness back and never trade it away again this visit.
        floor.current = p.from
        rung.current = p.from
        st.bad = st.good = 0
        apply()
        return
      }
    }
    // only a SUSTAINED sag or surplus moves the rung (a hitch from a
    // lazy build or another tab must not cost the room its sharpness)
    if (fps < down) {
      st.good = 0
      if (++st.bad < (lite ? LITE_SUSTAIN_DOWN : SUSTAIN_DOWN)) return
    } else if (fps >= up) {
      st.bad = 0
      if (++st.good < SUSTAIN_UP) return
    } else {
      st.bad = st.good = 0
      return
    }
    st.bad = st.good = 0
    if (fps < down) {
      if (rung.current <= floor.current) return
      // fill-bound: fps ~ 1 / ratio². Jump straight to the rung the
      // measured rate says will hold the upper bound.
      const fit = STEPS[rung.current] * Math.sqrt(Math.max(fps, 1) / up)
      const to = Math.max(floor.current, Math.min(rung.current - 1, stepFor(fit)))
      probe.current = { from: rung.current, fps }
      move('down', to)
    } else if (!pinned.current && rung.current < top) {
      move('up', rung.current + 1)
    }
  }

  useFrame(() => {
    /* A tier flip changed the ceiling under a ladder that was climbed
       for the other machine, so the ladder is re-seated at the new
       tier's start and the meter re-learns: a 0.75 rung a phone earned
       must not blur a window dragged back wide, and a 2.0 rung from the
       desk must not land on a phone. Unreachable on the desk — `lite` is
       constant there, so this never runs and every ref below keeps
       exactly the value the desk path gave it. */
    if (laddersTier.current !== lite) {
      laddersTier.current = lite
      rung.current = startRung
      floor.current = top >= stepFor(1.5) ? stepFor(HIDPI_FLOOR_DPR) : 0
      lastMove.current = null
      reversals.current = 0
      pinned.current = false
      probe.current = null
      streak.current.bad = streak.current.good = 0
      apply()
    }
    const m = meter.current
    if (!monitoring) {
      m.t0 = 0
      m.samples.length = 0
      return
    }
    const now = performance.now()
    if (!m.t0) {
      m.t0 = now
      m.n = 0
      return
    }
    m.n++
    if (now - m.t0 < WINDOW_MS) return
    const fps = (m.n * 1000) / (now - m.t0)
    m.hz = Math.max(m.hz, fps)
    m.samples.push(fps)
    m.t0 = now
    m.n = 0
    if (m.samples.length < WINDOWS) return
    const sorted = m.samples.splice(0).sort((a, b) => a - b)
    judge(sorted[sorted.length >> 1], m.hz)
  })

  return null
}
