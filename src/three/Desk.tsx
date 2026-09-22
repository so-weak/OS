import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { ContactShadows } from '@react-three/drei'
import {
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  MathUtils,
  Object3D,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
} from 'three'
import { identity } from '../data/resume'
import { useSystem } from '../os/store'
import { playClick } from '../os/sound'
import Clickable from './Clickable'
import Halo from './Halo'
import Mouse from './Mouse'
import { DESK, DESK_TOP, P } from './layout'
import {
  makeCanvas,
  makeLabelLines,
  makeSoftCircle,
  mulberry,
} from './textures'
import {
  brushedMetalMaps,
  fbmField,
  grimeTexture,
  plasticMaps,
  pbrFromFields,
  rubberMaps,
} from './tex/noise'
import {
  arc,
  at,
  lathe,
  mergeParts,
  paint,
  slab,
  sweep,
  tint,
  useWood,
  woodBox,
} from './tex/furniture'
import { rb } from './rbox'

/* =====================================================================
   The desk itself plus desk props: the live mouse + pad, a mug of chai
   that steams (and jiggles when poked), and the cable runs that tie the
   hardware together. The drawer pedestal lives in Drawers.tsx; the
   paper stack in Papers.tsx.

   The top is one bullnosed slab with a darker edge band and a glue line
   where the band meets the roll; everything under it is built from
   rounded, metric-UV'd boards so the grain runs the way real boards do.
   ===================================================================== */

const LEG_X = DESK.w / 2 - 0.06
const PANEL_H = DESK_TOP - DESK.thick

/* the two cable grommets, in desk space (3 cm from the back edge) */
const GROMMETS: [number, number][] = [
  [-0.665, -0.3],
  [0.25, -0.3],
]

interface DeskGeo {
  top: BufferGeometry
  frame: BufferGeometry
  grommet: BufferGeometry
}

function buildDesk(): DeskGeo {
  /* ---- the top: bullnose, edge band, glue line ---- */
  const top = slab({
    hx: DESK.w / 2,
    hz: DESK.d / 2,
    h: DESK.thick,
    rc: 0.014,
    rt: 0.012,
    rbot: 0.004,
    tile: 0.66,
    rings: 2,
    bottomRings: 1,
    arc: 6,
    straight: 3,
    bevel: 8,
  })
  paint(top, (_p, n, c) => {
    const ny = n.y
    if (Math.abs(ny) < 0.6) c.setRGB(0.8, 0.72, 0.62) // edge band: flatter, a touch warmer
    if (Math.abs(ny - 0.707) < 0.04) c.multiplyScalar(0.55) // glue line
    if (ny < -0.5) c.multiplyScalar(0.5)
  })
  at(top, 0, DESK_TOP - DESK.thick, 0)

  /* ---- everything under the top ---- */
  const parts: BufferGeometry[] = []
  for (const s of [-1, 1]) {
    parts.push(
      tint(
        at(
          woodBox(0.05, PANEL_H, 0.58, 0.007, 2, 0.4, 'y'),
          s * LEG_X,
          PANEL_H / 2,
          0,
        ),
        '#d2c2ae',
      ),
    )
  }
  // back modesty panel
  parts.push(
    tint(
      at(woodBox(1.56, 0.492, 0.02, 0.004, 2, 0.4, 'x'), 0, 0.4485, -0.28),
      '#b3a28d',
    ),
  )
  // front apron under the top, over the knee space
  parts.push(
    tint(
      at(
        woodBox(1.105, 0.07, 0.02, 0.004, 2, 0.4, 'x'),
        -0.2125,
        DESK_TOP - DESK.thick - 0.035,
        0.29,
      ),
      '#c4b39d',
    ),
  )
  // a stretcher between the end panels, low at the back
  parts.push(
    tint(
      at(woodBox(1.53, 0.05, 0.02, 0.004, 2, 0.4, 'x'), 0, 0.16, -0.27),
      '#a89783',
    ),
  )
  const frame = mergeParts(parts, true)

  /* ---- cable grommets: rubber ring, black throat ---- */
  const g: BufferGeometry[] = []
  for (const [gx, gz] of GROMMETS) {
    const ring = lathe(
      [
        [0.0165, -0.0025],
        [0.0245, -0.0025],
        [0.0245, 0.0016],
        [0.0228, 0.0033],
        [0.0192, 0.0036],
        [0.0168, 0.0022],
      ],
      { segments: 24, crease: 1.4, vTile: 0.05, uTile: 0.05 },
    )
    g.push(tint(at(ring, gx, DESK_TOP, gz), '#2a2c30'))
    const throat = lathe(
      [
        [0.0172, 0.0018],
        [0, 0.0018],
      ],
      { segments: 20 },
    )
    g.push(tint(at(throat, gx, DESK_TOP - 0.0012, gz), '#030304'))
  }
  return { top, frame, grommet: mergeParts(g, true) }
}

