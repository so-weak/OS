import { useEffect, useState } from 'react'
import { useCursor } from '@react-three/drei'
import type { ThreeElements, ThreeEvent } from '@react-three/fiber'
import { useRoom } from './roomState'

type GroupProps = ThreeElements['group']

interface ClickableProps extends Omit<GroupProps, 'onClick'> {
  /** fired on click when enabled */
  onActivate: (e: ThreeEvent<MouseEvent>) => void
  /** tiny Silkscreen tooltip shown near the cursor while hovered */
  label?: string
  enabled?: boolean
}

/** Clear the shared tooltip, but only if we are the one showing it. */
function releaseTooltip(label: string | undefined): void {
  if (!label) return
  const room = useRoom.getState()
  if (room.tooltip === label) room.setTooltip(null)
}

/**
 * Group that turns the cursor into a pointer while hovered, shows an
 * optional room tooltip, and calls onActivate on click. Events stop
 * here so props stacked on the desk don't also trigger whatever is
 * underneath them.
 */
export default function Clickable({
  onActivate,
  label,
  enabled = true,
  children,
  ...rest
}: ClickableProps) {
  const [hovered, setHovered] = useState(false)
  // enabled gates the cursor, so a stale hover while disabled is harmless
  useCursor(hovered && enabled)

  // if the control gets disabled mid-hover, release the tooltip
  useEffect(() => {
    if (!enabled) releaseTooltip(label)
  }, [enabled, label])

  // never leave a stale tooltip behind on unmount
  useEffect(() => () => releaseTooltip(label), [label])

  return (
    <group
      {...rest}
      onPointerOver={(e) => {
        if (!enabled) return
        e.stopPropagation()
        setHovered(true)
        if (label) useRoom.getState().setTooltip(label)
      }}
      onPointerOut={() => {
        setHovered(false)
        releaseTooltip(label)
      }}
      onClick={(e) => {
        if (!enabled) return
        e.stopPropagation()
        onActivate(e)
      }}
    >
      {children}
    </group>
  )
}
