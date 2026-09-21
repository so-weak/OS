import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { create } from 'zustand'
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  MathUtils,
  SRGBColorSpace,
  TubeGeometry,
  Vector3,
  type MeshBasicMaterial,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { playClick } from '../os/sound'
import { useSystem } from '../os/store'
import { reducedMotion } from '../world'
import Clickable from './Clickable'
import { WINDOW } from './layout'
import { live } from './live'
import { rb } from './rbox'
import { makeCanvas } from './textures'

/* =====================================================================
   A neon rainbow, standing on the window sill.

   Six glass tubes bent into concentric arches (red on the outside,
   violet on the inside), each fed through a black electrode cap into a
   powder-coated base bar, and clipped to a sheet of clear acrylic that
   stands on the sill, leaning against the window. A thin cord runs
   along the sill, off its right end and down the wall behind the desk;
   a small inline switch box hangs from it (click it to switch the sign).

   Nothing here is a light — a light would cost every lit fragment in
   the room. The glow is three cheap layers: the tubes themselves (unlit,
   over-bright, with a whiter core line), an additive shell around each
   tube, and one big additive halo behind the sign that paints the
   blinds and the casing. The sign breathes a hair, and every half
   minute or so it stutters like neon warming up.
   ===================================================================== */

const BANDS = ['#ff2b3d', '#ff8a1f', '#ffe83b', '#35ff7a', '#2fa8ff', '#b45cff']
const R0 = 0.19 // outer arch radius
const STEP = 0.0175 // between neighbouring tubes
const TUBE_R = 0.0055
const BASE_H = 0.02 // the base bar
const ARC_Y = 0.05 // arch centre above the sill

const SILL_Y = WINDOW.y - WINDOW.frameH / 2 + 0.0015
const CX = WINDOW.x - 0.05
const CZ = WINDOW.wallZ + 0.055

/* ---------- state ---------- */
const useNeon = create<{ on: boolean; toggle: () => void }>((set) => ({
  on: true,
  toggle: () => set((s) => ({ on: !s.on })),
}))

/* ---------- geometry ---------- */

function bandCurve(R: number, dz = 0): CatmullRomCurve3 {
  const pts: Vector3[] = []
  pts.push(new Vector3(R, BASE_H, dz), new Vector3(R, (BASE_H + ARC_Y) / 2, dz))
  const N = 40
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI
    pts.push(new Vector3(R * Math.cos(a), ARC_Y + R * Math.sin(a), dz))
  }
  pts.push(new Vector3(-R, (BASE_H + ARC_Y) / 2, dz), new Vector3(-R, BASE_H, dz))
  return new CatmullRomCurve3(pts, false, 'centripetal')
}

function withColor(g: BufferGeometry, c: Color): BufferGeometry {
  g.deleteAttribute('normal')
  g.deleteAttribute('uv')
  const n = g.getAttribute('position').count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r
    arr[i * 3 + 1] = c.g
    arr[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new Float32BufferAttribute(arr, 3))
  return g
}

/** The glass tubes plus a whiter core line on the viewer's side of each. */
function tubesGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = []
  BANDS.forEach((hex, k) => {
    const R = R0 - k * STEP
    const c = new Color(hex)
    parts.push(withColor(new TubeGeometry(bandCurve(R), 120, TUBE_R, 6, false), c))
    parts.push(
      withColor(
        new TubeGeometry(bandCurve(R, 0.0038), 120, 0.0024, 4, false),
        c.clone().lerp(new Color('#ffffff'), 0.6),
      ),
    )
  })
  const g = mergeGeometries(parts, false)
  parts.forEach((p) => p.dispose())
  return g
}

/** A fatter shell around each tube, drawn additively. */
function glowGeometry(): BufferGeometry {
  const parts = BANDS.map((hex, k) =>
    withColor(new TubeGeometry(bandCurve(R0 - k * STEP), 90, 0.013, 8, false), new Color(hex)),
  )
  const g = mergeGeometries(parts, false)
  parts.forEach((p) => p.dispose())
  return g
}

