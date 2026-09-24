import { SCREEN_W, SCREEN_H } from '../constants'
import { useDevice } from '../device'
import { useSystem } from './store'
import { useEggs } from './eggs'
import { useWorld } from '../world'
import BootSequence from './boot/BootSequence'
import ShutdownSequence from './boot/ShutdownSequence'
import CrtOverlay from './crt/CrtOverlay'
import Desktop from './wm/Desktop'
import BsodOverlay from './wm/BsodOverlay'
import './wm/shell.css'

/* =====================================================================
   SoubhikOS root — a 1024x768 surface living on the CRT glass.
   power: off -> booting -> desktop -> shutting-down.
   The CRT overlay (scanlines/vignette) always renders on top; the BSOD
   egg overlays everything but the glass itself. Hacker mode (konami)
   green-shifts the whole stage.

   `data-tier` is the ONE hook every responsive rule in the OS hangs
   off (see the PHONE TIER block at the foot of wm/shell.css). The OS
   is a 1024px div inside a CSS-3D transform, so a viewport media query
   here would be measuring the wrong thing entirely — and on a desk it
   would be one bad breakpoint away from moving a pixel. The attribute
   comes from src/device.ts, which reports 'desk' for anything wider
   than a tablet; nothing styles [data-tier='desk'], so the desk render
   is exactly the one that shipped. Nothing styles [data-tier='tablet']
   either, and that is deliberate and measured — see "AND WHY THERE IS
   NO TABLET BLOCK" at the foot of wm/shell.css.
   ===================================================================== */

export default function SoubhikOS() {
  const power = useSystem((s) => s.power)
  const bsod = useEggs((s) => s.bsod)
  const hacker = useEggs((s) => s.hacker)
  const tier = useDevice((s) => s.tier)

  return (
    <div
      className={`os-root${hacker ? ' hacker' : ''}`}
      data-tier={tier}
      style={{ width: SCREEN_W, height: SCREEN_H }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="os-stage">
        {power === 'off' && <ScreenOff />}
        {power === 'booting' && <BootSequence />}
        {power === 'desktop' && <Desktop />}
        {power === 'shutting-down' && <ShutdownSequence />}
      </div>

      {bsod && <BsodOverlay />}
      <CrtOverlay />
    </div>
  )
}

/** Powered-down glass: near-black with a faint reflection sheen. Left
    alone long enough (the world's idle flag), the phosphor remembers
    what it used to say — on the tube itself, never floating over the
    room. App.tsx keeps the promise: any key powers on while it shows. */
function ScreenOff() {
  const powerOn = useSystem((s) => s.powerOn)
  const idle = useWorld((s) => s.idle)
  return (
    <div className="screen-off" onClick={powerOn}>
      {idle ? (
        <div className="screen-burn t-term" aria-hidden="true">
          SoubhikOS · press any key
        </div>
      ) : null}
    </div>
  )
}
