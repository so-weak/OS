import { useEffect, useRef, useState } from 'react'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import { playBeep, playClick } from '../sound'
import { useWorld } from '../../world'
import './snake.css'

/* =====================================================================
   NIBBLES — canvas snake in a 440×480 non-resizable window. Phosphor
   playfield sunk into the chassis, amber pixel apple, speed ramp,
   persistent high score, and a street-cred certificate at 25.
   All colors are read from tokens.css at mount (canvas can't var()).
   ===================================================================== */

const COLS = 20
const ROWS = 18
const CELL = 20
const W = COLS * CELL
const H = ROWS * CELL

const START_MS = 150
const MIN_MS = 65
const CRED_SCORE = 25

type Dir = 'up' | 'down' | 'left' | 'right'
type Phase = 'title' | 'running' | 'paused' | 'gameover'

interface Cell {
  x: number
  y: number
}

const VEC: Record<Dir, Cell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

const OPPOSITE: Record<Dir, Dir> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
}

const KEY_DIR: Record<string, Dir> = {
  arrowup: 'up', w: 'up',
  arrowdown: 'down', s: 'down',
  arrowleft: 'left', a: 'left',
  arrowright: 'right', d: 'right',
}

/* the high score lives in the world store (the one place that remembers) */
function loadHi(): number {
  return useWorld.getState().snakeHi
}

function saveHi(v: number): void {
  useWorld.getState().setSnakeHi(v)
}

interface Palette {
  bg: string
  green: string
  amber: string
  amberDeep: string
}

