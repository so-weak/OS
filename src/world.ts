import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

/* =====================================================================
   The world — the ONE module that remembers, keeps time, and notices
   when nobody is touching anything.

   - Persistence: the only file allowed to touch localStorage. Visits,
     the ledger of found secrets, labubu clicks (field/action names below
     still say "duck" — see the comment on duckClicks — the toy on the
     CRT changed, this store didn't need to), the Snake high score,
     mute, the blinds. Everything else on the site is session state.
   - Clock: the desk is in Bengaluru and keeps Bengaluru time; the
     visitor's own clock is for greetings and the taskbar only.
   - Idle: one detector (40 s of no pointer/key/wheel), paused while the
     tab is hidden. The moth, the screensaver and the burn-in all read
     this flag; none of them run their own timers.

   Top-level on purpose (like constants.ts): src/three and src/os both
   import it, so it imports neither. The per-frame damped values that
   the 3D room reads live in src/three/WorldFrame.tsx.
   ===================================================================== */

export type Weather = 'clear' | 'rain' | 'storm'
export type DayOverride = 'day' | 'night' | null

/* ---------- the ledger (E-1): every secret the room can keep ----------
   Riddles show for unfound entries; the `done` line once found. Marked
   by the file that owns the moment — grep `mark('` to find them all. */
export interface LedgerEntry {
  id: string
  riddle: string
  done: string
}

export const LEDGER: readonly LedgerEntry[] = [
  { id: 'lamp', riddle: 'the room has a mood, and a switch for it', done: 'mood lighting' },
  { id: 'sunrise', riddle: 'the window has two moods', done: 'let the sun in' },
  // id kept as duck10 (now labubu): persisted in found[], renaming would orphan saves
  { id: 'duck10', riddle: 'something on this desk rewards persistence', done: 'the golden debugger' },
  { id: 'snake25', riddle: 'the snake keeps score. beat 25.', done: 'nibbles, 25 and up' },
  { id: 'streak3', riddle: 'three in a row, into the bin', done: 'hat-trick' },
  { id: 'konami', riddle: 'up, up, down, down. you know the rest.', done: 'hacker mode' },
  { id: 'crash', riddle: 'the terminal can be made to regret things', done: 'STOP 0xC0FFEE' },
  { id: 'format', riddle: 'there is a command no sane person types', done: 'format c:' },
  { id: 'papers3', riddle: 'read every page on the desk', done: 'the paperwork, all of it' },
  { id: 'sys', riddle: 'one of the books is not a book', done: 'SOUBHIK.SYS' },
  { id: 'hire', riddle: 'type what you came here to do — on the real keyboard', done: 'hire signal' },
  { id: 'knobs', riddle: 'the tube has knobs. both of them.', done: 'brightness and contrast' },
  { id: 'chair', riddle: 'someone has to test the chair', done: 'quality assurance seat' },
  { id: 'floppy', riddle: 'the a: drive has feelings', done: 'ejected' },
  { id: 'moth', riddle: 'something small visits the lamp at night', done: 'the moth' },
  { id: 'corner', riddle: 'wait long enough and the logo finds the corner', done: 'it hit the corner' },
  { id: 'blinds', riddle: 'the blinds are on a cord', done: 'drew the blinds' },
  { id: 'soweak', riddle: 'the shell watches for the oldest trick', done: 'soweak said no' },
  { id: 'nihongo', riddle: 'the operator speaks a little of a fourth language', done: 'こんにちは' },
] as const

export type LedgerId = (typeof LEDGER)[number]['id']

/* ---------- state ---------- */
interface Persisted {
  visits: number
  firstAt: number
  lastAt: number
  found: string[]
  /** clicks on the desk toy — now labubu (Labubu.tsx). Field name kept as
      duckClicks, same as bumpDuck() below and DUCK_GOLDEN_AT in eggs.ts:
      all three are persisted (localStorage), so renaming any of them
      would reset every returning visitor's progress for a cosmetic swap. */
  duckClicks: number
  snakeHi: number
  muted: boolean
  /** the visitor has used the window at least once — the clock may rule */
  windowTouched: boolean
  blinds: boolean
}

interface Session {
  /** Bengaluru clock as float hours 0–24, refreshed every 30 s */
  hour: number
  dayOfYear: number
  /** the visitor's own local hour (greetings, taskbar) */
  localHour: number
  weather: Weather
  /** this session's window click wins over the clock */
  dayOverride: DayOverride
  idle: boolean
  idleSince: number
  hidden: boolean
}

interface Actions {
  recordVisit: () => void
  /** returns true the first time an id is found */
  mark: (id: LedgerId) => boolean
  has: (id: LedgerId) => boolean
  setSnakeHi: (n: number) => void
  bumpDuck: () => number
  setMuted: (muted: boolean) => void
  setDayOverride: (v: DayOverride) => void
  setBlinds: (v: boolean) => void
  setWeather: (w: Weather) => void
  setClock: (hour: number, dayOfYear: number, localHour: number) => void
  setIdle: (idle: boolean) => void
  setHidden: (hidden: boolean) => void
  /** the visitor owns their data: wipe it all */
  forget: () => void
}

export type WorldState = Persisted & Session & Actions

const PERSISTED: Persisted = {
  visits: 0,
  firstAt: 0,
  lastAt: 0,
  found: [],
  duckClicks: 0,
  snakeHi: 0,
  muted: false,
  windowTouched: false,
  blinds: false,
}

/* ---------- clock helpers ---------- */
const IST = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  hour: 'numeric',
  minute: 'numeric',
  hour12: false,
})

