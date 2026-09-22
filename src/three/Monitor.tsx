import { Suspense, useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import {
  AdditiveBlending,
  BoxGeometry,
  CatmullRomCurve3,
  Color,
  CustomBlending,
  CylinderGeometry,
  MathUtils,
  MeshPhysicalMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
  type PointLight,
} from 'three'
import { GLASS_H, GLASS_W, HTML_SCALE, SCREEN_H, SCREEN_W } from '../constants'
import { useSystem } from '../os/store'
import { playBeep, playClick } from '../os/sound'
import SoubhikOS from '../os/SoubhikOS'
import { useWorld } from '../world'
import Clickable from './Clickable'
import Halo from './Halo'
import { BEZEL, GLASS_LOCAL, MON_POS, MON_YAW, P } from './layout'
import { KNOB_LEVELS, useRoom } from './roomState'
import { makeFeatheredRect, makeStickyNote } from './textures'
import { rb } from './rbox'
import {
  capFan,
  clamp01,
  drawSpaced,
  knurlGeometry,
  lathe,
  loftRings,
  makeDecal,
  mergeParts,
  mottleMap,
  noise3,
  part,
  sharedPlastic,
  roundedSlab,
  rrectPts,
  screwHead,
  smooth,
  smudgeMap,
  tintGeo,
  type RingSpec,
  type V3,
} from './tex/electronics'

/* =====================================================================
   The CRT monitor. A real 17-inch tube: a soft-formed front housing with
   a 1.6 cm roll-over on its edges, a chamfered bezel that steps in to a
   dark inner lip, and a funnel that tapers to 55% of the front section
   over the last 28 cm, with vents, a carry dip, a rear plate, a two-part
   swivel base and a cable boot. The whole passive body is ONE merged mesh.

   The OS itself is a 1024×768 DOM node mapped onto the glass plane with
   drei <Html transform occlude="blending">. distanceFactor=400 makes 1 css
   px equal exactly `scale` world units, so scale=HTML_SCALE fits the glass.

   Front-panel extras: the brightness/contrast knobs REALLY work (they
   drive a CSS filter on the OS plane), and the sticky note glows when
   someone types "hire" on the room keyboard.
   ===================================================================== */

/* Bezel frame dimensions derived from the shared layout contract. */
const HOLE_CY = GLASS_LOCAL.y
const BOT_H = HOLE_CY - BEZEL.holeH / 2 - BEZEL.bottom
const PLATE_FRONT = BEZEL.frontZ + BEZEL.depth / 2 // local z of bezel face
const KNOB_Y = BEZEL.bottom + BOT_H / 2
/** the raised control strip's front surface */
const STRIP_Z = PLATE_FRONT + 0.0012
/** volume / brightness / contrast knob x, and the column the LED and power button share */
const KNOB_X = [0.116, 0.144, 0.172] as const
const COL_X = 0.1935

/* ---------------------------------------------------------------------
   The housing: profile functions, ring sampling
   --------------------------------------------------------------------- */
const SPEC: RingSpec = { arc: 5, nR: 6, nT: 20, nL: 6, nB: 10 }
const RF_S = 0.016 // front roll-over radius, sides
const RF_T = 0.014 // top
const RF_B = 0.01 // bottom (the control strip needs flat)
const Z_S = 0.06 // where the funnel starts
const Z_R = -0.235 // rear plane of the housing
const HW0 = BEZEL.halfW
const NECK_Y = 0.268 // the neck cover sits high on the rear plate; the cable port below it

interface Prof {
  hw: number
  hh: number
  yc: number
  r: number
  /** funnel progress of the sides / bottom, and of the top (0..1) */
  f: number
  ft: number
}

const Z_T = -0.015 // the top stays flat over the front box, then falls away

/** Cross-section of the housing at depth z: full size at the front,
    tapering (smoothstep) to 55% at the rear. The bottom rises and the top
    falls away later and further, like a real tube housing. */
function profile(z: number): Prof {
  const u = clamp01((Z_S - z) / (Z_S - Z_R))
  const f = u * u * (3 - 2 * u)
  const ut = clamp01((Z_T - z) / (Z_T - Z_R))
  const ft = ut * ut * (3 - 2 * ut)
  const draft = 0.004 * clamp01((PLATE_FRONT - RF_S - z) / 0.09)
  const top = BEZEL.top - 0.118 * ft - draft * 0.35
  const bot = BEZEL.bottom + 0.062 * f + draft * 0.35
  return {
    hw: HW0 * (1 - 0.45 * f) - draft,
    hh: (top - bot) / 2,
    yc: (top + bot) / 2,
    r: 0.03 + 0.012 * Math.max(f, ft),
    f,
    ft,
  }
}

/** The top edge: crowned in the middle, dipped for the carry handle. */
function topLift(x: number, z: number, p: Prof): number {
  const dome = 0.0042 * (1 - 0.55 * p.ft) * Math.max(0, 1 - (x / p.hw) ** 2)
  const dx = x / 0.058
  const dz = (z + 0.105) / 0.05
  const dip = 0.0065 * Math.exp(-(dx ** 4 + dz ** 4))
  return dome - dip
}

/** Height of the housing's top surface at (x, z). */
function topY(x: number, z: number): number {
  const p = profile(z)
  return p.yc + p.hh + topLift(x, z, p)
}

function ringAt(z: number, ds = 0, dt = 0, db = 0): V3[] {
  const p = profile(z)
  const top = p.yc + p.hh - dt
  const bot = p.yc - p.hh + db
  const hh = (top - bot) / 2
  const cy = (top + bot) / 2
  const r = Math.max(p.r - (ds + dt + db) / 3, 0.006)
  return rrectPts(p.hw - ds, hh, r, SPEC).map(([x, y]) => {
    let yy = cy + y
    if (y > 0) {
      // only the top run lifts (the corner arcs fall away to nothing)
      const w = smooth(hh - r * 1.6, hh - r * 0.2, y)
      yy += topLift(x, z, p) * w * (1 - dt / 0.02)
    }
    return [x, yy, z]
  })
}

function holeRing(grow: number, z: number, r: number): V3[] {
  return rrectPts(BEZEL.holeW / 2 + grow, BEZEL.holeH / 2 + grow, r, SPEC).map(
    ([x, y]) => [x, HOLE_CY + y, z],
  )
}

/* the desk's monitor cable (Cables in Desk.tsx) starts INSIDE the housing;
   find where it leaves and fit a moulded strain-relief boot there. This
   list mirrors that cable's control points. */
const DESK_CABLE: V3[] = [
  [0.02, 0.95, -0.9],
  [0.045, 0.93, -0.985],
  [0.09, 0.8, -1.0],
  [0.13, 0.55, -1.015],
  [0.17, 0.25, -1.03],
  [0.24, 0.05, -1.04],
  [0.38, 0.0065, -1.045],
  [0.62, 0.0065, -1.03],
  [0.85, 0.02, -0.99],
  [0.95, 0.14, -0.94],
]

function insideHousing(x: number, y: number, z: number): boolean {
  if (z > PLATE_FRONT || z < Z_R - 0.011) return false
  const p = profile(z)
  const qx = Math.abs(x) - (p.hw - p.r)
  const qy = Math.abs(y - p.yc) - (p.hh - p.r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - p.r < 0
}

function cableExit(): { at: Vector3; dir: Vector3 } | null {
  const curve = new CatmullRomCurve3(DESK_CABLE.map((q) => new Vector3(...q)))
  const c = Math.cos(MON_YAW)
  const s = Math.sin(MON_YAW)
  const toLocal = (w: Vector3) => {
    const dx = w.x - MON_POS.x
    const dz = w.z - MON_POS.z
    return new Vector3(dx * c - dz * s, w.y - MON_POS.y, dx * s + dz * c)
  }
  let wasInside = false
  let prev = toLocal(curve.getPoint(0))
  for (let i = 0; i <= 600; i++) {
    const cur = toLocal(curve.getPoint(i / 600))
    const ins = insideHousing(cur.x, cur.y, cur.z)
    if (wasInside && !ins) {
      return { at: cur, dir: cur.clone().sub(prev).normalize() }
    }
    if (i === 0 && ins) wasInside = true
    if (ins) wasInside = true
    prev = cur
  }
  return null
}

const BEIGE = '#ffffff'

/** Everything passive in ONE geometry: housing, bezel, base, vents, feet,
    screws and boot. Vertex colours carry the two-tone plastic, the dark
    slots and the yellowing gradient; one normal map grains it all. */
function buildShell(): BufferGeometry {
  const parts: BufferGeometry[] = []
  const add = (g: BufferGeometry, o: Parameters<typeof part>[1] = {}) => {
    parts.push(part(g, { color: BEIGE, ...o }))
  }

  /* --- housing loft: roll-over, front box, funnel, rear roll-over --- */
  const rings: V3[][] = []
  for (let k = 0; k <= 5; k++) {
    const th = (k / 5) * (Math.PI / 2)
    const e = 1 - Math.sin(th)
    rings.push(ringAt(PLATE_FRONT - RF_S + RF_S * Math.cos(th), RF_S * e, RF_T * e, RF_B * e))
  }
  ;[0.105, 0.085, 0.065, Z_S].forEach((z) => rings.push(ringAt(z)))
  for (let j = 1; j <= 14; j++) rings.push(ringAt(Z_S + (Z_R - Z_S) * (j / 14)))
  const RR = 0.011
  for (let k = 1; k <= 3; k++) {
    const psi = (k / 3) * (Math.PI / 2)
    rings.push(ringAt(Z_R - RR * Math.sin(psi), RR * (1 - Math.cos(psi)), RR * (1 - Math.cos(psi)), RR * (1 - Math.cos(psi))))
  }
  add(loftRings(rings, 'outward'))
  const rear = rings[rings.length - 1]
  add(capFan(rear, [0, 0, -1]), { color: '#e0d9c4' })

  /* --- front: flat face, stepped chamfer, dark lip --- */
  const face = rings[0]
  const s0 = holeRing(0.011, PLATE_FRONT, 0.014)
  const s1 = holeRing(0.0008, PLATE_FRONT - 0.0064, 0.0088)
  const s2 = holeRing(0, 0.1265, 0.008)
  add(loftRings([face, s0], [0, 0, 1]))
  add(loftRings([s0, s1], [0, 0, 1]), { color: '#e6e0cf' })
  add(loftRings([s1, s2], 'inward'), { color: '#1b1a18' })

  /* --- raised control strip under the tube --- */
  const strip = roundedSlab(0.292, 0.033, 0.0016, 0.005, 0.0005, 2)
  add(strip, { pos: [0.054, KNOB_Y, PLATE_FRONT + 0.0004], color: '#c4bda9' })
  // small OSD buttons and the power button on the strip
  for (const [x, y, w] of [
    [0.07, KNOB_Y, 0.0105],
    [0.0845, KNOB_Y, 0.0105],
    [COL_X, KNOB_Y - 0.0062, 0.0098],
  ] as const) {
    add(roundedSlab(w, 0.0062, 0.0026, 0.0018, 0.0007, 2), {
      pos: [x, y, STRIP_Z],
      color: '#bdb6a2',
    })
  }
  // LED bezel (the lens itself is a separate emissive mesh)
  add(roundedSlab(0.0105, 0.0072, 0.0016, 0.002, 0.0004, 2), {
    pos: [COL_X, KNOB_Y + 0.0062, STRIP_Z - 0.0002],
    color: '#2a2925',
  })
  // knob wells: a shallow dark ring each
  for (const x of KNOB_X) {
    add(lathe([[0.0097, 0], [0.0097, 0.0008], [0.0092, 0.0011], [0.0, 0.0011]], 24), {
      pos: [x, KNOB_Y, STRIP_Z],
      rot: [Math.PI / 2, 0, 0],
      color: '#2c2b28',
      tile: 0,
    })
  }

  /* --- top vents (two banks) and the carry-handle grip slot --- */
  const slotGeo = new BoxGeometry(1, 1, 1)
  for (let i = 0; i < 12; i++) {
    const z = -0.03 - i * 0.0155
    const p = profile(z)
    const xMax = p.hw - p.r - 0.006
    const inDip = Math.abs(z + 0.105) < 0.032
    const x0 = inDip ? 0.075 : 0.032
    if (xMax - x0 < 0.02) continue
    const dz = 0.003
    const slope = (topY(0.06, z + dz) - topY(0.06, z - dz)) / (2 * dz)
    const ang = -Math.atan(slope)
    for (const sgn of [-1, 1]) {
      const cx = (x0 + xMax) / 2
      const w = xMax - x0
      add(slotGeo, {
        pos: [sgn * cx, topY(sgn * cx, z) - 0.0003, z],
        rot: [ang, 0, 0],
        scale: [w, 0.0014, 0.0036],
        color: '#1d1c19',
        crease: 0.5,
      })
    }
  }
  // the grip slot: a dark rounded slot sunk in the dip
  add(roundedSlab(0.07, 0.0085, 0.0018, 0.004, 0.0005, 2), {
    pos: [0, topY(0, -0.105) - 0.0004, -0.105],
    rot: [Math.PI / 2 - Math.atan((topY(0, -0.1) - topY(0, -0.11)) / 0.01), 0, 0],
    color: '#1d1c19',
  })

  /* --- side vents: vertical slots hugging the funnel wall --- */
  for (let i = 0; i < 9; i++) {
    const z = -0.045 - i * 0.0165
    const p = profile(z)
    const dz = 0.003
    const slope = (profile(z + dz).hw - profile(z - dz).hw) / (2 * dz)
    const phi = Math.atan(slope)
    add(slotGeo, {
      pos: [p.hw + 0.0002, p.yc + 0.004, z],
      rot: [0, phi, 0],
      scale: [0.0014, Math.min(0.06, (p.hh - p.r) * 1.7), 0.0034],
      color: '#1d1c19',
      crease: 0.5,
    })
    add(slotGeo, {
      pos: [-p.hw - 0.0002, p.yc + 0.004, z],
      rot: [0, Math.PI - phi, 0],
      scale: [0.0014, Math.min(0.06, (p.hh - p.r) * 1.7), 0.0034],
      color: '#1d1c19',
      crease: 0.5,
    })
  }

  /* --- rear: neck cover, vent grille, screws --- */
  const zRear = Z_R - RR
  // the tube-neck dome: a stepped collar, a domed cap and three shallow grooves
  add(
    lathe(
      [
        [0.0001, 0],
        [0.056, 0],
        [0.0575, 0.003],
        [0.0575, 0.009],
        [0.0545, 0.0115],
        [0.0505, 0.0115],
        [0.0495, 0.0135],
        [0.0485, 0.0225],
        [0.0455, 0.0305],
        [0.036, 0.034],
        [0.0355, 0.0335],
        [0.0345, 0.0335],
        [0.0335, 0.034],
        [0.02, 0.0365],
        [0.0195, 0.036],
        [0.0185, 0.036],
        [0.0175, 0.0365],
        [0.0001, 0.038],
      ],
      40,
    ),
    { pos: [0, NECK_Y, zRear], rot: [-Math.PI / 2, 0, 0], color: '#a29b87' },
  )
  for (let i = 0; i < 5; i++) {
    for (const sgn of [-1, 1]) {
      add(slotGeo, {
        pos: [sgn * (0.068 + i * 0.0078), NECK_Y, zRear - 0.0002],
        scale: [0.0034, 0.05, 0.0012],
        color: '#1d1c19',
        crease: 0.5,
      })
    }
  }
  const rp = profile(zRear)
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      add(screwHead(0.0042), {
        pos: [sx * (rp.hw - 0.022), NECK_Y + sy * (rp.hh - 0.02), zRear],
        rot: [0, Math.PI, 0],
        tile: 0,
      })
    }
  }

  /* --- the cable boot where the desk cable leaves the housing --- */
  const exit = cableExit()
  if (exit) {
    const boot = lathe(
      [
        [0.0001, -0.012],
        [0.0118, -0.012],
        [0.0122, 0.0],
        [0.0104, 0.012],
        [0.0084, 0.026],
        [0.0074, 0.036],
        [0.0064, 0.038],
        [0.0001, 0.038],
      ],
      16,
    )
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), exit.dir)
    boot.applyQuaternion(q)
    boot.translate(exit.at.x, exit.at.y, exit.at.z)
    parts.push(part(boot, { color: '#18181a', tile: 0.02 }))
  }

  /* --- swivel base: plinth, turntable, rubber feet --- */
  const plinth = roundedSlab(0.31, 0.25, 0.021, 0.034, 0.008, 4)
  add(plinth, { pos: [0, 0.0135, 0.018], rot: [-Math.PI / 2, 0, 0], color: '#cfc8b3' })
  add(
    lathe(
      [
        [0.0001, 0.0235],
        [0.114, 0.0235],
        [0.116, 0.0255],
        [0.114, 0.0275],
        [0.104, 0.0285],
        [0.098, 0.036],
        [0.097, 0.052],
        [0.102, 0.0545],
        [0.104, 0.0575],
        [0.102, 0.0602],
        [0.0001, 0.0605],
      ],
      72,
    ),
    { pos: [0, 0, 0.005], color: '#e1dac5' },
  )
  // seam between plinth and turntable: a thin dark groove
  add(
    lathe([[0.1175, 0.0232], [0.1175, 0.0246], [0.1148, 0.0246], [0.1148, 0.0232]], 72),
    { pos: [0, 0.0006, 0.005], color: '#25241f', tile: 0 },
  )
  const foot = new CylinderGeometry(0.011, 0.012, 0.003, 12)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      add(foot, { pos: [sx * 0.125, 0.0015, 0.018 + sz * 0.09], color: '#1c1c1d' })
    }
  }

  const merged = mergeParts(parts)
  slotGeo.dispose()
  /* tint: plastic yellows toward the top and the back, with soft blotches */
  const yel = new Color()
  tintGeo(merged, (x, y, z, out) => {
    const n = noise3(x * 8, y * 8, z * 8, 5)
    const amt = clamp01(0.06 + 0.26 * smooth(0.28, 0.47, y) + 0.2 * smooth(0.02, -0.24, z) + (n - 0.5) * 0.2)
    yel.setRGB(1 - amt * 0.03, 1 - amt * 0.11, 1 - amt * 0.36)
    out.multiply(yel)
    out.multiplyScalar(1 - 0.05 * smooth(0.3, 0.47, y) - 0.05 * smooth(0.0, -0.24, z))
    // hand-oil grime along the lower front edge, blotchy rather than a stripe
    const grub = smooth(0.15, 0.06, y) * smooth(0.09, 0.135, z)
    out.multiplyScalar(1 - 0.09 * grub * (0.4 + noise3(x * 30, y * 30, z * 30, 8)))
  })
  return merged
}

