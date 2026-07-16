import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/* =====================================================================
   Tiny in-window toast. StrictMode-safe (timer cleared on unmount).
   Render the returned node inside an `.app` (position: relative) root.
   ===================================================================== */

export function useToast(): { toast: ReactNode; show: (msg: string) => void } {
  const [msg, setMsg] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )

  const show = useCallback((m: string) => {
    setMsg(m)
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMsg(null), 2400)
  }, [])

  const toast = msg ? (
    <div className="app-toast bevel-out" role="status">
      {msg}
    </div>
  ) : null

  return { toast, show }
}
