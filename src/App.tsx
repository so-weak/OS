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
import { device, useDevice, watchDevice } from './device'
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

   A third place, on request or in failure: the pocket edition
   (src/Pocket.tsx). It used to be where every phone landed; phones walk
   into the room now, so it is what is left when the room genuinely
   cannot run (no WebGL2, or the scene throwing) and what a visitor gets
   when they tap the little door out of the room and just want the
   resume. Never a width gate.
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
   One question, and it is no longer about size. A phone renders the
   room; it just renders it differently (src/device.ts decides how the
   room dresses for the machine it is on). So the only thing that can
   turn a visitor away is a browser with no WebGL2 — and the only other
   way to the pocket edition is to ask for it. */
function probe(): PocketReason | null {
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    if (!gl) return 'webgl'
    // a throwaway context: hand it back now rather than at GC
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    return 'webgl'
  }
  return null
}

/* The escape hatch, inverted. It used to be "let me in anyway" for the
   phones the width gate had turned away; now that they are already in,
   it runs the other way — someone on a small screen who came for the
   resume and not the furniture asks for the plain page, and the tab
   remembers it until they walk back in. Read on phones and tablets
   only: a desk has no way to set this flag and no business honouring
   one, so `prefersPocket()` is a hard false at 1440x900. */
const POCKET_KEY = 'soubhikos-pocket'
let pocketThisSession = false

function prefersPocket(): boolean {
  if (device().tier === 'desk') return false
  if (pocketThisSession) return true
  try {
    return window.sessionStorage.getItem(POCKET_KEY) === '1'
  } catch {
    return false
  }
}

function rememberPocket(on: boolean): void {
  pocketThisSession = on
  try {
    if (on) window.sessionStorage.setItem(POCKET_KEY, '1')
    else window.sessionStorage.removeItem(POCKET_KEY)
  } catch {
    /* private mode — the module flag carries it */
  }
}

/** The landing URL is the room (not /library). Mirrors router.parse. */
function landsInRoom(): boolean {
  const base = import.meta.env.BASE_URL
  let path = window.location.pathname
  if (path.startsWith(base)) path = path.slice(base.length)
  return path.replace(/^\/+/, '').split('/')[0] !== 'library'
}

/* the store follows resize and orientation from here on; idempotent,
   and on a desk that never changes tier it changes nothing */
watchDevice()

/* Kick off the room's download right now when this visit is headed
   for it. Cheap checks only — the WebGL probe waits for Room. A visitor
   who asked for the plain page earlier in this tab is not headed for
   the room, so they still download no three.js; on a desk that test is
   a hard false, so the desk kicks off exactly as it always did. A
   failed download surfaces through lazy() into SceneBoundary, as
   before. */
if (landsInRoom() && !prefersPocket()) {
  sceneModule().catch(() => {})
}

function Room() {
  const [pocket, setPocket] = useState<PocketReason | null>(
    () => probe() ?? (prefersPocket() ? 'chose' : null),
  )

  if (pocket === 'chose') {
    return (
      <Pocket
        reason="chose"
        onEnterRoom={() => {
          rememberPocket(false)
          setPocket(null)
        }}
      />
    )
  }
  if (pocket === 'webgl') return <Pocket reason="webgl" />

  return (
    <SceneBoundary>
      <RoomView
        onStepOut={() => {
          rememberPocket(true)
          setPocket('chose')
        }}
      />
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

function RoomView({ onStepOut }: { onStepOut: () => void }) {
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
      {revealed && <PocketDoor visible={hudVisible} onLeave={onStepOut} />}
      <RoomVeil />

      {view === 'screen' && <StepBack onBack={zoomOut} />}
    </>
  )
}

/** The way out of the CRT close-up. The key chip is a promise about a
    keyboard, so a finger does not get told about a key it has no way
    to press — everything with a real Esc keeps the button it had,
    character for character. */
function StepBack({ onBack }: { onBack: () => void }) {
  const touch = useDevice((s) => s.pointer) === 'touch'
  return (
    <button className="hud-back t-term" onClick={onBack}>
      {touch ? (
        <>◂ step back</>
      ) : (
        <>
          ◂ step back &nbsp;<span className="hud-key">ESC</span>
        </>
      )}
    </button>
  )
}

/** The first ten seconds: lead with who this is, then decay into the
    power-aware hint. */
function HudHint({ visible, power }: { visible: boolean; power: string }) {
  const [identityPhase, setIdentityPhase] = useState(true)
  /* a finger cannot click. Mouse copy is the string it always was —
     only a coarse pointer takes the other branch. */
  const verb = useDevice((s) => s.pointer) === 'touch' ? 'tap' : 'click'
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
        ? `${verb} the monitor — the resume is inside`
        : `SoubhikOS is running — ${verb} the monitor to lean in`}
    </div>
  )
}

/** The door out of the room, for a visitor who came for the resume and
    not the furniture. It wears the room's own HUD button (.hud-back),
    trimmed down and parked in the free corner — nothing new floating
    over the desk. Portalled to <body> for the reason LibraryHud is:
    R3F raycasts on every pointer event that lands inside #root, so a
    button in there would both fire and poke the room. `visible` is the
    hint's own gate, which the shelf, the papers and the pin board (it
    raises paperUp) all close — so the corner is never contested. Never
    rendered on a desk: the tier check is false there and this is null. */
function PocketDoor({ visible, onLeave }: { visible: boolean; onLeave: () => void }) {
  const tier = useDevice((s) => s.tier)
  if (tier === 'desk' || !visible) return null
  return createPortal(
    <button type="button" className="hud-back pocket-door t-term" onClick={onLeave}>
      just the resume ▸
    </button>,
    document.body,
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
