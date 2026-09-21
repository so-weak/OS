import { useEffect, useMemo } from 'react'
import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/* =====================================================================
   A pair of Crocs, kicked off under the desk.

   Lime-green clogs: a thick moulded sole with a rolled lip, a domed toe
   box with a ring of ventilation holes, an open collar with a darker
   footbed, the heel strap swung back over the heel, and three jibbitz
   charms (a star, a heart and a disc) in the toe-box holes.

   The whole pair is ONE merged geometry with vertex colours: a single
   draw call, nothing coplanar (the flip-flops they replace glitched
   against the contact-shadow plane at y = 0.008), so the soles rest
   at 0.0088 — just above it — and the mesh only casts shadows.

   Shoe local frame: toe toward +x, up +y, width along z, sole bottom y=0.
   ===================================================================== */

const LF = 0.15 // toe end
const LR = 0.12 // heel end
const BF = 0.056 // half width across the toe box
const BR = 0.046 // half width at the heel
const TS = 0.026 // sole thickness

const GREEN = new Color('#86dd3a')
const GREEN_SOLE = new Color('#6cc12a')
const GREEN_INNER = new Color('#3f7a1c')
const HOLE = new Color('#0e1a08')

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Half width of the foot outline at x (a superellipse per end). */
function halfW(x: number): number {
  if (x >= 0) {
    const t = Math.min(1, x / LF)
    return BF * Math.pow(Math.max(0, 1 - Math.pow(t, 2.4)), 1 / 2.4)
  }
  const t = Math.min(1, -x / LR)
  return BR * Math.pow(Math.max(0, 1 - Math.pow(t, 2.2)), 1 / 2.2)
}

/** Height of the upper's crown along the length (before the side roll-off). */
function envelope(x: number): number {
  const H_TOE = 0.064
  const H_HEEL = 0.042
  const base = H_HEEL + (H_TOE - H_HEEL) * smooth(-0.03, 0.07, x)
  const capF = x > 0 ? Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, x / LF), 2.4)), 0.42) : 1
  const capR = x < 0 ? Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, -x / LR), 3)), 0.5) : 1
  return base * capF * capR
}

const XC = -0.03 // centre of the foot opening
const AX = 0.07
const AU = 0.62
const FOOTBED = 0.007

/** Upper surface height above the sole top at (x, u), u in [-1, 1] across. */
function height(x: number, u: number): number {
  const e = envelope(x) * Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(u), 2.6)))
  const d = ((x - XC) / AX) ** 2 + (u / AU) ** 2
  if (d >= 1) return e
  const k = smooth(0.7, 1, d)
  return FOOTBED + (Math.max(e, FOOTBED) - FOOTBED) * k
}

/** Depth of "inside the opening" at (x, u): 0 outside, 1 deep inside. */
function inner(x: number, u: number): number {
  const d = ((x - XC) / AX) ** 2 + (u / AU) ** 2
  return 1 - smooth(0.5, 0.82, d)
}

/** Strip the attributes the merge does not need and pin the colour. */
function tidy(g: BufferGeometry, color: Color | null): BufferGeometry {
  let out = g.index ? g.toNonIndexed() : g
  out.deleteAttribute('uv')
  if (color) {
    const n = out.getAttribute('position').count
    const arr = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      arr[i * 3] = color.r
      arr[i * 3 + 1] = color.g
      arr[i * 3 + 2] = color.b
    }
    out.setAttribute('color', new Float32BufferAttribute(arr, 3))
  }
  if (out === g) out = g.clone()
  return out
}

/** The rolled sole: an extruded foot outline with a soft bevel. */
function soleGeometry(): BufferGeometry {
  const N = 44
  const shape = new Shape()
  const xs: number[] = []
  for (let i = 0; i <= N; i++) xs.push(-LR + ((LR + LF) * i) / N)
  shape.moveTo(xs[0], 0)
  for (let i = 1; i < N; i++) shape.lineTo(xs[i], halfW(xs[i]))
  shape.lineTo(xs[N], 0)
  for (let i = N - 1; i > 0; i--) shape.lineTo(xs[i], -halfW(xs[i]))
  shape.closePath()
  const g = new ExtrudeGeometry(shape, {
    depth: TS - 0.006,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.003,
    bevelSegments: 2,
    curveSegments: 1,
  })
  g.rotateX(-Math.PI / 2)
  g.translate(0, 0.003, 0)
  return tidy(g, GREEN_SOLE)
}

/** The upper: a lofted height field over the foot outline, with the
    foot opening carved into it and the footbed darkened. */
