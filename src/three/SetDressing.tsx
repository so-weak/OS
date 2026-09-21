import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  CatmullRomCurve3,
  Color,
  DoubleSide,
  Matrix4,
  MeshStandardMaterial,
  SphereGeometry,
  TubeGeometry,
  Vector3,
  type CanvasTexture,
  type InstancedMesh,
} from 'three'
import { reducedMotion } from '../world'
import { WINDOW } from './layout'
import Crocs from './Crocs'
import { FramedPrint } from './Room'
import { makeFeatheredRect } from './textures'
import { plasterMaps } from './tex/noise'
import {
  bagGeo,
  bluePotGeo,
  boxesGeo,
  cardsGeo,
  headphonesGeo,
  heartLeafGeometry,
  hookGeo,
  leafGeometry,
  makeBlockPrint,
  makeBluePotTexture,
  makeCardAtlas,
  makeCardboardMaps,
  makeCorkMaps,
  makeGrainMaps,
  makeLeafTexture,
  makeMandalaArt,
  makePothosTexture,
  plantLayout,
  potGeo,
  pothosLayout,
  radiatorGeo,
  sweep,
  type ProfilePt,
} from './tex/room'
import { rb } from './rbox'

/* =====================================================================
   Set dressing around the room's edges: a rubber plant, a cork board of
   pinned cards, headphones on a hook, a radiator under the window, a pair
   of flip-flops kicked off under the desk, a stack of boxes in the corner
   — the things a person who lives here would have. Owned by the room
   builder; mounted once from Scene.tsx. The desk is the hero, so
   dressing stays at the edges and nothing sits between the camera and
   the CRT.

   Everything is a handful of merged meshes; the leaves are one
   InstancedMesh with a vertex-shader sway (frozen under reduced motion).
   ===================================================================== */

const WALL_Z = -1.08

export default function SetDressing() {
  // one clock for every swaying leaf (both plants read it in their shader)
  useFrame((state) => {
    SWAY.value = state.clock.elapsedTime
  })
  return (
    <group>
      <Radiator />
      <SillPlant />
      <Headphones position={[0.445, 1.14, WALL_Z + 0.0005]} />
      <CorkBoard position={[0.87, 1.06, WALL_Z + 0.0005]} tilt={0.008} />
      <Crocs position={[-0.02, 0, -0.86]} />
      {/* the right-hand side: a rubber plant, boxes, a print, a cloth bag */}
      <Plant position={[1.4, 0, -0.84]} />
      <Boxes position={[1.99, 0, 0.78]} />
      <RightWall />
    </group>
  )
}

/* ---------- a soft drop shadow on the wall behind wall-hung things ---------- */
function WallShadow({
  blob,
  w,
  h,
  x = 0,
  y = 0,
  opacity = 0.5,
}: {
  blob: CanvasTexture
  w: number
  h: number
  x?: number
  y?: number
  opacity?: number
}) {
  return (
    <mesh position={[x, y, -0.0004]} renderOrder={2}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={blob} color="#000000" transparent opacity={opacity} depthWrite={false} />
    </mesh>
  )
}

/** a leaf material whose vertex shader sways each leaf about its base:
    quiet (a few mm at the tip), phase from the instance's own position */
