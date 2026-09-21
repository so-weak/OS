import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  MathUtils,
  Vector3,
  type Group,
  type Mesh,
} from 'three'
import { useSystem } from '../os/store'
import { DESK_TOP } from './layout'
import { makeCanvas, makeSoftCircle } from './textures'
import { fabricMaps } from './tex/noise'
import {
  decalTex,
  knurlGeometry,
  lathe,
  mergeParts,
  orientOutward,
  part,
  sharedPlastic,
  roundedSlab,
  smooth,
  type V3,
} from './tex/electronics'

/** The mouse lives on render layer 1: the desk's baked ContactShadows
    (a layer-0 ortho camera) must not freeze a blob at its rest position
    while the live mouse glides away. The main camera and the lamp's
    shadow camera enable layer 1 (Lamp.tsx); its own shadow travels with
    it as a soft dark disc. */
export const MOUSE_LAYER = 1

/* =====================================================================
   The beige two-button mouse, alive on its pad: in room view it glides
   around mirroring YOUR cursor (clamped to the pad), with a little yaw
   into the direction of travel. When you zoom into the screen it drifts
   politely back to rest. Rendered desk-local (inside the Desk group).

   The body is a parametric superellipse dome cut into patches — palm,
   two buttons, side walls — with real 1 mm gaps over a dark inner shell,
   a knurled scroll wheel in a notch, and a strain-relieved braided cable
   that lies on the pad, drapes over its edge and runs to the desk
   grommet. The cable is re-solved every frame from the mouse's pose.
   ===================================================================== */

const LIM_X = 0.072 // pad-local travel limits
const LIM_Z = 0.056
const PAD_W = 0.24
const PAD_D = 0.2
const PAD_TOP = 0.0052

/* where the cable goes: the second cable grommet in the desk (desk-local) */
const GROMMET_DESK: [number, number] = [0.25, -0.3]
const POS: [number, number, number] = [0.42, DESK_TOP, 0.16]
const YAW = -0.12

/** grommet in pad-frame coordinates (the pad group is at POS, turned by YAW) */
const GROMMET: [number, number] = (() => {
  const dx = GROMMET_DESK[0] - POS[0]
  const dz = GROMMET_DESK[1] - POS[2]
  const c = Math.cos(-YAW)
  const s = Math.sin(-YAW)
  return [dx * c + dz * s, -dx * s + dz * c]
})()

/* ---------------------------------------------------------------------
   The body surface: u front(0) -> back(1), theta 0..pi across the top
   --------------------------------------------------------------------- */
const M = {
  zf: -0.0525,
  len: 0.105,
  w0: 0.0305,
  hMax: 0.0335,
  hFront: 0.0125,
  hBack: 0.012,
  uW: 0.6,
  uH: 0.62,
  n: 2.6,
  skirt: 0.0007,
}

function planW(u: number): number {
  const front = u < M.uW
  const a = Math.abs(u - M.uW) / (front ? M.uW : 1 - M.uW)
  const p = front ? 3.2 : 2.5
  return M.w0 * Math.pow(Math.max(0, 1 - Math.pow(a, p)), 1 / p)
}

function height(u: number): number {
  if (u < M.uH) {
    const t = u / M.uH
    return M.hFront + (M.hMax - M.hFront) * Math.pow(Math.sin((t * Math.PI) / 2), 1.4)
  }
  const t = (u - M.uH) / (1 - M.uH)
  return M.hBack + (M.hMax - M.hBack) * Math.pow(Math.cos((t * Math.PI) / 2), 1.3)
}

function surf(u: number, th: number, inset = 0): V3 {
  const w0 = planW(u)
  const w = Math.max(0, w0 - inset)
  // the dome sinks to the pad as the outline closes: nose and tail end in points, not knife edges
  const h = Math.max(M.skirt, M.skirt + (height(u) - M.skirt) * Math.pow(w0 / M.w0, 0.5) - inset)
  const c = Math.cos(th)
  const s = Math.sin(th)
  const e = 2 / M.n
  return [
    w * Math.sign(c) * Math.pow(Math.abs(c), e),
    M.skirt + (h - M.skirt) * Math.pow(Math.abs(s), e),
    M.zf + u * M.len,
  ]
}

