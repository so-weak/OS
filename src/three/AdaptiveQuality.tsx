import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
import { useSystem } from '../os/store'
import { useFrameGoverned } from './FrameGovernor'

/* =====================================================================
   Adaptive resolution.

   The room is fill-rate bound (every lit pixel pays for several lights),
   so the canvas resolution is the one dial that scales the cost of the
   whole picture. It starts at min(devicePixelRatio, 1.25) — a Retina
   laptop does not need 4x the pixels of a 1x monitor to read a room this
   soft — and drei's PerformanceMonitor walks it down when the frame rate
   sags and back up when there is headroom, one step at a time inside
   [0.75, 1.5]. After a few flip-flops it stops and keeps the lower step
   (no visible pumping).

   While the CRT fills the screen the 3D behind the glass barely matters
   (the OS is DOM and unaffected by the canvas resolution), so the canvas
   is capped at 1.0 there and restored the moment the camera pulls back.

   The monitor only starts once the scene has settled — long load frames
   must not count as a slow machine.
   ===================================================================== */

/** the ladder of pixel ratios the monitor may stand on */
const STEPS = [0.75, 1, 1.25, 1.5]
/** never above this, whatever the display */
const MAX_DPR = 1.5
/** default rung: min(devicePixelRatio, 1.25) */
const START_DPR = 1.25
/** cap while the OS is on screen */
const SCREEN_DPR = 1
/** frames to let the load settle before the monitor listens */
const SETTLE_FRAMES = 150

function stepFor(dpr: number): number {
  let best = 0
  for (let i = 0; i < STEPS.length; i++) if (STEPS[i] <= dpr + 1e-6) best = i
  return best
}

export default function AdaptiveQuality() {
  const setDpr = useThree((s) => s.setDpr)
  const view = useSystem((s) => s.view)
  const [settled, setSettled] = useState(false)
  const frames = useRef(0)
  // FrameGovernor drops the render loop to ~30Hz after ~8s idle; without
  // this, that governed rate reads to PerformanceMonitor as a slow
  // machine and it pumps the DPR down, then back up the moment input
  // resumes and the loop returns to full rate — visible pumping from a
  // deliberate idle optimisation, not an actual perf problem. Idle just
  // unmounts the monitor; the chosen rung is kept as-is until active again.
  const governed = useFrameGoverned()

  // the rung the monitor has chosen (never touched by the screen cap)
  const rung = useRef(
    stepFor(Math.min(START_DPR, MAX_DPR, window.devicePixelRatio || 1)),
  )
  const top = stepFor(Math.min(MAX_DPR, Math.max(1, window.devicePixelRatio || 1)))
  const lastMove = useRef<'up' | 'down' | null>(null)

  const apply = (v: string) => {
    const want = STEPS[rung.current]
    setDpr(v === 'screen' ? Math.min(want, SCREEN_DPR) : want)
  }

  // wait for the scene to settle, without re-rendering every frame
  useFrame(() => {
    if (settled) return
    if (++frames.current >= SETTLE_FRAMES) setSettled(true)
  })

  useEffect(() => {
    setDpr(view === 'screen' ? Math.min(STEPS[rung.current], SCREEN_DPR) : STEPS[rung.current])
  }, [view, setDpr])

  // only the room view is measured: zooming and the OS have their own cost
  const monitoring = settled && view === 'room' && !governed

  return monitoring ? (
    <PerformanceMonitor
      ms={250}
      iterations={8}
      threshold={0.7}
      flipflops={4}
      // 60 Hz: step down under 45 fps, up at (nearly) full rate;
      // 120 Hz panels: 80 / 110
      bounds={(hz) => (hz > 100 ? [80, 110] : [45, 57])}
      onDecline={() => {
        if (rung.current > 0) {
          rung.current--
          lastMove.current = 'down'
          apply('room')
        }
      }}
      onIncline={() => {
        if (rung.current < top) {
          rung.current++
          lastMove.current = 'up'
          apply('room')
        }
      }}
      onFallback={() => {
        // pumping between two rungs: settle on the lower one
        if (lastMove.current === 'up' && rung.current > 0) {
          rung.current--
          apply('room')
        }
      }}
    />
  ) : null
}
