import { useState } from 'react'
import { identity } from '../../data/resume'
import { AppIcon } from '../icons/AppIcon'
import { playClick } from '../sound'
import { useToast } from './useToast'
import './apps.css'

/* =====================================================================
   Resume.pdf — embedded PDF with a proper toolbar. If the browser (or
   the 3D-transformed CRT) refuses to render the PDF, <object> falls back
   to a clean pane with a big download button. Because a PDF can also
   "load" yet paint garbage under a CSS 3D transform, the status bar
   offers a manual eject to the same fallback pane.
   ===================================================================== */

function FallbackPane({ onOpenTab }: { onOpenTab: () => void }) {
  return (
    <div className="res-fallback">
      <AppIcon name="pdf" size={48} />
      <div className="res-fallback-title">
        This CRT predates inline PDF viewers.
      </div>
      <div className="res-fallback-sub">
        The built-in previewer couldn&apos;t render the document inside a
        cathode-ray tube. The paper itself is fine — grab it below.
      </div>
      <a
        className="btn primary"
        href={identity.resumePdf}
        download
        style={{ textDecoration: 'none' }}
      >
        Download SoubhikGhosh-Resume.pdf
      </a>
      <button type="button" className="btn" onClick={onOpenTab}>
        Open in new tab
      </button>
    </div>
  )
}

export default function Resume() {
  const { toast, show } = useToast()
  const [ejected, setEjected] = useState(false)

  const openTab = () => {
    window.open(identity.resumePdf, '_blank', 'noopener')
  }

  const print = () => {
    window.open(identity.resumePdf, '_blank', 'noopener')
    show('Spooled to LPT1… kidding. Opened a tab — hit Ctrl+P there.')
  }

  return (
    <div className="app">
      <div className="app-toolbar">
        <a
          className="btn"
          href={identity.resumePdf}
          download
          style={{ textDecoration: 'none' }}
        >
          <AppIcon name="pdf" size={16} />
          Download
        </a>
        <button type="button" className="btn" onClick={print}>
          Print
        </button>
        <button type="button" className="btn" onClick={openTab}>
          Open in new tab
        </button>
        <span className="tool-spring" />
        <span className="t-label t-soft">100% dpi-independent paper</span>
      </div>

      <div className="res-frame-wrap">
        {ejected ? (
          <FallbackPane onOpenTab={openTab} />
        ) : (
          <object
            className="res-frame"
            data={`${identity.resumePdf}#toolbar=0&navpanes=0`}
            type="application/pdf"
            aria-label="Resume PDF"
          >
            <FallbackPane onOpenTab={openTab} />
          </object>
        )}
      </div>

      <div className="app-status">
        <span>SoubhikGhosh-Resume.pdf</span>
        <button
          type="button"
          className="res-eject fit"
          onClick={() => {
            playClick()
            setEjected((e) => !e)
            show(
              ejected
                ? 'Re-inserting the paper into the tube…'
                : 'Preview ejected. The download button never fails.',
            )
          }}
        >
          {ejected ? 'retry preview' : 'preview scrambled? click to eject'}
        </button>
      </div>

      {toast}
    </div>
  )
}
