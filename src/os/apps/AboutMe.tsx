import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppProps } from '../registry'
import { useWindows } from '../store'
import {
  certifications,
  education,
  identity,
  summary,
} from '../../data/resume'
import { playClick } from '../sound'
import { useToast } from './useToast'
import './apps.css'

/* =====================================================================
   About Me — "System Properties" for a human being.
   Tabs: General (portrait + identity + summary), Education, Certificates.
   EGG: click the portrait 7 times → it spins; toast reassures you.
   ===================================================================== */

type Tab = 'general' | 'education' | 'certs'

/* ---- original pixel-art portrait, drawn from a char grid ---- */

const PORTRAIT_ROWS = [
  '................',
  '....hhhhhhhh....',
  '...hhhhhhhhhh...',
  '..hhhhhhhhhhhh..',
  '..hhhhhhhhhhhh..',
  '..hhsssssssshh..',
  '..hhgggssggghh..',
  '..hhgegssgeghh..',
  '...ssssssssss...',
  '...sssmmmmsss...',
  '....ssssssss....',
  '.....ssssss.....',
  '......ssss......',
  '...ttttcctttt...',
  '..tttttttttttt..',
  '..tttttttttttt..',
]

const PORTRAIT_INK: Record<string, string> = {
  h: 'var(--ink)', // hair
  s: 'var(--face-light)', // skin
  g: 'var(--face-darker)', // glasses
  e: 'var(--ink)', // eyes
  m: 'var(--amber-deep)', // grin
  t: 'var(--title-b)', // shirt
  c: 'var(--paper)', // collar
}

function PixelPortrait() {
  const rects = useMemo(() => {
    const out: { x: number; y: number; fill: string }[] = []
    PORTRAIT_ROWS.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const fill = PORTRAIT_INK[row[x]]
        if (fill) out.push({ x, y, fill })
      }
    })
    return out
  }, [])
  return (
    <svg viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden>
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={1} height={1} fill={r.fill} />
      ))}
    </svg>
  )
}

/* ---- uptime ticker (session-real, not a resume claim) ---- */

function useUptime(): string {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setSecs((s) => s + 1), 1000)
    return () => window.clearInterval(t)
  }, [])
  const h = String(Math.floor(secs / 3600)).padStart(2, '0')
  const m = String(Math.floor((secs / 60) % 60)).padStart(2, '0')
  const s = String(secs % 60).padStart(2, '0')
  return `${h}:${m}:${s}`
}

export default function AboutMe({ windowId }: AppProps) {
  const close = useWindows((s) => s.close)
  const [tab, setTab] = useState<Tab>('general')
  const { toast, show } = useToast()
  const uptime = useUptime()

  /* portrait spin egg */
  const clicks = useRef(0)
  const [spinKey, setSpinKey] = useState(0)
  const spinTimer = useRef<number | null>(null)
  const [spinning, setSpinning] = useState(false)
  useEffect(
    () => () => {
      if (spinTimer.current !== null) window.clearTimeout(spinTimer.current)
    },
    [],
  )
  const onPortraitClick = () => {
    clicks.current += 1
    if (clicks.current >= 7) {
      clicks.current = 0
      setSpinKey((k) => k + 1)
      setSpinning(true)
      show('still employable, no matter how many times you click.')
      if (spinTimer.current !== null) window.clearTimeout(spinTimer.current)
      spinTimer.current = window.setTimeout(() => setSpinning(false), 950)
    }
  }

  return (
    <div className="app">
      <div className="abt-tabs">
        {(
          [
            ['general', 'General'],
            ['education', 'Education'],
            ['certs', 'Certificates'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`abt-tab${tab === id ? ' active' : ''}`}
            onClick={() => {
              if (tab !== id) playClick()
              setTab(id)
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <div className="abt-page">
          <div className="abt-id">
            <div
              className="abt-portrait"
              onClick={onPortraitClick}
              title="user.bmp"
            >
              <div
                key={spinKey}
                className={`abt-face${spinning ? ' spin' : ''}`}
              >
                <PixelPortrait />
              </div>
            </div>
            <div>
              <div className="abt-name">{identity.name}</div>
              <div className="abt-title">{identity.title}</div>
              <div className="abt-loc">
                <span
                  style={{
                    width: 8,
                    height: 8,
                    background: 'var(--led-green)',
                    boxShadow: 'var(--bevel-thin-out)',
                    display: 'inline-block',
                  }}
                />
                {identity.location}
              </div>
            </div>
          </div>

          <dl className="abt-kv">
            <dt>System:</dt>
            <dd>SoubhikOS 4.01 (beige edition)</dd>
            <dt>Registered to:</dt>
            <dd>{identity.name}</dd>
            <dt>Processor:</dt>
            <dd>1 x human, caffeine-cooled</dd>
            <dt>Up-time:</dt>
            <dd className="t-term">{uptime}</dd>
          </dl>

          <div className="abt-summary well">{summary}</div>
        </div>
      )}

      {tab === 'education' && (
        <div className="abt-page">
          {education.map((e) => (
            <div key={e.degree} className="abt-edu">
              <div className="abt-edu-head">
                <span className="abt-edu-degree">{e.degree}</span>
                <span className="abt-edu-period">{e.period}</span>
              </div>
              <div className="abt-edu-school">{e.school}</div>
              <span className="abt-score">{e.score}</span>
            </div>
          ))}
          <div className="abt-cert-note t-label">
            all report cards located and defragmented
          </div>
        </div>
      )}

      {tab === 'certs' && (
        <div className="abt-page">
          {certifications.map((c) => (
            <div key={c} className="abt-cert">
              <span className="abt-medal" />
              {c}
            </div>
          ))}
          <div className="abt-cert-note">
            Verified authentic by SoubhikOS Certificate Manager. No expired
            drivers were found on this human.
          </div>
        </div>
      )}

      <div className="abt-footer">
        <button
          type="button"
          className="btn"
          disabled
          style={{ color: 'var(--face-dark)' }}
          title="nothing to apply — already at peak configuration"
        >
          Apply
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={() => close(windowId)}
        >
          OK
        </button>
      </div>

      {toast}
    </div>
  )
}