/** The tube knob: skirt, knurled grip, dished cap, indicator line. Axis +z. */
function buildKnob(): BufferGeometry {
  const skirt = lathe([[0.0001, 0], [0.0092, 0], [0.0092, 0.0008], [0.0078, 0.0026], [0.0001, 0.0026]], 24)
  skirt.rotateX(Math.PI / 2)
  const grip = knurlGeometry(0.0066, 0.0064, 22, 0.00042)
  grip.translate(0, 0, 0.002)
  const cap = lathe([[0.0001, 0.0], [0.0057, 0.0], [0.0058, 0.0004], [0.0049, 0.0011], [0.0001, 0.0006]], 20)
  cap.rotateX(Math.PI / 2)
  cap.translate(0, 0, 0.0084)
  const mark = new BoxGeometry(0.0011, 0.0046, 0.0004)
  mark.translate(0, 0.0026, 0.0089)
  return mergeParts([
    part(skirt, { color: '#55524a', tile: 0.02 }),
    part(grip, { color: '#37352f', tile: 0.02 }),
    part(cap, { color: '#4a473f', tile: 0.02 }),
    part(mark, { color: '#efe9d4', tile: 0, crease: 0.5 }),
  ])
}

/** Reflection-only glass over the OS (R-P4c): black physical material
    whose env reflection is ADDED to the frame, alpha = brightest channel
    so it survives the DOM alpha hole. Room view only — reading is sacred. */
