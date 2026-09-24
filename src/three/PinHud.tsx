import { createPortal } from 'react-dom'
import { useDevice } from '../device'
import { playClick } from '../os/sound'
import { PRINT_IDS, usePins } from './pinState'
import './pinHud.css'

/* =====================================================================
   The only DOM the pin-up board owns: a way back, and the stepper.

   Portalled to <body> ON PURPOSE, exactly like LibraryHud: R3F is wired to
   #root as its event source and raycasts on every pointer event, so an
   overlay inside #root would fire its button AND click whatever is behind
   it. Outside #root, these native events never reach the canvas.
   ===================================================================== */

export default function PinHud() {
  const open = usePins((s) => s.open)
  const heldId = usePins((s) => s.heldId)
  // a finger needs 44px of plate to land on, and no sticky :hover after
  // the tap; the desk keeps the brass exactly as it was cut
  const touch = useDevice((s) => s.pointer) === 'touch'
  if (!open) return null

  const at = heldId ? PRINT_IDS.indexOf(heldId) + 1 : 0

  return createPortal(
    <div className={touch ? 'pin-hud pin-hud--touch' : 'pin-hud'}>
      <button
        type="button"
        className="pin-back"
        onClick={() => {
          playClick()
          const s = usePins.getState()
          if (s.heldId) s.release()
          else s.closeBoard()
        }}
      >
        ◂ {heldId ? 'pin it back' : 'back to the room'} &nbsp;
        <span className="hud-key">ESC</span>
      </button>
      <div className="pin-steps">
        <button
          type="button"
          className="pin-step"
          aria-label="previous photo"
          onClick={() => {
            playClick()
            usePins.getState().step(-1)
          }}
        >
          ◂
        </button>
        <span className="pin-count" aria-live="polite">
          {at || '-'} / {PRINT_IDS.length}
        </span>
        <button
          type="button"
          className="pin-step"
          aria-label="next photo"
          onClick={() => {
            playClick()
            usePins.getState().step(1)
          }}
        >
          ▸
        </button>
      </div>
    </div>,
    document.body,
  )
}