export default function Desk() {
  const gl = useThree((s) => s.gl)
  const aniso = gl.capabilities.getMaxAnisotropy()
  const wood = useWood(aniso, P.deskWood, '#3d2a18')
  const geo = useMemo(() => buildDesk(), [])
  useEffect(
    () => () => {
      Object.values(geo).forEach((g) => g.dispose())
    },
    [geo],
  )
  const dust = useMemo(() => {
    const t = grimeTexture(31, 512, 0.7)
    t.repeat.set(1, 1)
    return t
  }, [])
  useEffect(() => () => dust.dispose(), [dust])

  return (
    <group position={[DESK.x, 0, DESK.z]}>
      {/* varnished top and the boards under it share one set of maps */}
      <mesh geometry={geo.top} castShadow receiveShadow matrixAutoUpdate={false}>
        <meshPhysicalMaterial
          vertexColors
          map={wood.map}
          bumpMap={wood.bumpMap}
          bumpScale={0.0025}
          roughnessMap={wood.roughnessMap}
          roughness={0.7}
          clearcoat={0.28}
          clearcoatRoughness={0.38}
        />
      </mesh>
      <mesh geometry={geo.frame} castShadow receiveShadow matrixAutoUpdate={false}>
        <meshStandardMaterial
          vertexColors
          map={wood.map}
          bumpMap={wood.bumpMap}
          bumpScale={0.002}
          roughnessMap={wood.roughnessMap}
          roughness={0.85}
        />
      </mesh>
      <mesh geometry={geo.grommet} receiveShadow matrixAutoUpdate={false}>
        <meshStandardMaterial vertexColors roughness={0.6} />
      </mesh>

      {/* a film of dust and fingerprints on the varnish, under everything */}
      <mesh
        position={[0, DESK_TOP + 0.0002, 0]}
        rotation-x={-Math.PI / 2}
        renderOrder={-2}
      >
        <planeGeometry args={[DESK.w - 0.04, DESK.d - 0.04]} />
        <meshStandardMaterial
          map={dust}
          transparent
          opacity={0.5}
          roughness={1}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
        />
      </mesh>

      {/* contact darkening under the desk props (monitor base, keyboard,
          mouse pad, mug, papers). Baked once — frames=1, never Infinity
          (agreed in review); renderOrder -1 keeps it under the paper. */}
      <ContactShadows
        frames={1}
        position={[0, DESK_TOP + 0.0005, 0]}
        scale={[DESK.w, DESK.d]}
        resolution={512}
        blur={1.6}
        far={0.45}
        opacity={0.5}
        renderOrder={-1}
      />

      <Mouse />
      <Mug />
      <Nameplate />
    </group>
  )
}

/* ---------- brass nameplate at the front edge (U-P3) ---------- */
const NAME_TITLE = 'AI / ML ENGINEER' // identity.title, abbreviated to fit

function Nameplate() {
  const tex = useMemo(
    () =>
      makeLabelLines(
        [identity.name.toUpperCase(), NAME_TITLE],
        '#2a1c08',
        '#d4ad55',
        4,
        6,
        3.6,
      ),
    [],
  )
  useEffect(() => () => tex.dispose(), [tex])
  const brushed = useMemo(() => brushedMetalMaps(5, 256, 3), [])
  useEffect(() => () => brushed.dispose(), [brushed])

  /* desk-local: front edge inside the lamp's pool, between the paperwork
     and the keyboard, so it reads at night too (the right side is dark) */
  return (
    <group position={[-0.33, DESK_TOP, 0.28]} rotation-y={0.1}>
      {/* base bar */}
      <mesh position={[0, 0.004, 0]} castShadow>
        <roundedBoxGeometry args={rb(0.2, 0.008, 0.032, 0.003, 2)} />
        <meshStandardMaterial
          color="#8a6a2c"
          metalness={0.85}
          roughness={0.5}
          roughnessMap={brushed.roughnessMap}
          normalMap={brushed.normalMap}
          normalScale={[0.3, 0.3]}
        />
      </mesh>
      {/* the plate, hinged at its foot and leaning back */}
      <group position={[0, 0.008, -0.006]} rotation-x={-0.42}>
        <mesh position={[0, 0.0275, 0]} castShadow>
          <roundedBoxGeometry args={rb(0.2, 0.055, 0.004, 0.0016, 2)} />
          <meshStandardMaterial
            color="#b8913f"
            metalness={0.85}
            roughness={0.5}
            roughnessMap={brushed.roughnessMap}
            normalMap={brushed.normalMap}
            normalScale={[0.3, 0.3]}
          />
        </mesh>
        {/* enamelled face, not bare metal, so the fill light reads it */}
        <mesh position={[0, 0.0275, 0.0021]}>
          <planeGeometry args={[0.19, 0.0528]} />
          <meshStandardMaterial map={tex} metalness={0.15} roughness={0.45} />
        </mesh>
      </group>
    </group>
  )
}