function buildGlass(smudge: ReturnType<typeof smudgeMap>): MeshPhysicalMaterial {
  const m = new MeshPhysicalMaterial({
    color: '#000000',
    roughness: 1,
    roughnessMap: smudge,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 1,
    clearcoatRoughnessMap: smudge,
    transparent: true,
    depthWrite: false,
    envMapIntensity: 0.25,
  })
  m.blending = CustomBlending
  m.blendSrc = OneFactor
  m.blendDst = OneFactor
  m.blendSrcAlpha = OneFactor
  m.blendDstAlpha = OneMinusSrcAlphaFactor
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      '#include <dithering_fragment>\n\tgl_FragColor.a = max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b));',
    )
  }
  return m
}

/* ---------------------------------------------------------------------
   Printed decals: brand mark, panel icons, serial sticker
   --------------------------------------------------------------------- */
const BRAND = 'SOUBHIK SYNTHVISION 17'

function brandDecal() {
  return makeDecal(1024, 112, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h)
    // a faint lighter offset first, so the print reads as slightly embossed
    drawSpaced(ctx, BRAND, w / 2 + 2, h / 2 + 3, "italic 700 60px 'Helvetica Neue', Arial, sans-serif", 'rgba(255,255,255,0.35)', 7, 'center')
    drawSpaced(ctx, BRAND, w / 2, h / 2, "italic 700 60px 'Helvetica Neue', Arial, sans-serif", '#4a463d', 7, 'center')
  })
}

