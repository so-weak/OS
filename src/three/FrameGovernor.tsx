import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useFrame, useStore, useThree } from '@react-three/fiber'
import { device } from '../device'

/* =====================================================================
   Frame governor — idle and hidden-tab frame-rate governance.

   The canvas runs in R3F's 'demand' frameloop (the `frameloop` prop on
   <Canvas> in Scene.tsx — see below for why it has to be the prop and
   not a call from here). Nothing renders unless something invalidates,
   and this component is what invalidates:

     - active (an input inside the last ~8s, page load counts as one):
       the full display rate, indistinguishable from 'always' mode.
     - idle (~8s with no pointer/key/wheel/touch/scroll): ~30 Hz
       instead. Every useFrame in the room (dust, steam, the neon
       flicker, rain, the wall clock) runs at half rate, which reads as
       identical motion for anything this slow — nothing in the room
       animates fast enough for 30 vs 60 Hz to be visible.
     - document.visibilityState === 'hidden': stop invalidating
       entirely. Nothing renders; a backgrounded tab costs zero frames.

   WHY THE MODE IS A PROP. fiber's configure() runs on EVERY render of
   <Canvas> (a layout effect with no dependency array), which is every
   render of App — a view change, a paper lifted, the shelf opening —
   and it re-applies the `frameloop` prop: `if (state.frameloop !==
   frameloop) state.setFrameloop(frameloop)`. With the prop left at its
   default the store was put back to 'always' at the first App render
   after mount (measured: the desk idled at 60 Hz, not 30 — the
   governance below simply never took effect), and on `lite`, where this
   file used to re-assert 'demand' afterwards, the pair ping-ponged:
   'always', 'demand', twice per App render, and setFrameloop() zeroes
   clock.elapsedTime every time it runs. A good chunk of the room reads
   state.clock.elapsedTime directly for oscillation phase (dust, sway,
   the moth, the neon, the desk lamp's flex...), so a phone's whole room
   snapped back to phase zero on every window drag (measured: 22.76 s of
   elapsed time, then 0.13 s, across one store write). Setting the prop
   to 'demand' makes configure's own test false forever: the mode is set
   once, at canvas creation, and the clock is never zeroed again.

   WHY THE PUMP IS TWO PARTS. invalidate() from a plain rAF cannot hold
   the display rate on its own, and this is worth spelling out because
   it looks like it should. fiber's loop stops itself the moment a
   rendered frame leaves internal.frames at 0, and invalidate() from
   outside a useFrame sets frames to exactly 1 — so the loop renders,
   stops, and has to be restarted by the next tick's invalidate(), which
   schedules it for the frame after that. One frame in two is lost:
   measured 30 fps on a 60 Hz panel with this file invalidating on every
   single tick. So the active rate is held by the useFrame below
   instead. invalidate() called from INSIDE a useFrame is fiber's
   "give me another frame" path and sets frames to 2, which survives the
   decrement at the end of update(), so the loop keeps running of its
   own accord at the display's rate. The rAF tick then owns exactly two
   jobs: the gated cadences (idle, lite), and restarting a loop that has
   been allowed to stop — and it hands the lead straight back the moment
   the panel is already slower than the cadence it would be gating to,
   because gating on top of that halves it a second time (see `paced`).

   The one real risk of demand mode is a stale delta: three's Clock
   keeps real wall time whether or not a frame renders, so a tab
   backgrounded for minutes hands the next real frame a multi-minute
   delta. WorldFrame and the wall clock already clamp their own dt at
   0.05s, but this scene has six zones' worth of useFrame callbacks and
   not all of them are guaranteed to, so on the visibilitychange back to
   visible this reaches into clock.oldTime directly and sets it to now —
   NOT clock.getDelta(), which looks like a discard but actually still
   folds the whole gap into clock.elapsedTime as a side effect (three's
   Clock.getDelta() advances elapsedTime by the diff it computes whether
   or not the caller reads the return value). Overwriting oldTime alone
   makes the next real getDelta() compute a normal near-zero gap, and
   elapsedTime simply stops advancing for the time the tab was away —
   springs and the clock's sub-stepper read that as "paused while gone",
   not "jump to catch up".

   LITE (phones). The active rate is capped too. A phone asked to draw
   this room at 60 (or 120) Hz spends a minute looking fast and then
   thermally throttles for the rest of the visit — the GPU clocks drop,
   the frame rate collapses BELOW the cap, and the picture gets worse
   than if it had never tried. A hard 30 Hz ceiling keeps the die cool,
   the rate steady and the battery alive, and nothing in this room moves
   fast enough to read as stutter at 30. A capped tier takes its frames
   from the gated tick, one restart apiece — it only lets the loop run
   free when the panel is already at or below the cap, which is the one
   case where gating would cost frames instead of saving them.
   ===================================================================== */

const IDLE_MS = 8000

/** lite: the active frame ceiling. Exported because AdaptiveQuality's
    meter has to judge the measured rate against this cap instead of the
    panel's own rate — otherwise it reads our own deliberate 30 Hz as a
    dying GPU and walks the canvas down to the floor for nothing. */
export const LITE_ACTIVE_HZ = 30
/** lite: the idle rate, below the desk's 30 — a parked phone should be
    spending nothing at all on a picture nobody is touching */
const LITE_IDLE_HZ = 20
/** rAF timestamps land on the display's own grid (16.7 ms at 60 Hz,
    8.3 at 120), so a budget of exactly 1000/30 is missed by a rounding
    hair at the 33.3 ms tick and waits for the next one — 20 Hz on a
    60 Hz panel (measured 22.7 Hz for the desk's idle budget before this
    slack was applied to it as well). A tick of slack makes the gate
    open on the tick we actually want, on every panel. */
