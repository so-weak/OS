import { useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
import { CAM_FOV } from '../constants'
import Bookcase from './Bookcase'
import CameraRig from './CameraRig'
import DayNight from './DayNight'
import Desk, { Cables } from './Desk'
import Drawers from './Drawers'
import Duck from './Duck'
import DeskClutter from './DeskClutter'
import DustMotes from './DustMotes'
import Keyboard from './Keyboard'
import Lamp from './Lamp'
import Monitor from './Monitor'
import Papers from './Papers'
import Room from './Room'
import LibraryHud from './LibraryHud'
import Scenery from './Scenery'
import SetDressing from './SetDressing'
import RoomTooltip from './Tooltip'
import Tower from './Tower'
import TrashGame from './TrashGame'
import RoomWindow from './Window'
import WorldFrame from './WorldFrame'
import { INTRO_CAM_POS, P } from './layout'

/* =====================================================================
   Scene root — the full-viewport R3F canvas plus the DOM overlays that
   live beside it (hover tooltip, library HUD).

   Because the OS uses <Html occlude="blending">, drei sets the canvas
   element to pointer-events:none (the DOM screen lives *behind* the
   canvas and shows through a punched alpha hole). So pointer events are
   sourced from #root instead, with client coordinates; that keeps every
   3D clickable (duck, lamp, tower, monitor, papers, bin…) live at the
   same time as the DOM screen. zIndexRange on the Html (see Monitor.tsx)
   keeps the canvas below the HUD overlays in App.tsx (z-index 50).

   Two hard-won rules for that blending stack (the lifted-paper bug):
   - eventSource makes drei portal its Html into #root, ABOVE the canvas,
     where WebGL can never occlude it — Monitor.tsx pins the portal back
     to the canvas's parent.
   - any drei <Html> WITHOUT occlude="blending" resets the canvas z-index
     and pointer-events on mount, breaking the punch-through. DOM
     overlays for the room belong beside the canvas (Tooltip.tsx), not
     inside it.
   ===================================================================== */

declare global {
  interface Window {
    __gl?: import('three').WebGLRenderer
    __scene?: import('three').Scene
  }
}

export default function Scene() {
  /* R-P10: cap pixel ratio at 1.5 and drop to 1 when frames stutter */
  const [dpr, setDpr] = useState<number | [number, number]>([1, 1.5])
  return (
    <>
      <Canvas
        shadows="percentage"
        dpr={dpr}
        camera={{
          fov: CAM_FOV,
          near: 0.04,
          far: 24,
          position: [INTRO_CAM_POS.x, INTRO_CAM_POS.y, INTRO_CAM_POS.z],
        }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        onCreated={({ gl, scene }) => {
          // dev only: window.__gl.info.render → { calls, triangles } for perf
          // checks; window.__scene lets experiments toggle lights and meshes
          if (import.meta.env.DEV) {
            window.__gl = gl
            window.__scene = scene
          }
        }}
        eventSource={document.getElementById('root') as HTMLElement}
        eventPrefix="client"
        style={{ position: 'fixed', inset: 0 }}
      >
        <color attach="background" args={[P.night]} />
        <PerformanceMonitor onDecline={() => setDpr(1)} />

        {/* damps every shared light value first (priority -1) */}
        <WorldFrame />
        <DayNight />

        <CameraRig />

        <Room />
        <RoomWindow />
        <Desk />
        <Drawers />
        <Cables />
        <Monitor />
        <Tower />
        <Keyboard />
        <Lamp />
        <Duck />
        <Papers />
        <Bookcase />
        <TrashGame />
        <DustMotes />
        {/* the living-world props: wall clock, moth, weather runner */}
        <Scenery />
        <DeskClutter />
        <SetDressing />
      </Canvas>
      <RoomTooltip />
      <LibraryHud />
    </>
  )
}
