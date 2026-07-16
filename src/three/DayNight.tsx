import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  Color,
  MathUtils,
  type AmbientLight,
  type HemisphereLight,
} from 'three'
import { P } from './layout'
import { useRoom } from './roomState'

/* =====================================================================
   Day/night base lighting. Owns the ambient + hemisphere lights and the
   scene background, cross-fading them when the window is clicked
   (roomState.isDay). The lamp, moon/sun spill and window art react in
   their own files off the same store; everything damps at the same rate
   so the whole room eases through one sunrise.
   ===================================================================== */

/** Shared damping rate for every day/night crossfade (≈1.5s sunrise). */
export const DAY_FADE = 2.2

const NIGHT = {
  bg: new Color(P.night),
  amb: new Color('#39415c'),
  ambI: 0.32,
  sky: new Color('#2c3654'),
  ground: new Color('#171310'),
  hemI: 0.4,
}
const DAY = {
  bg: new Color('#2e3852'),
  amb: new Color('#93a0bd'),
  ambI: 0.82,
  sky: new Color('#bcc9e4'),
  ground: new Color('#5a4c3c'),
  hemI: 0.9,
}

export default function DayNight() {
  const amb = useRef<AmbientLight>(null!)
  const hemi = useRef<HemisphereLight>(null!)
  const mix = useRef(0)
  const scene = useThree((s) => s.scene)

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    mix.current = MathUtils.damp(
      mix.current,
      useRoom.getState().isDay ? 1 : 0,
      DAY_FADE,
      dt,
    )
    const m = mix.current
    amb.current.color.copy(NIGHT.amb).lerp(DAY.amb, m)
    amb.current.intensity = MathUtils.lerp(NIGHT.ambI, DAY.ambI, m)
    hemi.current.color.copy(NIGHT.sky).lerp(DAY.sky, m)
    hemi.current.groundColor.copy(NIGHT.ground).lerp(DAY.ground, m)
    hemi.current.intensity = MathUtils.lerp(NIGHT.hemI, DAY.hemI, m)
    if (scene.background instanceof Color)
      scene.background.copy(NIGHT.bg).lerp(DAY.bg, m)
  })

  return (
    <>
      {/* moody base light — the lamp, window and screen do the real work */}
      <ambientLight ref={amb} color="#39415c" intensity={0.32} />
      <hemisphereLight ref={hemi} args={['#2c3654', '#171310', 0.4]} />
    </>
  )
}