/** brightness sun / contrast half-disc / volume speaker, over each knob */
function iconDecal() {
  return makeDecal(512, 96, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h)
    ctx.strokeStyle = '#4a463d'
    ctx.fillStyle = '#4a463d'
    ctx.lineWidth = 5
    ctx.lineCap = 'round'
    const cy = h / 2
    // slots: x fractions for volume, brightness, contrast (0.122/0.15/0.178 on a 0.084 span)
    const slot = (i: number) => (i + 0.5) * (w / 3)
    // volume: speaker cone + waves
    let cx = slot(0)
    ctx.beginPath()
    ctx.moveTo(cx - 24, cy - 9); ctx.lineTo(cx - 12, cy - 9); ctx.lineTo(cx + 4, cy - 22)
    ctx.lineTo(cx + 4, cy + 22); ctx.lineTo(cx - 12, cy + 9); ctx.lineTo(cx - 24, cy + 9)
    ctx.closePath(); ctx.fill()
    ctx.beginPath(); ctx.arc(cx + 6, cy, 16, -0.8, 0.8); ctx.stroke()
    ctx.beginPath(); ctx.arc(cx + 6, cy, 30, -0.8, 0.8); ctx.stroke()
    // brightness: sun
    cx = slot(1)
    ctx.beginPath(); ctx.arc(cx, cy, 11, 0, Math.PI * 2); ctx.fill()
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(a) * 19, cy + Math.sin(a) * 19)
      ctx.lineTo(cx + Math.cos(a) * 29, cy + Math.sin(a) * 29)
      ctx.stroke()
    }
    // contrast: half-filled disc
    cx = slot(2)
    ctx.beginPath(); ctx.arc(cx, cy, 22, 0, Math.PI * 2); ctx.stroke()
    ctx.beginPath(); ctx.arc(cx, cy, 22, -Math.PI / 2, Math.PI / 2); ctx.closePath(); ctx.fill()
  })
}

