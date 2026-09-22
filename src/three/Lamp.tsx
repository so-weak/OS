import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  CanvasTexture,
  Object3D,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
  type MeshStandardMaterial,
  type PointLight,
  type SpotLight,
} from 'three'
import { useSystem } from '../os/store'
import { playClick } from '../os/sound'
import { useWorld } from '../world'
import Clickable from './Clickable'
import { DESK_TOP } from './layout'
import { live } from './live'
import { MOUSE_LAYER } from './Mouse'
import { useRoom } from './roomState'
import { plasticMaps } from './tex/noise'
import {
  arc,
  at,
  helixPath,
  knurled,
  lathe,
  mergeParts,
  rod,
  sweep,
  woodBox,
} from './tex/furniture'
import { makeCanvas } from './textures'

/* =====================================================================
   Articulated desk lamp — the room's main warm light and an easter
   egg: clicking it snaps the light off and the whole mood changes.
   Intensity is damped, so it swells on rather than popping.

   An architect's lamp: a weighted enamel base on a rubber ring with a
   rocker switch, two parallelogram arms (a pair of rods per link with a
   coil spring between them), knurled brass pivots, and a rolled-rim
   dome shade — green enamel outside, warm off-white inside — over a
   glass bulb with a visible filament.

   Draw calls: enamel, dark metal, brass, springs, shade interior, bulb
   glass, bulb glow — seven for the whole lamp.
   ===================================================================== */

const WARM = '#ffb763'

/* ---- the pose --------------------------------------------------------
   How the lamp stands is these few numbers; the joints, neck, bulb and
   both lights are derived from them, so the linkage is consistent by
   construction. Lamp-local space: base at the origin, +x the way the arm
   leans, +y up, z across the arm plane. Angles are degrees above the
   horizontal unless said otherwise.

   A working pose: the lower arm rises steeply, the upper arm reaches on
   forward and a little up, and the head hangs from the end of it with
   the shade looking down at the desk, not at the monitor or the wall. */
const deg = (d: number): number => (d * Math.PI) / 180

/** which way the arm reaches over the desk: degrees from the desk's +x
    toward the front. Far enough round to clear the CRT's flank, and so
    the head sits over the open desk between the lamp and the keyboard */
const BEARING = 50
const LOWER_LEN = 0.212
const LOWER_ANG = deg(66)
const UPPER_LEN = 0.2
const UPPER_ANG = deg(18)
/** the shade's axis off vertical: its opening looks (90 - 30) = 60 deg
    below horizontal, forward and down onto the desk */
const TILT = deg(30)
/** shade apex (the swivel at the arm's end) to bulb centre */
const NECK_DIST = 0.048

/** three.js turns +x toward -z for a positive yaw */
const YAW = -deg(BEARING)

const J0 = new Vector3(0, 0.052, 0)
const ELB = new Vector3(
  J0.x + LOWER_LEN * Math.cos(LOWER_ANG),
  J0.y + LOWER_LEN * Math.sin(LOWER_ANG),
  0,
)
/** the swivel where the shade hangs from the end of the upper arm */
const NECK = new Vector3(
  ELB.x + UPPER_LEN * Math.cos(UPPER_ANG),
  ELB.y + UPPER_LEN * Math.sin(UPPER_ANG),
  0,
)
/** the way the shade opens: forward and down */
const AXIS = new Vector3(Math.sin(TILT), -Math.cos(TILT), 0)
/** the bulb sits just under the neck, inside the shade */
const BULB = NECK.clone().addScaledVector(AXIS, NECK_DIST)
/** where the shade's axis meets the desk: the middle of the pool */
const POOL = new Vector3(BULB.x + BULB.y * Math.tan(TILT), 0, 0)

/** Desk.tsx's lamp cord starts 0.0745 m from the base, heading this way
    in world (x, z). The boot keeps that world heading whatever the yaw,
    so the cord always meets it. */
