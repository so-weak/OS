import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  Color,
  MathUtils,
  Object3D,
  type MeshBasicMaterial,
  type PointLight,
  type SpotLight,
} from 'three'
import { useSystem } from '../os/store'
import { playClick } from '../os/sound'
import Clickable from './Clickable'
import { useRoom } from './roomState'
import { makeDayWindow, makeNightWindow } from './textures'
import { live } from './live'

/* =====================================================================
   The window — the room's one scenery control and the explanation for
   most of its light. Night by default; clicking it lets the sun in
   (roomState.toggleDay, which also records the visitor's override in
   the world store). Everything here fades with `live.day`, damped once
   per frame in WorldFrame so the whole room moves as one.

   Every hand that wants to touch the light coming through the glass
   (dusk, weather, lightning, blinds, the moon) works in THIS file.
   ===================================================================== */

/* ---------- the window: night by default, day on click ---------- */
const MOON_SPILL = new Color('#7b93c9')
const SUN_SPILL = new Color('#ffdfae')

export default function RoomWindow() {
  const view = useSystem((s) => s.view)
  const isDay = useRoom((s) => s.isDay)
  const toggleDay = useRoom((s) => s.toggleDay)

  const nightTex = useMemo(() => makeNightWindow(), [])
  const dayTex = useMemo(() => makeDayWindow(), [])
  useEffect(
    () => () => {
      nightTex.dispose()
      dayTex.dispose()
    },
    [nightTex, dayTex],
  )

  const dayMat = useRef<MeshBasicMaterial>(null!)
  const spill = useRef<PointLight>(null!)
  const sun = useRef<SpotLight>(null!)

  // the sun shaft leans down-right across the rug and desk
  const sunTarget = useMemo(() => {
    const o = new Object3D()
    o.position.set(0.9, -1.35, 1.45)
    return o
  }, [])

  useFrame(() => {
    const m = live.day
    dayMat.current.opacity = m
    spill.current.color.copy(MOON_SPILL).lerp(SUN_SPILL, m)
    spill.current.intensity = MathUtils.lerp(1.5, 2.6, m)
    sun.current.intensity = m * 3.4
  })

  const x = -1.18
  const y = 1.52
  return (
    <group position={[x, y, -1.07]}>
      <Clickable
        enabled={view === 'room'}
        label={isDay ? 'bring back the night' : 'let the sun in'}
        onActivate={() => {
          playClick()
          toggleDay()
        }}
      >
        {/* frame */}
        <mesh castShadow>
          <boxGeometry args={[0.72, 0.92, 0.045]} />
          <meshStandardMaterial color="#1c1e22" roughness={0.8} />
        </mesh>
        {/* night sky (unlit so it reads as light) */}
        <mesh position={[0, 0, 0.024]}>
          <planeGeometry args={[0.62, 0.82]} />
          <meshBasicMaterial map={nightTex} color="#b9c4de" toneMapped={false} />
        </mesh>
        {/* day sky cross-fades on top of it */}
        <mesh position={[0, 0, 0.0255]}>
          <planeGeometry args={[0.62, 0.82]} />
          <meshBasicMaterial
            ref={dayMat}
            map={dayTex}
            transparent
            opacity={0}
            toneMapped={false}
          />
        </mesh>
        {/* cross mullions */}
        <mesh position={[0, 0, 0.03]}>
          <boxGeometry args={[0.62, 0.024, 0.012]} />
          <meshStandardMaterial color="#1c1e22" roughness={0.8} />
        </mesh>
        <mesh position={[0, 0, 0.03]}>
          <boxGeometry args={[0.024, 0.82, 0.012]} />
          <meshStandardMaterial color="#1c1e22" roughness={0.8} />
        </mesh>
        {/* sill */}
        <mesh position={[0, -0.48, 0.05]} castShadow>
          <boxGeometry args={[0.78, 0.03, 0.09]} />
          <meshStandardMaterial color="#26282e" roughness={0.85} />
        </mesh>
      </Clickable>
      {/* moonlight / sunlight spilling in */}
      <pointLight
        ref={spill}
        position={[0, 0.1, 0.35]}
        color="#7b93c9"
        intensity={1.5}
        distance={4}
        decay={2}
      />
      {/* daytime sun shaft (outside Clickable so raycasts stay cheap) */}
      <primitive object={sunTarget} />
      <spotLight
        ref={sun}
        position={[0.05, 0.15, 0.03]}
        target={sunTarget}
        color={SUN_SPILL}
        intensity={0}
        angle={0.62}
        penumbra={0.7}
        distance={6.5}
        decay={1.1}
        castShadow
        shadow-mapSize={[512, 512]}
        shadow-bias={-0.002}
      />
    </group>
  )
}