function stickerDecal() {
  return makeDecal(512, 300, (ctx, w, h) => {
    ctx.fillStyle = '#e4e1d6'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = '#8b877a'
    ctx.lineWidth = 3
    ctx.strokeRect(6, 6, w - 12, h - 12)
    const ink = '#2b2924'
    drawSpaced(ctx, 'SOUBHIK SYNTHVISION', 26, 46, "700 30px 'Helvetica Neue', Arial, sans-serif", ink, 2)
    drawSpaced(ctx, 'COLOR DISPLAY  MODEL SV-1701', 26, 84, "500 22px 'Helvetica Neue', Arial, sans-serif", ink, 1)
    drawSpaced(ctx, '100-240V ~  50/60Hz  1.4A', 26, 118, "500 22px 'Helvetica Neue', Arial, sans-serif", ink, 1)
    drawSpaced(ctx, 'MADE IN NOWHERE PARTICULAR', 26, 152, "500 20px 'Helvetica Neue', Arial, sans-serif", '#5b574d', 1)
    // serial barcode
    let x = 26
    let s = 7
    while (x < w - 190) {
      const bw = 2 + ((s * 7) % 5)
      ctx.fillStyle = ink
      ctx.fillRect(x, 186, bw, 66)
      x += bw + 2 + ((s * 3) % 4)
      s += 3
    }
    drawSpaced(ctx, 'S/N 0004871-X', w - 26, 219, "600 24px 'Courier New', monospace", ink, 2, 'right')
    drawSpaced(ctx, 'CAUTION: HIGH VOLTAGE', 26, 276, "700 19px 'Helvetica Neue', Arial, sans-serif", '#7a2b22', 1)
  })
}

