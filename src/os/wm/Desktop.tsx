import { useEffect, useRef, useState } from 'react'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from 'react'
import { SCREEN_W } from '../../constants'
import { useWindows } from '../store'
import { useEggs } from '../eggs'
import { apps } from '../registry'
import { AppIcon } from '../icons/AppIcon'
import { playClick, playBeep } from '../sound'
import { localPoint, clamp, DESKTOP_H } from './metrics'
import OSWindow from './Window'
import Taskbar from './Taskbar'
import StartMenu from './StartMenu'
import { AboutDialog, ShutdownDialog, NewFolderDialog } from './dialogs'

/* =====================================================================
   The desktop: icon grid, windows, taskbar, start menu, context menu,
   system dialogs, toasts — plus the konami listener and the once-per-
   boot Welcome window.
   ===================================================================== */

type DialogKind = 'none' | 'about' | 'shutdown' | 'folder'

const KONAMI = [
  'arrowup',
  'arrowup',
  'arrowdown',
  'arrowdown',
  'arrowleft',
  'arrowright',
  'arrowleft',
  'arrowright',
  'b',
  'a',
]

export default function Desktop() {
  const windows = useWindows((s) => s.windows)
  const hacker = useEggs((s) => s.hacker)

  const [selected, setSelected] = useState<string | null>(null)
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null)
  const [dialog, setDialog] = useState<DialogKind>('none')
  const [toast, setToast] = useState<string | null>(null)
  const [arranging, setArranging] = useState(false)
  const [blinking, setBlinking] = useState(false)

  /* ---------- once per boot: open the Welcome window ----------
     The timeout makes this StrictMode-proof: mount -> schedule,
     fake unmount -> cancel, remount -> schedule -> fire once. */
  useEffect(() => {
    const t = setTimeout(() => useWindows.getState().openApp('welcome'), 500)
    return () => clearTimeout(t)
  }, [])

  /* ---------- konami code -> hacker mode ---------- */
  useEffect(() => {
    let i = 0
    const onKey = (e: KeyboardEvent) => {
      if (useEggs.getState().bsod) return
      const k = e.key.toLowerCase()
      if (k === KONAMI[i]) {
        i += 1
        if (i === KONAMI.length) {
          i = 0
          playBeep()
          useEggs.getState().toggleHacker()
        }
      } else {
        i = k === KONAMI[0] ? 1 : 0
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* ---------- hacker toast (skip initial mount, StrictMode-safe) ---------- */
  const prevHacker = useRef<boolean | null>(null)
  useEffect(() => {
    if (prevHacker.current !== null && prevHacker.current !== hacker) {
      setToast(
        hacker ? 'HACKER MODE — access granted' : 'HACKER MODE — access revoked',
      )
    }
    prevHacker.current = hacker
  }, [hacker])

  /* ---------- toast auto-dismiss ---------- */
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  /* ---------- Escape closes menus/dialogs (capture: don't zoom out) ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || useEggs.getState().bsod) return
      const wm = useWindows.getState()
      if (dialog !== 'none') {
        e.stopPropagation()
        setDialog('none')
      } else if (ctx) {
        e.stopPropagation()
        setCtx(null)
      } else if (wm.startOpen) {
        e.stopPropagation()
        wm.setStartOpen(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [dialog, ctx])

  /* ---------- arrange-icons jiggle cleanup ---------- */
  useEffect(() => {
    if (!arranging) return
    const t = setTimeout(() => setArranging(false), 850)
    return () => clearTimeout(t)
  }, [arranging])

  useEffect(() => {
    if (!blinking) return
    const t = setTimeout(() => setBlinking(false), 320)
    return () => clearTimeout(t)
  }, [blinking])

  const openCtxMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    const p = localPoint(e.clientX, e.clientY, e.currentTarget)
    setSelected(null)
    setCtx({
      x: clamp(Math.round(p.x), 0, SCREEN_W - 178),
      y: clamp(Math.round(p.y), 0, DESKTOP_H - 150),
    })
  }

  return (
    <div className={`desktop${blinking ? ' blink' : ''}`}>
      <div
        className="desktop-bg"
        onPointerDown={() => setSelected(null)}
        onContextMenu={openCtxMenu}
      />

      <IconGrid
        selected={selected}
        onSelect={setSelected}
        arranging={arranging}
      />

      {windows.map((w) => (
        <OSWindow key={w.id} win={w} />
      ))}

      <Taskbar />

      <StartMenu
        onAbout={() => setDialog('about')}
        onShutDown={() => setDialog('shutdown')}
      />

      {ctx && (
        <DesktopContextMenu
          x={ctx.x}
          y={ctx.y}
          onClose={() => setCtx(null)}
          onArrange={() => {
            playClick()
            setCtx(null)
            setArranging(true)
          }}
          onRefresh={() => {
            playClick()
            setCtx(null)
            setBlinking(true)
          }}
          onNewFolder={() => {
            playClick()
            setCtx(null)
            setDialog('folder')
          }}
        />
      )}

      {dialog === 'about' && <AboutDialog onClose={() => setDialog('none')} />}
      {dialog === 'shutdown' && (
        <ShutdownDialog onClose={() => setDialog('none')} />
      )}
      {dialog === 'folder' && (
        <NewFolderDialog onClose={() => setDialog('none')} />
      )}

      {toast && <div className="os-toast">{toast}</div>}
    </div>
  )
}

/* =====================================================================
   Desktop icon grid (left column, classic dotted selection).
   ===================================================================== */

function IconGrid({
  selected,
  onSelect,
  arranging,
}: {
  selected: string | null
  onSelect: (id: string) => void
  arranging: boolean
}) {
  const open = (id: string) => {
    playClick()
    useWindows.getState().openApp(id)
  }

  return (
    <div className={`desktop-icons${arranging ? ' arranging' : ''}`}>
      {apps
        .filter((a) => a.desktop)
        .map((a, i) => (
          <button
            key={a.id}
            className={`dicon${selected === a.id ? ' sel' : ''}`}
            style={arranging ? { animationDelay: `${i * 45}ms` } : undefined}
            onClick={() => onSelect(a.id)}
            onDoubleClick={() => open(a.id)}
            onKeyDown={(e: ReactKeyboardEvent<HTMLButtonElement>) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                open(a.id)
              }
            }}
          >
            <span className="dicon-ico">
              <AppIcon name={a.icon} size={32} />
            </span>
            <span className="dicon-label">{a.title}</span>
          </button>
        ))}
    </div>
  )
}

