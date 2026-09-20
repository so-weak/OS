import type { SurfaceMaps } from './textures'

/* =====================================================================
   The back wall. Its own file so the window builder can cut a real
   opening in it (WINDOW in layout.ts) and hang sky layers behind — a
   window that is a hole, not a picture, is what gives the room parallax.
   The plaster surface is passed in from Room.tsx so every wall shares
   one look.
   ===================================================================== */

export default function BackWall({ surface }: { surface: SurfaceMaps }) {
  return (
    <mesh position={[0.1, 1.3, -1.08]} receiveShadow>
      <planeGeometry args={[4.6, 2.6]} />
      <meshStandardMaterial
        map={surface.map}
        bumpMap={surface.bumpMap}
        bumpScale={0.003}
        roughnessMap={surface.roughnessMap}
        roughness={1}
      />
    </mesh>
  )
}
