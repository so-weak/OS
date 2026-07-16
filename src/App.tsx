import { Suspense, useEffect } from 'react'
import Scene from './three/Scene'
import { useSystem } from './os/store'
import { useRoom } from './three/roomState'
import './styles/hud.css'

/* =====================================================================
   Top level: the 3D room always renders; the OS lives on the CRT glass
   inside the scene (drei <Html transform>). A thin HUD shows hints and
   the "step back" control when zoomed in.
   ===================================================================== */

export default function App() {
  const view = useSystem((s) => s.view)
  const power = useSystem((s) => s.power)
  const zoomOut = useSystem((s) => s.zoomOut)
  const paperUp = useRoom((s) => s.paperUp)

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

      {view === 'room' && !paperUp && (
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
