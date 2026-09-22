import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Environment, Lightformer } from '@react-three/drei'
import {
  Color,
  MathUtils,
  type AmbientLight,
  type HemisphereLight,
} from 'three'
import { useSystem } from '../os/store'
import { P } from './layout'
import { live } from './live'
import { useRoom } from './roomState'
import Staged from './Staged'

/* =====================================================================
   Day/night base lighting. Owns the ambient + hemisphere lights, the
   scene background and the room's ENVIRONMENT — a 64² cube baked from
   three abstract light rects (the lamp head, the window, a warm floor
   bounce) so metals and plastics have something to reflect. The fill
   lights cross-fade with `live.day` (damped once per frame in
   WorldFrame); golden hour blends a DUSK table in by `live.dusk`.

   The environment re-bakes by REMOUNT on discrete states only (lamp,
   power, day) — never frames=Infinity. Continuous scalars (day, flash,
   lamp fade) ride on scene.environmentIntensity every frame.
   ===================================================================== */

/** Kept here for older imports; the damping itself lives in WorldFrame. */
export { DAY_FADE } from './live'

const NIGHT = {
  bg: new Color(P.night),
  amb: new Color('#39415c'),
  ambI: 0.42,
  sky: new Color('#3a4a78'),
  ground: new Color('#2a2018'),
  hemI: 0.55,
}
const DAY = {
  bg: new Color('#2e3852'),
  amb: new Color('#93a0bd'),
  ambI: 1.05,
  sky: new Color('#bcc9e4'),
  ground: new Color('#5a4c3c'),
  hemI: 1.1,
}
/* golden hour — the window side of it lives in Window.tsx with the
   same values, so the room and the sky agree */
const DUSK = {
  bg: new Color('#3b2f3f'),
  amb: new Color('#c99a7a'),
  ambI: 0.6,
  sky: new Color('#e7b58f'),
  ground: new Color('#4a3a30'),
  hemI: 0.68,
}

/* the env cube camera sits at the virtual-scene origin, so every rect is
   placed relative to this point above the desk — the spot the room's
   reflective props (monitor glass, mouse, trophy, lamp arms) surround */
const EYE = { x: 0.1, y: 0.9, z: -0.45 }
const rel = (x: number, y: number, z: number): [number, number, number] => [
  x - EYE.x,
  y - EYE.y,
  z - EYE.z,
]

const LAMP_POS = rel(-0.27, 0.95, -0.66)
const LAMP_AIM = rel(0.15, 0.74, -0.35)
const WIN_POS = rel(-1.18, 1.52, -1.07)
const WIN_AIM = rel(0.3, 0.8, 0.6)
const FLOOR_POS = rel(0.1, 0.0, 0.3)

function DayNightBody() {
  const amb = useRef<AmbientLight>(null!)
  const hemi = useRef<HemisphereLight>(null!)
  const lampOn = useRoom((s) => s.lampOn)
  const isDay = useRoom((s) => s.isDay)
  const powered = useSystem((s) => s.power !== 'off')

  useFrame(({ scene, gl }) => {
    const m = live.day
    const d = live.dusk * live.day
    const a = amb.current
    const h = hemi.current
    a.color.copy(NIGHT.amb).lerp(DAY.amb, m).lerp(DUSK.amb, d)
    a.intensity = MathUtils.lerp(
      MathUtils.lerp(NIGHT.ambI, DAY.ambI, m),
      DUSK.ambI,
      d,
    )
    h.color.copy(NIGHT.sky).lerp(DAY.sky, m).lerp(DUSK.sky, d)
    h.groundColor.copy(NIGHT.ground).lerp(DAY.ground, m).lerp(DUSK.ground, d)
    h.intensity = MathUtils.lerp(
      MathUtils.lerp(NIGHT.hemI, DAY.hemI, m),
      DUSK.hemI,
      d,
    )
    if (scene.background instanceof Color)
      scene.background.copy(NIGHT.bg).lerp(DAY.bg, m).lerp(DUSK.bg, d)

    // the env is baked per discrete state; everything continuous rides here.
    // It is also the room's soft bounce light, so it carries real weight.
    scene.environmentIntensity =
      (0.85 + 0.5 * m + 2 * live.flash) * MathUtils.lerp(0.8, 1, live.lamp)
    // a real camera would expose for a dim room: lift the whole image
    gl.toneMappingExposure = MathUtils.lerp(1.5, 1.28, m)
  })

  return (
    <>
      {/* moody base light — the lamp, window and screen do the real work */}
      <ambientLight ref={amb} color="#39415c" intensity={NIGHT.ambI} />
      <hemisphereLight ref={hemi} args={['#2c3654', '#171310', NIGHT.hemI]} />

      {/* what the room's metals and glass reflect: three soft rects */}
      <Environment
        key={`${lampOn}-${powered}-${isDay}`}
        resolution={64}
        frames={1}
        background={false}
      >
        {lampOn && (
          <Lightformer
            form="rect"
            color="#ffb763"
            intensity={12}
            position={LAMP_POS}
            scale={[0.16, 0.12, 1]}
            target={LAMP_AIM}
          />
        )}
        {/* the window: the big cool source at night, soft white by day */}
        <Lightformer
          form="rect"
          color={isDay ? '#e9eefb' : '#7d95d0'}
          intensity={isDay ? 6 : 5}
          position={WIN_POS}
          scale={[0.9, 1.1, 1]}
          target={WIN_AIM}
        />
        {/* warm bounce off the floorboards and the lamp pool */}
        <Lightformer
          form="rect"
          color="#7a5236"
          intensity={isDay ? 1.6 : 1.3}
          position={FLOOR_POS}
          rotation-x={-Math.PI / 2}
          scale={[4.6, 3.9, 1]}
        />
        {/* the walls and ceiling: a dim cool-grey room around everything,
            so shadowed sides still read (this is the "ambient" of a
            photograph — light that has bounced) */}
        <Lightformer
          form="rect"
          color="#55607a"
          intensity={isDay ? 1.6 : 1.1}
          position={rel(0.1, 2.5, 0.3)}
          rotation-x={Math.PI / 2}
          scale={[4.6, 3.9, 1]}
        />
        <Lightformer
          form="rect"
          color="#4a566e"
          intensity={isDay ? 1.4 : 0.9}
          position={rel(0.1, 1.3, -1.05)}
          scale={[4.6, 2.6, 1]}
        />
        <Lightformer
          form="rect"
          color="#3f4a60"
          intensity={isDay ? 1.2 : 0.8}
          position={rel(2.2, 1.3, 0.3)}
          rotation-y={-Math.PI / 2}
          scale={[3.9, 2.6, 1]}
        />
        <Lightformer
          form="rect"
          color="#3f4a60"
          intensity={isDay ? 1.2 : 0.8}
          position={rel(-2.0, 1.3, 0.3)}
          rotation-y={Math.PI / 2}
          scale={[3.9, 2.6, 1]}
        />
      </Environment>
    </>
  )
}

/* first load: its own turn of the staged build (stage.ts) — the
   environment bake is not spent in the canvas's first commit. It is the
   first turn, so the lights and the env are in long before any shader
   is compiled. */
export default function DayNight() {
  return (
    <Staged id="daynight">
      <DayNightBody />
    </Staged>
  )
}
