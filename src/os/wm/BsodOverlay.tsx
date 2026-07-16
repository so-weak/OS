import { useEffect } from 'react'
import { useEggs } from '../eggs'
import { playBeep } from '../sound'

/* =====================================================================
   The classic blue screen — triggered from useEggs (Terminal's `crash`
   command, or anything else that panics). Any key or click dismisses.
   ===================================================================== */

export default function BsodOverlay() {
  const dismissBsod = useEggs((s) => s.dismissBsod)

  useEffect(() => {
    // capture phase so the dismissing keypress never reaches the app
    // below (or App.tsx's Escape-to-zoom-out handler)
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation()
      e.preventDefault()
      dismissBsod()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [dismissBsod])

  useEffect(() => {
    // mournful beep on arrival; timeout keeps StrictMode from double-beeping
    const t = setTimeout(() => playBeep(), 80)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="bsod" onPointerDown={dismissBsod}>
      <div className="bsod-inner">
        <div className="bsod-title">SOUBHIK_OS</div>
        <p>
          A problem has been detected: <b>RECRUITER_ATTENTION_OVERFLOW</b>
        </p>
        <p>The system has been halted to prevent damage to your shortlist.</p>
        <p className="bsod-detail">
          *&nbsp;STOP: 0x0000C0FFEE (0xCAFEBABE, 0xDEADBEEF, 0x00001998)
          <br />
          *&nbsp;The current process (YOUR_DOUBTS.EXE) has been terminated.
          <br />
          *&nbsp;If this is the first time you have hired this developer,
          relax: uptime so far is excellent.
        </p>
        <p className="bsod-continue">
          Press any key to continue <span className="os-blink">▊</span>
        </p>
      </div>
    </div>
  )
}
