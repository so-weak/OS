import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { MathUtils, Object3D, type SpotLight } from 'three'
import { books } from '../data/library'
import { playClick } from '../os/sound'
import { navigate } from '../router'
import Clickable from './Clickable'
import { CASE, CASE_FRONT } from './layout'
import { useLibrary } from './libraryState'
import { makePlacard, makeStrip } from './libraryTextures'
import { rb } from './rbox'

/* =====================================================================
   What the case wears: the engraved placard on the cornice, the brass
   picture light under it, and — where a card catalogue would be — the
   brass plate that opens the real catalogue at /library.

   None of these are UI in costume. The plate is a plate; clicking it
   takes you to the page where searching actually belongs.
   ===================================================================== */

export default function CaseFittings() {
  const open = useLibrary((s) => s.open)

  const placard = useMemo(
    () => makePlacard('THE STACKS', `${books.length} VOLUMES · CATALOGUE INSIDE`),
    [],
  )
  useEffect(() => () => placard.dispose(), [placard])

  return (
    <group>
      {/* placard on the cornice */}
      <mesh position={[0, CASE.h - 0.082, CASE.d / 2 + 0.026]}>
        <planeGeometry args={[0.32, 0.08]} />
        <meshStandardMaterial
          map={placard}
          roughness={0.35}
          metalness={0.55}
          emissive="#c9a227"
          emissiveMap={placard}
          emissiveIntensity={0.12}
        />
      </mesh>

      <CataloguePlate enabled={open} />
      <PictureLight open={open} />
    </group>
  )
}

/* ---------- the brass plate on the plinth rail ---------- */
function CataloguePlate({ enabled }: { enabled: boolean }) {
  const strip = useMemo(
    () => makeStrip('CONSULT THE CATALOGUE', { fg: '#2a1d05', bg: '#c9a227', size: 34 }),
    [],
  )
  useEffect(() => () => strip.tex.dispose(), [strip])

  const glow = useRef(0)
  const mat = useRef<{ emissiveIntensity: number }>(null!)
  useFrame((_, delta) => {
    const m = mat.current
    if (!m) return
    const want = enabled ? 0.45 : 0.1
    if (glow.current === want) return
    glow.current = MathUtils.damp(glow.current, want, 4, Math.min(delta, 0.05))
    if (Math.abs(glow.current - want) < 0.002) glow.current = want
    m.emissiveIntensity = glow.current
  })

  const w = 0.36
  return (
    <group position={[0, CASE.plinth + 0.045, CASE_FRONT + 0.008]}>
      <Clickable
        enabled={enabled}
        label="open the catalogue"
        onActivate={() => {
          playClick()
          navigate({ name: 'library', bookId: null })
        }}
      >
        {/* the plate itself, screwed to the rail */}
        <mesh castShadow>
          <roundedBoxGeometry args={rb(w, w / strip.aspect, 0.01)} />
          <meshStandardMaterial
            ref={mat}
            map={strip.tex}
            metalness={0.65}
            roughness={0.34}
            emissive="#c9a227"
            emissiveMap={strip.tex}
            emissiveIntensity={0.1}
          />
        </mesh>
        {/* a hit box with some depth, so the plate is easy to grab */}
        <mesh position={[0, 0, 0.02]}>
          <roundedBoxGeometry args={rb(w + 0.04, 0.09, 0.04)} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </Clickable>
    </group>
  )
}

/* ---------- brass picture light under the cornice ---------- */
function PictureLight({ open }: { open: boolean }) {
  const on = useLibrary((s) => s.lampOn)
  const spot = useRef<SpotLight>(null!)
  const target = useMemo(() => {
    const o = new Object3D()
    o.position.set(0, -0.8, 0.06)
    return o
  }, [])

  useFrame((_, delta) => {
    const s = spot.current
    if (!s) return
    // NB: deliberately not gating `visible` — see Bookcase.tsx's
    // CornerFill comment: toggling a light's visibility changes the
    // scene's active light count and forces a scene-wide shader
    // recompile (measured). Early-out once settled is the safe win.
    const want = on ? (open ? 2.4 : 0.5) : 0
    if (s.intensity === want) return
    s.intensity = MathUtils.damp(s.intensity, want, 3.5, Math.min(delta, 0.05))
    if (Math.abs(s.intensity - want) < 0.01) s.intensity = want
  })

  return (
    <group position={[0, CASE.h - 0.115, CASE.d / 2 - 0.03]}>
      <Clickable
        enabled={open}
        label={on ? 'douse the lamp' : 'light the lamp'}
        onActivate={() => {
          useLibrary.getState().toggleLamp()
          playClick()
        }}
      >
        <mesh position={[0, 0.045, -0.03]} rotation-x={-0.6}>
          <cylinderGeometry args={[0.006, 0.006, 0.09, 8]} />
          <meshStandardMaterial color="#c9a227" metalness={0.75} roughness={0.35} />
        </mesh>
        <mesh position={[0, 0.012, 0.028]} rotation={[Math.PI, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.028, 0.028, 0.3, 10, 1, true, 0, Math.PI]} />
          <meshStandardMaterial color="#2f4f3a" metalness={0.4} roughness={0.5} side={2} />
        </mesh>
      </Clickable>
      <primitive object={target} />
      <spotLight
        ref={spot}
        position={[0, 0.05, 0.02]}
        target={target}
        color="#ffd9a0"
        intensity={0}
        angle={1.1}
        penumbra={0.8}
        distance={2.6}
        decay={1.7}
      />
    </group>
  )
}
