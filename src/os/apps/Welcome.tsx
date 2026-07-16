import { useEffect, useState } from 'react'
import type { AppProps } from '../registry'
import { useWindows } from '../store'
import { identity } from '../../data/resume'
import { AppIcon } from '../icons/AppIcon'
import { playClick } from '../sound'
import './apps.css'

/* =====================================================================
   Welcome — auto-opened at boot by the shell. Typewriter tagline built
   from identity.title, three quick-launch buttons, an inescapable
   startup checkbox, and a konami hint in the footer.
   ===================================================================== */

const TAGLINE = identity.title

function useTypewriter(text: string, speed = 42): string {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (n >= text.length) return
    const t = window.setTimeout(() => setN((v) => v + 1), speed)
    return () => window.clearTimeout(t)
  }, [n, text, speed])
  return text.slice(0, n)
}

export default function Welcome({ windowId }: AppProps) {
  const openApp = useWindows((s) => s.openApp)
  const close = useWindows((s) => s.close)
  const typed = useTypewriter(TAGLINE)

  return (
    <div className="app">
      <div className="wlc-banner">
        <AppIcon name="os-logo" size={40} />
        <div>
          <div className="wlc-banner-title">Welcome to SoubhikOS</div>
          <div className="wlc-banner-ver t-label">
            version 4.01 · beige edition
          </div>
        </div>
      </div>

      <div className="wlc-body">
        <div className="wlc-type">
          {typed}
          <span className="wlc-caret" />
        </div>

        <div className="wlc-blurb">
          The resume is the operating system. Everything on this desktop is
          clickable, most of it is useful, and some of it is a snake.
        </div>

        <div className="wlc-launchers">
          <button
            type="button"
            className="wlc-launch"
            onClick={() => {
              playClick()
              openApp('about')
            }}
          >
            <AppIcon name="about" size={32} />
            About Me
          </button>
          <button
            type="button"
            className="wlc-launch"
            onClick={() => {
              playClick()
              openApp('projects')
            }}
          >
            <AppIcon name="folder-work" size={32} />
            My Work
          </button>
          <button
            type="button"
            className="wlc-launch"
            onClick={() => {
              playClick()
              openApp('terminal')
            }}
          >
            <AppIcon name="terminal" size={32} />
            Terminal
          </button>
        </div>

        <label className="wlc-check">
          <input type="checkbox" checked readOnly disabled />
          Show this screen at every startup (you cannot escape)
        </label>
      </div>

      <div className="wlc-footer">
        <span className="wlc-hint t-label">psst — try the Konami code.</span>
        <button
          type="button"
          className="btn primary"
          onClick={() => close(windowId)}
        >
          Let me in
        </button>
      </div>
    </div>
  )
}
