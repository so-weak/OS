import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  CircleGeometry,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  Vector2,
  type Group,
} from 'three'
import { useSystem } from '../os/store'
import { playClick } from '../os/sound'
import { useWorld } from '../world'
import Clickable from './Clickable'
import { P, WINDOW } from './layout'
import { rb } from './rbox'
import {
  CLOCK,
  buildClockBack,
  buildClockCase,
  buildClockDome,
  buildClockHand,
  buildSecondHand,
  clockGlare,
  shadowBlob,
} from './tex/window'
import { makeClockFace, makeClockPlate } from './windowArt'
import Staged from './Staged'

/* =====================================================================
   The wall clock — the diegetic reason the light follows a clock the
   visitor may not share. It keeps Bengaluru time (useWorld.hour; the
   seconds are the same everywhere) above the monitor, between the two
   posters, with a brass plate that says where it is. The second hand
   ticks: quantised per second with a small overshoot spring, like the
   CRT knobs. Three rotations a frame; nothing else.

   The object: a lathe-turned bronze case with a rolled back edge and a
   bevelled bezel lip, a cream dial whose numerals and hour bars are
   embossed (normal map), pierced-leaf hands, a domed crystal, and on the
   back a battery bump and a hanger boss. It hangs from a nail — the top
   stands a few millimetres off the wall, the bottom rim rests on it — and
   throws a soft shadow down and to the right, away from the lamp.
   ===================================================================== */

const TAU = Math.PI * 2
const SPRING_STEP = 1 / 120
const WALL_Z = WINDOW.wallZ
const POS: [number, number, number] = [0.0, 1.6, WALL_Z]
const R = CLOCK.R
/* hung from a nail: top out, bottom rim on the wall */
const TILT = 0.045
const REST_Z = R * Math.sin(TILT) + 0.0008

