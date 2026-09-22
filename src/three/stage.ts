import { useLayoutEffect, useRef, useState } from 'react'
import { beginTask, endTask, useLoad } from '../loadProgress'

/* =====================================================================
   Staged first load — the room is assembled in slices, not in one
   multi-second freeze.

   Every prop used to build its canvases and geometry inside one React
   commit the moment the scene chunk arrived: ~1.2 s of main thread on a
   fast machine, 5+ s on an ordinary laptop, with the tab frozen and
   nothing but the page background on screen. Now each heavy piece asks
   for a turn:

     <Staged id="tower">…</Staged>       mounts its children in a turn
     useStagedValue('room.rug', make)    runs one builder in a turn
     useStagedSteps('room.floor', gen)   runs a generator builder, one
                                         `yield`-delimited step per turn

   Turns are granted one at a time, in the order they were asked for
   (which is tree order), each in its own task, so the browser breathes
   between them and the loader's bar moves (every turn is a critical-
   path task in loadProgress). Several cheap turns share one task until
   SLICE_MS is spent. Gates marked `last` wait until every other turn is
   done: the one-shot bakes that must see the whole room (the contact
   shadows) and the shadow scheduler, which wants to be the last frame
   callback, as it was when it was last in the tree.

   All of this is behind the veil. After the reveal — or on a second
   visit to the room in the same tab — nothing is staged: gates open and
   builders run synchronously, exactly as before, so the room never
   assembles itself in view. If the veil is lifted early by its timeout,
   every pending turn is flushed at once for the same reason.
   ===================================================================== */

/** main-thread budget for one task of turns (ms) */
const SLICE_MS = 10

interface Job {
  id: string
  last: boolean
  /** do (a step of) the work, or open the gate; true = more steps to
      come in later turns. Completion comes via finish(). */
  start: () => boolean
  started: boolean
}

const waiting: Job[] = []
let busy: Job | null = null
let sliceStart = 0
let posted = false
let seq = 0

const channel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null
function post(): void {
  if (posted) return
  posted = true
  if (channel) channel.port2.postMessage(0)
  else window.setTimeout(onSlice, 0)
}
function onSlice(): void {
  posted = false
  sliceStart = performance.now()
  grant()
}
if (channel) channel.port1.onmessage = onSlice

function grant(): void {
  if (busy || !waiting.length) return
  // everything else before the `last` gates
  let i = waiting.findIndex((j) => !j.last)
  if (i < 0) i = 0
  const job = waiting.splice(i, 1)[0]
  busy = job
  job.started = true
  if (job.start()) {
    // a multi-step builder: its next step goes first in the next turn
    waiting.unshift(job)
    busy = null
    post()
  }
}

function enqueue(job: Job): void {
  waiting.push(job)
  beginTask(job.id)
  post()
}

/** The job's result has committed (called from a layout effect, so any
    turns its children asked for are already queued). */
function finish(job: Job): void {
  endTask(job.id)
  const i = waiting.indexOf(job)
  if (i >= 0) waiting.splice(i, 1)
  if (busy !== job) return
  busy = null
  // a `last` gate holds a one-shot bake that runs on the next frame:
  // let that frame come before the next turn, so two bakes never share one
  if (job.last) requestAnimationFrame(post)
  else if (performance.now() - sliceStart < SLICE_MS) grant()
  else post()
}

/** Unmounted before its turn came, or mid-turn. */
function cancel(job: Job): void {
  endTask(job.id)
  const i = waiting.indexOf(job)
  if (i >= 0) waiting.splice(i, 1)
  if (busy === job) {
    busy = null
    post()
  }
}

/** Run every pending turn now, in this task. */
function flushAll(): void {
  while (waiting.length || busy) {
    const job = busy ?? waiting.shift()!
    const resume = busy === null && job.started // a builder between steps
    busy = null
    if (!job.started || resume) {
      job.started = true
      while (job.start()) {
        /* run every remaining step now */
      }
    }
  }
}

// the veil came down early (its give-up timeout): nothing may assemble
// in view
useLoad.subscribe((s, prev) => {
  if (!s.revealed || prev.revealed) return
  flushAll()
})