const CORD_HEADING = Math.PI + 0.4
const BOOT_ANGLE = CORD_HEADING + YAW

const ROD_OFFSET = 0.0125

interface LampGeo {
  enamel: BufferGeometry
  dark: BufferGeometry
  brass: BufferGeometry
  spring: BufferGeometry
  shadeIn: BufferGeometry
  glass: BufferGeometry
  glow: BufferGeometry
}

/** Dome shade about local Y, opening toward -y. Returns exterior (with
    the rolled rim) and interior (top-to-bottom, facing the axis). */
function buildShade(): { outer: BufferGeometry; inner: BufferGeometry } {
  const a = 0.0585
  const b = 0.092
  const base = -0.042
  const dome: [number, number][] = []
  const steps = 12
  const phiMax = Math.acos(0.0135 / a)
  for (let i = 0; i <= steps; i++) {
    const phi = (i / steps) * phiMax
    dome.push([a * Math.cos(phi), base + b * Math.sin(phi)])
  }
  // exterior: rolled rim (under and around the lip), then up the dome
  const outer = lathe(
    [
      ...arc(a - 0.0028, base, 0.0028, Math.PI, Math.PI * 2, 7),
      ...dome.slice(1),
      [0.0135, base + b * Math.sin(phiMax) + 0.0035],
      [0.0108, base + b * Math.sin(phiMax) + 0.0035],
    ],
    { segments: 40, crease: 1.2, vTile: 0.08, uTile: 0.08 },
  )
  // interior wall, from the neck hole down to the inner rim
  const ai = a - 0.0056
  const bi = b - 0.004
  const inner: [number, number][] = []
  const phiIn = Math.acos(0.0108 / ai)
  for (let i = 0; i <= steps; i++) {
    const phi = phiIn * (1 - i / steps)
    inner.push([ai * Math.cos(phi), base + bi * Math.sin(phi)])
  }
  const shadeIn = lathe(inner, { segments: 40, crease: 2 })
  return { outer, inner: shadeIn }
}

