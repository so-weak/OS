import { identity } from './data/resume'
import { href, navigate } from './router'
import { AppIcon } from './os/icons/AppIcon'
import './styles/pocket.css'

/* =====================================================================
   The pocket edition — the resume without the room.

   Shown where the room cannot run: a phone-width viewport, a browser
   that refused WebGL2, or the scene throwing (App.tsx wraps <Scene/> in
   an ErrorBoundary that lands here). It REPLACES the room — a DOM page
   in the OS's own beige/teal language, never a panel floating over the
   3D. Every fact on it comes from src/data/resume.ts.
   ===================================================================== */

export type PocketReason = 'pocket' | 'webgl' | 'error'

const FIRST_NAME = identity.name.split(' ')[0]

const COPY: Record<PocketReason, string> = {
  pocket:
    "SoubhikOS was built for a desk, not a pocket. Here's the short version:",
  webgl: "The room needs WebGL and yours said no. The resume doesn't care.",
  error: "The room needs WebGL and yours said no. The resume doesn't care.",
}

interface Props {
  reason: PocketReason
  /** only offered for the width gate — a phone can still try the room */
  onEnterAnyway?: () => void
}

export default function Pocket({ reason, onEnterAnyway }: Props) {
  const libraryHref = href({ name: 'library', bookId: null })

  return (
    <div className="pocket">
      <div className="pocket-card bevel-out">
        <div className="pocket-title">
          <AppIcon name="os-logo" size={16} />
          <span>SoubhikOS</span>
          <span className="pocket-title-ver t-label">pocket edition</span>
        </div>

        <div className="pocket-body">
          <p className="pocket-lead">{COPY[reason]}</p>

          <div className="pocket-id well">
            <div className="pocket-name">{identity.name}</div>
            <div className="pocket-role">{identity.title}</div>
            <div className="pocket-where t-term">{identity.location}</div>
          </div>

          <div className="pocket-actions">
            <a
              className="btn primary"
              href={identity.resumePdf}
              download
            >
              <AppIcon name="pdf" size={16} />
              Download resume
            </a>
            <a className="btn" href={`mailto:${identity.email}`}>
              <AppIcon name="mail" size={16} />
              Email {FIRST_NAME}
            </a>
            <a
              className="btn"
              href={identity.linkedin}
              target="_blank"
              rel="noopener noreferrer"
            >
              <AppIcon name="about" size={16} />
              LinkedIn
            </a>
            <a
              className="btn"
              href={identity.github}
              target="_blank"
              rel="noopener noreferrer"
            >
              <AppIcon name="terminal" size={16} />
              GitHub
            </a>
            <a
              className="btn"
              href={libraryHref}
              onClick={(e) => {
                e.preventDefault()
                navigate({ name: 'library', bookId: null })
              }}
            >
              <AppIcon name="folder" size={16} />
              Browse the library
            </a>
          </div>
        </div>

        <div className="pocket-foot">
          <span className="t-term pocket-fine">{identity.email}</span>
          {onEnterAnyway ? (
            <button
              type="button"
              className="pocket-anyway t-term"
              onClick={onEnterAnyway}
            >
              enter the room anyway →
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
