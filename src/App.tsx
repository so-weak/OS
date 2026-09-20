import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import { useSystem } from './os/store'
import { useRoute } from './router'
import { useLibrary } from './three/libraryState'
import { useRoom } from './three/roomState'
import { identity } from './data/resume'
import { useWorld } from './world'
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

const Scene = lazy(() => import('./three/Scene'))
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

function probe(): PocketReason | null {
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    if (!gl) return 'webgl'
  } catch {
    return 'webgl'
  }
  if (bypassed()) return null
  try {
    if (window.matchMedia('(max-width: 700px)').matches) return 'pocket'
  } catch {
    /* no matchMedia — assume a desk */
  }
  return null
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
      <Suspense fallback={<LoaderVeil />}>
        <Scene />
        {/* mounts with the scene, so its clock starts at the first frame */}
        <HudHint visible={hudVisible} power={power} />
      </Suspense>

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

function LoaderVeil() {
  return (
    <div className="loader-veil t-term">
      <div className="loader-box">
        <div>
          {identity.name.toUpperCase()} · {SHORT_TITLE.toUpperCase()} ·{' '}
          {CITY.toUpperCase()}
        </div>
        <div className="loader-bar">
          <div className="loader-fill" />
        </div>
        <div>warming up the room…</div>
      </div>
    </div>
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
