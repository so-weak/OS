import { useEffect, useSyncExternalStore } from 'react'
import { useStore, useThree } from '@react-three/fiber'
import { device } from '../device'

/* =====================================================================
   Frame governor — idle and hidden-tab frame-rate governance.

   By default the canvas is R3F's 'always' frameloop: one full render
   every rAF tick, forever, whether or not the picture is changing. This
   component switches to demand mode ONCE at mount and then drives every
   frame itself via invalidate():

     - active (an input inside the last ~8s, page load counts as one):
       invalidate every rAF tick — full display rate, indistinguishable
       from 'always' mode.
     - idle (~8s with no pointer/key/wheel/touch/scroll): invalidate at
       ~30 Hz instead. Every useFrame in the room (dust, steam, the neon
       flicker, rain, the wall clock) runs at half rate, which reads as
       identical motion for anything this slow — nothing in the room
       animates fast enough for 30 vs 60 Hz to be visible.
     - document.visibilityState === 'hidden': stop invalidating
       entirely. Nothing renders; a backgrounded tab costs zero frames.

   frameloop is set to 'demand' exactly once and never flipped back to
   'always': three's setFrameloop() resets clock.elapsedTime to 0 every
   time it runs (see @react-three/fiber's store.ts), and a good chunk of
   the room reads state.clock.elapsedTime directly for oscillation phase
   (dust, sway, the moth, the neon, the desk lamp's flex...). Toggling
   modes on every idle/active edge would zero that clock on every edge
   and visibly hitch those props. Governing purely through invalidate()
   cadence — with the mode itself set once — avoids that entirely.

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
   fast enough to read as stutter at 30. The desk is untouched: on
   `lite: false` this file invalidates on every tick exactly as before.
   ===================================================================== */

const IDLE_MS = 8000
const IDLE_FRAME_MS = 1000 / 30

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
    60 Hz panel. A tick of slack makes the gate open on the tick we
    actually want, on every panel. */
const GRID_SLACK_MS = 4
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

  /* Hold demand mode against the Canvas's own `frameloop` prop, exactly
     as AdaptiveQuality holds its pixel ratio against `dpr`: fiber's
     configure() re-applies that prop (default 'always') on every render
     of <Canvas>, which is every render of App — a view change, a paper
     lifted, the shelf opening — and a governor that has been quietly
     put back into 'always' mode caps nothing at all.

     LITE ONLY, deliberately. On the desk the mode is set once at mount
     and left to whatever fiber does with it afterwards, which is the
     behaviour the desk has today; re-asserting it there would start
     governing frames on a machine whose picture is the contract. */
  useEffect(
    () =>
      store.subscribe((s) => {
        if (device().lite && s.frameloop !== 'demand') s.setFrameloop('demand')
      }),
    [store],
  )

  useEffect(() => {
    setFrameloop('demand')

    let raf = 0
    let hiddenNow = document.visibilityState === 'hidden'
    let lastInput = performance.now()
    let lastIdleFrame = 0
    let lastLiteFrame = 0

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
      if (hiddenNow) return // fully paused: nothing invalidates, nothing renders
      // read per tick, not per mount: the tier can flip under us when a
      // phone is rotated or a desk window is dragged narrow
      const lite = device().lite
      // a flip INTO lite finds whatever mode fiber last left behind
      if (lite && store.getState().frameloop !== 'demand') setFrameloop('demand')
      if (t - lastInput < IDLE_MS) {
        setIdleFlag(false)
        if (!lite) {
          invalidate() // the desk: every tick, full display rate
          return
        }
        if (t - lastLiteFrame >= LITE_ACTIVE_MS) {
          lastLiteFrame = t
          invalidate()
        }
        return
      }
      setIdleFlag(true)
      if (t - lastIdleFrame >= (lite ? LITE_IDLE_MS : IDLE_FRAME_MS)) {
        lastIdleFrame = t
        invalidate()
      }
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('pointerdown', wake)
      window.removeEventListener('keydown', wake)
      window.removeEventListener('wheel', wake)
      window.removeEventListener('touchstart', wake)
      window.removeEventListener('scroll', wake)
      document.removeEventListener('visibilitychange', onVisibility)
      setIdleFlag(false)
      // hygiene for HMR/unmount only — the governor lives for the app's life
      setFrameloop('always')
    }
  }, [invalidate, setFrameloop, clock, store])

  return null
}