/* ---------- chai mug: steams gently, jiggles when poked ---------- */
const PUFFS = 4

const MUG_H = 0.09
/** wall radius (outside) at height y */
const mugOuter = (y: number): number =>
  0.0304 + (0.0058 * Math.sin(Math.min(1, y / MUG_H) * 1.4)) / Math.sin(1.4)
const mugInner = (y: number): number => 0.029 + 0.0359 * (y - 0.01)

function buildMug(): { body: BufferGeometry; chai: BufferGeometry } {
  /* one profile, walked outside-up, over the rolled rim, inside-down */
  const yTop = 0.0866
  const wall: [number, number][] = []
  for (let i = 0; i <= 6; i++) {
    const y = 0.008 + ((yTop - 0.008) * i) / 6
    wall.push([mugOuter(y), y])
  }
  const rimR = (mugOuter(yTop) - mugInner(yTop)) / 2
  const rimC = (mugOuter(yTop) + mugInner(yTop)) / 2
  const inner: [number, number][] = []
  for (let i = 1; i <= 5; i++) {
    const y = yTop - ((yTop - 0.0102) * i) / 5
    inner.push([mugInner(y), y])
  }
  const body = lathe(
    [
      [0, 0.0],
      [0.0268, 0.0],
      [0.0282, 0.0012],
      [0.0292, 0.0034],
      [0.0299, 0.0058],
      ...wall,
      ...arc(rimC, yTop, rimR, 0, Math.PI, 6).slice(1),
      ...inner,
      [0.0286, 0.0085],
      [0.0, 0.0085],
    ],
    { segments: 48, crease: 1.15, vTile: 0.06, uTile: 0.06 },
  )
  paint(body, (p, n, c) => {
    const r = Math.hypot(p.x, p.z)
    const inside =
      n.x * p.x + n.z * p.z < 0 ||
      (p.y < 0.0888 && r < mugInner(p.y) + 0.0006 && n.y > 0.4)
    if (p.y < 0.0042 && n.y < 0.5)
      c.setRGB(0.68, 0.55, 0.38) // raw clay foot ring
    else if (inside && p.y > 0.0095)
      c.setRGB(0.82, 0.78, 0.68) // white interior glaze
    else if (p.y < 0.0095 && n.y > 0.5) c.setRGB(0.82, 0.78, 0.68)
    else c.setRGB(0.38, 0.05, 0.028) // red exterior glaze, pooling darker toward the foot
    if (!inside) c.multiplyScalar(0.85 + 0.15 * Math.min(1, p.y / 0.03))
  })

  const handle = sweep({
    path: new CatmullRomCurve3(
      [
        new Vector3(0.033, 0.0795, 0),
        new Vector3(0.0475, 0.0815, 0),
        new Vector3(0.0615, 0.0715, 0),
        new Vector3(0.0665, 0.0525, 0),
        new Vector3(0.0605, 0.0335, 0),
        new Vector3(0.0485, 0.0232, 0),
        new Vector3(0.032, 0.0212, 0),
      ],
      false,
      'centripetal',
    ).getPoints(26),
    radial: 10,
    size: (t) => [0.0042 + 0.0012 * Math.cos(t * Math.PI * 2) ** 2, 0.0068],
    ref: new Vector3(0, 0, 1),
    exponent: 3,
    capStart: true,
    capEnd: true,
    vTile: 0.06,
  })
  tint(handle, '#a63c2e')

  /* the chai: opaque, milky masala tea. Walked from the wall in to the
     middle so the surface faces up; the first three points are the
     meniscus. The profile is resampled finely so the vertex colours can
     carry a pale milk-skin ring and a few tea-leaf flecks. */
  const surface: [number, number][] = [
    [0.0318, 0.0762],
    [0.0307, 0.0744],
    [0.0292, 0.0734],
    [0.024, 0.0729],
    [0, 0.0728],
  ]
  const cprof: [number, number][] = []
  for (let i = 0; i < surface.length - 1; i++) {
    const [r0, y0] = surface[i]
    const [r1, y1] = surface[i + 1]
    const n = Math.max(1, Math.round((r0 - r1) / 0.0016))
    for (let k = 0; k < n; k++) {
      const f = k / n
      cprof.push([r0 + (r1 - r0) * f, y0 + (y1 - y0) * f])
    }
  }
  cprof.push(surface[surface.length - 1])
  const chai = lathe(cprof, { segments: 96, crease: 3 })

  const CHAI_R = 0.0318 // radius where the surface meets the wall
  const chaiMid = new Color('#e39851') // caramel-tan body
  const chaiRim = new Color('#f5be80') // lighter toward the edge
  const chaiSkin = new Color('#f6e4bd') // pale milk skin at the meniscus
  const chaiWall = new Color('#ac7040') // a shade darker against the glaze
  const chaiFleck = new Color('#3a1f0c') // tea leaf, crushed cardamom
  const rand = mulberry(1907)
  const flecks = Array.from({ length: 12 }, () => {
    const a = rand() * Math.PI * 2
    const d = Math.sqrt(rand()) * 0.82 * CHAI_R
    return { x: Math.sin(a) * d, z: Math.cos(a) * d, w: 0.3 + rand() * 0.3 }
  })
  paint(chai, (p, _n, c) => {
    const r = Math.hypot(p.x, p.z) / CHAI_R
    const a = Math.atan2(p.z, p.x)
    c.copy(chaiMid).lerp(chaiRim, MathUtils.smoothstep(r, 0.3, 0.85))
    // slow swirls where the milk has not quite mixed in
    c.multiplyScalar(
      1 + 0.045 * Math.sin(2 * a + 8 * r) + 0.03 * Math.sin(5 * a - 13 * r),
    )
    c.lerp(chaiSkin, 0.95 * MathUtils.smoothstep(r, 0.83, 0.91))
    c.lerp(chaiWall, 0.7 * MathUtils.smoothstep(r, 0.97, 1))
    for (const f of flecks) {
      const d = Math.hypot(p.x - f.x, p.z - f.z)
      if (d < 0.0022) c.lerp(chaiFleck, f.w * (1 - d / 0.0022))
    }
  })
  return { body: mergeParts([body, handle], true), chai }
}

