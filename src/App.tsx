import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useSystem } from './os/store'
import { useRoute } from './router'
import { useLibrary } from './three/libraryState'
import { useRoom } from './three/roomState'
import { identity } from './data/resume'
import { useWorld } from './world'
import { loadFraction, setStage, useLoad, type LoadStage } from './loadProgress'
import veilBackdrop from './assets/veil-night.jpg'
import WorldClock from './WorldClock'
import Pocket, { type PocketReason } from './Pocket'
import './styles/hud.css'

/* =====================================================================
   Two places to be. `/` is the room — the 3D scene with the OS living
   on the CRT glass. `/library` is the catalogue, a page in its own
   right; the bookcase in the room is the door to it.

   Both are lazy so neither pays for the other: landing on /library
   loads no three.js, and the room never loads the catalogue's art
   until you walk over to the shelf.

   A third place, reluctantly: the pocket edition (src/Pocket.tsx) —
   where the room cannot run (phone width, no WebGL2, or the scene
   throwing) the resume is served as a plain page instead.
   ===================================================================== */

/* The room's chunk is ~1.3 MB. Its download starts at module
   evaluation (see the kick-off under the gate helpers below), so the
   network and parse overlap React's first render and the veil's first
   paint; lazy() then reuses the same promise.

   Mounting the scene blocks the main thread while it builds, so the
   veil flips to "unpacking" and gets one paint in BEFORE the scene is
   handed to React — otherwise that freeze would sit under a stale
   "downloading" line. */
const afterPaint = () =>
  new Promise<void>((resolve) => {
    let done = false
    const go = () => {
      if (done) return
      done = true
      window.setTimeout(resolve, 0) // rAF runs just before the paint
    }
    requestAnimationFrame(go)
    window.setTimeout(go, 120) // a hidden tab never paints
  })
const loadScene = () =>
  import('./three/Scene').then(async (m) => {
    performance.mark?.('load:chunk')
    setStage('build')
    await afterPaint()
    return m
  })
let scenePromise: ReturnType<typeof loadScene> | null = null
const sceneModule = () => (scenePromise ??= loadScene())
const Scene = lazy(sceneModule)
const LibraryPage = lazy(() => import('./library/LibraryPage'))

/* ---------- identity, derived once from resume.ts ----------
   "Artificial Intelligence & Machine Learning Engineer" is the title;
   the loader and the HUD get the short form of it. */
const SHORT_TITLE = identity.title
  .replace(/Artificial Intelligence/i, 'AI')
  .replace(/Machine Learning/i, 'ML')
  .replace(/\s*&\s*/g, '/')
const SHORT_TITLE_LC = SHORT_TITLE.replace(/ (\w)/g, (_m, c: string) => ` ${c.toLowerCase()}`)
const CITY = identity.location.split(',')[0].trim()

/** how long the HUD leads with the name before it turns into a hint */
const IDENTITY_MS = 8000

export default function App() {
  const route = useRoute()

  return (
    <>
      {/* visits, the desk's clock, the one idle detector */}
      <WorldClock />
      {route.name === 'library' ? (
        <Suspense fallback={<CatalogueVeil />}>
          <LibraryPage bookId={route.bookId} />
        </Suspense>
      ) : (
        <Room />
      )}
    </>
  )
}

/* ---------- the gate: can the room run here? ----------
   Width, not pointer type — an iPad runs the room fine. The "enter the
   room anyway" flag lives for the tab session only. */
const ANYWAY_KEY = 'soubhikos-room-anyway'
let anywayThisSession = false

function bypassed(): boolean {
  if (anywayThisSession) return true
  try {
    return window.sessionStorage.getItem(ANYWAY_KEY) === '1'
  } catch {
    return false
  }
}

function rememberAnyway(): void {
  anywayThisSession = true
  try {
    window.sessionStorage.setItem(ANYWAY_KEY, '1')
  } catch {
    /* private mode — the module flag carries it */
  }
}

function narrow(): boolean {
  try {
    return window.matchMedia('(max-width: 700px)').matches
  } catch {
    return false // no matchMedia — assume a desk
  }
}

function probe(): PocketReason | null {
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    if (!gl) return 'webgl'
    // a throwaway context: hand it back now rather than at GC
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    return 'webgl'
  }
  if (bypassed()) return null
  if (narrow()) return 'pocket'
  return null
}

/** The landing URL is the room (not /library). Mirrors router.parse. */
function landsInRoom(): boolean {
  const base = import.meta.env.BASE_URL
  let path = window.location.pathname
  if (path.startsWith(base)) path = path.slice(base.length)
  return path.replace(/^\/+/, '').split('/')[0] !== 'library'
}

/* Kick off the room's download right now when this visit is headed
   for it. Cheap checks only — the WebGL probe waits for Room, and a
   phone landing on the pocket edition downloads no three.js. A failed
   download surfaces through lazy() into SceneBoundary, as before. */
if (landsInRoom() && (bypassed() || !narrow())) {
  sceneModule().catch(() => {})
}

function Room() {
  const [pocket, setPocket] = useState<PocketReason | null>(probe)

  if (pocket === 'pocket') {
    return (
      <Pocket
        reason="pocket"
        onEnterAnyway={() => {
          rememberAnyway()
          setPocket(null)
        }}
      />
    )
  }
  if (pocket === 'webgl') return <Pocket reason="webgl" />

  return (
    <SceneBoundary>
      <RoomView />
    </SceneBoundary>
  )
}