/* =====================================================================
   Right-click desktop menu: Arrange Icons / Refresh / New > Folder.
   ===================================================================== */

function DesktopContextMenu({
  x,
  y,
  onClose,
  onArrange,
  onRefresh,
  onNewFolder,
}: {
  x: number
  y: number
  onClose: () => void
  onArrange: () => void
  onRefresh: () => void
  onNewFolder: () => void
}) {
  const [subOpen, setSubOpen] = useState(false)

  return (
    <>
      <div
        className="os-backdrop"
        style={{ zIndex: 5190 }}
        onPointerDown={onClose}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />
      <div className="menu ctx-menu" style={{ left: x, top: y }} role="menu">
        <div className="menu-item" role="menuitem" onClick={onArrange}>
          Arrange Icons
        </div>
        <div className="menu-item" role="menuitem" onClick={onRefresh}>
          Refresh
        </div>
        <div className="menu-sep" />
        <div
          className="menu-item has-sub"
          role="menuitem"
          onMouseEnter={() => setSubOpen(true)}
          onMouseLeave={() => setSubOpen(false)}
        >
          <span>New</span>
          <span className="sub-arrow">›</span>
          {subOpen && (
            <div className="menu submenu">
              <div className="menu-item" role="menuitem" onClick={onNewFolder}>
                Folder
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
