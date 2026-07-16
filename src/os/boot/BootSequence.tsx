import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react'
import { useSystem } from '../store'
import { SCREEN_W, SCREEN_H } from '../../constants'
import { identity, projects, skills, awards } from '../../data/resume'
import { playBeep, playStartup } from '../sound'
import { PixelMark, PixelText } from './pixelart'
import './boot.css'

/* =====================================================================
   Act 1 — BIOS POST  (~3.8s): memory count-up, device detection gags.
   Act 2 — SoubhikOS splash (~2.7s): pixel wordmark + segmented bar.
   Any click / key skips everything. bootComplete() fires exactly once
   (StrictMode-safe via refs); playStartup() rings as the desktop lands.
   ===================================================================== */

const MEM_TOTAL = 65536
const MEM_START = 200
const MEM_DUR = 1000
const GAG_640K_AT = MEM_START + MEM_DUR + 220
const LINES_START = GAG_640K_AT + 280
const LINE_STEP = 185
const SPLASH_HOLD = 420
const SPLASH_DUR = 2700

interface PostLine {
  key: string
  text: string
  status?: string
  tone?: 'ok' | 'warn' | 'dim'
  /** dim aside rendered after the status */
  note?: string
}

const skillCount = skills.reduce((n, g) => n + g.items.length, 0)
const silverStar =
  awards.find((a) => a.title.includes('Silver Star'))?.title.split(' — ')[0] ??
  'Silver Star Award'

const DEVICE_LINES: PostLine[] = [
  { key: 'cpu', text: 'Main Processor : SOUBHIK-486DX4 @ 99 MHz', status: 'OK', tone: 'ok' },
  { key: 'hdd', text: 'Primary Master : GHOSH-HDD 8455 MB', status: 'OK', tone: 'ok' },
  { key: 'vga', text: `Video : CRT-9000 SVGA, ${SCREEN_W}x${SCREEN_H} @ 60 Hz`, status: 'OK', tone: 'ok' },
  { key: 'gpu', text: 'Detecting GPUs for PyTorch', status: 'FOUND', tone: 'ok' },
  { key: 'llm', text: 'LLM co-processor (Gemini / Vertex AI)', status: 'READY', tone: 'ok' },
  { key: 'skills', text: `Skill modules : ${skillCount} packages`, status: 'LOADED', tone: 'ok' },
  { key: 'projects', text: `Portfolio volumes : ${projects.length} projects`, status: 'MOUNTED', tone: 'ok' },
  { key: 'board', text: `Board-presentation module (${silverStar})`, status: 'LOADED', tone: 'ok' },
  { key: 'liveness', text: 'Anti-spoofing liveness probe', status: 'HUMAN', tone: 'ok' },
  { key: 'caffeine', text: 'Caffeine controller', status: 'CRITICAL', tone: 'warn', note: '(operating normally)' },
]

const SPLASH_STATUS: string[] = [
  'Loading window manager…',
  'Mounting resume.pdf…',
  'Calibrating scanlines…',
  `Indexing ${projects.length} projects…`,
  'Warming CRT phosphors…',
  'Detuning startup chime…',
  'Negotiating with caffeine controller…',
]

const BIOS_STAMP = `${new Date().toLocaleDateString('en-GB')} · SBIOS-4.01 · ${identity.name}`

function toneClass(tone: PostLine['tone']): string {
  if (tone === 'warn') return ' bs-warn'
  if (tone === 'dim') return ' bs-dim'
  return ''
}