/** The room threw (a lost context, a driver that lied) — serve the
    resume instead of a blank page. Class component: React still has no
    hook for this. */
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[SoubhikOS] the room failed to render', error, info.componentStack)
  }

  render(): ReactNode {
    return this.state.failed ? <Pocket reason="error" /> : this.props.children
  }
}

function RoomView() {
  const view = useSystem((s) => s.view)
  const power = useSystem((s) => s.power)
  const zoomOut = useSystem((s) => s.zoomOut)
  const paperUp = useRoom((s) => s.paperUp)
  const atShelf = useLibrary((s) => s.open)
  const revealed = useLoad((s) => s.revealed)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') zoomOut()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomOut])

  /* keyboard path to power on (U-P9): Enter/Space in room view. While
     the powered-off tube shows its "press any key" burn-in, any key
     keeps that promise. Capture phase, so we read `idle` before the
     world's own listener clears it. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const sys = useSystem.getState()
      if (sys.view !== 'room' || e.repeat) return
      if (!useLoad.getState().revealed) return // still behind the veil
      if (useRoom.getState().paperUp || useLibrary.getState().open) return
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return
      const entering = e.key === 'Enter' || e.key === ' '
      const burnIn =
        sys.power === 'off' &&
        useWorld.getState().idle &&
        e.key.length === 1 // a printable key, not a modifier
      if (!entering && !burnIn) return
      e.preventDefault()
      sys.powerOn()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const hudVisible = view === 'room' && !paperUp && !atShelf

  return (
    <>
      {/* the canvas mounts as soon as its code lands and builds UNDER the
          veil; nothing here replaces it while it works */}
      <Suspense fallback={null}>
        <Scene />
      </Suspense>
      {/* mounts at the reveal, so its identity clock starts with the room */}
      {revealed && <HudHint visible={hudVisible} power={power} />}
      <RoomVeil />

      {view === 'screen' && (
        <button className="hud-back t-term" onClick={zoomOut}>
          ◂ step back &nbsp;<span className="hud-key">ESC</span>
        </button>
      )}
    </>
  )
}

/** The first ten seconds: lead with who this is, then decay into the
    power-aware hint. */
function HudHint({ visible, power }: { visible: boolean; power: string }) {
  const [identityPhase, setIdentityPhase] = useState(true)
  useEffect(() => {
    const t = window.setTimeout(() => setIdentityPhase(false), IDENTITY_MS)
    return () => window.clearTimeout(t)
  }, [])

  if (!visible) return null
  if (identityPhase) {
    return (
      <div className="hud-hint hud-identity t-term">
        {identity.name} · {SHORT_TITLE_LC} · this is his desk
      </div>
    )
  }
  return (
    <div className="hud-hint t-term">
      {power === 'off'
        ? 'click the monitor — the resume is inside'
        : 'SoubhikOS is running — click the monitor to lean in'}
    </div>
  )
}

/* ---------- the room's loader veil ----------
   Up from the first paint until the room's first real frame is on
   screen (loadProgress.reveal(), called by three/SceneReady), then it
   fades out over the drawn room. The bar is loadFraction — the stages
   the scene actually reports — not a timer: the stripes march on the
   compositor so a busy main thread never reads as a hang, but the
   filled length only moves when the work does. Portalled to <body> so
   no click on it reaches the canvas's event source (#root). */
const STAGE_LINE: Record<LoadStage, string> = {
  code: 'downloading the room…',
  build: 'unpacking the room…',
  gpu: 'warming up the GPU…',
  ready: 'stepping in…',
}
/** fallback unmount if transitionend never fires (hidden tab, etc.) */
const VEIL_FADE_MS = 650

function RoomVeil() {
  const stage = useLoad((s) => s.stage)
  const revealed = useLoad((s) => s.revealed)
  const fraction = useLoad(loadFraction)
  // a second visit to the room this session: it is already warm
  const [gone, setGone] = useState(() => useLoad.getState().revealed)
  const [backdropIn, setBackdropIn] = useState(false)

  useEffect(() => {
    if (!revealed || gone) return
    const t = window.setTimeout(() => setGone(true), VEIL_FADE_MS + 200)
    return () => window.clearTimeout(t)
  }, [revealed, gone])

  if (gone) return null
  const pct = Math.round(fraction * 100)
  return createPortal(
    <div
      className={`loader-veil room-veil t-term${revealed ? ' is-leaving' : ''}`}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === 'opacity') setGone(true)
      }}
    >
      {/* the night hero shot, blurred and dimmed (~10 KB): the reveal
          reads as the room coming into focus, not black to room */}
      <img
        className={`loader-backdrop${backdropIn ? ' is-in' : ''}`}
        src={veilBackdrop}
        alt=""
        aria-hidden="true"
        decoding="async"
        onLoad={() => setBackdropIn(true)}
      />
      <div className="loader-box">
        <div>
          {identity.name.toUpperCase()} · {SHORT_TITLE.toUpperCase()} ·{' '}
          {CITY.toUpperCase()}
        </div>
        <div
          className="loader-bar"
          role="progressbar"
          aria-label="loading the room"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div className="loader-track">
            <div className="loader-stripes" />
            <div className="loader-cover" style={{ transform: `scaleX(${1 - fraction})` }} />
          </div>
        </div>
        <div className="loader-stage" aria-live="polite">
          {STAGE_LINE[stage]}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function CatalogueVeil() {
  return (
    <div className="loader-veil t-term">
      <div className="loader-box">
        <div>THE STACKS</div>
        <div className="loader-bar">
          <div className="loader-fill" />
        </div>
        <div>fetching the catalogue…</div>
      </div>
    </div>
  )
}