const GRID_SLACK_MS = 4
const IDLE_FRAME_MS = 1000 / 30 - GRID_SLACK_MS
const LITE_ACTIVE_MS = 1000 / LITE_ACTIVE_HZ - GRID_SLACK_MS
const LITE_IDLE_MS = 1000 / LITE_IDLE_HZ - GRID_SLACK_MS

type Listener = () => void
const listeners = new Set<Listener>()
let idleFlag = false
function setIdleFlag(v: boolean) {
  if (idleFlag === v) return
  idleFlag = v
  listeners.forEach((l) => l())
}
function subscribe(l: Listener) {
  listeners.add(l)
  return () => listeners.delete(l)
}
function getSnapshot() {
  return idleFlag
}
function getServerSnapshot() {
  return false
}
/** True once the governor has dropped to the idle frame rate. AdaptiveQuality
    reads this so its PerformanceMonitor doesn't mistake a deliberately
    governed 30Hz idle rate for a slow machine and pump the DPR down.
    eslint-disable-next-line: this file's second export is a hook, not a
    component — sharing it needs a second file, and this zone (global
    settings/frame budget) is scoped to exactly one new file. */
// eslint-disable-next-line react-refresh/only-export-components
export function useFrameGoverned(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

export default function FrameGovernor() {
  const invalidate = useThree((s) => s.invalidate)
  const setFrameloop = useThree((s) => s.setFrameloop)
  const clock = useThree((s) => s.clock)
  const store = useStore()

  /** true while the loop is allowed to free-run at the display's rate */
  const hot = useRef(false)

  /* The active pump — see "WHY THE PUMP IS TWO PARTS" above. Priority 0
     on purpose: a positive priority would tell fiber that someone else
     owns the render and stop the room being drawn at all (that is
     exactly how SceneReady holds the first frame). */
  useFrame(() => {
    if (hot.current) invalidate()
  })

  useEffect(() => {
    // the prop already put the store in demand mode at canvas creation;
    // calling it again would only zero the oscillation clock once more
    if (store.getState().frameloop !== 'demand') setFrameloop('demand')

    let raf = 0
    let hiddenNow = document.visibilityState === 'hidden'
    let lastInput = performance.now()
    let lastTick = performance.now()
    let lastIdleFrame = 0
    let lastLiteFrame = 0

    /* One governed frame, `budget` ms apart — or the loop let off its
       lead when the panel is ALREADY slower than the budget. Gating on
       top of a tick rate at or below the rate we are governing to costs
       one frame in two, because a loop that stops takes a frame to
       restart: a 30 Hz panel would idle at 15, and a machine whose
       frames cost 40 ms would be halved again for being slow. Returns
       the new `last`. */
    const paced = (t: number, gap: number, budget: number, last: number): number => {
      if (gap >= budget) {
        hot.current = true
        invalidate()
        return t
      }
      hot.current = false
      if (t - last < budget) return last
      invalidate()
      return t
    }

    const wake = () => {
      lastInput = performance.now()
      setIdleFlag(false)
    }
    const opts: AddEventListenerOptions = { passive: true }
    window.addEventListener('pointermove', wake, opts)
    window.addEventListener('pointerdown', wake, opts)
    window.addEventListener('keydown', wake, opts)
    window.addEventListener('wheel', wake, opts)
    window.addEventListener('touchstart', wake, opts)
    window.addEventListener('scroll', wake, opts)

    const onVisibility = () => {
      hiddenNow = document.visibilityState === 'hidden'
      if (!hiddenNow) {
        clock.oldTime = performance.now() // swallow the stale gap, see header
        lastInput = performance.now()
        setIdleFlag(false)
        invalidate()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    const tick = (t: number) => {
      raf = requestAnimationFrame(tick)
      if (hiddenNow) {
        hot.current = false // fully paused: nothing invalidates, nothing renders
        return
      }
      /* Backstop only. The prop holds demand mode now, so this can only
         fire if someone drops it from <Canvas> — in which case one
         frame per App render is governed late rather than not at all. */
      if (store.getState().frameloop !== 'demand') setFrameloop('demand')
      const gap = t - lastTick
      lastTick = t
      // read per tick, not per mount: the tier can flip under us when a
      // phone is rotated or a desk window is dragged narrow
      const lite = device().lite
      if (t - lastInput < IDLE_MS) {
        setIdleFlag(false)
        if (!lite) {
          // the desk: full display rate. This invalidate() is the
          // restart after a gated stretch; the useFrame above is what
          // keeps the loop running once it is going.
          hot.current = true
          invalidate()
          return
        }
        lastLiteFrame = paced(t, gap, LITE_ACTIVE_MS, lastLiteFrame)
        return
      }
      setIdleFlag(true)
      lastIdleFrame = paced(t, gap, lite ? LITE_IDLE_MS : IDLE_FRAME_MS, lastIdleFrame)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      hot.current = false
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('pointerdown', wake)
      window.removeEventListener('keydown', wake)
      window.removeEventListener('wheel', wake)
      window.removeEventListener('touchstart', wake)
      window.removeEventListener('scroll', wake)
      document.removeEventListener('visibilitychange', onVisibility)
      setIdleFlag(false)
      // hygiene for HMR/unmount only — the governor lives for the app's
      // life, and a canvas left in demand mode with nobody invalidating
      // is a frozen room. configure() puts the prop's 'demand' back on
      // the next render of <Canvas>.
      setFrameloop('always')
    }
  }, [invalidate, setFrameloop, clock, store])

  return null
}