export default function BootSequence(): ReactElement {
  const [mem, setMem] = useState(0)
  const [lines, setLines] = useState<PostLine[]>([])
  const [phase, setPhase] = useState<'post' | 'splash'>('post')
  const [safeMode, setSafeMode] = useState(false)

  // Refs survive StrictMode's double-effect pass — one-shots stay one-shot.
  const doneRef = useRef(false)
  const seenRef = useRef<Set<string>>(new Set())
  const beepRef = useRef(false)
  const phaseRef = useRef<'post' | 'splash'>('post')
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  const pushLine = useCallback((line: PostLine): void => {
    if (seenRef.current.has(line.key)) return
    seenRef.current.add(line.key)
    setLines((prev) => [...prev, line])
  }, [])

  const finish = useCallback((): void => {
    if (doneRef.current) return
    doneRef.current = true
    playStartup()
    useSystem.getState().bootComplete()
  }, [])

  /* ---------- timeline ---------- */
  useEffect(() => {
    const timers: number[] = []
    const at = (ms: number, fn: () => void): void => {
      timers.push(window.setTimeout(fn, ms))
    }

    const t0 = performance.now()
    const memTimer = window.setInterval(() => {
      const el = performance.now() - t0 - MEM_START
      if (el <= 0) return
      const frac = Math.min(1, el / MEM_DUR)
      setMem(Math.round((frac * MEM_TOTAL) / 512) * 512)
      if (frac >= 1) {
        window.clearInterval(memTimer)
        if (!beepRef.current) {
          beepRef.current = true
          playBeep()
        }
      }
    }, 34)

    at(GAG_640K_AT, () =>
      pushLine({
        key: '640k',
        text: '640K ought to be enough for anybody… upgrading anyway',
        tone: 'dim',
      }),
    )
    DEVICE_LINES.forEach((line, i) =>
      at(LINES_START + i * LINE_STEP, () => pushLine(line)),
    )

    const splashAt = LINES_START + DEVICE_LINES.length * LINE_STEP + SPLASH_HOLD
    at(splashAt, () => setPhase('splash'))
    at(splashAt + SPLASH_DUR, finish)

    return () => {
      timers.forEach((t) => window.clearTimeout(t))
      window.clearInterval(memTimer)
    }
  }, [finish, pushLine])

  /* ---------- input: gags + skip ---------- */
  useEffect(() => {
    // a natural double-click on the monitor lands its second click right
    // after power-on — give the POST theater a beat before skips arm
    const armedAt = performance.now() + 700
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Shift') {
        if (!seenRef.current.has('safemode')) {
          setSafeMode(true)
          pushLine({
            key: 'safemode',
            text: 'Safe mode? There is no safe mode. We ship to production.',
            tone: 'warn',
          })
        }
        return
      }
      // Mac keyboards label Backspace "delete" — honor both for the gag.
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (phaseRef.current === 'splash') {
          finish() // POST is over; SETUP ship has sailed — just skip
          return
        }
        pushLine({
          key: 'setup',
          text: 'SETUP is a lie. Booting anyway.',
          tone: 'warn',
        })
        return
      }
      if (
        e.key === 'Control' ||
        e.key === 'Alt' ||
        e.key === 'Meta' ||
        e.key === 'CapsLock' ||
        e.key === 'Escape' // ESC steps the camera back (App.tsx); POST keeps running
      ) {
        return
      }
      if (performance.now() < armedAt) return
      finish()
    }
    const onPointer = (): void => {
      if (performance.now() < armedAt) return
      finish()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [finish, pushLine])

  return (
    <div className="boot-root" role="presentation">
      {phase === 'post' ? (
        <div className="post">
          <div className="post-head">
            <div>
              <div className="post-title">SOUBHIK SYSTEMS (R) BIOS v4.01</div>
              <div className="bs-dim">
                {identity.name} Modular BIOS · {identity.location}
              </div>
            </div>
            <PixelMark px={4} />
          </div>

          <div className="post-mem">
            Memory Test : {String(mem).padStart(5, ' ')}K{' '}
            {mem >= MEM_TOTAL ? <span className="bs-ok">OK</span> : null}
          </div>

          <div className="post-lines">
            {lines.map((l) => (
              <div
                key={l.key}
                className={`post-line${l.status ? '' : toneClass(l.tone)}`}
              >
                {l.text}
                {l.status ? (
                  <>
                    {' … '}
                    <span className={l.tone === 'warn' ? 'bs-warn' : 'bs-ok'}>
                      {l.status}
                    </span>
                  </>
                ) : null}
                {l.note ? <span className="bs-dim"> {l.note}</span> : null}
              </div>
            ))}
            <span className="post-cursor" />
          </div>

          <div className="post-foot">
            <div>
              Press <span className="bs-warn">DEL</span> to enter SETUP · any
              other key skips POST
            </div>
            <div className="bs-dim">{BIOS_STAMP}</div>
          </div>
        </div>
      ) : (
        <Splash safeMode={safeMode} />
      )}
    </div>
  )
}

/* ---------- Act 2: splash ---------- */

const SEGS = 20

function Splash({ safeMode }: { safeMode: boolean }): ReactElement {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const t0 = performance.now()
    const iv = window.setInterval(
      () => setElapsed(performance.now() - t0),
      50,
    )
    return () => window.clearInterval(iv)
  }, [])

  const progress = Math.min(1, elapsed / (SPLASH_DUR - 300))
  const filled = Math.round(progress * SEGS)
  const status =
    SPLASH_STATUS[Math.floor(elapsed / 400) % SPLASH_STATUS.length]

  return (
    <div className="splash">
      <div className="splash-ver">v4.01</div>
      <div className="splash-mark">
        <PixelMark px={6} />
      </div>
      <div className="splash-word">
        <PixelText text="Soubhik" px={8} fill="var(--face-lighter)" />
        <PixelText text="OS" px={8} fill="var(--amber)" />
      </div>
      <div className="splash-sub">{identity.title.toUpperCase()}</div>
      <div className="splash-bar">
        {Array.from({ length: SEGS }, (_, i) => (
          <div key={i} className={`splash-seg${i < filled ? ' on' : ''}`} />
        ))}
      </div>
      <div className="splash-status">{status}</div>
      {safeMode ? (
        <div className="splash-safemode">
          Safe mode? There is no safe mode. We ship to production.
        </div>
      ) : null}
      <div className="splash-skip">press any key to skip</div>
    </div>
  )
}