function WallClockBody() {
  const view = useSystem((s) => s.view)
  const face = useMemo(() => makeClockFace(), [])
  const plate = useMemo(() => makeClockPlate('BENGALURU'), [])
  const blob = useMemo(() => shadowBlob(), [])
  const glare = useMemo(() => clockGlare(), [])

  const caseGeo = useMemo(() => buildClockCase(), [])
  const backGeo = useMemo(() => buildClockBack(), [])
  const domeGeo = useMemo(() => buildClockDome(), [])
  const hourGeo = useMemo(() => buildClockHand('hour'), [])
  const minuteGeo = useMemo(() => buildClockHand('minute'), [])
  const secondGeo = useMemo(() => buildSecondHand(), [])
  const dialGeo = useMemo(() => new CircleGeometry(CLOCK.dialR, 72), [])
  const capGeo = useMemo(() => new SphereGeometry(0.0052, 16, 10), [])

  const caseMat = useMemo(
    () => new MeshStandardMaterial({ color: '#3a2f22', metalness: 0.72, roughness: 0.34 }),
    [],
  )
  const backMat = useMemo(
    () => new MeshStandardMaterial({ color: '#25272b', roughness: 0.7 }),
    [],
  )
  const dialMat = useMemo(
    () =>
      new MeshStandardMaterial({
        map: face.map,
        normalMap: face.normalMap,
        normalScale: new Vector2(1.2, 1.2),
        roughness: 0.82,
      }),
    [face],
  )
  const handMat = useMemo(
    () => new MeshStandardMaterial({ color: '#15130f', roughness: 0.42, metalness: 0.35 }),
    [],
  )
  const secondMat = useMemo(
    () => new MeshStandardMaterial({ color: P.ledRed, roughness: 0.42, metalness: 0.2 }),
    [],
  )
  const brassMat = useMemo(
    () => new MeshStandardMaterial({ color: '#b59248', metalness: 0.85, roughness: 0.32 }),
    [],
  )
  const glassMat = useMemo(
    // was MeshPhysicalMaterial with clearcoat 1 at clearcoatRoughness 0.02
    // — the same roughness as the base coat, so the clearcoat lobe was a
    // second copy of the exact same specular highlight, not a different
    // one; Standard alone reads identically on a crystal this small and
    // skips compiling the clearcoat shader variant
    () =>
      new MeshStandardMaterial({
        color: '#ffffff',
        map: glare,
        transparent: true,
        roughness: 0.02,
        metalness: 0,
        envMapIntensity: 2.4,
        depthWrite: false,
      }),
    [glare],
  )
  const plateMat = useMemo(
    () =>
      new MeshStandardMaterial({
        map: plate.map,
        normalMap: plate.normalMap,
        normalScale: new Vector2(0.8, 0.8),
        metalness: 0.75,
        roughness: 0.42,
      }),
    [plate],
  )
  const plateBackMat = useMemo(
    () => new MeshStandardMaterial({ color: '#7f6530', metalness: 0.8, roughness: 0.4 }),
    [],
  )
  const shadowMat = useMemo(
    () =>
      new MeshBasicMaterial({
        map: blob,
        color: '#000000',
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        toneMapped: false,
      }),
    [blob],
  )
  const handShadowMat = useMemo(
    () =>
      new MeshBasicMaterial({
        color: '#000000',
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  )

  useEffect(
    () => () => {
      face.map.dispose()
      face.normalMap.dispose()
      plate.map.dispose()
      plate.normalMap.dispose()
      blob.dispose()
      glare.dispose()
      for (const g of [caseGeo, backGeo, domeGeo, hourGeo, minuteGeo, secondGeo, dialGeo, capGeo])
        g.dispose()
      for (const m of [
        caseMat,
        backMat,
        dialMat,
        handMat,
        secondMat,
        brassMat,
        glassMat,
        plateMat,
        plateBackMat,
        shadowMat,
        handShadowMat,
      ])
        m.dispose()
    },
    [
      face,
      plate,
      blob,
      glare,
      caseGeo,
      backGeo,
      domeGeo,
      hourGeo,
      minuteGeo,
      secondGeo,
      dialGeo,
      capGeo,
      caseMat,
      backMat,
      dialMat,
      handMat,
      secondMat,
      brassMat,
      glassMat,
      plateMat,
      plateBackMat,
      shadowMat,
      handShadowMat,
    ],
  )

  const hour = useRef<Group>(null!)
  const minute = useRef<Group>(null!)
  const second = useRef<Group>(null!)
  const hourSh = useRef<Group>(null!)
  const minuteSh = useRef<Group>(null!)
  const secondSh = useRef<Group>(null!)
  const spring = useRef({ x: 0, v: 0 })

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const h = useWorld.getState().hour
    const rh = -((h % 12) / 12) * TAU
    const rm = -((h % 1) * 1) * TAU
    hour.current.rotation.z = rh
    minute.current.rotation.z = rm
    hourSh.current.rotation.z = rh
    minuteSh.current.rotation.z = rm

    // the second hand: snap to the second, overshoot, settle
    const target = ((Math.floor(Date.now() / 1000) % 60) / 60) * TAU
    const sp = spring.current
    if (target < sp.x - Math.PI) sp.x -= TAU // wrapped past 12
    /* Sub-stepped: this spring's explicit damping (42 · dt) tips into
       instability above dt ≈ 0.048, so on a slow page (dt clamped at 0.05)
       the hand exploded and spun wildly. At 1/120 s it is stable at any
       frame rate. */
    for (let left = dt; left > 1e-6; left -= SPRING_STEP) {
      const h = Math.min(left, SPRING_STEP)
      sp.v += (900 * (target - sp.x) - 42 * sp.v) * h
      sp.x += sp.v * h
    }
    second.current.rotation.z = -sp.x
    secondSh.current.rotation.z = -sp.x
  })

  const dz = CLOCK.dialZ
  return (
    <group position={POS}>
      {/* the wall behind it: soft shadow of the clock and of the plate */}
      <mesh
        material={shadowMat}
        position={[0.009, -0.018, 0.0004]}
        scale={[0.4, 0.4, 1]}
      >
        <planeGeometry args={[1, 1]} />
      </mesh>
      <mesh
        material={shadowMat}
        position={[0.006, -0.16, 0.0004]}
        scale={[0.3, 0.1, 1]}
      >
        <planeGeometry args={[1, 1]} />
      </mesh>

      <Clickable
        enabled={view === 'room'}
        label="the desk's clock"
        onActivate={() => playClick()}
      >
        {/* the clock itself: pivoted about its centre, leaning on the wall */}
        <group position={[0, 0, REST_Z]} rotation-x={TILT}>
          <mesh geometry={caseGeo} material={caseMat} castShadow />
          <mesh geometry={backGeo} material={backMat} />
          <mesh
            geometry={dialGeo}
            material={dialMat}
            position={[0, 0, dz + 0.0002]}
          />
          {/* hands' soft shadows on the paper, thrown away from the lamp */}
          <group ref={hourSh} position={[0.0022, -0.0034, dz + 0.0007]}>
            <mesh geometry={hourGeo} material={handShadowMat} />
          </group>
          <group ref={minuteSh} position={[0.0028, -0.0042, dz + 0.0007]}>
            <mesh geometry={minuteGeo} material={handShadowMat} />
          </group>
          <group ref={secondSh} position={[0.0034, -0.005, dz + 0.0007]}>
            <mesh geometry={secondGeo} material={handShadowMat} />
          </group>
          {/* hands pivot at the centre; each points up at 0 */}
          <group ref={hour} position={[0, 0, dz + 0.0032]}>
            <mesh geometry={hourGeo} material={handMat} />
          </group>
          <group ref={minute} position={[0, 0, dz + 0.0052]}>
            <mesh geometry={minuteGeo} material={handMat} />
          </group>
          <group ref={second} position={[0, 0, dz + 0.0072]}>
            <mesh geometry={secondGeo} material={secondMat} />
          </group>
          {/* pivot cap */}
          <mesh
            geometry={capGeo}
            material={brassMat}
            position={[0, 0, dz + 0.0078]}
            scale={[1, 1, 0.7]}
          />
          {/* the crystal */}
          <mesh geometry={domeGeo} material={glassMat} />
        </group>

        {/* the brass plate: where this clock lives, screwed to the wall */}
        <group position={[0, -R - 0.037, 0.0032]}>
          <mesh material={plateBackMat}>
            <roundedBoxGeometry args={rb(0.22, 0.04, 0.0055, 0.0014, 2)} />
          </mesh>
          <mesh position={[0, 0, 0.00285]} material={plateMat}>
            <planeGeometry args={[0.214, 0.0389]} />
          </mesh>
          {[-0.1, 0.1].map((sx) => (
            <mesh key={sx} position={[sx, 0, 0.0029]} material={brassMat}>
              <cylinderGeometry args={[0.0018, 0.0018, 0.0012, 10]} />
            </mesh>
          ))}
        </group>
      </Clickable>
    </group>
  )
}

/* first load: mounted in its own turn of the staged build (stage.ts) */
export default function WallClock() {
  return (
    <Staged id="wallclock">
      <WallClockBody />
    </Staged>
  )
}
