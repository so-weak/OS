import { useWindows } from '../store'
import { apps } from '../registry'
import { AppIcon } from '../icons/AppIcon'
import { playClick } from '../sound'
import { GlyphPower } from './glyphs'

/* =====================================================================
   Start menu: vertical "SoubhikOS" banner, program entries, About,
   Shut Down. Closes on outside click (backdrop) and Escape (handled
   by the Desktop key listener).
   ===================================================================== */

interface StartMenuProps {
  onAbout: () => void
  onShutDown: () => void
}

export default function StartMenu({ onAbout, onShutDown }: StartMenuProps) {
  const open = useWindows((s) => s.startOpen)
  if (!open) return null

  const close = () => useWindows.getState().setStartOpen(false)

  const launch = (appId: string) => {
    playClick()
    useWindows.getState().openApp(appId) // also closes the menu
  }

  return (
    <>
      <div
        className="os-backdrop"
        style={{ zIndex: 5090 }}
        onPointerDown={close}
        onContextMenu={(e) => {
          e.preventDefault()
          close()
        }}
      />
      <div className="startmenu" role="menu">
        <div className="sm-banner" aria-hidden>
          <span className="sm-ver">4.01</span>
          <span className="sm-name">SoubhikOS</span>
        </div>
        <div className="sm-items">
          {apps
            .filter((a) => a.startMenu)
            .map((a) => (
              <div
                key={a.id}
                className="menu-item sm-item"
                role="menuitem"
                onClick={() => launch(a.id)}
              >
                <AppIcon name={a.icon} size={24} />
                <span>{a.title}</span>
              </div>
            ))}

          <div className="menu-sep" />

          <div
            className="menu-item sm-item"
            role="menuitem"
            onClick={() => {
              playClick()
              close()
              onAbout()
            }}
          >
            <AppIcon name="os-logo" size={24} />
            <span>About SoubhikOS…</span>
          </div>

          <div className="menu-sep" />

          <div
            className="menu-item sm-item"
            role="menuitem"
            onClick={() => {
              playClick()
              close()
              onShutDown()
            }}
          >
            <span className="sm-power">
              <GlyphPower size={18} />
            </span>
            <span>Shut Down…</span>
          </div>
        </div>
      </div>
    </>
  )
}