/** the ring a wet mug leaves on varnish: a darker rim, an uneven edge and
    a faint splash. */
function makeRingStain(): CanvasTexture {
  const S = 256
  const ctx = makeCanvas(S, S)
  const rand = mulberry(77)
  ctx.clearRect(0, 0, S, S)
  ctx.translate(S / 2, S / 2)
  for (const [r, a, w] of [
    [96, 0.5, 4],
    [93, 0.2, 8],
    [99, 0.16, 6],
  ] as const) {
    ctx.strokeStyle = `rgba(52,28,12,${a})`
    ctx.lineWidth = w
    ctx.beginPath()
    const start = rand() * 0.6
    for (let i = 0; i <= 96; i++) {
      const t = start + (i / 96) * (Math.PI * 2 * 0.92)
      const rr = r + Math.sin(t * 3 + 1.3) * 2 + (rand() - 0.5) * 1.6
      const x = Math.cos(t) * rr
      const y = Math.sin(t) * rr
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  // a couple of drips
  ctx.fillStyle = 'rgba(52,28,12,0.32)'
  for (let i = 0; i < 4; i++) {
    const a = rand() * Math.PI * 2
    ctx.beginPath()
    ctx.arc(
      Math.cos(a) * 108,
      Math.sin(a) * 108,
      1.5 + rand() * 2,
      0,
      Math.PI * 2,
    )
    ctx.fill()
  }
  const t = new CanvasTexture(ctx.canvas)
  t.colorSpace = SRGBColorSpace
  return t
}

function Mug() {
  const view = useSystem((s) => s.view)
  const rig = useRef<Group>(null!)
  const squash = useRef({ s: 0, v: 0 })
  const boost = useRef(0)
  const puffs = useRef<(Mesh | null)[]>(
    Array.from({ length: PUFFS }, () => null),
  )

  const steamTex = useMemo(() => makeSoftCircle(), [])
  useEffect(() => () => steamTex.dispose(), [steamTex])
  const geo = useMemo(() => buildMug(), [])
  useEffect(
    () => () => {
      geo.body.dispose()
      geo.chai.dispose()
    },
    [geo],
  )
  const stain = useMemo(() => makeRingStain(), [])
  useEffect(() => () => stain.dispose(), [stain])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const t = state.clock.elapsedTime

    // poke jiggle (underdamped spring) — stop integrating once it has
    // settled back to rest instead of running the spring forever
    const sq = squash.current
    if (Math.abs(sq.s) > 1e-4 || Math.abs(sq.v) > 1e-4) {
      sq.v += (-110 * sq.s - 8 * sq.v) * dt
      sq.s += sq.v * dt
      rig.current.scale.set(1 - sq.s * 0.5, 1 + sq.s, 1 - sq.s * 0.5)
    }

    boost.current = Math.max(0, boost.current - dt / 1.4)

    // steam puffs — loop upward, sway, fade; billboarded to the camera
    puffs.current.forEach((m, i) => {
      if (!m) return
      const cycle = (t * (0.22 + i * 0.045) + i * 0.37) % 1
      m.position.set(
        Math.sin(cycle * 6.1 + i * 1.7) * 0.009,
        0.1 + cycle * 0.13,
        Math.cos(cycle * 5.3 + i) * 0.006,
      )
      const s = 0.014 + cycle * 0.03
      m.scale.set(s, s, s)
      m.quaternion.copy(state.camera.quaternion)
      const mat = m.material as MeshBasicMaterial
      mat.opacity = (1 - cycle) * cycle * 4 * (0.32 + boost.current * 0.4)
    })
  })

  return (
    <group position={[0.6, DESK_TOP, -0.1]}>
      {/* a soft pool of shade where the foot meets the varnish */}
      <mesh
        position={[0, 0.0007, 0]}
        rotation-x={-Math.PI / 2}
        renderOrder={-2}
      >
        <planeGeometry args={[0.1, 0.1]} />
        <meshBasicMaterial
          map={steamTex}
          color="#000000"
          transparent
          opacity={0.5}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-4}
          polygonOffsetUnits={-4}
        />
      </mesh>
      {/* the ring left by an earlier cup, half hidden under this one */}
      <mesh
        position={[0.004, 0.0004, 0.003]}
        rotation-x={-Math.PI / 2}
        renderOrder={-2}
      >
        <planeGeometry args={[0.105, 0.105]} />
        <meshStandardMaterial
          map={stain}
          transparent
          roughness={0.5}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-3}
          polygonOffsetUnits={-3}
        />
      </mesh>
      <Clickable
        enabled={view === 'room'}
        label="100 percent chai. off coffee, insomniac"
        onActivate={() => {
          squash.current.v = -1.6
          boost.current = 1
          playClick()
        }}
      >
        <group ref={rig}>
          {/* glazed stoneware: red outside, cream inside, raw clay foot */}
          <mesh geometry={geo.body} castShadow receiveShadow matrixAutoUpdate={false}>
            <meshPhysicalMaterial
              vertexColors
              roughness={0.16}
              clearcoat={1}
              clearcoatRoughness={0.06}
              envMapIntensity={1.3}
              specularIntensity={1}
            />
          </mesh>
          {/* chai: opaque and milky, satin rather than a mirror, with a
              pale skin ring at the meniscus and a few tea-leaf flecks. A
              little emissive stands in for the light that scatters through
              milk, so it stays caramel in the dim corner instead of going
              chocolate. */}
          <mesh geometry={geo.chai} matrixAutoUpdate={false}>
            <meshPhysicalMaterial
              vertexColors
              roughness={0.36}
              clearcoat={0.15}
              clearcoatRoughness={0.3}
              envMapIntensity={0.6}
              specularIntensity={0.7}
              emissive="#74563a"
              emissiveIntensity={0.6}
            />
          </mesh>
        </group>
      </Clickable>

      {/* steam (outside the jiggle rig so it keeps rising) */}
      {Array.from({ length: PUFFS }, (_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            puffs.current[i] = el
          }}
          position={[0, 0.11, 0]}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            map={steamTex}
            color="#cfd8e8"
            transparent
            opacity={0}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  )
}

