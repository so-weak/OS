import { useState } from 'react'
import { identity } from '../../data/resume'
import { AppIcon } from '../icons/AppIcon'
import { playClick } from '../sound'
import { useToast } from './useToast'
import './apps.css'

/* =====================================================================
   Resume.pdf — the pane that never fails comes first: a big download
   button and an open-in-tab. The inline <object> preview is opt-in
   from the status bar, because a PDF under a CSS 3D transform can
   "load" and still paint garbage on this tube; if the browser refuses
   it outright, <object> falls back to the same pane.
   ===================================================================== */

function FallbackPane({ onOpenTab }: { onOpenTab: () => void }) {
  return (
    <div className="res-fallback">
      <AppIcon name="pdf" size={48} />
      <div className="res-fallback-title">
        This CRT predates inline PDF viewers.
      </div>
      <div className="res-fallback-sub">
        Previews scramble on a cathode-ray tube. The paper itself is fine —
        grab it below, or open it in a tab of its own.
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
  const [inline, setInline] = useState(false)

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
        {inline ? (
          <object
            className="res-frame"
            data={`${identity.resumePdf}#toolbar=0&navpanes=0`}
            type="application/pdf"
            aria-label="Resume PDF"
          >
            <FallbackPane onOpenTab={openTab} />
          </object>
        ) : (
          <FallbackPane onOpenTab={openTab} />
        )}
      </div>

      <div className="app-status">
        <span>SoubhikGhosh-Resume.pdf</span>
        <button
          type="button"
          className="res-eject fit"
          onClick={() => {
            playClick()
            setInline((v) => !v)
            show(
              inline
                ? 'Preview ejected. The download button never fails.'
                : 'Feeding the paper into the tube… it may scramble.',
            )
          }}
        >
          {inline
            ? 'preview scrambled? click to eject'
            : 'try the inline preview (may scramble on this tube)'}
        </button>
      </div>

      {toast}
    </div>
  )
}
