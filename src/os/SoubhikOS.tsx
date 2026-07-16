import { SCREEN_W, SCREEN_H } from '../constants'
import { useSystem } from './store'
import { useEggs } from './eggs'
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
   ===================================================================== */

export default function SoubhikOS() {
  const power = useSystem((s) => s.power)
  const bsod = useEggs((s) => s.bsod)
  const hacker = useEggs((s) => s.hacker)

  return (
    <div
      className={`os-root${hacker ? ' hacker' : ''}`}
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

/** Powered-down glass: near-black with a faint reflection sheen. */
function ScreenOff() {
  const powerOn = useSystem((s) => s.powerOn)
  return <div className="screen-off" onClick={powerOn} />
}