/* =====================================================================
   Cables and the power strip
   ===================================================================== */

/** fabric-braid height field → normal + roughness (diagonal strands) */
function braidMaps(): ReturnType<typeof pbrFromFields> {
  const S = 64
  const h = new Float32Array(S * S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const a = Math.sin(((x / S) * 8 + (y / S) * 8) * Math.PI * 2)
      const b = Math.sin(((x / S) * 8 - (y / S) * 8) * Math.PI * 2)
      h[y * S + x] = 0.5 + 0.25 * a + 0.25 * b * (a > 0 ? 1 : -0.6)
    }
  }
  const rough = fbmField(S, 3, { octaves: 2, freq: 6 })
  return pbrFromFields(h, rough, S, {
    strength: 1.4,
    repeat: 1,
    roughLo: 0.7,
    roughHi: 1,
  })
}

interface CableProps {
  points: [number, number, number][]
  radius?: number
  color?: string
  braided?: boolean
  samples?: number
}

/** the sweep a Cable draws, factored out so the non-braided runs below can
    be built and merged without mounting a component per cable */
function buildCableGeo(
  points: [number, number, number][],
  radius: number,
  samples = 64,
): BufferGeometry {
  const curve = new CatmullRomCurve3(
    points.map((p) => new Vector3(...p)),
    false,
    'centripetal',
  )
  return sweep({
    path: curve.getPoints(samples),
    radial: 6,
    size: () => [radius, radius],
    vTile: Math.PI * 2 * radius,
  })
}