function buildLamp(): LampGeo {
  const enamel: BufferGeometry[] = []
  const dark: BufferGeometry[] = []
  const brass: BufferGeometry[] = []
  const spring: BufferGeometry[] = []
  const seg = { segments: 40, crease: 1.1, vTile: 0.08, uTile: 0.08 }

  /* ---- weighted base: rubber ring, cast enamel body, turret, switch ---- */
  dark.push(
    lathe(
      [
        [0.055, 0.0],
        [0.0648, 0.0],
        [0.0668, 0.0018],
        [0.0668, 0.0072],
        [0.0648, 0.0092],
        [0.055, 0.0092],
      ],
      { segments: 40, crease: 1.2, vTile: 0.08, uTile: 0.08 },
    ),
  )
  enamel.push(
    lathe(
      [
        [0, 0.0085],
        [0.061, 0.0085],
        [0.0645, 0.0115],
        [0.0655, 0.016],
        [0.0645, 0.0205],
        [0.0605, 0.0245],
        [0.052, 0.0275],
        [0.038, 0.0305],
        [0.029, 0.0345],
        [0.0245, 0.041],
        [0.0225, 0.05],
        [0.0, 0.05],
      ],
      { ...seg, segments: 40 },
    ),
  )
  // brass collar where the turret meets the dome
  brass.push(
    lathe(
      [
        [0.0262, 0.0352],
        [0.0292, 0.0362],
        [0.0292, 0.0402],
        [0.0262, 0.0415],
      ],
      { segments: 28, vTile: 0.06, uTile: 0.06 },
    ),
  )
  // cheek plates that carry the first pivot
  for (const z of [-0.0125, 0.0125]) {
    enamel.push(
      at(
        woodBox(0.028, 0.03, 0.0045, 0.0018, 1, 0.06, 'x'),
        0,
        J0.y + 0.002,
        z,
      ),
    )
  }
  // rocker switch on the front shoulder
  const swA = 1.05
  const swR = 0.049
  const sw = woodBox(0.017, 0.007, 0.011, 0.0022, 1, 0.06, 'x').rotateX(0.22)
  dark.push(
    at(
      sw,
      swR * Math.cos(swA),
      0.0275,
      swR * Math.sin(swA),
      0,
      Math.PI / 2 - swA,
      0,
    ),
  )

  // the cord leaves the base through a moulded strain-relief boot, on
  // the side of the base that faces the desk's grommet (BOOT_ANGLE keeps
  // its tip where Desk.tsx's cord starts, whichever way the lamp is yawed)
  dark.push(
    at(
      lathe(
        [
          [0.0058, -0.003],
          [0.0056, 0.0],
          [0.0046, 0.006],
          [0.0037, 0.0125],
          [0.003, 0.0132],
          [0, 0.0132],
        ],
        { segments: 10, crease: 1.4 },
      )
        .rotateZ(Math.PI / 2)
        .rotateY(Math.PI - BOOT_ANGLE),
      0.0625 * Math.cos(BOOT_ANGLE),
      0.0095,
      0.0625 * Math.sin(BOOT_ANGLE),
    ),
  )

  /* ---- parallelogram arms: two rods a link, a spring between ---- */
  const link = (from: Vector3, to: Vector3): void => {
    const d = new Vector3().subVectors(to, from)
    const springTurns = Math.round(d.length() * 74)
    d.normalize()
    const n = new Vector3(-d.y, d.x, 0)
    for (const s of [-1, 1]) {
      const o = n.clone().multiplyScalar(s * ROD_OFFSET)
      dark.push(rod([from.clone().add(o), to.clone().add(o)], 0.0032, 8))
    }
    const a = from.clone().addScaledVector(d, 0.0125)
    const b = to.clone().addScaledVector(d, -0.0125)
    const path = helixPath(a, b, 0.0048, springTurns, 6)
    spring.push(
      sweep({ path, radial: 4, size: () => [0.00085, 0.00085], vTile: 0.02 }),
    )
    // a small hook at each end so the spring reads as anchored
    spring.push(
      rod(
        [
          a.clone().addScaledVector(d, -0.004),
          a.clone().addScaledVector(d, 0.002),
        ],
        0.0011,
        5,
      ),
    )
    spring.push(
      rod(
        [
          b.clone().addScaledVector(d, -0.002),
          b.clone().addScaledVector(d, 0.004),
        ],
        0.0011,
        5,
      ),
    )
  }
  link(J0, ELB)
  link(ELB, NECK)

  // pivots: dark hub between two brass knurled knobs
  for (const p of [J0, ELB, NECK]) {
    dark.push(
      at(
        lathe(
          [
            [0, -0.0115],
            [0.0105, -0.0115],
            [0.0105, 0.0115],
            [0, 0.0115],
          ],
          { segments: 16, vTile: 0.06, uTile: 0.06 },
        ).rotateX(Math.PI / 2),
        p.x,
        p.y,
        0,
      ),
    )
    for (const z of [-1, 1]) {
      brass.push(at(knurled(0.0082, 0.0075, 14), p.x, p.y, z * 0.0165))
    }
  }

  /* ---- shade, socket, bulb ---- */
  const sh = buildShade()
  enamel.push(at(sh.outer, BULB.x, BULB.y, 0, 0, 0, TILT))
  const shadeIn = at(sh.inner, BULB.x, BULB.y, 0, 0, 0, TILT)

  // brass socket up into the neck
  brass.push(
    at(
      lathe(
        [
          [0.0092, 0.0195],
          [0.0098, 0.0205],
          [0.0098, 0.0455],
          [0.0092, 0.0465],
          [0.0, 0.0465],
        ],
        { segments: 18, crease: 1.2, vTile: 0.06, uTile: 0.06 },
      ),
      BULB.x,
      BULB.y,
      0,
      0,
      0,
      TILT,
    ),
  )
  // screw threads on the bulb cap, along the shade axis
  for (let i = 0; i < 3; i++) {
    const dist = 0.0245 + i * 0.0026
    brass.push(
      at(
        lathe(
          [
            [0.0086, 0],
            [0.0102, 0.0009],
            [0.0086, 0.0018],
          ],
          { segments: 16 },
        ),
        BULB.x - Math.sin(TILT) * dist,
        BULB.y + Math.cos(TILT) * dist,
        0,
        0,
        0,
        TILT,
      ),
    )
  }
  const glass = at(
    lathe(
      [
        [0, -0.0285],
        [0.0065, -0.0275],
        [0.0132, -0.0225],
        [0.0186, -0.0135],
        [0.0207, -0.0025],
        [0.0198, 0.0072],
        [0.0148, 0.0152],
        [0.0098, 0.0194],
        [0.0088, 0.0212],
        [0, 0.0212],
      ],
      { segments: 24, crease: 2 },
    ),
    BULB.x,
    BULB.y,
    0,
    0,
    0,
    TILT,
  )
  // filament: a coil between two support wires, glowing
  const fa = new Vector3(-0.0065, -0.0035, 0)
  const fb = new Vector3(0.0065, -0.0035, 0)
  const coil = sweep({
    path: helixPath(fa, fb, 0.0017, 5, 6),
    radial: 4,
    size: () => [0.00055, 0.00055],
    vTile: 0.02,
  })
  const posts = [
    rod(
      [new Vector3(-0.0065, -0.0035, 0), new Vector3(-0.0045, 0.0125, 0)],
      0.0004,
      4,
    ),
    rod(
      [new Vector3(0.0065, -0.0035, 0), new Vector3(0.0045, 0.0125, 0)],
      0.0004,
      4,
    ),
  ]
  const glow = mergeParts(
    [coil, ...posts].map((g) => at(g, BULB.x, BULB.y, 0, 0, 0, TILT)),
  )

  return {
    enamel: mergeParts(enamel),
    dark: mergeParts(dark),
    brass: mergeParts(brass),
    spring: mergeParts(spring),
    shadeIn,
    glass,
    glow,
  }
}

