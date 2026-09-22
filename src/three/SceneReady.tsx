import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Material, Object3D, Texture, WebGLRenderer } from 'three'
import { pendingTasks, reveal, setStage, useLoad } from '../loadProgress'
import { hurryStaged } from './stage'

/* =====================================================================
   SceneReady — decides when the room has earned its reveal.

   Mounted last inside the <Canvas>, under the loader veil (App.tsx).
   From its mount until the reveal it holds R3F's render: the frame
   loop keeps running (every useFrame still ticks, so the camera, the
   lights and anything a builder drives per frame all settle), but
   nothing is drawn, because a positive-priority useFrame subscriber
   tells R3F someone else owns the render. That is the point — a draw
   before the shaders are ready compiles every program synchronously on
   the main thread, which was the multi-second freeze behind the old
   "black screen with the hint".

     build  wait until no critical-path task is pending (loadProgress),
            giving late-mounting props at least two frames to register
     gpu    compileAsync every material in the scene (in parallel on
            the driver where KHR_parallel_shader_compile exists), then
            upload the textures a few per frame
     ready  release the hold, let two real frames render, reveal() on
            the animation frame after that — the veil fades over a room
            that is already drawn

   Two timeouts, counted in visible time. Past HURRY_MS the build stops
   pacing itself (stage.ts hurryStaged: every pending turn runs at once,
   behind the veil) and the steps above carry on — the veil still waits
   for a drawn room. Revealing at that point instead faded the veil over
   an undrawn canvas: seconds of black under the HUD hint on a slow
   machine. Past GIVE_UP_MS more, the veil lifts whatever state the
   warm-up is in, so it can never trap anyone.
   A second visit to the room in the same tab (back from /library) finds
   `revealed` already set and holds nothing.
   ===================================================================== */

/** visible time after which the paced build is finished in one go */
const HURRY_MS = 12000
/** visible time after the hurry when the veil lifts regardless */
const GIVE_UP_MS = 20000
/** after the hurry, a critical-path task with no progress this long is
    stuck: warm up without it */
const STUCK_MS = 5000
/** main-thread budget per frame for texture uploads */
const UPLOAD_BUDGET_MS = 8

/** While mounted, R3F runs every frame callback but skips its render. */
function HoldRender() {
  useFrame(() => {}, 1)
  return null
}

/** stage timings for DevTools' Performance panel / scripted probes */
const mark = (name: string) => {
  try {
    performance.mark(name)
  } catch {
    /* no User Timing — nothing to record */
  }
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

/** Every uploadable texture the scene's materials reference. */
function sceneTextures(scene: Object3D): Texture[] {
  const found = new Set<Texture>()
  const take = (v: unknown) => {
    const t = v as Texture | null
    if (t && t.isTexture && t.image && t.version > 0 && !t.isRenderTargetTexture) found.add(t)
  }
  const fromMaterial = (m: Material) => {
    for (const v of Object.values(m)) take(v)
    const uniforms = (m as Material & { uniforms?: Record<string, { value: unknown }> }).uniforms
    if (uniforms) for (const k in uniforms) take(uniforms[k]?.value)
  }
  scene.traverse((o) => {
    const m = (o as Object3D & { material?: Material | Material[] }).material
    if (!m) return
    if (Array.isArray(m)) m.forEach(fromMaterial)
    else fromMaterial(m)
  })
  return [...found]
}

async function uploadTextures(gl: WebGLRenderer, scene: Object3D, alive: () => boolean) {
  const list = sceneTextures(scene)
  let i = 0
  while (i < list.length) {
    if (!alive()) return
    const t0 = performance.now()
    while (i < list.length && performance.now() - t0 < UPLOAD_BUDGET_MS) gl.initTexture(list[i++])
    await nextFrame()
  }
}

export default function SceneReady() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const [holding, setHolding] = useState(() => !useLoad.getState().revealed)
  /** set once the hold is released; counts frames R3F actually drew */
  const drawn = useRef(-1)

  useEffect(() => {
    if (useLoad.getState().revealed) return
    let alive = true
    let raf = 0
    let polls = 0
    setStage('build')
    mark('load:mounted')

    const release = () => {
      setHolding(false)
      if (drawn.current < 0) drawn.current = 0
    }
    // a tab opened in the background neither paints nor warms up; don't
    // spend the timeouts there, or the visitor arrives to a cold scene
    let hard = 0
    const afterVisible = (ms: number, fn: () => void) => {
      hard = window.setTimeout(() => {
        if (useLoad.getState().revealed) return
        if (document.visibilityState === 'hidden') return afterVisible(ms, fn)
        fn()
      }, ms)
    }
    /** when the hurry's flush returned, and the last task to finish */
    let hurriedAt = 0
    let lastEnded = useLoad.getState().ended
    let lastEndedAt = 0
    const unsubscribe = useLoad.subscribe((s) => {
      if (s.ended === lastEnded) return
      lastEnded = s.ended
      lastEndedAt = performance.now()
    })
    afterVisible(HURRY_MS, () => {
      console.warn('[load] the room is slow to build; finishing it in one go')
      mark('load:hurry')
      hurryStaged()
      hurriedAt = performance.now()
      afterVisible(GIVE_UP_MS, () => {
        console.warn('[load] warm-up overran; revealing anyway')
        mark('load:timeout')
        setHolding(false)
        reveal()
      })
    })

    const warm = async () => {
      setStage('gpu')
      mark('load:gpu')
      try {
        if (typeof gl.compileAsync === 'function') await gl.compileAsync(scene, camera)
        else gl.compile(scene, camera)
        mark('load:compiled')
        await uploadTextures(gl, scene, () => alive)
        mark('load:uploaded')
      } catch (e) {
        console.warn('[load] warm-up skipped', e)
      }
      // a give-up reveal already let go
      if (alive && !useLoad.getState().revealed) release()
    }

    const poll = () => {
      if (!alive || useLoad.getState().revealed) return
      const stuck =
        hurriedAt > 0 && performance.now() - Math.max(hurriedAt, lastEndedAt) > STUCK_MS
      if (++polls < 2 || (pendingTasks() > 0 && !stuck)) {
        raf = requestAnimationFrame(poll)
        return
      }
      void warm()
    }
    raf = requestAnimationFrame(poll)

    return () => {
      alive = false
      cancelAnimationFrame(raf)
      window.clearTimeout(hard)
      unsubscribe()
    }
  }, [gl, scene, camera])

  // after the release: two frames drawn and presented, then reveal
  // (`holding` is this render's value: false only once HoldRender has
  // unmounted, so R3F — or whoever owns the render — draws this frame)
  useFrame(() => {
    if (drawn.current < 0 || holding) return
    // this frame's render follows the callbacks; at the second one, the
    // first drawn frame is on screen and the second is being drawn
    if (++drawn.current === 2) {
      drawn.current = -1
      requestAnimationFrame(() => {
        mark('load:reveal')
        reveal()
      })
    }
  })

  return holding ? <HoldRender /> : null
}