/** Base bar, electrode caps and the clips that hold each tube to the acrylic. */
function hardwareGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = []
  // RoundedBoxGeometry is non-indexed and cylinders are indexed: a merge of
  // mixed geometries returns null, so everything goes non-indexed first
  const strip = (g: BufferGeometry): BufferGeometry => {
    const out = g.index ? g.toNonIndexed() : g
    out.deleteAttribute('uv')
    return out
  }
  const bar = new RoundedBoxGeometry(2 * R0 + 0.06, BASE_H, 0.03, 2, 0.004)
  bar.translate(0, BASE_H / 2, 0)
  parts.push(strip(bar))
  BANDS.forEach((_, k) => {
    const R = R0 - k * STEP
    for (const sx of [-1, 1]) {
      const cap = new CylinderGeometry(0.0068, 0.0075, 0.012, 10)
      cap.translate(sx * R, BASE_H + 0.006, 0)
      parts.push(strip(cap))
    }
    for (const deg of [24, 90, 156]) {
      const a = (deg * Math.PI) / 180
      const clip = new CylinderGeometry(0.0045, 0.0045, 0.012, 8)
      clip.rotateX(Math.PI / 2)
      clip.translate(R * Math.cos(a), ARC_Y + R * Math.sin(a), -0.004)
      parts.push(strip(clip))
    }
  })
  const g = mergeGeometries(parts, false)
  parts.forEach((p) => p.dispose())
  return g
}

/** The wide soft halo that paints the blinds and the casing behind the sign. */
function haloTexture(): { tex: CanvasTexture; w: number; h: number; cy: number } {
  const W = 512
  const H = 320
  const w = 0.95
  const h = (w * H) / W
  const pxm = W / w
  const ctx = makeCanvas(W, H)
  const cx = W / 2
  const cyLocal = 0.14 // plane centre above the sill
  const cy = H / 2 + (cyLocal - ARC_Y) * pxm
  ctx.globalCompositeOperation = 'lighter'
  BANDS.forEach((hex, k) => {
    const r = (R0 - k * STEP) * pxm
    for (const [blur, width, alpha] of [
      [60, 16, 0.5],
      [26, 9, 0.7],
    ] as const) {
      ctx.strokeStyle = hex
      ctx.shadowColor = hex
      ctx.shadowBlur = blur
      ctx.lineWidth = width
      ctx.globalAlpha = alpha
      ctx.beginPath()
      ctx.arc(cx, cy, r, Math.PI, Math.PI * 2)
      ctx.moveTo(cx - r, cy)
      ctx.lineTo(cx - r, cy + (ARC_Y - BASE_H) * pxm)
      ctx.moveTo(cx + r, cy)
      ctx.lineTo(cx + r, cy + (ARC_Y - BASE_H) * pxm)
      ctx.stroke()
    }
  })
  const tex = new CanvasTexture(ctx.canvas)
  tex.colorSpace = SRGBColorSpace
  return { tex, w, h, cy: cyLocal }
}

/** The cord: along the sill, off its right end, down behind the desk. */
function cordGeometry(): BufferGeometry {
  const y = SILL_Y + 0.0035
  const pts = [
    new Vector3(CX + R0 + 0.02, SILL_Y + 0.008, CZ),
    new Vector3(CX + R0 + 0.07, y, -0.99),
    new Vector3(-0.95, y, -0.985),
    new Vector3(-0.8, y, -0.985),
    new Vector3(-0.722, y - 0.004, -0.985),
    new Vector3(-0.716, y - 0.06, -0.984),
    new Vector3(-0.716, 0.9, -0.984),
    new Vector3(-0.72, 0.76, -0.99),
  ]
  return new TubeGeometry(new CatmullRomCurve3(pts, false, 'centripetal'), 90, 0.0022, 5, false)
}

/* ---------- the component ---------- */

