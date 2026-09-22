import { useEffect, useRef, useState } from 'react'
import { SCREEN_W, SCREEN_H } from '../../constants'
import { useSystem } from '../store'
import { useWorld } from '../../world'
import { AppIcon } from '../icons/AppIcon'
import { playBeep } from '../sound'

/* =====================================================================
   The screensaver — a pixel logo drifting around the tube, changing
   colour on every bounce, and every so often (really) finding a corner.

   It reads the world's one idle flag and never runs its own detector:
   ≥60 s of total idle when the desktop is small on the tube (room
   view), ≥120 s when someone is leaning in — never mid-read. Any input
   flips `idle` off and this unmounts, touching no window: the overlay
   catches the click, and a dismissing keystroke is swallowed before it
   reaches whatever was focused.

   The path is analytic (triangle waves in time, not per-frame
   integration), so the corner hit is exact: with the x/y periods in a
   7:9 ratio the logo meets a corner ~49 s in, then every ~98 s.
   ===================================================================== */

/** total idle before the logo appears — measured from the last input */
const ROOM_MS = 60_000
const SCREEN_MS = 120_000
/** the world's detector flips `idle` this long after the last input
    (WorldClock.tsx IDLE_MS), so `idleSince` already sits 40 s in */
const DETECTOR_MS = 40_000
const LOGO = 96
/** one edge-to-edge traversal in x, ms */
const TX = 14_000
const TY = (TX * 7) / 9
const HUE_STEP = 47
const TOAST_MS = 4200
const OUT_MS = 180

/** position along a bounce, and which way it is heading */
function tri(t: number, period: number, span: number): [number, 1 | -1] {
  const ph = t % (2 * period)
  return ph < period
    ? [(ph / period) * span, 1]
    : [(2 - ph / period) * span, -1]
}

export default function Screensaver() {
  const idle = useWorld((s) => s.idle)
  const idleSince = useWorld((s) => s.idleSince)
  const view = useSystem((s) => s.view)
  const [showing, setShowing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const logoRef = useRef<HTMLDivElement>(null)

  /* arm while idle; the threshold depends on how close the reader is */
  useEffect(() => {
    if (!idle) return
    const threshold = view === 'room' ? ROOM_MS : SCREEN_MS
    const sinceInput = DETECTOR_MS + (Date.now() - idleSince)
    const remaining = Math.max(0, threshold - sinceInput)
    const t = window.setTimeout(() => setShowing(true), remaining)
    return () => window.clearTimeout(t)
  }, [idle, idleSince, view])

  /* dismiss with a short grace, so the pointer-up that woke the world
     still lands on the overlay and not on a window underneath */
  useEffect(() => {
    if (idle || !showing) return
    const t = window.setTimeout(() => {
      setShowing(false)
      setToast(null)
    }, OUT_MS)
    return () => window.clearTimeout(t)
  }, [idle, showing])

  /* a dismissing keystroke must not type into a window */
  useEffect(() => {
    if (!showing) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      useWorld.getState().setIdle(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [showing])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), TOAST_MS)
    return () => window.clearTimeout(t)
  }, [toast])

  /* the flight */
  useEffect(() => {
    if (!showing) return
    const el = logoRef.current
    if (!el) return
    const W = SCREEN_W - LOGO
    const H = SCREEN_H - LOGO
    const t0 = performance.now()
    let prevDx = 0
    let prevDy = 0
    let hue = 0
    let flipX = -1e9
    let flipY = -1e9
    let cornerAt = -1e9
    let raf = 0

    const frame = (now: number) => {
      const t = now - t0
      // start dead centre, heading for the bottom-right
      const [x, dx] = tri(t + TX / 2, TX, W)
      const [y, dy] = tri(t + TY / 2, TY, H)
      let bounced = false
      if (prevDx !== 0 && dx !== prevDx) {
        flipX = t
        bounced = true
      }
      if (prevDy !== 0 && dy !== prevDy) {
        flipY = t
        bounced = true
      }
      prevDx = dx
      prevDy = dy
      if (bounced) {
        hue = (hue + HUE_STEP) % 360
        el.style.filter = `hue-rotate(${hue}deg)`
        if (Math.abs(flipX - flipY) < 40 && t - cornerAt > 1000) {
          cornerAt = t
          playBeep()
          useWorld.getState().mark('corner')
          setToast('IT HIT THE CORNER. you may go now.')
        }
      }
      el.style.transform = `translate(${x}px, ${y}px)`
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [showing])

  if (!showing) return null
  return (
    <div className={`saver${idle ? '' : ' saver-out'}`} aria-hidden="true">
      <div ref={logoRef} className="saver-logo">
        <AppIcon name="os-logo" size={LOGO} />
      </div>
      {toast ? <div className="os-toast saver-toast">{toast}</div> : null}
    </div>
  )
}
