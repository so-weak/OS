import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  CatmullRomCurve3,
  MathUtils,
  Vector3,
  type BufferGeometry,
  type Group,
} from 'three'
import { useSystem } from '../os/store'
import { playClick } from '../os/sound'
import { useWorld } from '../world'
import Clickable from './Clickable'
import { plasticMaps, rubberMaps } from './tex/noise'
import {
  arc,
  at,
  deform,
  fabricSet,
  lathe,
  mergeParts,
  nylonMaps,
  paint,
  slab,
  slabSeam,
  smoothstep,
  sweep,
  tint,
  woodBox,
  type SlabOpts,
} from './tex/furniture'
import { mulberry } from './textures'
import Staged from './Staged'
import { useStagedValue } from './stage'

/* =====================================================================
   The desk chair — a proper ergonomic office chair, about 1 m tall with
   a 0.47 m seat. Easter egg: click it and it spins on an underdamped
   swivel; it marks the ledger's `chair`.

   Everything is merged by material, so the whole chair is six draw
   calls: upholstery, moulded plastic, chrome, nylon base, wheels, and
   the piston. UVs are "one unit = 6 cm of surface" so a single fabric
   or grain texture fits every part.

     rig (spins):   seat cushion + piping, seat pan, mechanism, spine,
                    back cushion + shell, T-arms with soft pads, lever
     static:        five-star base, column bellows, piston, casters
   ===================================================================== */

/** metres of surface per UV unit, shared by every part of the chair */
const T = 0.06

const SEAT: SlabOpts = {
  hx: 0.235,
  hz: 0.21,
  h: 0.078,
  rc: 0.075,
  rt: 0.034,
  rbot: 0.02,
  tile: T,
  rings: 5,
  arc: 5,
  straight: 4,
  bevel: 4,
}
const SEAT_Y = 0.412
const SEAT_Z = 0.02

const BACK: SlabOpts = {
  hx: 0.2,
  hz: 0.222,
  h: 0.05,
  rc: 0.085,
  rt: 0.03,
  rbot: 0.02,
  tile: T,
  rings: 5,
  arc: 5,
  straight: 4,
  bevel: 4,
}
const BACK_Y = 0.8
const BACK_Z = -0.245
const BACK_LEAN = 0.13
/** z of the shell's rear face at height y (the back leans away with height) */
const shellRear = (y: number): number =>
  BACK_Z - 0.004 - (y - BACK_Y) * Math.tan(BACK_LEAN)
/** the whole chair is nudged toward the desk-facing side of its column so
    the back clears the desk's front edge (the rig itself stays put) */
const NUDGE = 0.06

/* ---------- shaping functions (slab-local coordinates) ---------- */

const seatShape = (p: Vector3): void => {
  const top = smoothstep(SEAT.h - 0.055, SEAT.h - 0.012, p.y)
  const dx = p.x / 0.15
  const dz = (p.z + 0.02) / 0.16
  // pelvis dish, raised side bolsters, waterfall front edge
  p.y -= top * 0.013 * Math.exp(-(dx * dx + dz * dz))
  p.y += top * 0.007 * smoothstep(0.12, 0.23, Math.abs(p.x))
  const f = smoothstep(0.08, 0.21, p.z)
  p.y -= f * f * 0.05
}

const backShape = (p: Vector3, front: boolean): void => {
  const top = front ? smoothstep(BACK.h - 0.05, BACK.h - 0.01, p.y) : 0
  // slab z runs down the back once stood up: u = +1 top edge, -1 bottom
  const u = -p.z / BACK.hz
  const nx = p.x / BACK.hx
  // the back wraps forward a little at the sides
  p.y += 0.028 * nx * nx
  // lumbar bulge on the padded face
  const lu = (u + 0.42) / 0.3
  p.y += top * 0.012 * Math.exp(-lu * lu) * (1 - nx * nx)
  // the shoulders lean away
  p.y -= 0.028 * Math.max(0, u - 0.15) ** 2
  // slightly narrower at the shoulders
  p.x *= 1 - 0.05 * smoothstep(0.1, 1, u)
}

