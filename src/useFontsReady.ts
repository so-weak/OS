import { useEffect, useState } from 'react'

/**
 * True once the webfonts have loaded. Shared by the 3D shelf and the
 * catalogue page: both draw type onto canvases. Canvas textures that draw text
 * must wait for this or they rasterise with a fallback face and never
 * repaint (a canvas is not re-laid out when a font arrives).
 */
export function useFontsReady(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let alive = true
    const done = (): void => {
      if (alive) setReady(true)
    }
    if (typeof document !== 'undefined' && 'fonts' in document) {
      document.fonts.ready.then(done, done)
    } else {
      done()
    }
    return () => {
      alive = false
    }
  }, [])
  return ready
}
