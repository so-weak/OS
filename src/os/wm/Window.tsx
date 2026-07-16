import { Suspense } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { SCREEN_W } from '../../constants'
import { useWindows, useActiveWindowId, type WinState } from '../store'
import { getApp } from '../registry'
import { AppIcon } from '../icons/AppIcon'
import { playClick } from '../sound'
import {
  clamp,
  osScale,
  DESKTOP_H,
  TITLEBAR_H,
  WIN_FRAME,
  DEFAULT_MIN_W,
  DEFAULT_MIN_H,
} from './metrics'
import { GlyphMinimize, GlyphMaximize, GlyphRestore, GlyphClose } from './glyphs'

/* =====================================================================
   Win9x window chrome: drag (pointer capture on the titlebar, clamped
   so the titlebar can never leave the 1024x768 root), 8-direction
   resize, min/max/close, double-click titlebar to maximize. The app
   component renders lazily inside <Suspense>.
   ===================================================================== */

type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const RESIZE_DIRS: ResizeDir[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

export default function OSWindow({ win }: { win: WinState }) {
  const activeId = useActiveWindowId()
  const app = getApp(win.appId)
  if (!app) return null

  const active = activeId === win.id
  const resizable = app.resizable !== false
  const minW = app.minSize?.[0] ?? DEFAULT_MIN_W
  const minH = app.minSize?.[1] ?? DEFAULT_MIN_H

  /* ---------- drag ---------- */
  const onTitlebarPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return
    if (win.maximized) return

    const el = e.currentTarget
    const { sx, sy } = osScale(el)
    const startCX = e.clientX
    const startCY = e.clientY
    const startX = win.x
    const startY = win.y
    const w = win.w

    el.setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) => {
      const nx = clamp(startX + (ev.clientX - startCX) / sx, 0, SCREEN_W - w)
      // keep the full titlebar visible above the taskbar
      const ny = clamp(
        startY + (ev.clientY - startCY) / sy,
        0,
        DESKTOP_H - TITLEBAR_H - WIN_FRAME * 2,
      )
      useWindows.getState().move(win.id, Math.round(nx), Math.round(ny))
    }
    const onUp = () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
  }

  /* ---------- resize ---------- */
  const onResizePointerDown =
    (dir: ResizeDir) => (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      e.stopPropagation()
      useWindows.getState().focus(win.id)

      const el = e.currentTarget
      const { sx, sy } = osScale(el)
      const startCX = e.clientX
      const startCY = e.clientY
      const start = { x: win.x, y: win.y, w: win.w, h: win.h }

      el.setPointerCapture(e.pointerId)
      const onMove = (ev: PointerEvent) => {
        const dx = (ev.clientX - startCX) / sx
        const dy = (ev.clientY - startCY) / sy
        let { x, y, w, h } = start

        if (dir.includes('e')) w = clamp(start.w + dx, minW, SCREEN_W - start.x)
        if (dir.includes('s')) h = clamp(start.h + dy, minH, DESKTOP_H - start.y)
        if (dir.includes('w')) {
          const d = clamp(dx, -start.x, start.w - minW)
          x = start.x + d
          w = start.w - d
        }
        if (dir.includes('n')) {
          const d = clamp(dy, -start.y, start.h - minH)
          y = start.y + d
          h = start.h - d
        }

        const wm = useWindows.getState()
        wm.move(win.id, Math.round(x), Math.round(y))
        wm.resize(win.id, Math.round(w), Math.round(h))
      }
      const onUp = () => {
        el.removeEventListener('pointermove', onMove)
        el.removeEventListener('pointerup', onUp)
        el.removeEventListener('pointercancel', onUp)
      }
      el.addEventListener('pointermove', onMove)
      el.addEventListener('pointerup', onUp)
      el.addEventListener('pointercancel', onUp)
    }

  /* ---------- controls ---------- */
  const onMinimize = () => {
    playClick()
    useWindows.getState().minimize(win.id)
  }
  const onToggleMax = () => {
    if (!resizable) return
    playClick()
    useWindows.getState().toggleMaximize(win.id)
  }
  const onClose = () => {
    playClick()
    useWindows.getState().close(win.id)
  }

  const AppComponent = app.component
  const frame = win.maximized
    ? { left: 0, top: 0, width: SCREEN_W, height: DESKTOP_H }
    : { left: win.x, top: win.y, width: win.w, height: win.h }

  return (
    <section
      className={`win${active ? '' : ' inactive'}`}
      style={{
        ...frame,
        zIndex: win.z,
        display: win.minimized ? 'none' : 'flex',
      }}
      onPointerDown={() => useWindows.getState().focus(win.id)}
      aria-label={win.title}
    >
      <div
        className="win-titlebar"
        onPointerDown={onTitlebarPointerDown}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('button')) return
          onToggleMax()
        }}
      >
        <span className="win-ico">
          <AppIcon name={app.icon} size={16} />
        </span>
        <span className="win-title">{win.title}</span>
        <button className="btn-sq" onClick={onMinimize} aria-label="Minimize">
          <GlyphMinimize />
        </button>
        <button
          className="btn-sq"
          onClick={onToggleMax}
          disabled={!resizable}
          aria-label={win.maximized ? 'Restore' : 'Maximize'}
        >
          {win.maximized ? <GlyphRestore /> : <GlyphMaximize />}
        </button>
        <button
          className="btn-sq win-x"
          onClick={onClose}
          aria-label="Close"
        >
          <GlyphClose />
        </button>
      </div>

      <div className="win-body">
        <Suspense
          fallback={
            <div className="win-loading t-term">
              loading<span className="os-blink">_</span>
            </div>
          }
        >
          <AppComponent windowId={win.id} props={win.props} />
        </Suspense>
      </div>

      {resizable && !win.maximized && (
        <>
          {RESIZE_DIRS.map((dir) => (
            <div
              key={dir}
              className={`rz rz-${dir}`}
              onPointerDown={onResizePointerDown(dir)}
            />
          ))}
        </>
      )}
    </section>
  )
}