export default function NeonRainbow() {
  const view = useSystem((s) => s.view)
  const on = useNeon((s) => s.on)
  const toggle = useNeon((s) => s.toggle)

  const tubes = useMemo(() => tubesGeometry(), [])
  const glow = useMemo(() => glowGeometry(), [])
  const hardware = useMemo(() => hardwareGeometry(), [])
  const cord = useMemo(() => cordGeometry(), [])
  const halo = useMemo(() => haloTexture(), [])
  useEffect(
    () => () => {
      tubes.dispose()
      glow.dispose()
      hardware.dispose()
      cord.dispose()
      halo.tex.dispose()
    },
    [tubes, glow, hardware, cord, halo],
  )

  const tubeMat = useRef<MeshBasicMaterial>(null!)
  const glowMat = useRef<MeshBasicMaterial>(null!)
  const haloMat = useRef<MeshBasicMaterial>(null!)
  const ledMat = useRef<MeshBasicMaterial>(null!)
  // `next` is scheduled on the first frame: Math.random() is impure in render
  const st = useRef({ lvl: 1, next: 0, dipAt: -10 })

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const t = state.clock.elapsedTime
    const s = st.current
    s.lvl = MathUtils.damp(s.lvl, useNeon.getState().on ? 1 : 0, 5, dt)

    let alive = 1
    if (!reducedMotion()) {
      if (s.next === 0) s.next = t + 14 + Math.random() * 16
      // warming-up stutter: a third of a second of flicker every 25–50 s
      if (t > s.next) {
        s.dipAt = t
        s.next = t + 25 + Math.random() * 25
      }
      const since = t - s.dipAt
      if (since >= 0 && since < 0.35) alive = Math.sin(since * 90) > 0.1 ? 1 : 0.32
      alive *= 1 + 0.012 * Math.sin(t * 97) + 0.008 * Math.sin(t * 53)
    }
    // by day the sign is a dull coloured glass sculpture, not a light
    const lit = s.lvl * (1 - 0.55 * live.day) * alive
    tubeMat.current.color.setScalar(0.16 + 1.2 * lit)
    glowMat.current.opacity = 0.2 * lit
    haloMat.current.opacity = 0.62 * lit
    ledMat.current.color.setRGB(1, 0.23, 0.23).multiplyScalar(0.3 + 1.3 * s.lvl)
  })

  return (
    <group>
      {/* the sign, standing on the sill and leaning back against the window */}
      <group position={[CX, SILL_Y, CZ]} rotation-x={-0.09}>
        <mesh geometry={tubes}>
          <meshBasicMaterial ref={tubeMat} vertexColors toneMapped={false} fog={false} />
        </mesh>
        <mesh geometry={glow} renderOrder={3}>
          <meshBasicMaterial
            ref={glowMat}
            vertexColors
            transparent
            opacity={0.2}
            blending={AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
            fog={false}
          />
        </mesh>
        <mesh geometry={hardware} castShadow>
          <meshStandardMaterial color="#17181c" metalness={0.55} roughness={0.42} />
        </mesh>
        {/* the clear acrylic the tubes are clipped to */}
        <mesh position={[0, BASE_H + (ARC_Y + R0 + 0.03 - BASE_H) / 2, -0.0085]}>
          <roundedBoxGeometry args={rb(2 * R0 + 0.07, ARC_Y + R0 + 0.03 - BASE_H, 0.005, 0.004)} />
          <meshStandardMaterial
            color="#e4f0ff"
            transparent
            opacity={0.1}
            roughness={0.04}
            depthWrite={false}
          />
        </mesh>
        {/* the glow it throws on the blinds and the casing */}
        <mesh position={[0, halo.cy, -0.02]} renderOrder={2}>
          <planeGeometry args={[halo.w, halo.h]} />
          <meshBasicMaterial
            ref={haloMat}
            map={halo.tex}
            transparent
            opacity={0.62}
            blending={AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
            fog={false}
          />
        </mesh>
      </group>

      {/* the cord and its inline switch */}
      <mesh geometry={cord}>
        <meshStandardMaterial color="#0e0f12" roughness={0.6} />
      </mesh>
      <Clickable
        enabled={view === 'room'}
        label={on ? 'lights out, rainbow' : 'let there be rainbow'}
        onActivate={() => {
          playClick()
          toggle()
        }}
        position={[-0.716, 0.94, -0.984]}
      >
        <mesh castShadow>
          <roundedBoxGeometry args={rb(0.028, 0.056, 0.018, 0.004)} />
          <meshStandardMaterial color="#111216" roughness={0.35} metalness={0.2} />
        </mesh>
        <mesh position={[0, 0.012, 0.0095]}>
          <roundedBoxGeometry args={rb(0.007, 0.007, 0.002, 0.0008)} />
          <meshBasicMaterial ref={ledMat} color="#ff3b3b" toneMapped={false} />
        </mesh>
        <mesh position={[0, -0.01, 0.0095]}>
          <roundedBoxGeometry args={rb(0.012, 0.016, 0.002, 0.0008)} />
          <meshStandardMaterial color="#d9d9d4" roughness={0.5} />
        </mesh>
        {/* a generous invisible hit pad — the box is tiny from the room */}
        <mesh visible={false}>
          <sphereGeometry args={[0.04, 8, 6]} />
          <meshBasicMaterial />
        </mesh>
      </Clickable>
    </group>
  )
}