function leafMaterial(
  map: CanvasTexture,
  length: number,
  swayAmp: number,
  roughness: number,
): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ map, roughness, side: DoubleSide, envMapIntensity: 1.4 })
  const amp = { value: reducedMotion() ? 0 : swayAmp }
  const invLen = { value: 1 / length }
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = SWAY
    sh.uniforms.uAmp = amp
    sh.uniforms.uInvLen = invLen
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uTime;\nuniform float uAmp;\nuniform float uInvLen;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float tipK = position.z * uInvLen;
        float ph = instanceMatrix[3].x * 6.0 + instanceMatrix[3].y * 9.0 + instanceMatrix[3].z * 4.0;
        transformed.y += sin(uTime * 1.25 + ph) * uAmp * tipK * tipK;
        transformed.x += cos(uTime * 0.85 + ph * 0.7) * uAmp * 0.6 * tipK * tipK;`,
      )
  }
  return m
}

/* ---------- the rubber plant ---------- */

/** shared clock for the leaf sway; written in a frame loop, read by the shader */
const SWAY = { value: 0 }

function Plant({ position }: { position: [number, number, number] }) {
  const layout = useMemo(() => plantLayout(12, 26), [])
  const leafGeo = useMemo(() => leafGeometry(), [])
  const leafTex = useMemo(() => makeLeafTexture(3), [])
  const stemGeo = useMemo(
    () => new TubeGeometry(new CatmullRomCurve3(layout.stem), 40, 0.0105, 8),
    [layout],
  )
  const pot = useMemo(() => potGeo(), [])
  const clay = useMemo(() => {
    const m = plasterMaps(41, 256, 1)
    m.normalMap.repeat.set(8, 2)
    m.roughnessMap.repeat.set(8, 2)
    return m
  }, [])
  const soil = useMemo(() => {
    const g = new SphereGeometry(0.1, 20, 6)
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) {
      const n = Math.sin(p.getX(i) * 91) * Math.cos(p.getZ(i) * 77)
      p.setY(i, p.getY(i) * 0.09 + n * 0.0016)
    }
    g.computeVertexNormals()
    return g
  }, [])
  const leafMat = useMemo(() => leafMaterial(leafTex, 0.26, 0.007, 0.36), [leafTex])
  const leaves = useRef<InstancedMesh>(null)

  useEffect(() => {
    const m = leaves.current
    if (!m) return
    const c = new Color()
    layout.leaves.forEach((l, i) => {
      m.setMatrixAt(i, l.matrix)
      m.setColorAt(i, c.setScalar(l.shade))
    })
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [layout])

  useEffect(
    () => () => {
      leafGeo.dispose()
      leafTex.dispose()
      stemGeo.dispose()
      pot.pot.dispose()
      pot.saucer.dispose()
      clay.dispose()
      soil.dispose()
      leafMat.dispose()
    },
    [leafGeo, leafTex, stemGeo, pot, clay, soil, leafMat],
  )

  return (
    <group position={position}>
      <mesh geometry={pot.saucer} receiveShadow>
        <meshStandardMaterial color="#8f4c2c" roughness={1} normalMap={clay.normalMap} normalScale={[0.3, 0.3]} roughnessMap={clay.roughnessMap} />
      </mesh>
      <group position={[0, 0.012, 0]}>
        <mesh geometry={pot.pot} castShadow receiveShadow>
          <meshStandardMaterial color="#b4643b" roughness={1} normalMap={clay.normalMap} normalScale={[0.3, 0.3]} roughnessMap={clay.roughnessMap} />
        </mesh>
        <mesh geometry={soil} position={[0, 0.183, 0]}>
          <meshStandardMaterial color="#2a1c12" roughness={1} />
        </mesh>
        {/* stem and leaves rise from the soil */}
        <group position={[0, 0.185, 0]}>
          <mesh geometry={stemGeo}>
            <meshStandardMaterial color="#5f5a36" roughness={0.7} />
          </mesh>
          <instancedMesh
            ref={leaves}
            args={[leafGeo, leafMat, layout.leaves.length]}
            frustumCulled={false}
            castShadow
          />
        </group>
      </group>
    </group>
  )
}

/* ---------- a trailing pothos in a blue pot, on the window sill ---------- */
function SillPlant() {
  const lay = useMemo(() => pothosLayout(0.045, 8), [])
  const leafGeo = useMemo(() => heartLeafGeometry(), [])
  const tex = useMemo(() => makePothosTexture(5), [])
  const potTex = useMemo(() => makeBluePotTexture(), [])
  const pot = useMemo(() => bluePotGeo(), [])
  const mat = useMemo(() => leafMaterial(tex, 0.056, 0.0035, 0.42), [tex])
  const leaves = useRef<InstancedMesh>(null)
  useEffect(() => {
    const m = leaves.current
    if (!m) return
    const c = new Color()
    lay.leaves.forEach((l, i) => {
      m.setMatrixAt(i, l.matrix)
      m.setColorAt(i, c.setScalar(l.shade))
    })
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [lay])
  useEffect(
    () => () => {
      lay.vines.dispose()
      leafGeo.dispose()
      tex.dispose()
      potTex.dispose()
      pot.pot.dispose()
      pot.soil.dispose()
      mat.dispose()
    },
    [lay, leafGeo, tex, potTex, pot, mat],
  )
  return (
    <group
      position={[
        WINDOW.x + 0.26,
        WINDOW.y - WINDOW.frameH / 2 + 0.0015,
        WINDOW.wallZ + 0.04,
      ]}
    >
      <mesh geometry={pot.pot} castShadow>
        <meshStandardMaterial map={potTex} roughness={0.22} envMapIntensity={1.4} />
      </mesh>
      <mesh geometry={pot.soil}>
        <meshStandardMaterial color="#2a1c12" roughness={1} />
      </mesh>
      <mesh geometry={lay.vines}>
        <meshStandardMaterial color="#4a6a34" roughness={0.7} />
      </mesh>
      <instancedMesh
        ref={leaves}
        args={[leafGeo, mat, lay.leaves.length]}
        frustumCulled={false}
      />
    </group>
  )
}

/* ---------- the right-hand wall: a mandala print and a cloth bag ---------- */
function RightWall() {
  const art = useMemo(() => makeMandalaArt(), [])
  const blob = useMemo(() => makeFeatheredRect(64, 64, 0.6), [])
  const print = useMemo(() => makeBlockPrint(), [])
  const bag = useMemo(() => bagGeo(), [])
  const hook = useMemo(() => hookGeo(), [])
  useEffect(
    () => () => {
      art.dispose()
      blob.dispose()
      print.dispose()
      bag.body.dispose()
      bag.strap.dispose()
      hook.dispose()
    },
    [art, blob, print, bag, hook],
  )
  return (
    <group>
      <FramedPrint
        tex={art}
        w={0.3}
        h={0.375}
        frame="wood"
        matBorder={0.03}
        position={[2.2495, 1.48, 0.28]}
        rotationY={-Math.PI / 2}
        tilt={-0.008}
        blob={blob}
        glow={0.05}
      />
      {/* a hook, and a cotton bag hung by its straps */}
      <group position={[2.2495, 1.52, 0.86]} rotation-y={-Math.PI / 2}>
        <mesh geometry={hook} castShadow>
          <meshStandardMaterial color="#b9bec6" metalness={0.9} roughness={0.3} />
        </mesh>
        <group position={[0, -0.103, 0.036]} rotation-y={0.05}>
          <mesh geometry={bag.body} castShadow receiveShadow>
            <meshStandardMaterial map={print} roughness={0.95} />
          </mesh>
          <mesh geometry={bag.strap} castShadow>
            <meshStandardMaterial color="#cdb98f" roughness={0.95} />
          </mesh>
        </group>
      </group>
    </group>
  )
}

/* ---------- headphones on a hook ---------- */
function Headphones({ position }: { position: [number, number, number] }) {
  const hp = useMemo(() => headphonesGeo(), [])
  const hook = useMemo(() => hookGeo(), [])
  useEffect(
    () => () => {
      hp.dispose()
      hook.dispose()
    },
    [hp, hook],
  )
  return (
    <group position={position}>
      <mesh geometry={hook} castShadow>
        <meshStandardMaterial color="#b9bec6" metalness={0.9} roughness={0.3} />
      </mesh>
      {/* the band drapes over the peg: its inner surface rests on it */}
      <mesh
        geometry={hp}
        position={[0, 0.0113, 0.0335]}
        rotation={[0.04, 0.16, 0.03]}
        castShadow
      >
        <meshStandardMaterial vertexColors metalness={0.25} roughness={0.5} />
      </mesh>
    </group>
  )
}

/* ---------- cork board with pinned cards ---------- */
const CORK_FRAME: ProfilePt[] = [
  [0.018, 0.005],
  [0.018, 0.0135],
  [0.0165, 0.0155],
  [0.0035, 0.0155],
  [0.0, 0.0125],
  [0.0, 0.0],
]

function CorkBoard({
  position,
  tilt = 0,
}: {
  position: [number, number, number]
  tilt?: number
}) {
  const cork = useMemo(() => makeCorkMaps(6), [])
  const atlas = useMemo(() => makeCardAtlas(9), [])
  const blob = useMemo(() => makeFeatheredRect(64, 64, 0.6), [])
  const frame = useMemo(
    () =>
      sweep(
        CORK_FRAME,
        [
          [-0.25, -0.18],
          [0.25, -0.18],
          [0.25, 0.18],
          [-0.25, 0.18],
        ],
        { mode: 'wall', closed: true },
      ),
    [],
  )
  const wood = useMemo(() => {
    const m = makeGrainMaps('#b58a55', 4)
    m.map.repeat.set(4, 18)
    m.normalMap.repeat.set(4, 18)
    m.roughnessMap.repeat.set(4, 18)
    return m
  }, [])
  const cards = useMemo(() => cardsGeo(), [])
  const pinGeo = useMemo(() => new SphereGeometry(0.0048, 8, 6), [])
  const pinsRef = useRef<InstancedMesh>(null)
  const yarn = useMemo(() => {
    const p = cards.pins
    const a = new Vector3(p[0].x, p[0].y, p[0].z + 0.0018)
    const b = new Vector3(p[1].x, p[1].y, p[1].z + 0.0018)
    const c = new Vector3(p[6].x, p[6].y, p[6].z + 0.0018)
    const sag = (u: Vector3, v: Vector3, k: number) => new Vector3().addVectors(u, v).multiplyScalar(0.5).add(new Vector3(0, -k, 0.001))
    return new TubeGeometry(
      new CatmullRomCurve3([a, sag(a, b, 0.02), b, sag(b, c, 0.014), c]),
      48,
      0.0009,
      5,
    )
  }, [cards])

  useEffect(() => {
    const m = pinsRef.current
    if (!m) return
    const mat = new Matrix4()
    const col = new Color()
    cards.pins.forEach((p, i) => {
      mat.makeScale(1, 1, 0.62).setPosition(p.x, p.y, p.z + 0.0018)
      m.setMatrixAt(i, mat)
      m.setColorAt(i, col.set(p.color))
    })
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [cards])

  useEffect(
    () => () => {
      cork.dispose()
      atlas.dispose()
      blob.dispose()
      frame.dispose()
      wood.dispose()
      cards.cards.dispose()
      cards.shadows.dispose()
      pinGeo.dispose()
      yarn.dispose()
    },
    [cork, atlas, blob, frame, wood, cards, pinGeo, yarn],
  )

  return (
    <group position={position} rotation-z={tilt}>
      <WallShadow blob={blob} w={0.58} h={0.44} x={0.008} y={-0.012} opacity={0.6} />
      <mesh geometry={frame} castShadow receiveShadow>
        <meshStandardMaterial
          map={wood.map}
          normalMap={wood.normalMap}
          roughnessMap={wood.roughnessMap}
          roughness={1}
        />
      </mesh>
      {/* backer, then the cork */}
      <mesh position={[0, 0, 0.0025]}>
        <roundedBoxGeometry args={rb(0.5, 0.36, 0.005, 0.001, 1)} />
        <meshStandardMaterial color="#5b4028" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0, 0.0056]} receiveShadow>
        <planeGeometry args={[0.47, 0.33]} />
        <meshStandardMaterial map={cork.map} normalMap={cork.normalMap} roughness={0.95} />
      </mesh>
      <mesh geometry={cards.shadows} renderOrder={2}>
        <meshBasicMaterial
          map={blob}
          color="#000000"
          transparent
          opacity={0.5}
          depthWrite={false}
        />
      </mesh>
      <group position={[0, 0, 0.0056]}>
        <mesh geometry={cards.cards} castShadow receiveShadow>
          <meshStandardMaterial map={atlas} roughness={0.9} side={DoubleSide} />
        </mesh>
        <instancedMesh ref={pinsRef} args={[pinGeo, undefined, cards.pins.length]} frustumCulled={false} castShadow>
          <meshStandardMaterial roughness={0.32} metalness={0.05} />
        </instancedMesh>
        <mesh geometry={yarn}>
          <meshStandardMaterial color="#b3271f" roughness={0.95} />
        </mesh>
      </group>
    </group>
  )
}

/* ---------- radiator under the window ---------- */
function Radiator() {
  const g = useMemo(() => radiatorGeo(), [])
  useEffect(
    () => () => {
      g.paint.dispose()
      g.copper.dispose()
    },
    [g],
  )
  return (
    <group position={[-1.18, 0, WALL_Z + 0.001]}>
      <mesh geometry={g.paint} castShadow receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.36} />
      </mesh>
      <mesh geometry={g.copper} castShadow>
        <meshStandardMaterial vertexColors metalness={0.85} roughness={0.32} />
      </mesh>
    </group>
  )
}

/* ---------- boxes stacked against the right-hand wall ---------- */
function Boxes({ position }: { position: [number, number, number] }) {
  const g = useMemo(() => boxesGeo(), [])
  const grain = useMemo(() => makeCardboardMaps(13), [])
  useEffect(
    () => () => {
      g.boxes.dispose()
      g.trim.dispose()
      grain.dispose()
    },
    [g, grain],
  )
  return (
    <group position={position} rotation-y={-Math.PI / 2 + 0.05}>
      <mesh geometry={g.boxes} castShadow receiveShadow>
        <meshStandardMaterial
          map={grain.map}
          normalMap={grain.normalMap}
          normalScale={[0.5, 0.5]}
          roughnessMap={grain.roughnessMap}
          roughness={1}
        />
      </mesh>
      <mesh geometry={g.trim} castShadow>
        <meshStandardMaterial vertexColors roughness={0.55} />
      </mesh>
    </group>
  )
}