const arcPath = (pts: [number, number, number][], n = 20): Vector3[] =>
  new CatmullRomCurve3(
    pts.map((p) => new Vector3(...p)),
    false,
    'centripetal',
  ).getPoints(n)

/* ---------- the parts ---------- */

interface ChairGeo {
  fabric: BufferGeometry
  plastic: BufferGeometry
  chrome: BufferGeometry
  nylon: BufferGeometry
  wheels: BufferGeometry
}

function buildChair(): ChairGeo {
  const fabric: BufferGeometry[] = []
  const plastic: BufferGeometry[] = []
  const chrome: BufferGeometry[] = []
  const nylon: BufferGeometry[] = []
  const wheels: BufferGeometry[] = []

  /* ---- seat cushion, piping, pan ---- */
  const cushion = deform(slab(SEAT), seatShape)
  fabric.push(at(cushion, 0, SEAT_Y, SEAT_Z))
  for (const [edge, lift] of [
    ['top', 0.0012],
    ['bottom', 0.0008],
  ] as const) {
    const piping = sweep({
      path: slabSeam(SEAT, edge, lift),
      radial: 5,
      size: () => [0.0032, 0.0032],
      ref: new Vector3(0, 1, 0),
      closed: true,
      vTile: T,
    })
    tint(piping, edge === 'top' ? '#8a93a3' : '#5a6270')
    fabric.push(at(deform(piping, seatShape), 0, SEAT_Y, SEAT_Z))
  }
  const pan = deform(
    slab({
      hx: 0.222,
      hz: 0.196,
      h: 0.016,
      rc: 0.07,
      rt: 0.006,
      rbot: 0.008,
      tile: T,
      rings: 2,
      bottomRings: 1,
      arc: 4,
      straight: 3,
      bevel: 4,
    }),
    (p) => {
      const f = smoothstep(0.08, 0.196, p.z)
      p.y -= f * f * 0.05
    },
  )
  plastic.push(
    at(
      paint(pan, (_p, _n, c) => c.setScalar(0.85)),
      0,
      SEAT_Y - 0.012,
      SEAT_Z,
    ),
  )

  /* ---- mechanism housing under the seat ---- */
  const mech = deform(
    slab({
      hx: 0.105,
      hz: 0.14,
      h: 0.05,
      rc: 0.045,
      rt: 0.014,
      rbot: 0.016,
      tile: T,
      rings: 2,
      bottomRings: 1,
      arc: 4,
      straight: 2,
      bevel: 4,
    }),
    (p) => {
      p.x *= 1 - 0.32 * smoothstep(0.02, 0.14, -p.z)
    },
  )
  plastic.push(at(mech, 0, 0.352, 0.02))
  // column boss under the mechanism
  plastic.push(
    at(
      lathe(
        [
          [0.03, 0],
          [0.034, 0.003],
          [0.034, 0.014],
          [0.027, 0.02],
        ],
        { segments: 14, vTile: T, uTile: T },
      ),
      0,
      0.348,
      0,
    ),
  )

  /* ---- back: spine, mounting plate, shell, cushion ---- */
  plastic.push(
    sweep({
      path: arcPath([
        [0, 0.372, -0.06],
        [0, 0.386, -0.13],
        [0, 0.418, -0.19],
        [0, 0.49, -0.228],
        [0, 0.6, -0.243],
        [0, 0.68, -0.248],
      ]),
      radial: 8,
      size: () => [0.008, 0.026],
      ref: new Vector3(1, 0, 0),
      exponent: 4,
      capEnd: true,
      vTile: T,
    }),
  )
  plastic.push(
    at(
      woodBox(0.1, 0.15, 0.012, 0.005, 2, T, 'x'),
      0,
      0.665,
      shellRear(0.665) - 0.004,
      -BACK_LEAN,
      0,
      0,
    ),
  )

  const shell = deform(
    slab({
      hx: 0.207,
      hz: 0.23,
      h: 0.016,
      rc: 0.09,
      rt: 0.007,
      rbot: 0.007,
      tile: T,
      rings: 2,
      bottomRings: 1,
      arc: 5,
      straight: 4,
      bevel: 4,
    }),
    (p) => backShape(p, false),
  )
  plastic.push(
    at(
      paint(shell, (_p, _n, c) => c.setScalar(0.9)),
      0,
      BACK_Y,
      BACK_Z - 0.004,
      Math.PI / 2 - BACK_LEAN,
    ),
  )
  const backCushion = deform(slab(BACK), (p) => backShape(p, true))
  fabric.push(
    at(backCushion, 0, BACK_Y, BACK_Z + 0.008, Math.PI / 2 - BACK_LEAN),
  )
  const bp = sweep({
    path: slabSeam(BACK, 'top', 0.0012),
    radial: 5,
    size: () => [0.0032, 0.0032],
    ref: new Vector3(0, 1, 0),
    closed: true,
    vTile: T,
  })
  tint(bp, '#8a93a3')
  fabric.push(
    at(
      deform(bp, (p) => backShape(p, true)),
      0,
      BACK_Y,
      BACK_Z + 0.008,
      Math.PI / 2 - BACK_LEAN,
    ),
  )
  // a sewn seam across the padded face, following the lumbar curve
  const seamPath: Vector3[] = []
  for (let i = 0; i <= 24; i++) {
    const x = -0.172 + (0.344 * i) / 24
    seamPath.push(new Vector3(x, BACK.h + 0.0006, 0.05))
  }
  const seam = sweep({
    path: seamPath,
    radial: 5,
    size: () => [0.0024, 0.0024],
    ref: new Vector3(0, 0, 1),
    vTile: T,
  })
  tint(seam, '#7c8ba6')
  fabric.push(
    at(
      deform(seam, (p) => backShape(p, true)),
      0,
      BACK_Y,
      BACK_Z + 0.008,
      Math.PI / 2 - BACK_LEAN,
    ),
  )
  /* ---- T-arms ---- */
  for (const s of [-1, 1]) {
    plastic.push(
      sweep({
        path: arcPath(
          [
            [s * 0.05, 0.372, 0.03],
            [s * 0.14, 0.376, 0.03],
            [s * 0.226, 0.392, 0.03],
            [s * 0.25, 0.43, 0.03],
            [s * 0.256, 0.5, 0.03],
            [s * 0.253, 0.6, 0.03],
            [s * 0.252, 0.652, 0.03],
          ],
          24,
        ),
        radial: 8,
        size: () => [0.0075, 0.02],
        ref: new Vector3(0, 0, 1),
        exponent: 3.5,
        vTile: T,
      }),
    )
    // pad plate + soft pad
    plastic.push(
      at(woodBox(0.036, 0.008, 0.17, 0.003, 1, T, 'x'), s * 0.252, 0.653, 0.02),
    )
    const pad = deform(
      slab({
        hx: 0.029,
        hz: 0.135,
        h: 0.034,
        rc: 0.026,
        rt: 0.014,
        rbot: 0.009,
        tile: T,
        rings: 2,
        bottomRings: 1,
        arc: 5,
        straight: 3,
        bevel: 4,
      }),
      (p) => {
        p.y +=
          0.012 * smoothstep(0.03, 0.135, p.z) +
          0.004 * (1 - (p.x / 0.029) ** 2)
        p.y -= 0.006 * smoothstep(-0.04, -0.135, p.z)
      },
    )
    plastic.push(
      paint(at(pad, s * 0.252, 0.657, 0.02), (p, n, c) => {
        // hands wear the front of the pad to a paler polish
        const wear = n.y > 0.5 ? 0.35 * smoothstep(0.0, 0.11, p.z) : 0
        c.setScalar(1.3 + wear)
      }),
    )
  }

  /* ---- height lever + tilt knob ---- */
  chrome.push(
    sweep({
      path: [
        new Vector3(0.09, 0.352, 0.07),
        new Vector3(0.15, 0.352, 0.075),
        new Vector3(0.19, 0.356, 0.078),
      ],
      radial: 6,
      size: () => [0.0032, 0.0032],
      capEnd: true,
      vTile: T,
    }),
  )
  plastic.push(
    at(
      woodBox(0.036, 0.008, 0.024, 0.003, 1, T, 'x'),
      0.205,
      0.358,
      0.079,
      0,
      0.12,
      -0.08,
    ),
  )
  plastic.push(
    at(
      lathe(
        [
          [0, 0.02],
          [0.014, 0.019],
          [0.016, 0.012],
          [0.013, 0],
          [0.008, 0],
        ],
        { segments: 10, vTile: T, uTile: T },
      ),
      0,
      0.352,
      0.15,
      Math.PI / 2,
    ),
  )

  /* ---- gas-lift column ---- */
  // black telescoping bellows: a wave of folds over a gentle cone
  const bell: [number, number][] = []
  const folds = 9
  for (let i = 0; i <= folds * 4; i++) {
    const t = i / (folds * 4)
    const y = 0.128 + t * 0.14
    const base = 0.034 - 0.01 * t
    const wave = 0.0032 * (0.5 - 0.5 * Math.cos(t * folds * Math.PI * 2))
    bell.push([base + wave, y])
  }
  nylon.push(
    lathe(
      [
        [0.02, 0.124],
        [0.036, 0.124],
        [0.037, 0.128],
        ...bell,
        [0.024, 0.27],
        [0.021, 0.272],
      ],
      { segments: 18, crease: 3, vTile: T, uTile: T },
    ),
  )
  // the piston, from the bellows cap to the mechanism
  chrome.push(
    lathe(
      [
        [0, 0.268],
        [0.0185, 0.268],
        [0.0195, 0.272],
        [0.0195, 0.352],
        [0, 0.352],
      ],
      { segments: 14, crease: 3, vTile: 0.2, uTile: 0.2 },
    ),
  )
  chrome.push(
    lathe(
      [
        [0.0195, 0.268],
        [0.026, 0.268],
        [0.027, 0.271],
        [0.027, 0.277],
        [0.0195, 0.28],
      ],
      { segments: 14, vTile: 0.2, uTile: 0.2 },
    ),
  )

  /* ---- five-star base ---- */
  const rand = mulberry(29)
  const hub = lathe(
    [
      [0.012, 0.082],
      [0.05, 0.082],
      [0.056, 0.09],
      [0.056, 0.106],
      [0.048, 0.122],
      [0.036, 0.13],
      [0.03, 0.132],
    ],
    { segments: 16, vTile: T, uTile: T },
  )
  nylon.push(hub)
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.31
    const leg = sweep({
      path: arcPath(
        [
          [0.03, 0.112, 0],
          [0.09, 0.108, 0],
          [0.17, 0.094, 0],
          [0.24, 0.082, 0],
          [0.292, 0.075, 0],
        ],
        14,
      ),
      radial: 8,
      size: (t) => [
        MathUtils.lerp(0.03, 0.0155, t),
        MathUtils.lerp(0.024, 0.0105, t ** 0.8),
      ],
      ref: new Vector3(0, 1, 0),
      exponent: 3,
      capEnd: true,
      vTile: T,
    })
    nylon.push(at(leg, 0, 0, 0, 0, a, 0))

    // twin-wheel caster: swivel housing, hub, two tyres
    const cx = 0.292 * Math.cos(a)
    const cz = -0.292 * Math.sin(a)
    const swivel = a + (rand() - 0.5) * 1.3
    const dirX = Math.cos(swivel)
    const dirZ = -Math.sin(swivel)
    // stem + cup at the leg tip
    nylon.push(
      at(
        lathe(
          [
            [0.0, 0.078],
            [0.017, 0.078],
            [0.019, 0.072],
            [0.016, 0.064],
            [0.0, 0.064],
          ],
          { segments: 10, vTile: T, uTile: T },
        ),
        cx,
        0,
        cz,
      ),
    )
    // fork housing (rides the swivel angle)
    const fork = woodBox(0.04, 0.03, 0.034, 0.009, 2, T, 'x')
    nylon.push(
      at(fork, cx + dirX * 0.006, 0.058, cz + dirZ * 0.006, 0, swivel, 0),
    )
    const cap = woodBox(0.05, 0.008, 0.022, 0.003, 1, T, 'x')
    nylon.push(
      at(cap, cx + dirX * 0.006, 0.037, cz + dirZ * 0.006, 0, swivel, 0),
    )
    // axle runs across the housing: twin tyres either side
    const axleX = -dirZ
    const axleZ = dirX
    for (const side of [-1, 1]) {
      const w = wheelGeometry()
      at(
        w,
        cx + dirX * 0.014 + axleX * side * 0.0085,
        0.0245,
        cz + dirZ * 0.014 + axleZ * side * 0.0085,
        0,
        swivel,
        0,
      )
      wheels.push(w)
    }
    nylon.push(
      at(
        lathe(
          [
            [0, -0.006],
            [0.0075, -0.006],
            [0.0075, 0.006],
            [0, 0.006],
          ],
          { segments: 8 },
        ).rotateX(Math.PI / 2),
        cx + dirX * 0.014,
        0.0245,
        cz + dirZ * 0.014,
        0,
        swivel,
        0,
      ),
    )
  }

  return {
    fabric: mergeParts(fabric, true),
    plastic: mergeParts(plastic, true),
    chrome: mergeParts(chrome),
    nylon: mergeParts(nylon),
    wheels: mergeParts(wheels, true),
  }
}