/** Bengaluru wall time as float hours (e.g. 23.67 = 11:40 pm). */
export function bengaluruHour(d = new Date()): number {
  const parts = IST.formatToParts(d)
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return h + m / 60
}

export function dayOfYear(d = new Date()): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 1)
  return Math.floor((d.getTime() - start) / 86_400_000) + 1
}

/** Bengaluru daylight window, as seen from the desk. */
export function isDaylight(hour: number): boolean {
  return hour >= 6.5 && hour < 18.25
}

/** 0–1 "golden hour" weight: peaks around dawn (~6.8) and dusk (~18). */
export function duskAmount(hour: number): number {
  const bump = (c: number, w: number) => Math.max(0, 1 - Math.abs(hour - c) / w)
  return Math.max(bump(6.8, 1.1), bump(18.0, 1.2))
}

/* tiny deterministic PRNG (same as textures.ts, kept local: no three here) */
function mulberry(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Weather is chosen once per calendar day so everyone sees the same
    Tuesday. Bengaluru monsoon (Jun–Sep) rains more. A first visit never
    opens on a storm — the hero shot comes first. */
export function weatherForDay(doy: number, year: number, firstVisit: boolean): Weather {
  const rand = mulberry(doy * 7 + year)
  const monsoon = doy >= 152 && doy <= 273
  const r = rand()
  if (r > (monsoon ? 0.6 : 0.25)) return 'clear'
  if (firstVisit) return 'rain'
  return rand() < 0.4 ? 'storm' : 'rain'
}

/* ---------- the store ---------- */
export const useWorld = create<WorldState>()(
  persist(
    (set, get) => ({
      ...PERSISTED,
      hour: bengaluruHour(),
      dayOfYear: dayOfYear(),
      localHour: new Date().getHours() + new Date().getMinutes() / 60,
      weather: 'clear',
      dayOverride: null,
      idle: false,
      idleSince: 0,
      hidden: typeof document !== 'undefined' && document.hidden,

      recordVisit: () => {
        const now = Date.now()
        set((s) => ({
          visits: s.visits + 1,
          firstAt: s.firstAt || now,
          lastAt: now,
        }))
      },
      mark: (id) => {
        if (get().found.includes(id)) return false
        set((s) => ({ found: [...s.found, id] }))
        return true
      },
      has: (id) => get().found.includes(id),
      setSnakeHi: (n) => set((s) => ({ snakeHi: Math.max(s.snakeHi, n) })),
      bumpDuck: () => {
        const n = get().duckClicks + 1
        set({ duckClicks: n })
        return n
      },
      setMuted: (muted) => set({ muted }),
      setDayOverride: (v) => set({ dayOverride: v, windowTouched: true }),
      setBlinds: (blinds) => set({ blinds }),
      setWeather: (weather) => set({ weather }),
      setClock: (hour, doy, localHour) => set({ hour, dayOfYear: doy, localHour }),
      setIdle: (idle) => set({ idle, idleSince: idle ? Date.now() : 0 }),
      setHidden: (hidden) => set({ hidden }),
      forget: () => set({ ...PERSISTED, dayOverride: null }),
    }),
    {
      name: 'soubhikos-world',
      version: 1,
      storage: createJSONStorage(() => window.localStorage),
      partialize: (s) => ({
        visits: s.visits,
        firstAt: s.firstAt,
        lastAt: s.lastAt,
        found: s.found,
        duckClicks: s.duckClicks,
        snakeHi: s.snakeHi,
        muted: s.muted,
        windowTouched: s.windowTouched,
        blinds: s.blinds,
      }),
    },
  ),
)

/* ---------- one-time migration: Snake's old high-score key ---------- */
try {
  const old = window.localStorage.getItem('soubhikos-snake-hi')
  if (old !== null) {
    const n = parseInt(old, 10)
    if (Number.isFinite(n) && n > 0) useWorld.getState().setSnakeHi(n)
    window.localStorage.removeItem('soubhikos-snake-hi')
  }
} catch {
  /* private mode etc. — nothing to migrate */
}

/** Frozen at load, BEFORE recordVisit bumps the count: is this someone
    who has been here before? The first visit always gets the night. */
export const RETURNING: boolean = useWorld.getState().visits > 0

/* seed today's weather now that we know whether it's a first visit */
useWorld
  .getState()
  .setWeather(weatherForDay(dayOfYear(), new Date().getFullYear(), !RETURNING))

/** What the room's daylight should be right now, before any damping.
    First visit: night (the hero shot). Otherwise the desk's clock —
    unless the visitor has clicked the window this session. */
export function wantsDay(): boolean {
  const s = useWorld.getState()
  if (s.dayOverride) return s.dayOverride === 'day'
  if (!RETURNING && !s.windowTouched) return false
  return isDaylight(s.hour)
}

/** Honour the OS-level motion preference everywhere. */
export function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** Greeting band from the VISITOR's clock. */
export function greeting(localHour = useWorld.getState().localHour): string {
  if (localHour >= 5 && localHour < 11) return 'Good morning'
  if (localHour >= 11 && localHour < 17) return 'Good afternoon'
  if (localHour >= 17 && localHour < 22) return 'Good evening'
  return "It's late — respect"
}

/** "11:40 pm" at the desk, for copy that explains the lamp. */
export function bengaluruClockLabel(hour = useWorld.getState().hour): string {
  const h24 = Math.floor(hour) % 24
  const m = Math.round((hour - Math.floor(hour)) * 60) % 60
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(m).padStart(2, '0')} ${h24 < 12 ? 'am' : 'pm'}`
}