export default function Monitor() {
  const view = useSystem((s) => s.view)
  const powered = useSystem((s) => s.power !== 'off')
  const powerOn = useSystem((s) => s.powerOn)
  const gl = useThree((s) => s.gl)
  /* Scene passes eventSource={#root}, and drei portals Html into
     events.connected by default — #root, OUTSIDE the canvas container.
     There the OS plane composites ON TOP of the canvas and no WebGL
     object (lifted paper, tossed trash ball) can ever occlude it.
     Pinning the portal to the canvas's own parent restores the intended
     occlude="blending" stack: canvas above DOM, alpha hole punched
     through the glass. */
  const htmlPortal = useMemo(
    () => ({ current: gl.domElement.parentNode as HTMLElement }),
    [gl],
  )
  const brightIdx = useRoom((s) => s.brightIdx)
  const contrastIdx = useRoom((s) => s.contrastIdx)
  const cycleBright = useRoom((s) => s.cycleBright)
  const cycleContrast = useRoom((s) => s.cycleContrast)
  const muted = useSystem((s) => s.muted)
  /* the ledger: both tube knobs turned at least once */
  const turned = useRef({ bright: false, contrast: false })
  const noteTurn = (which: 'bright' | 'contrast') => {
    turned.current[which] = true
    if (turned.current.bright && turned.current.contrast)
      useWorld.getState().mark('knobs')
  }

  const glowMat = useRef<MeshBasicMaterial>(null!)
  const glowLight = useRef<PointLight>(null!)
  const ledMat = useRef<MeshStandardMaterial>(null!)
  const glass = useRef<Mesh>(null!)
  const level = useRef(0)
  /** 1 in room view, eased to 0 while zooming/reading — the bleed sits
      in front of the bezel, so it must never veil the OS while reading */
  const roomMix = useRef(1)

  const bleedTex = useMemo(() => makeFeatheredRect(128, 96, 0.34), [])
  const smudge = useMemo(() => smudgeMap(4, 128), [])
  const glassMat = useMemo(() => buildGlass(smudge), [smudge])
  const shell = useMemo(() => buildShell(), [])
  const knobGeo = useMemo(() => buildKnob(), [])
  const plastic = useMemo(() => sharedPlastic(), [])
  const mottle = useMemo(() => {
    const t = mottleMap(21, 256)
    t.repeat.set(0.16, 0.16)
    return t
  }, [])
  useEffect(
    () => () => {
      bleedTex.dispose()
      smudge.dispose()
      glassMat.dispose()
      shell.dispose()
      knobGeo.dispose()
      plastic.dispose()
      mottle.dispose()
    },
    [bleedTex, smudge, glassMat, shell, knobGeo, plastic, mottle],
  )

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const t = state.clock.elapsedTime
    level.current = MathUtils.damp(level.current, powered ? 1 : 0, 5, dt)
    // phosphor never sits perfectly still; knob turns brighten the bleed
    const knob = KNOB_LEVELS[useRoom.getState().brightIdx]
    const flicker =
      1 + Math.sin(t * 43.7) * 0.035 + Math.sin(t * 11.3) * 0.045
    roomMix.current = MathUtils.damp(
      roomMix.current,
      useSystem.getState().view === 'room' ? 1 : 0,
      8,
      dt,
    )
    glowMat.current.opacity =
      level.current * 0.3 * flicker * (0.55 + 0.45 * knob) * roomMix.current
    const glowI = level.current * 1.6 * flicker * (0.55 + 0.45 * knob)
    glowLight.current.intensity = glowI
    // off entirely (not just intensity 0) while the tube is dark — one
    // fewer light in every material's shading loop for the whole time
    // before the machine is first powered on
    glowLight.current.visible = glowI > 0.01
    ledMat.current.emissiveIntensity = MathUtils.damp(
      ledMat.current.emissiveIntensity,
      powered ? 1.8 : 0,
      8,
      dt,
    )
    // the glass reflects the room's env explicitly, so its own intensity
    // is honoured (three overrides envMapIntensity for scene-env users)
    const gm = glass.current.material as MeshPhysicalMaterial
    if (gm.envMap !== state.scene.environment)
      gm.envMap = state.scene.environment
    gm.envMapIntensity = 0.25 * state.scene.environmentIntensity
  })

  return (
    <group position={MON_POS} rotation-y={MON_YAW}>
      <Clickable
        enabled={view === 'room'}
        label={powered ? 'lean in' : 'power on'}
        onActivate={() => {
          playClick()
          powerOn()
        }}
      >
        <MonitorShell
          shell={shell}
          plastic={plastic}
          mottle={mottle}
          ledMat={ledMat}
        />
        {/* tube face — dark glass filling the bezel hole. It lives INSIDE the
            clickable: the hole shows nothing else to hit, and clicking the
            screen is how you lean in. */}
        <mesh position={[0, HOLE_CY, GLASS_LOCAL.z - 0.0015]}>
          <planeGeometry args={[BEZEL.holeW, BEZEL.holeH]} />
          <meshStandardMaterial color="#090c0b" roughness={0.35} />
        </mesh>
      </Clickable>

      <StickyNote />

      {/* volume / brightness / contrast knobs — they actually work.
          Volume has two detents (muted / not) and IS the mute control. */}
      <Knob
        x={KNOB_X[0]}
        idx={muted ? 0 : 4}
        label={muted ? 'volume (muted)' : 'volume'}
        geo={knobGeo}
        onCycle={() => useSystem.getState().toggleMuted()}
      />
      <Knob
        x={KNOB_X[1]}
        idx={brightIdx}
        label="brightness"
        geo={knobGeo}
        onCycle={() => {
          noteTurn('bright')
          cycleBright()
        }}
      />
      <Knob
        x={KNOB_X[2]}
        idx={contrastIdx}
        label="contrast"
        geo={knobGeo}
        onCycle={() => {
          noteTurn('contrast')
          cycleContrast()
        }}
      />

      {/* phosphor bleed — a feathered additive veil just proud of the
          bezel, so the lit tube blooms softly onto the plastic around it
          while powered. Room view only (roomMix); the lifted paper
          (renderOrder 50, no depth test) still paints over it. */}
      <mesh position={[0, HOLE_CY, PLATE_FRONT + 0.004]} renderOrder={4}>
        <planeGeometry args={[BEZEL.holeW + 0.08, BEZEL.holeH + 0.08]} />
        <meshBasicMaterial
          ref={glowMat}
          map={bleedTex}
          color={P.screenGlow}
          transparent
          opacity={0}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* the glass itself: reflections of the lamp and window slide across
          the tube with the camera; hidden the moment you lean in */}
      <mesh
        ref={glass}
        position={[0, HOLE_CY, GLASS_LOCAL.z + 0.0035]}
        material={glassMat}
        renderOrder={10}
        visible={view === 'room'}
      >
        <planeGeometry args={[GLASS_W, GLASS_H]} />
      </mesh>

      {/* screen light spilling onto the keyboard and desk */}
      <pointLight
        ref={glowLight}
        position={[0, HOLE_CY, 0.55]}
        color={P.screenGlow}
        intensity={0}
        distance={1.7}
        decay={2}
      />

      {/* ============ the OS, mapped 1:1 onto the glass ============ */}
      <Html
        transform
        occlude="blending"
        portal={htmlPortal}
        distanceFactor={400}
        scale={HTML_SCALE}
        position={[GLASS_LOCAL.x, GLASS_LOCAL.y, GLASS_LOCAL.z + 0.002]}
        zIndexRange={[40, 0]}
        pointerEvents={view === 'screen' ? 'auto' : 'none'}
      >
        <div
          style={{
            width: SCREEN_W,
            height: SCREEN_H,
            overflow: 'hidden',
            background: 'var(--term-bg)',
            // no filter at all while both knobs sit at neutral: even an
            // identity filter makes the browser render the whole OS into
            // an offscreen effect surface under the 3D transform, one more
            // resample of every glyph (and a cost on every frame)
            filter:
              KNOB_LEVELS[brightIdx] === 1 && KNOB_LEVELS[contrastIdx] === 1
                ? undefined
                : `brightness(${KNOB_LEVELS[brightIdx]}) contrast(${KNOB_LEVELS[contrastIdx]})`,
          }}
        >
          <Suspense fallback={null}>
            <SoubhikOS />
          </Suspense>
        </div>
      </Html>
    </group>
  )
}

