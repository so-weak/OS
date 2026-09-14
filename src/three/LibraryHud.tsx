import { createPortal } from 'react-dom'
import { books } from '../data/library'
import { playClick } from '../os/sound'
import { navigate } from '../router'
import { useLibrary } from './libraryState'

/* =====================================================================
   The only DOM the shelf owns: a way back to the room, and the door to
   the catalogue.

   It is portalled to <body> ON PURPOSE. R3F is wired to #root as its
   event source (see Scene.tsx), and it raycasts on every pointer event
   regardless of which DOM element was actually hit — so an overlay
   inside #root would fire its button AND pull a book off the shelf.
   Outside #root, these native events never reach the canvas at all.
   ===================================================================== */

export default function LibraryHud() {
  const open = useLibrary((s) => s.open)
  const selected = useLibrary((s) => s.selectedId)
  if (!open) return null

  return createPortal(
    <div className="lib-hud">
      <button
        type="button"
        className="lib-back t-term"
        onClick={() => {
          playClick()
          const lib = useLibrary.getState()
          if (lib.selectedId) lib.select(null)
          else lib.closeLibrary()
        }}
      >
        ◂ {selected ? 'shelve it' : 'back to the room'} &nbsp;
        <span className="hud-key">ESC</span>
      </button>
      <button
        type="button"
        className="lib-open t-term"
        onClick={() => {
          playClick()
          navigate({ name: 'library', bookId: null })
        }}
      >
        consult the catalogue &nbsp;<span className="lib-count">{books.length}</span> ▸
      </button>
    </div>,
    document.body,
  )
}