/** A 1×64 warm gradient for the shade interior: hottest at the neck,
    fading toward the rim. */
function makeInnerGlow(): CanvasTexture {
  const ctx = makeCanvas(4, 64)
  const g = ctx.createLinearGradient(0, 0, 0, 64)
  // canvas top = v 1 = the rim; canvas bottom = v 0 = the neck
  g.addColorStop(0, '#8a6a44')
  g.addColorStop(0.65, '#f0d2a4')
  g.addColorStop(1, '#ffffff')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 4, 64)
  const t = new CanvasTexture(ctx.canvas)
  t.colorSpace = SRGBColorSpace
  return t
}

export default function Lamp() {
  const view = useSystem((s) => s.view)
  const toggleLamp = useRoom((s) => s.toggleLamp)

  const spot = useRef<SpotLight>(null!)
  const spill = useRef<PointLight>(null!)
  const bulbMat = useRef<MeshStandardMaterial>(null!)
  const innerMat = useRef<MeshStandardMaterial>(null!)

  const target = useMemo(() => {
    const o = new Object3D()
    o.position.copy(POOL)
    return o
  }, [])

  const geo = useMemo(() => buildLamp(), [])
  const res = useMemo(
    () => ({ pla: plasticMaps(23, 256, 3), glow: makeInnerGlow() }),
    [],
  )
  useEffect(
    () => () => {
      Object.values(geo).forEach((g) => g.dispose())
    },
    [geo],
  )
  useEffect(
    () => () => {
      res.pla.dispose()
      res.glow.dispose()
    },
    [res],
  )

  // the mouse sits on its own render layer (see Mouse.tsx); the lamp
  // must still throw its shadow
  useLayoutEffect(() => {
    spot.current.shadow.camera.layers.enable(MOUSE_LAYER)
  }, [])

  useFrame(() => {
    // live.lamp is damped once per frame in WorldFrame (≈0.3 s swell)
    const level = live.lamp
    spot.current.intensity = level * 3.2
    spill.current.intensity = level * 0.55
    bulbMat.current.emissiveIntensity = level * 2.4
    innerMat.current.emissiveIntensity = level * 1.1
  })

  return (
    <group position={[-0.55, DESK_TOP, -0.78]} rotation-y={YAW}>
      <Clickable
        enabled={view === 'room'}
        label="mood lighting"
        onActivate={() => {
          playClick()
          // the ledger: switching the mood off is the secret
          if (useRoom.getState().lampOn) useWorld.getState().mark('lamp')
          toggleLamp()
        }}
      >
        {/* cast base, turret cheeks and the dome shade: green enamel */}
        <mesh geometry={geo.enamel} castShadow receiveShadow matrixAutoUpdate={false}>
          <meshPhysicalMaterial
            color="#1f5a45"
            roughness={0.42}
            metalness={0.15}
            clearcoat={0.55}
            clearcoatRoughness={0.3}
            normalMap={res.pla.normalMap}
            normalScale={[0.035, 0.035]}
          />
        </mesh>
        {/* rubber ring, rods, hubs, rocker */}
        <mesh geometry={geo.dark} castShadow matrixAutoUpdate={false}>
          <meshStandardMaterial
            color="#1a1c1f"
            metalness={0.55}
            roughness={0.42}
          />
        </mesh>
        {/* knurled knobs, collar, socket */}
        <mesh geometry={geo.brass} castShadow matrixAutoUpdate={false}>
          <meshStandardMaterial
            color="#b58c4f"
            metalness={1}
            roughness={0.36}
          />
        </mesh>
        {/* the counterbalance springs */}
        <mesh geometry={geo.spring} matrixAutoUpdate={false}>
          <meshStandardMaterial
            color="#a4a9b1"
            metalness={1}
            roughness={0.34}
          />
        </mesh>
        {/* the inside of the shade, lit warm by the bulb */}
        <mesh geometry={geo.shadeIn} matrixAutoUpdate={false}>
          <meshStandardMaterial
            ref={innerMat}
            color="#6e5c46"
            emissive={WARM}
            emissiveMap={res.glow}
            emissiveIntensity={1.1}
            roughness={0.7}
          />
        </mesh>
        {/* glass envelope — tiny and almost fully transparent, so the
            clearcoat layer a Physical material would add here never reads;
            Standard gets the same soft highlight from roughness alone */}
        <mesh geometry={geo.glass} matrixAutoUpdate={false}>
          <meshStandardMaterial
            color="#fff6e4"
            transparent
            opacity={0.2}
            roughness={0.04}
            depthWrite={false}
          />
        </mesh>
        {/* hot filament */}
        <mesh geometry={geo.glow} matrixAutoUpdate={false}>
          <meshStandardMaterial
            ref={bulbMat}
            color="#fff4dc"
            emissive={WARM}
            emissiveIntensity={2.4}
            toneMapped={false}
          />
        </mesh>
      </Clickable>

      {/* the light itself (outside Clickable so raycasts stay cheap) */}
      <primitive object={target} />
      <spotLight
        ref={spot}
        position={BULB}
        target={target}
        color={WARM}
        intensity={3.2}
        angle={0.72}
        penumbra={0.55}
        distance={3.2}
        decay={1.8}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-near={0.05}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      <pointLight
        ref={spill}
        position={[BULB.x, BULB.y + 0.07, BULB.z]}
        color={WARM}
        intensity={0.55}
        distance={2.4}
        decay={2}
      />
    </group>
  )
}
