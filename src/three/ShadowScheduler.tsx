import { useLayoutEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { MeshBasicMaterial, PerspectiveCamera } from 'three'
import type {
  BufferAttribute,
  InstancedMesh,
  Light,
  Material,
  Mesh,
  Object3D,
  Scene,
  SpotLight,
  WebGLRenderer,
} from 'three'
import { useLoad } from '../loadProgress'
import { useSystem } from '../os/store'
import Staged from './Staged'
import { useStagedSteps } from './stage'

/* =====================================================================
   Shadow scheduler — static shadows are drawn once, not sixty times a
   second.

   Two lights cast shadows (the desk lamp and the sun). three re-renders
   every shadow map on every frame by default: one depth draw per caster
   per light, ~340 extra draw calls per frame for a picture that almost
   never changes. This component turns that automatic update off and asks
   for a fresh map only when something that could change the picture did:

     - a caster moved, scaled, appeared or vanished (its world matrix,
       its visibility chain, an instanced mesh's matrices or a
       CPU-deformed geometry changed)
     - a shadow light moved (the sun target drifts with golden hour)
     - a light that was off just came on (its map is stale)

   Detection is generic — it compares world matrices — so a prop that is
   animated tomorrow needs no wiring. Updates are capped at 30 Hz while
   something moves; nothing at all is rendered while everything is still,
   and nothing while the CRT fills the screen (the depth passes cannot be
   seen from there). Lights whose intensity is ~0 are skipped entirely
   and refreshed when they wake.

   Tiny casters (screws, legends, knobs…) contribute no readable shadow,
   so they are dropped from the depth pass once, at the first scan.
   ===================================================================== */

/** casters with a world bounding radius under this stop casting (metres) */
const MIN_CASTER_RADIUS = 0.022
/** silhouette movement (metres) that is worth a new shadow map */
const MOVE_EPS = 0.002
/** shortest gap between two shadow renders while things move */
const MIN_INTERVAL = 1 / 30
/** frames between re-scans for meshes/lights that mounted later */
const RESCAN_EVERY = 45

interface Tracked {
  mesh: Mesh
  /** world bounding radius (metres) */
  radius: number
  /** last drawn: 16 matrix elements, visibility, instance/geometry versions */
  sig: Float64Array
}

interface ShadowLight {
  light: SpotLight
  sig: Float64Array
  lit: boolean
  stale: boolean
}

/** 1 when the object and every ancestor is visible AND it is still in the
    scene (an unmounted mesh keeps its parent chain cut and, in R3F, loses
    its geometry — it must read as "not casting", never throw). */
function visibleChain(o: Object3D): number {
  let p: Object3D | null = o
  let top: Object3D = o
  for (; p; p = p.parent) {
    if (!p.visible) return 0
    top = p
  }
  return (top as Scene).isScene ? 1 : 0
}

/** bounding-sphere radius in world units (0 for an empty geometry) */
function worldRadius(m: Mesh): number {
  const g = m.geometry
  if (!g) return 0
  if (!g.boundingSphere) g.computeBoundingSphere()
  if (!g.boundingSphere) return 0
  m.updateWorldMatrix(true, false) // first frame: nothing has been drawn yet
  const e = m.matrixWorld.elements
  const sc = Math.max(
    Math.hypot(e[0], e[1], e[2]),
    Math.hypot(e[4], e[5], e[6]),
    Math.hypot(e[8], e[9], e[10]),
  )
  return g.boundingSphere.radius * sc
}

function versionOf(m: Mesh): number {
  let v = 0
  const inst = m as InstancedMesh
  if (inst.isInstancedMesh) {
    v += inst.instanceMatrix.version
    v += inst.count * 0.001 // a changed count changes the picture too
  }
  const pos = m.geometry?.getAttribute('position') as BufferAttribute | undefined
  if (pos) v += pos.version
  return v
}

interface Sched {
  casters: Tracked[]
  lights: ShadowLight[]
  frame: number
  last: number
  pending: boolean
  trimmed: WeakSet<Mesh>
  key: string
}

function createSched(): Sched {
  return {
    casters: [],
    lights: [],
    frame: 0,
    last: -1,
    pending: true,
    trimmed: new WeakSet<Mesh>(),
    key: '',
  }
}

/** (re)collect casters and shadow lights from the scene graph */
function rescan(s: Sched, scene: Scene): void {
  const casters: Mesh[] = []
  const lights: SpotLight[] = []
  scene.traverse((o) => {
    if ((o as Mesh).isMesh && o.castShadow) casters.push(o as Mesh)
    else if ((o as Light).isLight && o.castShadow) lights.push(o as SpotLight)
  })

  // drop the tiny ones once (never instanced meshes: one draw for all)
  for (const m of casters) {
    if (s.trimmed.has(m)) continue
    s.trimmed.add(m)
    if ((m as InstancedMesh).isInstancedMesh) continue
    const r = worldRadius(m)
    if (r > 0 && r < MIN_CASTER_RADIUS) m.castShadow = false
  }
  const kept = casters.filter((m) => m.castShadow)

  const key = kept.map((m) => m.id).join(',')
  if (key !== s.key) {
    s.key = key
    s.casters = kept.map((mesh) => ({
      mesh,
      radius: worldRadius(mesh),
      sig: new Float64Array(19).fill(NaN),
    }))
    s.pending = true
  }

  // take over any new shadow light
  for (const light of lights) {
    if (s.lights.some((l) => l.light === light)) continue
    light.shadow.autoUpdate = false
    light.shadow.needsUpdate = true
    s.lights.push({ light, sig: new Float64Array(32).fill(NaN), lit: true, stale: false })
  }
}

/** has any caster or light moved enough to need a new depth pass? */
function detectChange(s: Sched): boolean {
  let changed = false
  for (const t of s.casters) {
    const m = t.mesh
    const e = m.matrixWorld.elements
    const sig = t.sig
    /* how far has the shape's silhouette moved since the pose we last
       drew? translation plus the rotation/scale of the three axes
       reaching out to the bounding radius. Sub-2 mm idle sway (the duck,
       a swinging cord) never asks for a redraw, but accumulates: the
       pose only advances when a redraw is due. */
    let dr = 0
    for (let k = 0; k < 11; k++) if (k !== 3 && k !== 7) dr += Math.abs(e[k] - sig[k])
    const move =
      Math.abs(e[12] - sig[12]) +
      Math.abs(e[13] - sig[13]) +
      Math.abs(e[14] - sig[14]) +
      (t.radius * dr) / 3
    if (!(move <= MOVE_EPS)) {
      for (let k = 0; k < 16; k++) sig[k] = e[k]
      changed = true
    }
    const vis = visibleChain(m)
    if (sig[16] !== vis) {
      sig[16] = vis
      changed = true
    }
    const ver = versionOf(m)
    if (sig[17] !== ver) {
      sig[17] = ver
      changed = true
    }
  }
  for (const l of s.lights) {
    const a = l.light.matrixWorld.elements
    const b = l.light.target.matrixWorld.elements
    for (let k = 0; k < 16; k++) {
      if (l.sig[k] !== a[k]) {
        l.sig[k] = a[k]
        changed = true
      }
      if (l.sig[16 + k] !== b[k]) {
        l.sig[16 + k] = b[k]
        changed = true
      }
    }
  }
  return changed
}

/** one frame of scheduling; returns nothing, flips shadow.needsUpdate */
function tickSched(s: Sched, scene: Scene, now: number, away: boolean): void {
  if (s.frame++ % RESCAN_EVERY === 0) rescan(s, scene)

  if (detectChange(s)) s.pending = true
  if (away) return

  // wake a light that was off: its map is stale
  for (const l of s.lights) {
    const lit = l.light.intensity > 0.01
    if (lit && !l.lit) l.stale = true
    l.lit = lit
  }

  const wake = s.lights.some((l) => l.stale && l.lit)
  if ((s.pending || wake) && (wake || now - s.last >= MIN_INTERVAL)) {
    for (const l of s.lights) {
      if (!l.lit) {
        l.stale = true // refresh when it wakes
        continue
      }
      l.light.shadow.needsUpdate = true
      l.stale = false
    }
    s.pending = false
    s.last = now
  }
}

/* ---------------------------------------------------------------------
   First load: warm the shadow pass one program at a time.

   The first draw of the shadow maps compiles a depth program for every
   kind of caster (instanced or not, which side casts, alpha-tested, a
   custom depth material…), about ten, synchronously, in whichever frame
   draws shadows first — that was a single 150–700 ms freeze at the end
   of the load. Here, behind the veil, each kind is drawn into the
   shadow maps on its own, one per turn of the staged build (stage.ts),
   through a camera that sees nothing (so the main pass draws nothing),
   and the maps are then flagged for a full redraw with every caster:
   same pictures, the compile cost spread thin.
   --------------------------------------------------------------------- */

/** what decides a caster's shadow depth program */
function depthKind(m: Mesh): string {
  const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as Material & {
    map?: unknown
    alphaMap?: unknown
    displacementMap?: unknown
  }
  const cut = mat.alphaTest > 0 && (mat.map || mat.alphaMap) ? mat.uuid : ''
  return [
    (m as InstancedMesh).isInstancedMesh ? 'i' : '',
    m.morphTargetInfluences ? 'm' : '',
    mat.side,
    mat.shadowSide,
    cut,
    mat.displacementMap ? 'd' : '',
    mat.alphaToCoverage ? 'a' : '',
    m.customDepthMaterial?.uuid ?? '',
  ].join('|')
}

function* warmShadowPass(gl: WebGLRenderer, scene: Scene): Generator<void, boolean, void> {
  if (useLoad.getState().revealed) return false
  const casters: Mesh[] = []
  const lights: SpotLight[] = []
  scene.traverse((o) => {
    if ((o as Mesh).isMesh && o.castShadow) casters.push(o as Mesh)
    else if ((o as Light).isLight && o.castShadow) lights.push(o as SpotLight)
  })
  if (!lights.length || !casters.length) return false
  const kinds = new Map<string, Set<Mesh>>()
  for (const m of casters) {
    const k = depthKind(m)
    if (!kinds.has(k)) kinds.set(k, new Set())
    kinds.get(k)!.add(m)
  }
  // a camera far below the floor looking down: its main pass culls
  // everything; what is never culled draws into nothing
  const blind = new PerspectiveCamera(1, 1, 0.001, 0.002)
  blind.position.set(0, -1000, 0)
  blind.lookAt(0, -2000, 0)
  blind.updateMatrixWorld()
  const nothing = new MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false })
  for (const group of kinds.values()) {
    yield
    if (useLoad.getState().revealed) break
    const muted: Mesh[] = []
    for (const m of casters) {
      if (m.castShadow && !group.has(m)) {
        m.castShadow = false
        muted.push(m)
      }
    }
    for (const l of lights) l.shadow.needsUpdate = true
    const prev = scene.overrideMaterial
    scene.overrideMaterial = nothing
    try {
      gl.render(scene, blind)
    } finally {
      scene.overrideMaterial = prev
      for (const m of muted) m.castShadow = true
    }
  }
  nothing.dispose()
  // the maps hold one kind each now: redraw them whole at the next draw
  for (const l of lights) l.shadow.needsUpdate = true
  return true
}

function ShadowSchedulerBody() {
  const sched = useRef<Sched | null>(null)
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  useStagedSteps('shadows.warm', () => warmShadowPass(gl, scene))

  useLayoutEffect(() => {
    const s = createSched()
    sched.current = s
    return () => {
      for (const l of s.lights) l.light.shadow.autoUpdate = true
      sched.current = null
    }
  }, [])

  useFrame(({ scene, clock }) => {
    const s = sched.current
    if (!s) return
    // nothing is visible while the CRT fills the screen
    const away = useSystem.getState().view === 'screen'
    tickSched(s, scene, clock.elapsedTime, away)
  })

  return null
}

/* first load: mounted after every other turn of the staged build
   (stage.ts), so it is still the last frame callback and its first
   scan sees the whole room */
export default function ShadowScheduler() {
  return (
    <Staged id="shadows" last>
      <ShadowSchedulerBody />
    </Staged>
  )
}