/* ---------- bezel knob with detents ---------- */
function Knob({
  x,
  idx,
  label,
  geo,
  onCycle,
}: {
  x: number
  idx: number
  label: string
  geo: BufferGeometry
  onCycle: () => void
}) {
  const view = useSystem((s) => s.view)
  const grp = useRef<Group>(null!)

  useFrame((_, delta) => {
    grp.current.rotation.z = MathUtils.damp(
      grp.current.rotation.z,
      -(idx - 2) * 0.55,
      12,
      Math.min(delta, 0.05),
    )
  })

  return (
    <Clickable
      enabled={view === 'room'}
      label={label}
      onActivate={() => {
        playClick()
        onCycle()
      }}
    >
      <group ref={grp} position={[x, KNOB_Y, STRIP_Z]}>
        <mesh geometry={geo} castShadow>
          <meshStandardMaterial vertexColors color="#ffffff" roughness={0.5} />
        </mesh>
        {/* invisible hit pad — knobs are tiny from room distance. Never drawn
            (visible=false); the raycaster still tests it. */}
        <mesh position={[0, 0, 0.01]} visible={false}>
          <circleGeometry args={[0.0125, 8]} />
        </mesh>
      </group>
    </Clickable>
  )
}

/* ---------- sticky note: the hint, plus the "hire" celebration ---------- */
function StickyNote() {
  const view = useSystem((s) => s.view)
  const noteTex = useMemo(() => makeStickyNote(), [])
  useEffect(() => () => noteTex.dispose(), [noteTex])

  const mat = useRef<MeshStandardMaterial>(null!)
  const rig = useRef<Group>(null!)
  const wiggle = useRef({ s: 0, v: 0 })

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const t = state.clock.elapsedTime
    const celebrating = useRoom.getState().hireActive
    mat.current.emissiveIntensity = MathUtils.damp(
      mat.current.emissiveIntensity,
      celebrating ? 0.55 + Math.sin(t * 11) * 0.35 : 0,
      8,
      dt,
    )
    const w = wiggle.current
    w.v += (-140 * w.s - 9 * w.v) * dt
    w.s += w.v * dt
    rig.current.rotation.z = 0.07 + w.s
  })

  return (
    <group
      ref={rig}
      position={[-0.128, 0.094, PLATE_FRONT + 0.0009]}
      rotation-z={0.07}
    >
      <Clickable
        enabled={view === 'room'}
        label="past me left this"
        onActivate={() => {
          wiggle.current.v = 1.4
          playBeep()
        }}
      >
        <mesh>
          <planeGeometry args={[0.06, 0.06]} />
          <meshStandardMaterial
            ref={mat}
            map={noteTex}
            emissive="#f6d84f"
            emissiveMap={noteTex}
            emissiveIntensity={0}
            roughness={0.95}
          />
        </mesh>
      </Clickable>
    </group>
  )
}

