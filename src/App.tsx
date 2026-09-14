import { Suspense, lazy, useEffect } from 'react'
import { useSystem } from './os/store'
import { useRoute } from './router'
import { useLibrary } from './three/libraryState'
import { useRoom } from './three/roomState'
import './styles/hud.css'

/* =====================================================================
   Two places to be. `/` is the room — the 3D scene with the OS living
   on the CRT glass. `/library` is the catalogue, a page in its own
   right; the bookcase in the room is the door to it.

   Both are lazy so neither pays for the other: landing on /library
   loads no three.js, and the room never loads the catalogue's art
   until you walk over to the shelf.
   ===================================================================== */

const Scene = lazy(() => import('./three/Scene'))
const LibraryPage = lazy(() => import('./library/LibraryPage'))

export default function App() {
  const route = useRoute()

  if (route.name === 'library') {
    return (
      <Suspense fallback={<CatalogueVeil />}>
        <LibraryPage bookId={route.bookId} />
      </Suspense>
    )
  }
  return <Room />
}

function Room() {
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

  return (
    <>
      <Suspense fallback={<LoaderVeil />}>
        <Scene />
      </Suspense>

      {view === 'room' && !paperUp && !atShelf && (
        <div className="hud-hint t-term">
          {power === 'off'
            ? 'click the monitor to power on'
            : 'SoubhikOS is running — click the monitor to lean in'}
        </div>
      )}
      {view === 'screen' && (
        <button className="hud-back t-term" onClick={zoomOut}>
          ◂ step back &nbsp;<span className="hud-key">ESC</span>
        </button>
      )}
    </>
  )
}

function LoaderVeil() {
  return (
    <div className="loader-veil t-term">
      <div className="loader-box">
        <div>SOUBHIK SYSTEMS (R) BOOT AGENT</div>
        <div className="loader-bar">
          <div className="loader-fill" />
        </div>
        <div>loading hardware…</div>
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
