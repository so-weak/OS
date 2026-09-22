import { useEffect } from 'react'
import { playThunder } from '../os/sound'
import { RETURNING, reducedMotion, useWorld, type Weather } from '../world'
import { live, strike } from './live'

/* =====================================================================
   The weather runner — the only scheduler the sky has.

   Rain needs no timer: WorldFrame damps `live.rain` from the world's
   weather and Window.tsx reads it. A storm is rain plus lightning, and
   lightning is the one discrete event the room fires on its own, so it
   carries every gate the review agreed on:
     - only on a storm day, and never on a first visit (RETURNING)
     - never in the first 60 s of the session
     - `strike()` itself refuses outside room view, over a lifted paper,
       with the bookcase open, or under prefers-reduced-motion
     - the timer chain is torn down while the tab is hidden
   Thunder follows 1.2–3.5 s later, only if the strike was accepted.
   ===================================================================== */

const SESSION_START = Date.now()
const QUIET_MS = 60_000
const GAP_MIN_MS = 8_000
const GAP_MAX_MS = 40_000

export function WeatherRunner(): null {
  const weather = useWorld((s) => s.weather)
  const hidden = useWorld((s) => s.hidden)

  useEffect(() => {
    if (weather !== 'storm' || !RETURNING || hidden || reducedMotion()) return
    let timer = 0
    const schedule = () => {
      timer = window.setTimeout(
        fire,
        GAP_MIN_MS + Math.random() * (GAP_MAX_MS - GAP_MIN_MS),
      )
    }
    const fire = () => {
      if (!document.hidden && Date.now() - SESSION_START >= QUIET_MS) {
        const strength = 0.6 + Math.random() * 0.4
        if (strike(strength)) playThunder(1200 + Math.random() * 2300)
      }
      schedule()
    }
    schedule()
    return () => window.clearTimeout(timer)
  }, [weather, hidden])

  return null
}

/* ---------- dev hook: the sky on a string, for screenshots ----------
   Nothing here reaches production; the terminal's `weather` command is
   the only in-fiction control. */
declare global {
  interface Window {
    __scenery?: {
      strike: typeof strike
      setWeather: (w: Weather) => void
      setBlinds: (v: boolean) => void
      setIdle: (v: boolean) => void
      /** override the Bengaluru hour (WorldClock re-reads it within 30 s) */
      setHour: (h: number) => void
      live: typeof live
    }
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__scenery = {
    strike,
    setWeather: (w) => useWorld.getState().setWeather(w),
    setBlinds: (v) => useWorld.getState().setBlinds(v),
    setIdle: (v) => useWorld.getState().setIdle(v),
    setHour: (h) => {
      const s = useWorld.getState()
      s.setClock(h, s.dayOfYear, s.localHour)
    },
    live,
  }
}