/** Analytic outward normal of the body surface at (u, theta): smooth
    shading however coarse the grid, and continuous across patches. */
function surfNormal(u: number, th: number, inset: number): V3 {
  const d = 0.002
  const a = surf(Math.min(1, u + d), th, inset)
  const b = surf(Math.max(0, u - d), th, inset)
  const c = surf(u, th + d, inset)
  const e = surf(u, th - d, inset)
  const tu = [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
  const tt = [c[0] - e[0], c[1] - e[1], c[2] - e[2]]
  let nx = tu[1] * tt[2] - tu[2] * tt[1]
  let ny = tu[2] * tt[0] - tu[0] * tt[2]
  let nz = tu[0] * tt[1] - tu[1] * tt[0]
  const p = surf(u, th, inset)
  if (nx * p[0] + ny * (p[1] - 0.012) + nz * (p[2] - (M.zf + M.len * 0.5)) < 0) {
    nx = -nx
    ny = -ny
    nz = -nz
  }
  const l = Math.hypot(nx, ny, nz)
  return l < 1e-12 ? [Math.sign(p[0]), 0.2, 0] : [nx / l, ny / l, nz / l]
}

/** An (u, theta) grid patch; `thFn` gives the theta range at each u. */
function patch(
  uA: number,
  uB: number,
  thFn: (u: number) => [number, number],
  nu: number,
  nt: number,
  inset = 0,
): BufferGeometry {
  const pos = new Float32Array((nu + 1) * (nt + 1) * 3)
  const nor = new Float32Array((nu + 1) * (nt + 1) * 3)
  const idx: number[] = []
  for (let i = 0; i <= nu; i++) {
    // cosine spacing: fine steps where the outline turns sharply (nose and tail)
    const t = i / nu
    const e = 0.5 - 0.5 * Math.cos(Math.PI * t)
    const u = Math.min(1 - 1e-5, Math.max(1e-5, uA + (uB - uA) * e))
    const [t0, t1] = thFn(u)
    for (let j = 0; j <= nt; j++) {
      const th = t0 + ((t1 - t0) * j) / nt
      pos.set(surf(u, th, inset), (i * (nt + 1) + j) * 3)
      nor.set(surfNormal(u, th, inset), (i * (nt + 1) + j) * 3)
    }
  }
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nt; j++) {
      const a = i * (nt + 1) + j
      idx.push(a, a + 1, a + nt + 1, a + 1, a + nt + 2, a + nt + 1)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setAttribute('normal', new BufferAttribute(nor, 3))
  g.setIndex(idx)
  return orientOutward(g, 0, 0.012, M.zf + M.len * 0.5)
}

const TH_WALL = 0.5236 // where the side walls end and the buttons start

/** half-gap between the buttons: 0.5 mm, opening up around the wheel */
function gap(u: number): number {
  return 0.007 + 0.068 * smooth(0.1, 0.14, u) * (1 - smooth(0.27, 0.31, u))
}

function buildMouse(): BufferGeometry {
  const parts: BufferGeometry[] = []
  const add = (g: BufferGeometry, color: string, tile = 0.03) =>
    parts.push(part(g, { color, crease: false, tile }))
  const UB = 0.4
  const beige = '#cfc7b1'
  const key = '#d8d0bb'
  const full = (): [number, number] => [0, Math.PI]

  // dark inner shell shows through the gaps
  add(patch(0.02, 0.5, full, 16, 16, 0.0012), '#1a1918')
  // palm, side walls, nose
  add(patch(UB + 0.008, 1, full, 30, 28), beige)
  add(patch(0, UB + 0.008, () => [0, TH_WALL], 14, 4), beige)
  add(patch(0, UB + 0.008, () => [Math.PI - TH_WALL, Math.PI], 14, 4), beige)
  add(patch(0, 0.018, () => [TH_WALL, Math.PI - TH_WALL], 6, 12), beige)
  // the two buttons
  add(patch(0.022, UB - 0.004, (u) => [TH_WALL + 0.03, Math.PI / 2 - gap(u)], 18, 8), key)
  add(patch(0.022, UB - 0.004, (u) => [Math.PI / 2 + gap(u), Math.PI - TH_WALL - 0.03], 18, 8), key)

  // scroll wheel, sunk in the notch
  const wheel = knurlGeometry(0.0085, 0.0052, 26, 0.0006)
  wheel.translate(0, 0, -0.0026)
  wheel.rotateY(Math.PI / 2)
  const uw = 0.205
  parts.push(part(wheel, { pos: [0, height(uw) + 0.0027 - 0.0085, M.zf + uw * M.len], color: '#2a2a2c', crease: 0.9, tile: 0.02 }))

  // strain-relief boot at the nose
  const boot = lathe(
    [
      [0.0001, -0.006],
      [0.0052, -0.006],
      [0.0052, 0],
      [0.0044, 0.008],
      [0.0034, 0.016],
      [0.0033, 0.0165],
      [0.0001, 0.0165],
    ],
    14,
  )
  boot.rotateX(-Math.PI / 2)
  parts.push(part(boot, { pos: [0, 0.0105, M.zf + 0.004], color: '#18181a', tile: 0.02 }))
  return mergeParts(parts)
}

/* ---------------------------------------------------------------------
   The pad: rubber base, woven top, stitched border
   --------------------------------------------------------------------- */
function buildPad() {
  const flat = -Math.PI / 2
  const base = part(roundedSlab(PAD_W, PAD_D, 0.0034, 0.014, 0.0011, 3), {
    pos: [0, 0.0017, 0],
    rot: [flat, 0, 0],
    color: '#141616',
    tile: 0.03,
  })
  const top = part(roundedSlab(PAD_W - 0.0008, PAD_D - 0.0008, 0.0018, 0.0136, 0.0007, 3), {
    pos: [0, PAD_TOP - 0.0009, 0],
    rot: [flat, 0, 0],
    color: '#ffffff',
    tile: 0.022,
  })
  return { base, top }
}

function stitchDecal() {
  const W = 512
  const H = Math.round((W * (PAD_D - 0.008)) / (PAD_W - 0.008))
  const ctx = makeCanvas(W, H)
  ctx.clearRect(0, 0, W, H)
  ctx.setLineDash([7, 5])
  ctx.lineWidth = 2.5
  ctx.lineCap = 'round'
  ctx.strokeStyle = '#5d9184'
  const m = 11
  const r = 20
  ctx.beginPath()
  ctx.roundRect(m, m, W - 2 * m, H - 2 * m, r)
  ctx.stroke()
  ctx.setLineDash([])
  return decalTex(ctx, 8)
}

/* ---------------------------------------------------------------------
   The cable: a tube solved every frame
   --------------------------------------------------------------------- */
const CN = 58 // samples along the cable
const CR = 7 // vertices around (the seam repeats)
const CABLE_R = 0.0021
const N_BEZIER = 46

function buildCableGeometry(): BufferGeometry {
  const g = new BufferGeometry()
  const pos = new Float32Array(CN * CR * 3)
  const nor = new Float32Array(CN * CR * 3)
  const uv = new Float32Array(CN * CR * 2)
  const idx: number[] = []
  for (let i = 0; i < CN - 1; i++) {
    for (let j = 0; j < CR - 1; j++) {
      const a = i * CR + j
      idx.push(a, a + CR, a + 1, a + 1, a + CR, a + CR + 1)
    }
  }
  const pa = new BufferAttribute(pos, 3)
  const na = new BufferAttribute(nor, 3)
  pa.setUsage(DynamicDrawUsage)
  na.setUsage(DynamicDrawUsage)
  g.setAttribute('position', pa)
  g.setAttribute('normal', na)
  g.setAttribute('uv', new BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.boundingSphere = null
  return g
}

const _pts = Array.from({ length: CN }, () => new Vector3())
const _t = new Vector3()
const _n = new Vector3()
const _b = new Vector3()
const _up = new Vector3(0, 1, 0)
const _A = new Vector3()
const _P1 = new Vector3()
const _P2 = new Vector3()
const _B = new Vector3()

/** height of whatever the cable rests on at pad-frame (x, z): the pad, or the desk */
function ground(x: number, z: number): number {
  const d = Math.max(Math.abs(x) - (PAD_W / 2 - 0.004), Math.abs(z) - (PAD_D / 2 - 0.004))
  return PAD_TOP * (1 - smooth(0, 0.016, d))
}

/** Lay the cable from the boot (A, heading dA) to the grommet. */
function solveCable(
  geo: BufferGeometry,
  ax: number,
  ay: number,
  az: number,
  dx: number,
  dz: number,
): void {
  _A.set(ax, ay, az)
  _B.set(GROMMET[0], CABLE_R, GROMMET[1])
  _P1.set(ax + dx * 0.11, 0, az + dz * 0.11)
  // arrive at the grommet from the pad side, a little from the right
  _P2.set(_B.x + 0.05, 0, _B.z + 0.17)
  let arc = 0
  for (let i = 0; i < N_BEZIER; i++) {
    const t = i / (N_BEZIER - 1)
    const k = 1 - t
    const w0 = k * k * k
    const w1 = 3 * k * k * t
    const w2 = 3 * k * t * t
    const w3 = t * t * t
    const x = w0 * _A.x + w1 * _P1.x + w2 * _P2.x + w3 * _B.x
    const z = w0 * _A.z + w1 * _P1.z + w2 * _P2.z + w3 * _B.z
    if (i > 0) arc += Math.hypot(x - _pts[i - 1].x, z - _pts[i - 1].z)
    // rides up out of the boot, then settles onto whatever is under it
    const settle = smooth(0, 0.1, arc)
    const y = MathUtils.lerp(ay, CABLE_R + ground(x, z), settle)
    _pts[i].set(x, y, z)
  }
  // the last stretch dives through the grommet
  for (let i = N_BEZIER; i < CN; i++) {
    const k = (i - N_BEZIER + 1) / (CN - N_BEZIER)
    _pts[i].set(_B.x, CABLE_R - k * 0.05, _B.z - 0.002 * k)
  }
  // frames + tube
  const pos = geo.attributes.position as BufferAttribute
  const nor = geo.attributes.normal as BufferAttribute
  const uv = geo.attributes.uv as BufferAttribute
  let along = 0
  for (let i = 0; i < CN; i++) {
    const a = _pts[Math.max(0, i - 1)]
    const b = _pts[Math.min(CN - 1, i + 1)]
    _t.subVectors(b, a).normalize()
    _n.crossVectors(_up, _t)
    if (_n.lengthSq() < 1e-6) _n.set(1, 0, 0)
    _n.normalize()
    _b.crossVectors(_t, _n)
    if (i > 0) along += _pts[i].distanceTo(_pts[i - 1])
    for (let j = 0; j < CR; j++) {
      const ph = (j / (CR - 1)) * Math.PI * 2
      const cx = Math.cos(ph)
      const sy = Math.sin(ph)
      const nx = _n.x * cx + _b.x * sy
      const ny = _n.y * cx + _b.y * sy
      const nz = _n.z * cx + _b.z * sy
      const v = i * CR + j
      pos.setXYZ(v, _pts[i].x + nx * CABLE_R, _pts[i].y + ny * CABLE_R, _pts[i].z + nz * CABLE_R)
      nor.setXYZ(v, nx, ny, nz)
      uv.setXY(v, along / 0.014, j / (CR - 1))
    }
  }
  pos.needsUpdate = true
  nor.needsUpdate = true
  uv.needsUpdate = true
}

export default function Mouse() {
  const body = useRef<Group>(null!)
  const cable = useRef<Mesh>(null!)
  const prevX = useRef(0)
  const camera = useThree((s) => s.camera)
  const shadowTex = useMemo(() => makeSoftCircle(), [])
  const mouseGeo = useMemo(() => buildMouse(), [])
  const pad = useMemo(() => buildPad(), [])
  const stitch = useMemo(() => stitchDecal(), [])
  const plastic = useMemo(() => sharedPlastic(), [])
  const fabric = useMemo(() => {
    const f = fabricMaps(9, 256, 1, 24)
    f.heightMap.dispose()
    return f
  }, [])
  const braid = useMemo(() => {
    const f = fabricMaps(3, 128, 1, 8)
    f.heightMap.dispose()
    return f
  }, [])
  const cableGeo = useMemo(() => buildCableGeometry(), [])
  useEffect(
    () => () => {
      shadowTex.dispose()
      mouseGeo.dispose()
      pad.base.dispose()
      pad.top.dispose()
      stitch.dispose()
      plastic.dispose()
      fabric.dispose()
      braid.dispose()
      cableGeo.dispose()
    },
    [shadowTex, mouseGeo, pad, stitch, plastic, fabric, braid, cableGeo],
  )

  useLayoutEffect(() => {
    camera.layers.enable(MOUSE_LAYER)
    body.current.traverse((o) => o.layers.set(MOUSE_LAYER))
    cable.current.layers.set(MOUSE_LAYER)
  }, [camera])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const inRoom = useSystem.getState().view === 'room'
    const tx = inRoom
      ? MathUtils.clamp(state.pointer.x, -1, 1) * LIM_X
      : 0.01
    const tz = inRoom
      ? MathUtils.clamp(-state.pointer.y, -1, 1) * LIM_Z
      : 0.015

    const g = body.current
    g.position.x = MathUtils.damp(g.position.x, tx, 7, dt)
    g.position.z = MathUtils.damp(g.position.z, tz, 7, dt)

    // lean into the direction of travel
    const vx = (g.position.x - prevX.current) / Math.max(dt, 1e-4)
    prevX.current = g.position.x
    g.rotation.y = MathUtils.damp(
      g.rotation.y,
      0.18 - MathUtils.clamp(vx * 2.4, -0.38, 0.38),
      6,
      dt,
    )

    // the cable follows: out of the boot along the mouse's own heading
    const psi = g.rotation.y
    const sn = Math.sin(psi)
    const cs = Math.cos(psi)
    const bz = M.zf - 0.0115 // boot tip in body space
    solveCable(
      cableGeo,
      g.position.x + bz * sn,
      g.position.y + 0.0105,
      g.position.z + bz * cs,
      -sn,
      -cs,
    )
  })

  return (
    <group position={POS} rotation-y={YAW}>
      {/* pad: rubber base, woven top, stitched border */}
      <mesh geometry={pad.base} receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.95} />
      </mesh>
      <mesh geometry={pad.top} receiveShadow>
        <meshStandardMaterial
          color="#1e433f"
          roughness={0.96}
          normalMap={fabric.normalMap}
          normalScale={[0.45, 0.45]}
          roughnessMap={fabric.roughnessMap}
        />
      </mesh>
      <mesh position={[0, PAD_TOP + 0.0003, 0]} rotation-x={-Math.PI / 2} renderOrder={1}>
        <planeGeometry args={[PAD_W - 0.008, PAD_D - 0.008]} />
        <meshStandardMaterial
          map={stitch}
          transparent
          roughness={1}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
        />
      </mesh>

      {/* the lead: braided, lying on the pad, over its edge, into the grommet */}
      <mesh ref={cable} geometry={cableGeo} frustumCulled={false} castShadow>
        <meshStandardMaterial
          color="#1d1d20"
          roughness={0.85}
          normalMap={braid.normalMap}
          normalScale={[0.9, 0.9]}
          roughnessMap={braid.roughnessMap}
        />
      </mesh>

      {/* two-button beige mouse */}
      <group ref={body} position={[0.01, PAD_TOP, 0.015]} rotation-y={0.18}>
        {/* its contact shadow, riding along underneath */}
        <mesh position={[0, 0.0004, 0.004]} rotation-x={-Math.PI / 2} renderOrder={-1}>
          <planeGeometry args={[0.09, 0.13]} />
          <meshBasicMaterial
            map={shadowTex}
            color="#000000"
            transparent
            opacity={0.5}
            depthWrite={false}
          />
        </mesh>
        <mesh geometry={mouseGeo} castShadow>
          <meshStandardMaterial
            color="#ffffff"
            vertexColors
            roughness={0.5}
            normalMap={plastic.normalMap}
            normalScale={[0.4, 0.4]}
            roughnessMap={plastic.roughnessMap}
          />
        </mesh>
      </group>
    </group>
  )
}