/** window props unused — Nibbles needs nothing but a keyboard */
export default function Snake() {
  const [phase, setPhase] = useState<Phase>('title')
  const [score, setScore] = useState(0)
  const [hi, setHi] = useState(loadHi)
  const [newHi, setNewHi] = useState(false)

  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const palRef = useRef<Palette | null>(null)

  const snakeRef = useRef<Cell[]>([])
  const dirRef = useRef<Dir>('right')
  const queueRef = useRef<Dir[]>([])
  const foodRef = useRef<Cell>({ x: 14, y: 9 })
  const scoreRef = useRef(0)
  const stepMsRef = useRef(START_MS)
  const overAtRef = useRef(0)
  const phaseRef = useRef<Phase>('title')
  const beepTimerRef = useRef(0)

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  /* ---------- board / game state ---------- */
  const resetBoard = (): void => {
    snakeRef.current = [
      { x: 8, y: 9 },
      { x: 7, y: 9 },
      { x: 6, y: 9 },
    ]
    dirRef.current = 'right'
    queueRef.current = []
    scoreRef.current = 0
    stepMsRef.current = START_MS
    setScore(0)
    setNewHi(false)
    spawnFood()
  }

  const spawnFood = (): void => {
    const taken = new Set(snakeRef.current.map((c) => `${c.x},${c.y}`))
    let cell: Cell
    do {
      cell = {
        x: Math.floor(Math.random() * COLS),
        y: Math.floor(Math.random() * ROWS),
      }
    } while (taken.has(`${cell.x},${cell.y}`))
    foodRef.current = cell
  }

  const die = (): void => {
    overAtRef.current = performance.now()
    const s = scoreRef.current
    if (s > hi) {
      setHi(s)
      setNewHi(true)
      saveHi(s)
    }
    setPhase('gameover')
    playBeep()
    beepTimerRef.current = window.setTimeout(() => playBeep(), 140)
  }

  const step = (): void => {
    // consume one queued turn, re-validated against the live direction
    while (queueRef.current.length) {
      const next = queueRef.current.shift() as Dir
      if (next !== dirRef.current && next !== OPPOSITE[dirRef.current]) {
        dirRef.current = next
        break
      }
    }
    const snake = snakeRef.current
    const v = VEC[dirRef.current]
    const head = { x: snake[0].x + v.x, y: snake[0].y + v.y }

    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
      die()
      return
    }
    const eating = head.x === foodRef.current.x && head.y === foodRef.current.y
    // moving into the vacating tail cell is legal (unless we grow)
    const body = eating ? snake : snake.slice(0, -1)
    if (body.some((c) => c.x === head.x && c.y === head.y)) {
      die()
      return
    }

    snake.unshift(head)
    if (eating) {
      scoreRef.current += 1
      setScore(scoreRef.current)
      stepMsRef.current = Math.max(MIN_MS, START_MS - scoreRef.current * 3.5)
      spawnFood()
      playBeep()
    } else {
      snake.pop()
    }
  }

  /* ---------- drawing ---------- */
  const draw = (): void => {
    const ctx = canvasRef.current?.getContext('2d')
    const pal = palRef.current
    if (!ctx || !pal) return

    ctx.fillStyle = pal.bg
    ctx.fillRect(0, 0, W, H)

    // faint phosphor grid dots
    ctx.globalAlpha = 0.12
    ctx.fillStyle = pal.green
    for (let gx = 1; gx < COLS; gx++) {
      for (let gy = 1; gy < ROWS; gy++) {
        ctx.fillRect(gx * CELL - 1, gy * CELL - 1, 2, 2)
      }
    }
    ctx.globalAlpha = 1

    // amber pixel apple
    const f = foodRef.current
    const fx = f.x * CELL
    const fy = f.y * CELL
    ctx.fillStyle = pal.amber
    ctx.fillRect(fx + 5, fy + 8, 10, 8)
    ctx.fillRect(fx + 4, fy + 10, 12, 4)
    ctx.fillStyle = pal.amberDeep
    ctx.fillRect(fx + 5, fy + 14, 10, 2)
    ctx.fillRect(fx + 9, fy + 4, 2, 4) // stem
    ctx.fillStyle = pal.green
    ctx.fillRect(fx + 11, fy + 4, 4, 2) // leaf

    // the snake
    const snake = snakeRef.current
    for (let i = snake.length - 1; i >= 0; i--) {
      const c = snake[i]
      const px = c.x * CELL
      const py = c.y * CELL
      if (i === 0) {
        ctx.globalAlpha = 1
        ctx.fillStyle = pal.green
        ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2)
        // eyes face the direction of travel
        ctx.fillStyle = pal.bg
        const d = dirRef.current
        const e1: Cell = { x: 0, y: 0 }
        const e2: Cell = { x: 0, y: 0 }
        if (d === 'right') { e1.x = 13; e1.y = 4; e2.x = 13; e2.y = 12 }
        if (d === 'left') { e1.x = 4; e1.y = 4; e2.x = 4; e2.y = 12 }
        if (d === 'up') { e1.x = 4; e1.y = 4; e2.x = 12; e2.y = 4 }
        if (d === 'down') { e1.x = 4; e1.y = 13; e2.x = 12; e2.y = 13 }
        ctx.fillRect(px + e1.x, py + e1.y, 3, 3)
        ctx.fillRect(px + e2.x, py + e2.y, 3, 3)
      } else {
        ctx.globalAlpha = Math.max(0.45, 0.85 - i * 0.012)
        ctx.fillStyle = pal.green
        ctx.fillRect(px + 2, py + 2, CELL - 4, CELL - 4)
      }
    }
    ctx.globalAlpha = 1
  }

  /* ---------- canvas + palette setup (after draw so lint sees order) ---------- */
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = W * dpr
    canvas.height = H * dpr
    const ctx = canvas.getContext('2d')
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const s = getComputedStyle(wrap)
    palRef.current = {
      bg: s.getPropertyValue('--term-bg').trim() || '#050a06',
      green: s.getPropertyValue('--term-green').trim() || '#33ff66',
      amber: s.getPropertyValue('--term-amber').trim() || '#ffb627',
      amberDeep: s.getPropertyValue('--amber-deep').trim() || '#b5720a',
    }
    resetBoard()
    draw()
    wrap.focus({ preventScroll: true })
    const beepTimer = beepTimerRef
    return () => {
      window.clearTimeout(beepTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------- game loop ---------- */
  useEffect(() => {
    if (phase !== 'running') return
    let raf = 0
    let last = performance.now()
    let acc = 0
    const tick = (t: number): void => {
      raf = requestAnimationFrame(tick)
      acc += t - last
      last = t
      let stepped = false
      while (acc >= stepMsRef.current && phaseRef.current === 'running') {
        acc -= stepMsRef.current
        step()
        stepped = true
      }
      if (stepped) draw()
    }
    draw()
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  /* ---------- input ---------- */
  const enqueue = (d: Dir): void => {
    const q = queueRef.current
    const last = q.length ? q[q.length - 1] : dirRef.current
    if (d === last || d === OPPOSITE[last] || q.length >= 2) return
    q.push(d)
    playClick()
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const key = e.key.toLowerCase()
    const isDir = key in KEY_DIR
    if (isDir || key === ' ' || key === 'p') e.preventDefault()
    if (['shift', 'control', 'alt', 'meta', 'escape'].includes(key)) return

    if (phase === 'title') {
      setPhase('running')
      return
    }
    if (phase === 'gameover') {
      if (performance.now() - overAtRef.current < 400) return
      resetBoard()
      setPhase('running')
      return
    }
    if (phase === 'paused') {
      if (isDir) enqueue(KEY_DIR[key])
      setPhase('running')
      return
    }
    // running
    if (isDir) {
      enqueue(KEY_DIR[key])
    } else if (key === 'p') {
      setPhase('paused')
      playClick()
    }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault() // keep focus glued to the wrapper
    wrapRef.current?.focus({ preventScroll: true })
  }

  const onBlur = (): void => {
    if (phaseRef.current === 'running') setPhase('paused')
  }

  const pad = (n: number): string => String(n).padStart(3, '0')

  return (
    <div
      ref={wrapRef}
      className="snake-root"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onBlur={onBlur}
    >
      <div className="snake-hud">
        <span className="snake-score">SCORE {pad(score)}</span>
        <span className="snake-title t-label">· NIBBLES ·</span>
        <span className="snake-hi">HI {pad(hi)}</span>
      </div>

      <div className="snake-bezel">
        <canvas
          ref={canvasRef}
          className="snake-canvas"
          style={{ width: W, height: H }}
        />

        {phase === 'title' && (
          <div className="snake-overlay">
            <div className="snake-big">NIBBLES</div>
            <div className="snake-sub">a snake with career ambitions</div>
            <div className="snake-blink">PRESS ANY KEY</div>
            <div className="snake-keys t-label">arrows / wasd move · p pause</div>
          </div>
        )}

        {phase === 'paused' && (
          <div className="snake-overlay">
            <div className="snake-big">PAUSED</div>
            <div className="snake-blink">PRESS ANY KEY</div>
          </div>
        )}

        {phase === 'gameover' && (
          <div className="snake-overlay">
            <div className="snake-big">GAME OVER</div>
            <div className="snake-sub">
              SCORE {pad(score)} &nbsp;·&nbsp; BEST {pad(hi)}
            </div>
            {newHi && <div className="snake-newhi">★ NEW HIGH SCORE ★</div>}
            {score >= CRED_SCORE && (
              <div className="snake-cred">
                certified persistent. mention NIBBLES in your email
                <br />
                for instant street cred.
              </div>
            )}
            <div className="snake-blink">PRESS ANY KEY</div>
          </div>
        )}
      </div>

      <div className="snake-help t-label">
        arrows / wasd steer · p pause · walls are load-bearing
      </div>
    </div>
  )
}