function Cable({
  points,
  radius = 0.005,
  color = P.cable,
  braided = false,
  samples = 64,
}: CableProps) {
  const geo = useMemo(
    () => buildCableGeo(points, radius, samples),
    [points, radius, samples],
  )
  useEffect(() => () => geo.dispose(), [geo])
  const braid = useMemo(() => (braided ? braidMaps() : null), [braided])
  useEffect(() => () => braid?.dispose(), [braid])
  return (
    <mesh geometry={geo} castShadow>
      <meshStandardMaterial
        color={color}
        roughness={braided ? 0.9 : 0.5}
        normalMap={braid?.normalMap}
        normalScale={[0.8, 0.8]}
        roughnessMap={braid?.roughnessMap}
      />
    </mesh>
  )
}

/** A moulded plug with its strain-relief boot: pins point along -Z, the
    boot runs out along +Z. Body, boot and pins share one vertex-coloured
    mesh. */
function buildPlug(): BufferGeometry {
  const p: BufferGeometry[] = []
  p.push(tint(woodBox(0.036, 0.036, 0.03, 0.007, 2, 0.05, 'x'), '#1d1f22'))
  // finger grips: two shallow ribs each side
  for (const s of [-1, 1]) {
    for (const z of [-0.004, 0.004]) {
      p.push(
        tint(
          at(
            woodBox(0.0026, 0.02, 0.003, 0.001, 1, 0.05, 'x'),
            s * 0.0182,
            0,
            z,
          ),
          '#15171a',
        ),
      )
    }
  }
  // strain-relief boot: ribbed taper
  const boot: [number, number][] = [[0.0085, 0.0]]
  for (let i = 0; i <= 12; i++) {
    const t = i / 12
    boot.push([
      0.0135 - 0.0075 * t + 0.0009 * Math.sin(t * Math.PI * 4),
      0.014 + t * 0.036,
    ])
  }
  boot.push([0.0055, 0.05], [0.0, 0.05])
  p.push(
    tint(
      at(lathe(boot, { segments: 12, crease: 2 }), 0, 0, 0, Math.PI / 2),
      '#17181b',
    ),
  )
  // pins: two round, one larger earth pin
  for (const [x, y, r, l] of [
    [-0.0095, -0.007, 0.0026, 0.015],
    [0.0095, -0.007, 0.0026, 0.015],
    [0, 0.0095, 0.0034, 0.017],
  ] as const) {
    p.push(
      tint(
        at(
          lathe(
            [
              [0, 0],
              [r, 0],
              [r, l - 0.002],
              [r * 0.7, l],
              [0, l],
            ],
            { segments: 6 },
          ),
          x,
          y,
          -0.015,
          -Math.PI / 2,
        ),
        '#9aa0a8',
      ),
    )
  }
  return mergeParts(p, true)
}

/** a small orange hook-and-loop tie, wrapped round a bundle */
function buildTie(): BufferGeometry {
  const loop: Vector3[] = []
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2
    loop.push(new Vector3(Math.cos(a) * 0.0095, 0, Math.sin(a) * 0.0095))
  }
  const band = sweep({
    path: loop,
    radial: 6,
    size: () => [0.0007, 0.0055],
    ref: new Vector3(0, 1, 0),
    exponent: 4,
    closed: true,
    vTile: 0.05,
  })
  band.rotateY(0)
  // the loose tail
  const tail = sweep({
    path: [
      new Vector3(0.0095, 0, 0),
      new Vector3(0.013, 0.0004, 0.006),
      new Vector3(0.0125, -0.002, 0.018),
    ],
    radial: 6,
    size: () => [0.0007, 0.0055],
    ref: new Vector3(0, 1, 0),
    exponent: 4,
    capEnd: true,
    vTile: 0.05,
  })
  return mergeParts([band, tail])
}

