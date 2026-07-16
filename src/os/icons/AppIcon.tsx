import { icons } from './icons'

/* =====================================================================
   Pixel icon system. Icons are 16x16 pixel-grids drawn as inline SVG
   (crisp at 2x via shape-rendering). `icons.tsx` owns the artwork;
   this component is the stable interface the rest of the OS uses.
   ===================================================================== */

export interface AppIconProps {
  name: string
  size?: number // rendered px, default 32
}

export function AppIcon({ name, size = 32 }: AppIconProps) {
  const Icon = icons[name] ?? icons['default']
  return (
    <span
      style={{
        width: size,
        height: size,
        display: 'inline-block',
        lineHeight: 0,
        imageRendering: 'pixelated',
      }}
      aria-hidden
    >
      <Icon size={size} />
    </span>
  )
}