/** set by hurryStaged(): the first load stopped pacing itself */
let hurried = false

/** Stop pacing the first load: every pending turn runs now, and whatever
    mounts from here on builds on the spot, as after the reveal — but the
    veil stays up until the room is drawn. For a machine so slow that
    the paced build overran SceneReady's patience; one long task behind
    the veil beats another ten seconds of turns. */
export function hurryStaged(): void {
  hurried = true
  flushAll()
}

/** staging is over: the room was revealed, or the load was hurried */
const revealed = () => hurried || useLoad.getState().revealed

/** Gate state for <Staged>: false until this gate's turn (true at once
    after the reveal). */
export function useStagedGate(id: string, last = false): boolean {
  const [open, setOpen] = useState(revealed)
  const initiallyOpen = useRef(open)
  const job = useRef<Job | null>(null)
  // mount-only: ask for a turn; the cleanup runs on unmount alone
  useLayoutEffect(() => {
    if (initiallyOpen.current) return
    const j: Job = {
      id: `stage:${id}#${++seq}`,
      last,
      started: false,
      start: () => {
        setOpen(true)
        return false
      },
    }
    job.current = j
    enqueue(j)
    return () => {
      if (job.current === j) {
        job.current = null
        cancel(j)
      }
    }
    // a gate's id and order are fixed for its lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // the turn's content has committed (children's layout effects ran first)
  useLayoutEffect(() => {
    if (!open || !job.current) return
    const j = job.current
    job.current = null
    finish(j)
  }, [open])
  return open
}

/** Build `make()` in its own turn during the first load; null until then.
    After the reveal it builds synchronously on first render, like
    useMemo(make, []). `make` must be pure and read only mount-time
    values — it runs once, a little later than the render that passed it. */
export function useStagedValue<T>(id: string, make: () => T): T | null {
  const [value, setValue] = useState<{ v: T } | null>(() => (revealed() ? { v: make() } : null))
  const initiallyReady = useRef(value !== null)
  const job = useRef<Job | null>(null)
  const ready = value !== null
  useLayoutEffect(() => {
    if (initiallyReady.current) return
    const j: Job = {
      id: `build:${id}#${++seq}`,
      last: false,
      started: false,
      start: () => {
        const v = make()
        setValue({ v })
        return false
      },
    }
    job.current = j
    enqueue(j)
    return () => {
      if (job.current === j) {
        job.current = null
        cancel(j)
      }
    }
    // `make` is captured once, by design (see above)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useLayoutEffect(() => {
    if (!ready || !job.current) return
    const j = job.current
    job.current = null
    finish(j)
  }, [ready])
  return value ? value.v : null
}

/** Run a generator builder to completion, synchronously (the sync API of
    a builder written in steps). */
export function runSteps<T>(gen: Generator<unknown, T, void>): T {
  for (;;) {
    const r = gen.next()
    if (r.done) return r.value
  }
}

/** Like useStagedValue, for a builder written as a generator: each
    `yield` ends a turn, so one big texture can be spread over several
    tasks. After the reveal it runs to completion on first render. */
export function useStagedSteps<T>(id: string, steps: () => Generator<unknown, T, void>): T | null {
  const [value, setValue] = useState<{ v: T } | null>(() =>
    revealed() ? { v: runSteps(steps()) } : null,
  )
  const initiallyReady = useRef(value !== null)
  const job = useRef<Job | null>(null)
  const ready = value !== null
  useLayoutEffect(() => {
    if (initiallyReady.current) return
    let gen: Generator<unknown, T, void> | null = null
    const j: Job = {
      id: `build:${id}#${++seq}`,
      last: false,
      started: false,
      start: () => {
        gen ??= steps()
        const r = gen.next()
        if (!r.done) return true
        setValue({ v: r.value })
        return false
      },
    }
    job.current = j
    enqueue(j)
    return () => {
      if (job.current === j) {
        job.current = null
        cancel(j)
      }
    }
    // `steps` is captured once, like useStagedValue's `make`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useLayoutEffect(() => {
    if (!ready || !job.current) return
    const j = job.current
    job.current = null
    finish(j)
  }, [ready])
  return value ? value.v : null
}