/** One 25 mm-radius chair wheel, axle along local Z (before placement). */
function wheelGeometry(): BufferGeometry {
  const hw = 0.0055
  const r = 0.0245
  const profile: [number, number][] = [
    [0.0, -hw],
    [0.016, -hw],
    ...arc(r - 0.003, -hw + 0.003, 0.003, -Math.PI / 2, 0, 2),
    ...arc(r - 0.003, hw - 0.003, 0.003, 0, Math.PI / 2, 2),
    [0.016, hw],
    [0.0, hw],
  ]
  const g = lathe(profile, { segments: 14, crease: 0.9, vTile: T, uTile: T })
  paint(g, (p, _n, c) => {
    const rr = Math.hypot(p.x, p.z)
    // grey hub disc, black tyre
    const k = rr < 0.0165 ? 0.34 : 0.09
    c.setScalar(k)
  })
  // lathe axis is Y; the caller wants the axle horizontal
  g.rotateX(Math.PI / 2)
  return g
}

/* ---------- component ---------- */

function ChairBody() {
  const view = useSystem((s) => s.view)
  const rig = useRef<Group>(null!)
  const spin = useRef({ x: 0, v: 0, target: 0 })

  // the chair's geometry is its own turn of the staged first load (stage.ts)
  const geo = useStagedValue('chair.geo', buildChair)
  const res = useMemo(() => {
    const fab = fabricSet('#6c7b92', 5, T, 256, 2)
    const pla = plasticMaps(11, 256, 1)
    const nyl = nylonMaps(7, 256, T)
    const rub = rubberMaps(4, 256, 1)
    return { fab, pla, nyl, rub }
  }, [])
  useEffect(
    () => () => {
      if (geo) Object.values(geo).forEach((g) => g.dispose())
    },
    [geo],
  )
  useEffect(
    () => () => {
      res.fab.dispose()
      res.pla.dispose()
      res.nyl.dispose()
      res.rub.dispose()
    },
    [res],
  )

  useFrame((_, delta) => {
    const sp = spin.current
    // once the swivel has settled, stop integrating it every frame —
    // rotation/lean are already at rest, so there is nothing to redraw
    if (Math.abs(sp.v) < 1e-4 && Math.abs(sp.target - sp.x) < 1e-4) return
    const dt = Math.min(delta, 0.05)
    // underdamped swivel — overshoots, wobbles, settles
    sp.v += (26 * (sp.target - sp.x) - 4.2 * sp.v) * dt
    sp.x += sp.v * dt
    const g = rig.current
    g.rotation.y = sp.x
    // centrifugal lean while it whips around
    g.rotation.z = MathUtils.clamp(sp.v * 0.01, -0.05, 0.05)
  })

  if (!geo) return null
  return (
    /* Parked left of the paperwork on purpose: from the room camera the
       chair back sits in the gap between the bookcase and the desk props
       (paper stack, crumpled shots), so it occludes neither. */
    <group position={[-0.58, 0, -0.02]} rotation-y={0.35}>
      <group position={[0, 0, NUDGE]}>
        <Clickable
          enabled={view === 'room'}
          label="quality assurance seat"
          onActivate={() => {
            spin.current.target += Math.PI * 2 * (Math.random() < 0.3 ? -1 : 1)
            useWorld.getState().mark('chair')
            playClick()
          }}
        >
          <group ref={rig}>
            {/* upholstery: woven charcoal-blue with a velvety sheen */}
            <mesh geometry={geo.fabric} castShadow receiveShadow matrixAutoUpdate={false}>
              <meshPhysicalMaterial
                vertexColors
                map={res.fab.map}
                normalMap={res.fab.normalMap}
                normalScale={[0.5, 0.5]}
                roughnessMap={res.fab.roughnessMap}
                roughness={1}
                sheen={1}
                sheenColor="#9fb2d2"
                sheenRoughness={0.45}
              />
            </mesh>
            {/* moulded plastics: back shell, spine, arms, mechanism */}
            <mesh geometry={geo.plastic} castShadow receiveShadow matrixAutoUpdate={false}>
              <meshStandardMaterial
                vertexColors
                color="#2a2d33"
                normalMap={res.pla.normalMap}
                normalScale={[0.1, 0.1]}
                roughnessMap={res.pla.roughnessMap}
                roughness={0.78}
              />
            </mesh>
            {/* lever, screws, piston collar */}
            <mesh geometry={geo.chrome} castShadow matrixAutoUpdate={false}>
              <meshStandardMaterial
                color="#b4b9c2"
                metalness={1}
                roughness={0.34}
              />
            </mesh>
          </group>
          {/* base and column stay put while the seat swivels */}
          <mesh geometry={geo.nylon} castShadow receiveShadow matrixAutoUpdate={false}>
            <meshStandardMaterial
              color="#1d1f23"
              normalMap={res.nyl.normalMap}
              normalScale={[0.35, 0.35]}
              roughnessMap={res.nyl.roughnessMap}
              roughness={0.85}
            />
          </mesh>
          <mesh geometry={geo.wheels} castShadow matrixAutoUpdate={false}>
            <meshStandardMaterial
              vertexColors
              color="#ffffff"
              normalMap={res.rub.normalMap}
              normalScale={[0.25, 0.25]}
              roughnessMap={res.rub.roughnessMap}
              roughness={0.7}
            />
          </mesh>
        </Clickable>
      </group>
    </group>
  )
}

/* first load: mounted in its own turn of the staged build (stage.ts) */
export default function Chair() {
  return (
    <Staged id="chair">
      <ChairBody />
    </Staged>
  )
}
