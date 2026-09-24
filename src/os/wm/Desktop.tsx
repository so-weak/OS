import { useEffect, useRef, useState } from 'react'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from 'react'
import { SCREEN_W, SCREEN_H } from '../../constants'
import { useDevice } from '../../device'
import { useSystem, useWindows } from '../store'
import { useEggs } from '../eggs'
import { useWorld } from '../../world'
import { apps } from '../registry'
import { AppIcon } from '../icons/AppIcon'
import { playClick, playBeep } from '../sound'
import { localPoint, clamp, DESKTOP_H } from './metrics'
import OSWindow from './Window'
import Taskbar from './Taskbar'
import StartMenu from './StartMenu'
import Screensaver from './Screensaver'
import { AboutDialog, ShutdownDialog, NewFolderDialog } from './dialogs'

/* =====================================================================
   The desktop: icon grid, windows, taskbar, start menu, context menu,
   system dialogs, toasts, the screensaver — plus the konami listener
   and the once-per-boot Welcome window (or Contact, when the machine
   was booted by typing "hire" on the room keyboard).
   ===================================================================== */

type DialogKind = 'none' | 'about' | 'shutdown' | 'folder'

/* Taskbar height at phone tier — twice the 30px in metrics.ts, kept in
   sync with the PHONE TIER block in shell.css. Only used for pointer
   maths here; the bar's own height is CSS. */
const PHONE_TASKBAR_H = 60

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
  const phone = useDevice((s) => s.tier === 'phone')

  const [selected, setSelected] = useState<string | null>(null)
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null)
  const [dialog, setDialog] = useState<DialogKind>('none')
  const [toast, setToast] = useState<string | null>(null)
  const [arranging, setArranging] = useState(false)
  const [blinking, setBlinking] = useState(false)

  /* ---------- once per boot: open the Welcome window ----------
     The timeout makes this StrictMode-proof: mount -> schedule,
     fake unmount -> cancel, remount -> schedule -> fire once.
     A "hire" boot opens Contact INSTEAD (never stacked on Welcome).
     Keyed on hireBoot so that typing "hire" while the machine is
     already running still lands in Contact, right now, and the flag
     never lingers into a later boot. */
  const hireBoot = useSystem((s) => s.hireBoot)
  const greeted = useRef(false)
  useEffect(() => {
    if (greeted.current && !hireBoot) return
    const t = setTimeout(() => {
      greeted.current = true
      const sys = useSystem.getState()
      if (sys.hireBoot) {
        sys.clearHireBoot()
        useWindows.getState().openApp('contact')
      } else {
        useWindows.getState().openApp('welcome')
      }
    }, 500)
    return () => clearTimeout(t)
  }, [hireBoot])

  /* ---------- phone: every window opens full-bleed ----------
     A 620x600 window floating in a 1024x768 desktop is a joke on a
     surface that measures 367 CSS px across: the app would get a
     thumbnail of a thumbnail. So the moment a window appears we
     maximize it, which is also what turns OFF titlebar dragging and
     the eight resize handles (Window.tsx keys both on `maximized`) —
     nobody is hauling a window around with a thumb. shell.css pins the
     frame to the desktop as well, so there is no one-frame flash of
     the small window before this lands, and the ids are forgotten on
     close so a re-opened app comes back maximized too. */
  const maximized = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!phone) return
    const wm = useWindows.getState()
    const live = new Set(wm.windows.map((w) => w.id))
    for (const id of [...maximized.current])
      if (!live.has(id)) maximized.current.delete(id)
    for (const w of wm.windows) {
      if (maximized.current.has(w.id)) continue
      maximized.current.add(w.id)
      if (!w.maximized) wm.toggleMaximize(w.id)
    }
  }, [windows, phone])

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
          useWorld.getState().mark('konami')
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
    // the menu is twice the size on a phone, and it has to clear a
    // taskbar that is twice as tall
    setCtx({
      x: clamp(Math.round(p.x), 0, SCREEN_W - (phone ? 352 : 178)),
      y: clamp(
        Math.round(p.y),
        0,
        phone ? SCREEN_H - PHONE_TASKBAR_H - 250 : DESKTOP_H - 150,
      ),
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
        phone={phone}
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

      {/* idle long enough and the logo goes looking for the corner */}
      <Screensaver />
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
  phone,
}: {
  selected: string | null
  onSelect: (id: string) => void
  arranging: boolean
  phone: boolean
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
            /* Double-click is the desk's gesture and it stays the desk's.
               A finger double-taps to zoom, not to launch, so on a phone
               one tap opens the app — the selection state a second click
               was there to confirm is worth nothing on a touchscreen. */
            onClick={() => (phone ? open(a.id) : onSelect(a.id))}
            onDoubleClick={() => open(a.id)}
            onKeyDown={(e: ReactKeyboardEvent<HTMLButtonElement>) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                open(a.id)
              }
            }}
          >
            <span className="dicon-ico">
              {/* 16x16 pixel art at an exact 4x instead of 2x: the grid
                  survives, the target does not disappear under a thumb */}
              <AppIcon name={a.icon} size={phone ? 64 : 32} />
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
