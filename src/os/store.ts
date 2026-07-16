import { create } from 'zustand'
import { SCREEN_W, SCREEN_H } from '../constants'
import { getApp } from './registry'

/* =====================================================================
   System state machine
   power: off -> booting -> desktop -> shutting-down -> off
   view:  room <-> (zooming) <-> screen
   ===================================================================== */

export type PowerState = 'off' | 'booting' | 'desktop' | 'shutting-down'
export type ViewState = 'room' | 'zooming-in' | 'screen' | 'zooming-out'

interface SystemState {
  power: PowerState
  view: ViewState
  muted: boolean
  /** user clicked the monitor (or "power on") */
  powerOn: () => void
  bootComplete: () => void
  /** start menu -> Shut Down. Plays CRT-off, then zooms out. */
  shutDown: () => void
  shutdownComplete: () => void
  zoomIn: () => void
  zoomOut: () => void
  zoomArrived: () => void
  toggleMuted: () => void
}

export const useSystem = create<SystemState>((set, get) => ({
  power: 'off',
  view: 'room',
  muted: false,

  powerOn: () => {
    const { power } = get()
    set({ view: 'zooming-in', power: power === 'off' ? 'booting' : power })
  },
  bootComplete: () => set({ power: 'desktop' }),
  shutDown: () => set({ power: 'shutting-down' }),
  shutdownComplete: () => {
    useWindows.getState().closeAll()
    set({ power: 'off', view: 'zooming-out' })
  },
  zoomIn: () => set({ view: 'zooming-in' }),
  zoomOut: () => {
    const v = get().view
    if (v === 'screen' || v === 'zooming-in') set({ view: 'zooming-out' })
  },
  zoomArrived: () => {
    const v = get().view
    if (v === 'zooming-in') set({ view: 'screen' })
    else if (v === 'zooming-out') set({ view: 'room' })
  },
  toggleMuted: () => set((s) => ({ muted: !s.muted })),
}))

/* =====================================================================
   Window manager
   ===================================================================== */

export interface WinState {
  id: string // instance id (appId for single-instance apps)
  appId: string
  title: string
  x: number
  y: number
  w: number
  h: number
  z: number
  minimized: boolean
  maximized: boolean
  /** arbitrary props handed to the app component (e.g. projectId) */
  props?: Record<string, unknown>
}

interface WindowsState {
  windows: WinState[]
  nextZ: number
  startOpen: boolean
  openApp: (appId: string, props?: Record<string, unknown>) => void
  close: (id: string) => void
  closeAll: () => void
  focus: (id: string) => void
  minimize: (id: string) => void
  toggleMaximize: (id: string) => void
  restore: (id: string) => void
  move: (id: string, x: number, y: number) => void
  resize: (id: string, w: number, h: number) => void
  setStartOpen: (open: boolean) => void
  setTitle: (id: string, title: string) => void
}

let spawnCount = 0

export const useWindows = create<WindowsState>((set, get) => ({
  windows: [],
  nextZ: 10,
  startOpen: false,

  openApp: (appId, props) => {
    const app = getApp(appId)
    if (!app) return
    const { windows, nextZ } = get()
    const instanceId =
      app.singleInstance !== false ? appId : `${appId}#${++spawnCount}`

    const existing = windows.find((w) => w.id === instanceId)
    if (existing) {
      set({
        windows: windows.map((w) =>
          w.id === instanceId ? { ...w, minimized: false, z: nextZ } : w,
        ),
        nextZ: nextZ + 1,
        startOpen: false,
      })
      return
    }

    const [w, h] = app.defaultSize
    const cascade = (windows.length % 6) * 26
    set({
      windows: [
        ...windows,
        {
          id: instanceId,
          appId,
          title: app.title,
          // clamp all four edges: cascaded windows must keep their bottom
          // above the 30px taskbar and never overflow the right edge
          x: Math.max(
            8,
            Math.min(
              Math.round((SCREEN_W - w) / 2) + cascade - 60,
              SCREEN_W - w - 8,
            ),
          ),
          y: Math.max(
            8,
            Math.min(
              Math.round((SCREEN_H - 40 - h) / 2) + cascade - 40,
              SCREEN_H - 30 - h - 4,
            ),
          ),
          w,
          h,
          z: nextZ,
          minimized: false,
          maximized: false,
          props,
        },
      ],
      nextZ: nextZ + 1,
      startOpen: false,
    })
  },

  close: (id) =>
    set((s) => ({ windows: s.windows.filter((w) => w.id !== id) })),
  closeAll: () => set({ windows: [], startOpen: false }),

  focus: (id) =>
    set((s) => {
      const top = [...s.windows].sort((a, b) => b.z - a.z)[0]
      if (top?.id === id && !top.minimized) return s
      return {
        windows: s.windows.map((w) =>
          w.id === id ? { ...w, z: s.nextZ, minimized: false } : w,
        ),
        nextZ: s.nextZ + 1,
      }
    }),

  minimize: (id) =>
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id ? { ...w, minimized: true } : w,
      ),
    })),

  toggleMaximize: (id) =>
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id ? { ...w, maximized: !w.maximized } : w,
      ),
    })),

  restore: (id) => get().focus(id),

  move: (id, x, y) =>
    set((s) => ({
      windows: s.windows.map((w) => (w.id === id ? { ...w, x, y } : w)),
    })),

  resize: (id, w, h) =>
    set((s) => ({
      windows: s.windows.map((win) =>
        win.id === id ? { ...win, w, h } : win,
      ),
    })),

  setStartOpen: (open) => set({ startOpen: open }),
  setTitle: (id, title) =>
    set((s) => ({
      windows: s.windows.map((w) => (w.id === id ? { ...w, title } : w)),
    })),
}))

/** Topmost non-minimized window id (for active titlebar styling). */
export function useActiveWindowId(): string | null {
  return useWindows((s) => {
    const visible = s.windows.filter((w) => !w.minimized)
    if (!visible.length) return null
    return visible.reduce((a, b) => (a.z > b.z ? a : b)).id
  })
}
