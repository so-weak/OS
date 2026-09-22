import { create } from 'zustand'

/* =====================================================================
   First-load progress: the one source of truth for "is the room ready
   to be seen yet". The loader veil (App.tsx) reads it; the scene
   reports into it. The veil must stay up until `revealed` — the room's
   first real frame — not merely until the scene's code has downloaded.

   Stages, in order:
     code   the lazy Scene chunk is downloading
     build  the scene is mounted and building textures and geometry;
            anything heavy on the critical path wraps itself in
            beginTask/endTask (or trackTask) so the bar moves honestly
     gpu    everything is built; shaders are compiling / uploading
     ready  the first real frame has been presented: reveal()

   Work that is NOT needed for the first frame (drawer interiors, the
   OS's art, the day sky at night...) should not block the veil at all:
   schedule it with afterReveal(), which runs it in idle time once the
   room is on screen, a slice at a time.
   ===================================================================== */

export type LoadStage = 'code' | 'build' | 'gpu' | 'ready'

interface LoadState {
  stage: LoadStage
  /** ids of critical-path tasks begun / finished during `build` */
  begun: number
  ended: number
  revealed: boolean
}

export const useLoad = create<LoadState>(() => ({
  stage: 'code',
  begun: 0,
  ended: 0,
  revealed: false,
}))

const open = new Set<string>()

export function setStage(stage: LoadStage): void {
  if (useLoad.getState().stage !== stage) useLoad.setState({ stage })
}

/** A critical-path task started (ids are unique per task). */
export function beginTask(id: string): void {
  if (open.has(id)) return
  open.add(id)
  useLoad.setState((s) => ({ begun: s.begun + 1 }))
}

/** A critical-path task finished. Unknown ids are ignored. */
export function endTask(id: string): void {
  if (!open.delete(id)) return
  useLoad.setState((s) => ({ ended: s.ended + 1 }))
}

/** Run a synchronous critical-path builder and report it. */
export function trackTask<T>(id: string, fn: () => T): T {
  beginTask(id)
  try {
    return fn()
  } finally {
    endTask(id)
  }
}

/** Critical-path tasks still running. */
export function pendingTasks(): number {
  return open.size
}

/** 0..1 for the veil's bar: code is the first 20%, build 20-85%,
    gpu 85-100%. Never goes backwards within a stage. */
export function loadFraction(s: LoadState): number {
  if (s.revealed || s.stage === 'ready') return 1
  if (s.stage === 'code') return 0.12
  if (s.stage === 'gpu') return 0.9
  const f = s.begun > 0 ? s.ended / s.begun : 0
  return 0.2 + 0.65 * f
}

const idleQueue: (() => void)[] = []
let draining = false

type IdleCb = (d: { timeRemaining: () => number }) => void
const ric: (cb: IdleCb) => void =
  typeof window !== 'undefined' && 'requestIdleCallback' in window
    ? (cb) => (window as unknown as { requestIdleCallback: (c: IdleCb, o: { timeout: number }) => void }).requestIdleCallback(cb, { timeout: 600 })
    : (cb) => window.setTimeout(() => cb({ timeRemaining: () => 8 }), 16)

function drain(): void {
  if (draining) return
  draining = true
  ric(function step(deadline) {
    // one job per idle slot at least; more while the slot has time left
    do {
      const job = idleQueue.shift()
      if (!job) break
      try {
        job()
      } catch (e) {
        console.error('[load] deferred job failed', e)
      }
    } while (idleQueue.length && deadline.timeRemaining() > 6)
    if (idleQueue.length) ric(step)
    else draining = false
  })
}

/** Run `fn` in idle time after the room is revealed (immediately
    queued if it already is). Jobs run one per idle slot, in order. */
export function afterReveal(fn: () => void): void {
  idleQueue.push(fn)
  if (useLoad.getState().revealed) drain()
}

/** The room's first real frame is on screen. */
export function reveal(): void {
  if (useLoad.getState().revealed) return
  useLoad.setState({ stage: 'ready', revealed: true })
  drain()
}
