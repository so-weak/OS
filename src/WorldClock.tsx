import { useEffect } from 'react'
import { useWorld, bengaluruHour, dayOfYear } from './world'

/* =====================================================================
   The world's only timers. Mounted once by App:
   - records the visit,
   - refreshes the Bengaluru clock every 30 s,
   - runs the single idle detector (40 s without pointer/key/wheel),
   - pauses everything while the tab is hidden.
   Everything cleans up; StrictMode double-mount is harmless (the
   visit counter uses a module flag).
   ===================================================================== */

const IDLE_MS = 40_000
let visitRecorded = false

export default function WorldClock() {
  useEffect(() => {
    const w = useWorld.getState()
    if (!visitRecorded) {
      visitRecorded = true
      w.recordVisit()
    }

    const tick = () => {
      const d = new Date()
      useWorld
        .getState()
        .setClock(bengaluruHour(d), dayOfYear(d), d.getHours() + d.getMinutes() / 60)
    }
    tick()
    const clock = window.setInterval(tick, 30_000)

    let idleTimer = 0
    const arm = () => {
      window.clearTimeout(idleTimer)
      if (document.hidden) return
      idleTimer = window.setTimeout(() => useWorld.getState().setIdle(true), IDLE_MS)
    }
    const activity = () => {
      if (useWorld.getState().idle) useWorld.getState().setIdle(false)
      arm()
    }
    const onVisibility = () => {
      useWorld.getState().setHidden(document.hidden)
      if (document.hidden) {
        window.clearTimeout(idleTimer)
      } else {
        activity()
      }
    }

    const opts: AddEventListenerOptions = { passive: true }
    window.addEventListener('pointermove', activity, opts)
    window.addEventListener('pointerdown', activity, opts)
    window.addEventListener('keydown', activity, opts)
    window.addEventListener('wheel', activity, opts)
    window.addEventListener('touchstart', activity, opts)
    document.addEventListener('visibilitychange', onVisibility)
    arm()

    return () => {
      window.clearInterval(clock)
      window.clearTimeout(idleTimer)
      window.removeEventListener('pointermove', activity)
      window.removeEventListener('pointerdown', activity)
      window.removeEventListener('keydown', activity)
      window.removeEventListener('wheel', activity)
      window.removeEventListener('touchstart', activity)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return null
}
