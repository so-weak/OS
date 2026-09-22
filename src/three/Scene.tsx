import { Canvas } from '@react-three/fiber'
import { Vector3 } from 'three'
import { CAM_FOV } from '../constants'
import AdaptiveQuality from './AdaptiveQuality'
import Bookcase from './Bookcase'
import CameraRig from './CameraRig'
import DayNight from './DayNight'
import Desk, { Cables } from './Desk'
import Drawers from './Drawers'
import DeskClutter from './DeskClutter'
import DustMotes from './DustMotes'
import FrameGovernor from './FrameGovernor'
import Keyboard from './Keyboard'
import Duck from './Duck'
import Lamp from './Lamp'
import Monitor from './Monitor'
import Papers from './Papers'
import Room from './Room'
import LibraryHud from './LibraryHud'
import PinHud from './PinHud'
import RainAudio from './RainAudio'
import Scenery from './Scenery'
import SetDressing from './SetDressing'
import ShadowScheduler from './ShadowScheduler'
import RoomTooltip from './Tooltip'
import Tower from './Tower'
import TrashGame from './TrashGame'
import RoomWindow from './Window'
import SceneReady from './SceneReady'
import WorldFrame from './WorldFrame'
import { INTRO_CAM_POS, P } from './layout'
import { useRoom } from './roomState'
import { useSystem } from '../os/store'
import { useLibrary } from './libraryState'
import { useWorld } from '../world'

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
    __project?: (x: number, y: number, z: number) => [number, number]
  }
}

/** dev only: ?dpr=1.5 pins the canvas resolution (perf experiments) */
const PINNED_DPR = import.meta.env.DEV
  ? Number(new URLSearchParams(window.location.search).get('dpr') || 0)
  : 0

export default function Scene() {
  return (
    <>
      <Canvas
        shadows="percentage"
        // the display's own ratio up to 2 (a 1.25 cap stretched every
        // label 1.6x on Retina); AdaptiveQuality picks the live rung
        // before the first drawn frame and walks it under load
        dpr={PINNED_DPR || [1, 2]}
        camera={{
          fov: CAM_FOV,
          near: 0.04,
          far: 24,
          position: [INTRO_CAM_POS.x, INTRO_CAM_POS.y, INTRO_CAM_POS.z],
        }}
        gl={{
          antialias: true,
          alpha: true,
          // depth is required (3D room); stencil is unused anywhere in the
          // app (no outline/mask passes) — dropping it shrinks the
          // framebuffer and saves the bandwidth every draw call pays for it
          stencil: false,
          powerPreference: 'high-performance',
        }}
        onCreated={({ gl, scene, camera }) => {
          // dev only: window.__gl.info.render → { calls, triangles } for perf
          // checks; window.__scene lets experiments toggle lights and meshes;
          // window.__project(x, y, z) returns the CSS-pixel screen position of
          // a world point (for scripted clicks that survive camera changes)
          if (import.meta.env.DEV) {
            window.__gl = gl
            window.__scene = scene
            window.__project = (x, y, z) => {
              const v = new Vector3(x, y, z).project(camera)
              const r = gl.domElement.getBoundingClientRect()
              return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height]
            }
            ;(window as unknown as Record<string, unknown>).__stores = { room: useRoom, sys: useSystem, lib: useLibrary, world: useWorld }
          }
        }}
        eventSource={document.getElementById('root') as HTMLElement}
        eventPrefix="client"
        style={{ position: 'fixed', inset: 0 }}
      >
        <color attach="background" args={[P.night]} />
        {!PINNED_DPR && <AdaptiveQuality />}
        <FrameGovernor />

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
        {/* rain on the glass: renders nothing, reads live.rain each frame */}
        <RainAudio />
        {/* last, so its frame callback sees every prop's motion this frame */}
        <ShadowScheduler />
        {/* holds the first draw until shaders + textures are warm, then reveals */}
        <SceneReady />
      </Canvas>
      <RoomTooltip />
      <LibraryHud />
      <PinHud />
    </>
  )
}
