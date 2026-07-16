import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useSystem } from '../store'
import { playShutdown } from '../sound'
import { PixelMark } from './pixelart'
import './boot.css'

/* =====================================================================
   Shutdown: "SoubhikOS is shutting down…" beat → the classic amber
   "It is now safe to turn off your computer." → CRT power-off collapse
   (bright line squeeze → dot fade). playShutdown() rings at the start;
   shutdownComplete() fires exactly once (StrictMode-safe via refs).
   ===================================================================== */

const CLOSE_LINES = [
  'Stopping window manager … done',
  'Unmounting resume.pdf … done',
  'Saving Nibbles high score … done',
  'Powering down phosphors …',
]

const SAFE_AT = 1550
const COLLAPSE_AT = SAFE_AT + 1650
const DONE_AT = COLLAPSE_AT + 820

type Stage = 'closing' | 'safe' | 'collapse'

export default function ShutdownSequence(): ReactElement {
  const [stage, setStage] = useState<Stage>('closing')
  const [lineCount, setLineCount] = useState(0)
  const doneRef = useRef(false)
  const soundRef = useRef(false)

  useEffect(() => {
    if (!soundRef.current) {
      soundRef.current = true
      playShutdown()
    }

    const timers: number[] = []
    const at = (ms: number, fn: () => void): void => {
      timers.push(window.setTimeout(fn, ms))
    }

    CLOSE_LINES.forEach((_, i) => at(220 + i * 270, () => setLineCount(i + 1)))
    at(SAFE_AT, () => setStage('safe'))
    at(COLLAPSE_AT, () => setStage('collapse'))
    at(DONE_AT, () => {
      if (doneRef.current) return
      doneRef.current = true
      useSystem.getState().shutdownComplete()
    })

    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [])

  return (
    <div className="shut-root" role="presentation">
      {stage === 'closing' ? (
        <div className="shut-closing">
          <div className="shut-mark">
            <PixelMark px={5} />
          </div>
          <div className="shut-title">
            SoubhikOS is shutting down
            <span className="shut-dot">.</span>
            <span className="shut-dot">.</span>
            <span className="shut-dot">.</span>
          </div>
          {CLOSE_LINES.slice(0, lineCount).map((l) => (
            <div key={l} className="shut-line">
              {l}
            </div>
          ))}
        </div>
      ) : null}

      {stage === 'safe' ? (
        <div className="shut-safe">
          <div className="shut-safe-text">
            It is now safe to turn off
            <br />
            your computer.
          </div>
        </div>
      ) : null}

      {stage === 'collapse' ? (
        <div className="shut-collapse">
          <div className="crt-off-line" />
        </div>
      ) : null}
    </div>
  )
}