export function Cables() {
  const plug = useMemo(() => buildPlug(), [])
  const tie = useMemo(() => buildTie(), [])
  useEffect(
    () => () => {
      plug.dispose()
      tie.dispose()
    },
    [plug, tie],
  )

  /* the strip's pose is shared with PowerStrip below; the lamp plug sits
     in socket 1 with its boot pointing up */
  const pts = useMemo(() => {
    const strip = new Object3D()
    strip.position.set(-0.42, 0.022, -1.0)
    strip.rotation.set(0, 0.12, 0)
    strip.updateMatrix()
    const w = (x: number, y: number, z: number): [number, number, number] => {
      const v = new Vector3(x, y, z).applyMatrix4(strip.matrix)
      return [v.x, v.y, v.z]
    }
    return {
      lampBoot: w(-0.07, 0.02 + 0.018 + 0.05, 0),
      stripEnd: w(0.108, 0, 0),
      w,
    }
  }, [])
  const lb = pts.lampBoot
  const se = pts.stripEnd

  /* keyboard, monitor and strip->wall cables never move, are never
     clickable, and already share one flat #P.cable material (only the
     braided lamp cord above gets its own look) — merged into one mesh
     they cost one draw call and one shadow caster instead of three */
  const bundleGeo = useMemo(
    () =>
      mergeParts([
        buildCableGeo(
          [
            [0.17, 0.7615, -0.522],
            [0.178, 0.7505, -0.55],
            [0.215, 0.7458, -0.63],
            [0.27, 0.7455, -0.74],
            [0.305, 0.7455, -0.84],
            [0.3, 0.7455, -0.905],
            [0.3, 0.7405, -0.9205],
            [0.3, 0.68, -0.928],
            [0.302, 0.5, -0.94],
            [0.315, 0.3, -0.97],
            [0.35, 0.1, -0.99],
            [0.42, 0.012, -1.0],
            [0.6, 0.009, -0.99],
            [0.78, 0.02, -0.96],
            [0.92, 0.12, -0.93],
            [0.97, 0.2, -0.915],
            [0.99, 0.24, -0.884],
          ],
          0.0036,
        ),
        buildCableGeo(
          [
            [0.02, 0.95, -0.9],
            [0.045, 0.93, -0.985],
            [0.09, 0.8, -1.0],
            [0.13, 0.55, -1.015],
            [0.17, 0.25, -1.03],
            [0.24, 0.05, -1.04],
            [0.38, 0.0065, -1.045],
            [0.62, 0.0065, -1.03],
            [0.85, 0.02, -0.99],
            [0.93, 0.12, -0.95],
            [0.955, 0.17, -0.884],
          ],
          0.0055,
        ),
        buildCableGeo(
          [
            [se[0], se[1], se[2]],
            [se[0] + 0.03, 0.012, se[2] - 0.02],
            [-0.2, 0.0058, -1.04],
            [0.1, 0.0058, -1.052],
            [0.45, 0.0058, -1.05],
            [0.62, 0.0062, -1.04],
            [0.7, 0.03, -1.012],
            [0.735, 0.1, -0.985],
            [0.728, 0.16, -0.983],
            [0.72, 0.192, -0.992],
          ],
          0.0048,
        ),
      ]),
    [se],
  )
  useEffect(() => () => bundleGeo.dispose(), [bundleGeo])

  return (
    <group>
      {/* lamp cord: cloth-covered, base -> grommet -> down behind the desk
          -> a loose loop to the plug in the strip */}
      <Cable
        braided
        color="#2c2823"
        radius={0.0034}
        points={[
          [-0.6186, 0.7515, -0.809],
          [-0.6297, 0.7492, -0.8137],
          [-0.637, 0.7464, -0.835],
          [-0.628, 0.7458, -0.86],
          [-0.615, 0.7455, -0.905],
          [-0.615, 0.7405, -0.9205],
          [-0.615, 0.68, -0.926],
          [-0.616, 0.5, -0.935],
          [-0.612, 0.28, -0.965],
          [-0.606, 0.09, -0.985],
          [-0.585, 0.018, -0.992],
          [-0.55, 0.03, -0.994],
          [-0.526, 0.1, -0.994],
          [-0.51, 0.14, -0.993],
          [lb[0] - 0.006, lb[1] + 0.03, lb[2]],
          [lb[0], lb[1], lb[2]],
        ]}
      />
      {/* keyboard, monitor and strip->wall cables: one merged draw call
          (see bundleGeo above — same #P.cable look all three had before) */}
      <mesh geometry={bundleGeo} castShadow matrixAutoUpdate={false}>
        <meshStandardMaterial color={P.cable} roughness={0.5} />
      </mesh>

      {/* plug in the wall socket's lower outlet, boot toward the room */}
      <mesh geometry={plug} position={[0.72, 0.192, -1.04]}>
        <meshStandardMaterial vertexColors roughness={0.55} />
      </mesh>
      {/* the lamp's plug in the strip, boot straight up */}
      <mesh
        geometry={plug}
        position={pts.w(-0.07, 0.02 + 0.018 + 0.001, 0)}
        rotation={[-Math.PI / 2, 0, 0.12]}
      >
        <meshStandardMaterial vertexColors roughness={0.55} />
      </mesh>

      {/* orange velcro ties gathering the cables behind the desk */}
      <mesh
        geometry={tie}
        position={[0.1, 0.62, -1.008]}
        rotation={[0.08, 0.3, 0.1]}
      >
        <meshStandardMaterial color="#d0642c" roughness={0.95} />
      </mesh>
      <mesh
        geometry={tie}
        position={[0.3, 0.4, -0.955]}
        rotation={[0.05, 0.1, 0.06]}
      >
        <meshStandardMaterial color="#d0642c" roughness={0.95} />
      </mesh>

      <PowerStrip />
    </group>
  )
}

