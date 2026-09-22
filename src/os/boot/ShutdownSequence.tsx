import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useSystem } from '../store'
import { identity } from '../../data/resume'
import { useWorld } from '../../world'
import { playShutdown } from '../sound'
import { PixelMark } from './pixelart'
import './boot.css'

/* =====================================================================
   Shutdown: "SoubhikOS is shutting down…" with closing lines that know
   what the visitor did (the world remembers) → the classic amber "It
   is now safe to turn off your computer." with a handshake underneath
   → CRT power-off collapse (bright line squeeze → dot fade).
   playShutdown() rings at the start; shutdownComplete() fires exactly
   once (StrictMode-safe via refs).
   ===================================================================== */

const LINE_STEP = 240
const LINES_AT = 220
const SAFE_HOLD = 2400
const COLLAPSE_MS = 820

/** Built at shutdown, from the world — every line is true. */
function closeLines(): string[] {
  const w = useWorld.getState()
  const lines = ['Stopping window manager … done']
  if (w.snakeHi > 0) lines.push(`Saving Nibbles high score (${w.snakeHi}) … done`)
  if (w.duckClicks >= 10) lines.push('Returning duck to factory yellow … refused')
  lines.push(`Logging visit #${w.visits} … done`)
  lines.push('Committing your impression to memory … done')
  lines.push('Powering down phosphors …')
  return lines
}

type Stage = 'closing' | 'safe' | 'collapse'

export default function ShutdownSequence(): ReactElement {
  const [lines] = useState(closeLines)
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

    lines.forEach((_, i) => at(LINES_AT + i * LINE_STEP, () => setLineCount(i + 1)))
    const safeAt = LINES_AT + lines.length * LINE_STEP + 420
    const collapseAt = safeAt + SAFE_HOLD
    at(safeAt, () => setStage('safe'))
    at(collapseAt, () => setStage('collapse'))
    at(collapseAt + COLLAPSE_MS, () => {
      if (doneRef.current) return
      doneRef.current = true
      useSystem.getState().shutdownComplete()
    })

    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [lines])

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
          {lines.slice(0, lineCount).map((l) => (
            <div key={l} className="shut-line">
              {l}
            </div>
          ))}
        </div>
      ) : null}

      {stage === 'safe' ? (
        <div className="shut-safe">
          <div>
            <div className="shut-safe-text">
              It is now safe to turn off
              <br />
              your computer.
            </div>
            <div className="shut-safe-sub">or write to {identity.email}</div>
            <div className="shut-safe-bye">Come back. The lamp stays on.</div>
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