function upperGeometry(): BufferGeometry {
  const NX = 56
  const NZ = 28
  const pos: number[] = []
  const col: number[] = []
  const tmp = new Color()
  for (let i = 0; i <= NX; i++) {
    const x = -LR + ((LR + LF) * i) / NX
    const w = halfW(x)
    for (let j = 0; j <= NZ; j++) {
      const u = -1 + (2 * j) / NZ
      pos.push(x, TS + height(x, u), u * w)
      tmp.copy(GREEN).lerp(GREEN_INNER, inner(x, u))
      col.push(tmp.r, tmp.g, tmp.b)
    }
  }
  const idx: number[] = []
  for (let i = 0; i < NX; i++) {
    for (let j = 0; j < NZ; j++) {
      const a = i * (NZ + 1) + j
      const b = (i + 1) * (NZ + 1) + j
      const c = i * (NZ + 1) + j + 1
      const d = (i + 1) * (NZ + 1) + j + 1
      idx.push(a, c, b, b, c, d)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return tidy(g, null)
}

/** World point and outward normal on the upper at (x, u). */
function surface(x: number, u: number): { p: Vector3; n: Vector3 } {
  const w = Math.max(halfW(x), 1e-4)
  const e = 1e-3
  const y = TS + height(x, u)
  const dydx = (height(x + e, u) - height(x - e, u)) / (2 * e)
  const dydu = (height(x, u + e) - height(x, u - e)) / (2 * e)
  const n = new Vector3(-dydx, 1, -dydu / w).normalize()
  return { p: new Vector3(x, y, u * w), n }
}

/** A flattened part standing on the surface: local +z is the outward normal. */
function onSurface(g: BufferGeometry, x: number, u: number, lift: number): BufferGeometry {
  const { p, n } = surface(x, u)
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), n)
  const m = new Matrix4().compose(p.clone().addScaledVector(n, lift), q, new Vector3(1, 1, 1))
  g.applyMatrix4(m)
  return g
}

function starShape(): Shape {
  const s = new Shape()
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2
    const r = i % 2 === 0 ? 0.0085 : 0.0038
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r)
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  s.closePath()
  return s
}

function heartShape(): Shape {
  const s = new Shape()
  const k = 0.0007
  s.moveTo(0, -6 * k)
  s.bezierCurveTo(-3 * k, -3 * k, -8 * k, 0, -8 * k, 3.5 * k)
  s.bezierCurveTo(-8 * k, 7 * k, -3 * k, 8 * k, 0, 4.5 * k)
  s.bezierCurveTo(3 * k, 8 * k, 8 * k, 7 * k, 8 * k, 3.5 * k)
  s.bezierCurveTo(8 * k, 0, 3 * k, -3 * k, 0, -6 * k)
  return s
}

/** One shoe. `side` flips the charms so the pair is not a copy. */
function shoeGeometry(side: 1 | -1): BufferGeometry {
  const parts: BufferGeometry[] = [soleGeometry(), upperGeometry()]

  // ventilation holes: dark, flattened, half sunk into the toe box
  const holes: [number, number][] = [
    [0.06, -0.58], [0.06, 0.58], [0.085, -0.3], [0.085, 0.3],
    [0.108, 0], [0.108, -0.55], [0.108, 0.55], [0.13, -0.28], [0.13, 0.28],
    [-0.095, -0.86], [-0.095, 0.86], [0.02, -0.9], [0.02, 0.9],
  ]
  for (const [x, u] of holes) {
    const d = ((x - XC) / AX) ** 2 + (u / AU) ** 2
    if (d < 1.25) continue // never inside the opening
    const g = new SphereGeometry(0.0062, 8, 6)
    g.scale(1, 1, 0.3)
    parts.push(tidy(onSurface(g, x, u, -0.0004), HOLE))
  }

  // jibbitz charms
  const charm = (shape: Shape | null, color: string, x: number, u: number): BufferGeometry => {
    const g = shape
      ? new ExtrudeGeometry(shape, { depth: 0.004, bevelEnabled: false, curveSegments: 6 })
      : new CylinderGeometry(0.0064, 0.0064, 0.004, 14).rotateX(Math.PI / 2)
    return tidy(onSurface(g, x, u * side, 0.0012), new Color(color))
  }
  parts.push(charm(starShape(), '#ffd23f', 0.085, -0.3))
  parts.push(charm(heartShape(), '#ff4fa3', 0.108, 0))
  parts.push(charm(null, '#35a7ff', 0.13, 0.28))

  // the heel strap, swung back over the heel
  const strap = new TorusGeometry(0.041, 0.0042, 6, 24, Math.PI)
  strap.rotateY(Math.PI / 2)
  strap.scale(2.6, 1, 1)
  strap.rotateZ(1.2)
  strap.translate(-0.055, TS + 0.026, 0)
  parts.push(tidy(strap, GREEN))

  const merged = mergeGeometries(parts, false)
  parts.forEach((p) => p.dispose())
  return merged
}

/** The pair, kicked off at angles to each other, sole bottoms at y = 0. */
function pairGeometry(): BufferGeometry {
  const a = shoeGeometry(1)
  a.applyMatrix4(
    new Matrix4().makeTranslation(0, 0, -0.07).multiply(new Matrix4().makeRotationY(0.5)),
  )
  const b = shoeGeometry(-1)
  b.applyMatrix4(
    new Matrix4().makeTranslation(0.03, 0, 0.09).multiply(new Matrix4().makeRotationY(-0.28)),
  )
  const merged = mergeGeometries([a, b], false)
  a.dispose()
  b.dispose()
  return merged
}

export default function Crocs({ position }: { position: [number, number, number] }) {
  const g = useMemo(() => pairGeometry(), [])
  useEffect(() => () => g.dispose(), [g])
  return (
    <mesh geometry={g} position={[position[0], 0.0088, position[2]]} castShadow>
      <meshStandardMaterial vertexColors roughness={0.5} />
    </mesh>
  )
}