/* NOTE: the "hire" toast is deliberately NOT a drei <Html> here — a
   non-blending Html resets the canvas z-index/pointer-events that
   occlude="blending" depends on (drei clobbers them on mount). It lives
   in the DOM beside the canvas instead: see HireToast in Tooltip.tsx. */

/* ---------- passive shell: one merged body plus its printed decals ---------- */
function MonitorShell({
  shell,
  plastic,
  mottle,
  ledMat,
}: {
  shell: BufferGeometry
  plastic: ReturnType<typeof sharedPlastic>
  mottle: ReturnType<typeof mottleMap>
  ledMat: React.RefObject<MeshStandardMaterial>
}) {
  const brand = useMemo(() => brandDecal(), [])
  const icons = useMemo(() => iconDecal(), [])
  const sticker = useMemo(() => stickerDecal(), [])
  useEffect(
    () => () => {
      brand.dispose()
      icons.dispose()
      sticker.dispose()
    },
    [brand, icons, sticker],
  )
  const ledX = COL_X
  const ledY = KNOB_Y + 0.0062
  // the side wall the sticker is glued to, tilted by the housing's draft
  const stickerZ = 0.082
  const stickerX = profile(stickerZ).hw + 0.0005
  return (
    <group>
      {/* the whole housing, base and boot in one draw call */}
      <mesh geometry={shell} castShadow>
        <meshStandardMaterial
          color="#dcd3bb"
          roughness={0.62}
          vertexColors
          map={mottle}
          normalMap={plastic.normalMap}
          normalScale={[0.3, 0.3]}
          roughnessMap={plastic.roughnessMap}
        />
      </mesh>

      {/* printed brand mark on the control strip */}
      <mesh position={[-0.026, KNOB_Y, STRIP_Z + 0.0003]}>
        <planeGeometry args={[0.104, 0.0114]} />
        <meshBasicMaterial map={brand} transparent opacity={0.9} depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
      </mesh>
      {/* control icons above each knob */}
      <mesh position={[KNOB_X[1], KNOB_Y + 0.0142, STRIP_Z + 0.0003]}>
        <planeGeometry args={[0.084, 0.0158]} />
        <meshBasicMaterial map={icons} transparent opacity={0.85} depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
      </mesh>

      {/* serial sticker on the right flank */}
      <mesh position={[stickerX, 0.2, stickerZ]} rotation-y={Math.PI / 2 + 0.0444}>
        <planeGeometry args={[0.09, 0.0527]} />
        <meshStandardMaterial map={sticker} roughness={0.55} polygonOffset polygonOffsetFactor={-2} />
      </mesh>

      {/* power LED lens */}
      <mesh position={[ledX, ledY, STRIP_Z + 0.0006]}>
        <roundedBoxGeometry args={rb(0.0075, 0.0042, 0.0018, 0.0012, 2)} />
        <meshStandardMaterial
          ref={ledMat}
          color="#123a1c"
          emissive={P.ledGreen}
          emissiveIntensity={0}
          roughness={0.35}
        />
      </mesh>
      <Halo
        source={ledMat}
        color={P.ledGreen}
        size={0.02}
        intensity={0}
        position={[ledX, ledY, STRIP_Z + 0.0024]}
      />
    </group>
  )
}
