import { useEffect, useState } from 'react'
import type { AppProps } from '../registry'
import { useWindows } from '../store'
import { identity } from '../../data/resume'
import {
  LEDGER,
  RETURNING,
  bengaluruClockLabel,
  greeting,
  isDaylight,
  useWorld,
} from '../../world'
import { AppIcon } from '../icons/AppIcon'
import { playClick } from '../sound'
import './apps.css'

/* =====================================================================
   Welcome — auto-opened at boot by the shell. Says hello like a person:
   the name in the banner, the title on a typewriter, a blurb that knows
   what time it is at the desk (and, on a return visit, what the visitor
   did last time), five launchers in a period-correct column, the
   inescapable checkbox, and a footer that whispers one riddle from the
   ledger of things not yet found.
   ===================================================================== */

const FIRST_NAME = identity.name.split(' ')[0]
const TAGLINE = identity.title

const LAUNCHERS: { id: string; icon: string; label: string }[] = [
  { id: 'about', icon: 'about', label: 'About Me' },
  { id: 'projects', icon: 'folder-work', label: 'My Work' },
  { id: 'resume', icon: 'pdf', label: 'Resume.pdf' },
  { id: 'contact', icon: 'mail', label: 'Contact' },
  { id: 'terminal', icon: 'terminal', label: 'Terminal' },
]

const RIDDLE_STEP = 6500

function useTypewriter(text: string, speed = 42): string {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (n >= text.length) return
    const t = window.setTimeout(() => setN((v) => v + 1), speed)
    return () => window.clearTimeout(t)
  }, [n, text, speed])
  return text.slice(0, n)
}

/** "A, B, and C" / "A and B" / "A" — then capitalise the first letter. */
function sentence(clauses: string[]): string {
  const joined =
    clauses.length > 2
      ? `${clauses.slice(0, -1).join(', ')}, and ${clauses[clauses.length - 1]}`
      : clauses.join(' and ')
  return joined.charAt(0).toUpperCase() + joined.slice(1) + '.'
}

function firstVisitBlurb(hour: number): string {
  const lamp = isDaylight(hour) ? '' : ', hence the lamp'
  return (
    `${greeting()} — it's ${bengaluruClockLabel(hour)} at this desk${lamp}. ` +
    'The resume is the operating system: everything here is clickable, ' +
    'most of it is useful, some of it is a snake. Short on time? The PDF ' +
    'and the mail app are right here.'
  )
}

function returnBlurb(
  visits: number,
  snakeHi: number,
  duckClicks: number,
  found: string[],
): string {
  const clauses: string[] = []
  if (snakeHi > 0)
    clauses.push(`the snake kept your score (HI ${String(snakeHi).padStart(3, '0')})`)
  if (duckClicks > 0) clauses.push('the duck kept its colour')
  const known = found.filter((id) => LEDGER.some((e) => e.id === id)).length
  if (known >= 1) {
    const left = LEDGER.length - known
    if (left === 0) clauses.push('you have found everything. everything')
    else if (left === 1) clauses.push("there is still one thing you haven't found")
    else clauses.push(`there are still ${left} things you haven't found`)
  }
  const memory = clauses.length
    ? sentence(clauses)
    : 'Nothing has moved; everything is still clickable.'
  return `Welcome back — visit #${visits}. ${memory}`
}

/** The footer whisper: one unfound riddle at a time, rotating. */
function useRiddle(found: string[]): string {
  const pool = LEDGER.filter((e) => !found.includes(e.id)).map((e) => e.riddle)
  const lines = found.length === 0 ? ['the duck knows things', ...pool] : pool
  const [i, setI] = useState(0)
  useEffect(() => {
    if (lines.length < 2) return
    const t = window.setInterval(() => setI((v) => v + 1), RIDDLE_STEP)
    return () => window.clearInterval(t)
  }, [lines.length])
  if (lines.length === 0) return 'psst — you found all of them. go outside.'
  const line = lines[i % lines.length]
  return `psst — ${line}${/[.?!]$/.test(line) ? '' : '.'}`
}

export default function Welcome({ windowId }: AppProps) {
  const openApp = useWindows((s) => s.openApp)
  const close = useWindows((s) => s.close)
  const typed = useTypewriter(TAGLINE)

  const hour = useWorld((s) => s.hour)
  const visits = useWorld((s) => s.visits)
  const snakeHi = useWorld((s) => s.snakeHi)
  const duckClicks = useWorld((s) => s.duckClicks)
  const found = useWorld((s) => s.found)
  const riddle = useRiddle(found)

  const blurb = RETURNING
    ? returnBlurb(visits, snakeHi, duckClicks, found)
    : firstVisitBlurb(hour)

  return (
    <div className="app">
      <div className="wlc-banner">
        <AppIcon name="os-logo" size={40} />
        <div>
          <div className="wlc-banner-title">Hi — I&apos;m {FIRST_NAME}.</div>
          <div className="wlc-banner-ver t-label">
            SoubhikOS 4.01 · beige edition
          </div>
        </div>
      </div>

      <div className="wlc-body">
        <div className="wlc-cols">
          <div className="wlc-text">
            <div className="wlc-type">
              {typed}
              <span className="wlc-caret" />
            </div>
            <div className="wlc-blurb">{blurb}</div>
          </div>

          <div className="wlc-launchers">
            {LAUNCHERS.map((l) => (
              <button
                key={l.id}
                type="button"
                className="wlc-launch"
                onClick={() => {
                  playClick()
                  openApp(l.id)
                }}
              >
                <AppIcon name={l.icon} size={32} />
                <span>{l.label}</span>
              </button>
            ))}
          </div>
        </div>

        <label className="wlc-check">
          <input type="checkbox" checked readOnly disabled />
          Show this screen at every startup (you cannot escape)
        </label>
      </div>

      <div className="wlc-footer">
        <span className="wlc-hint t-term">{riddle}</span>
        <button
          type="button"
          className="btn primary"
          onClick={() => close(windowId)}
        >
          Let me poke around
        </button>
      </div>
    </div>
  )
}
