import { identity } from '../../data/resume'
import { AppIcon } from '../icons/AppIcon'
import { useToast } from './useToast'
import resumePage1 from '../../assets/resume-pages/page-1.svg'
import resumePage2 from '../../assets/resume-pages/page-2.svg'
import './apps.css'

/* =====================================================================
   Resume.pdf — the whole point of the portfolio, so it has to actually
   show up. A live PDF plugin under this window's CSS 3D transform is
   unreliable (it can "load" and still paint garbage on the CRT tube),
   so each page is converted to SVG (vector glyph outlines, drawn by the
   browser at whatever resolution the tube ends up at, so small text
   stays crisp) and shown directly. Regenerate after editing the PDF:
     pdftocairo -svg -f N -l N public/SoubhikGhosh-Resume.pdf \
       src/assets/resume-pages/page-N.svg
   Download/Print/Open-in-tab still hand over the real PDF underneath.
   ===================================================================== */

const PAGES = [resumePage1, resumePage2]

export default function Resume() {
  const { toast, show } = useToast()

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
        <span className="t-label t-soft">
          {PAGES.length} page{PAGES.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="res-pages">
        {PAGES.map((src, i) => (
          <img
            key={src}
            className="res-page"
            src={src}
            alt={`SoubhikGhosh-Resume.pdf, page ${i + 1} of ${PAGES.length}`}
            draggable={false}
          />
        ))}
      </div>

      <div className="app-status">
        <span>SoubhikGhosh-Resume.pdf</span>
        <span className="t-label t-soft">the real PDF is one click away above</span>
      </div>

      {toast}
    </div>
  )
}