/* ---------- power strip: cream ABS, three earthed outlets, neon rocker ---------- */
function buildStrip(): {
  body: BufferGeometry
  recess: BufferGeometry
  trim: BufferGeometry
} {
  const T = 0.06
  const body = slab({
    hx: 0.1,
    hz: 0.035,
    h: 0.04,
    rc: 0.012,
    rt: 0.009,
    rbot: 0.004,
    tile: T,
    rings: 2,
    bottomRings: 1,
    arc: 5,
    straight: 2,
    bevel: 4,
  })
  paint(body, (p, n, c) => {
    // a little yellowing where hands and sun have been; darker toward the floor
    const y = 0.72 + 0.28 * Math.min(1, Math.max(0, p.y / 0.04))
    c.setRGB(0.86 * y, 0.82 * y, 0.68 * y)
    if (n.y < -0.5) c.multiplyScalar(0.6)
  })
  at(body, 0, -0.02, 0)

  const recess: BufferGeometry[] = []
  const trim: BufferGeometry[] = []
  for (let i = 0; i < 3; i++) {
    const x = -0.07 + i * 0.046
    // raised, slightly darker outlet plate
    trim.push(
      tint(
        at(woodBox(0.039, 0.0025, 0.052, 0.0012, 1, T, 'x'), x, 0.0215, 0),
        '#bdb69f',
      ),
    )
    for (const [hx, hz, r] of [
      [-0.0085, 0.009, 0.0027],
      [0.0085, 0.009, 0.0027],
      [0, -0.0105, 0.0036],
    ] as const) {
      recess.push(
        tint(
          at(
            lathe(
              [
                [r * 1.15, 0.0],
                [0, 0.0],
              ],
              { segments: 10 },
            ),
            x + hx,
            0.0229,
            hz,
          ),
          '#050506',
        ),
      )
    }
  }
  // switch bezel
  trim.push(
    tint(
      at(woodBox(0.03, 0.0025, 0.04, 0.0012, 1, T, 'x'), 0.072, 0.0215, 0),
      '#2a2c30',
    ),
  )
  // cord boot at the +x end
  const boot: [number, number][] = [[0.0075, 0]]
  for (let i = 0; i <= 8; i++) {
    const t = i / 8
    boot.push([
      0.0105 - 0.0045 * t + 0.0006 * Math.sin(t * Math.PI * 3),
      0.002 + t * 0.026,
    ])
  }
  boot.push([0.0045, 0.028], [0, 0.028])
  trim.push(
    tint(
      at(
        lathe(boot, { segments: 10, crease: 2 }),
        0.1,
        0,
        0,
        0,
        0,
        -Math.PI / 2,
      ),
      '#1c1e21',
    ),
  )
  return {
    body,
    recess: mergeParts(recess, true),
    trim: mergeParts(trim, true),
  }
}

function PowerStrip() {
  const geo = useMemo(() => buildStrip(), [])
  useEffect(
    () => () => {
      Object.values(geo).forEach((g) => g.dispose())
    },
    [geo],
  )
  const maps = useMemo(() => plasticMaps(17, 256, 1), [])
  const rub = useMemo(() => rubberMaps(9, 128, 1), [])
  useEffect(
    () => () => {
      maps.dispose()
      rub.dispose()
    },
    [maps, rub],
  )
  return (
    <group position={[-0.42, 0.022, -1.0]} rotation-y={0.12}>
      <mesh geometry={geo.body} castShadow receiveShadow>
        <meshStandardMaterial
          vertexColors
          normalMap={maps.normalMap}
          normalScale={[0.15, 0.15]}
          roughnessMap={maps.roughnessMap}
          roughness={0.85}
        />
      </mesh>
      <mesh geometry={geo.trim} receiveShadow>
        <meshStandardMaterial
          vertexColors
          normalMap={rub.normalMap}
          normalScale={[0.1, 0.1]}
          roughness={0.6}
        />
      </mesh>
      <mesh geometry={geo.recess}>
        <meshStandardMaterial vertexColors roughness={0.9} />
      </mesh>
      {/* glowing neon rocker */}
      <mesh position={[0.072, 0.0255, 0]} rotation-z={0.0}>
        <roundedBoxGeometry args={rb(0.02, 0.006, 0.03, 0.0025, 2)} />
        <meshStandardMaterial
          color={P.ledRed}
          emissive={P.ledRed}
          emissiveIntensity={0.9}
          roughness={0.35}
        />
      </mesh>
      <Halo
        color={P.ledRed}
        size={0.06}
        intensity={0.35}
        position={[0.075, 0.03, 0]}
      />
    </group>
  )
}
