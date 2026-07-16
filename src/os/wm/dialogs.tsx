import type { ReactNode } from 'react'
import { identity } from '../../data/resume'
import { useSystem } from '../store'
import { AppIcon } from '../icons/AppIcon'
import { playClick } from '../sound'
import { GlyphClose, GlyphPower, BadgeErrorX } from './glyphs'

/* =====================================================================
   System message boxes. Win9x-centered, modal (transparent backdrop
   blocks the desktop), never dimmed — this is 1998.
   ===================================================================== */

function SysDialog({
  title,
  width = 380,
  onClose,
  children,
  buttons,
}: {
  title: string
  width?: number
  onClose: () => void
  children: ReactNode
  buttons: ReactNode
}) {
  return (
    <>
      <div className="os-backdrop" style={{ zIndex: 5990 }} />
      <div className="sysdlg" style={{ width }} role="dialog" aria-label={title}>
        <div className="win-titlebar">
          <span className="win-title">{title}</span>
          <button
            className="btn-sq"
            onClick={() => {
              playClick()
              onClose()
            }}
            aria-label="Close"
          >
            <GlyphClose />
          </button>
        </div>
        <div className="sysdlg-body">{children}</div>
        <div className="sysdlg-buttons">{buttons}</div>
      </div>
    </>
  )
}

function DlgButton({
  label,
  primary,
  onClick,
}: {
  label: string
  primary?: boolean
  onClick: () => void
}) {
  return (
    <button
      className={`btn${primary ? ' primary' : ''}`}
      autoFocus={primary}
      onClick={() => {
        playClick()
        onClick()
      }}
    >
      {label}
    </button>
  )
}

/* ---------- Shut Down… ---------- */

export function ShutdownDialog({ onClose }: { onClose: () => void }) {
  return (
    <SysDialog
      title="Shut Down SoubhikOS"
      width={370}
      onClose={onClose}
      buttons={
        <>
          <DlgButton
            label="OK"
            primary
            onClick={() => {
              onClose()
              useSystem.getState().shutDown()
            }}
          />
          <DlgButton label="Cancel" onClick={onClose} />
        </>
      }
    >
      <span className="sysdlg-badge t-amber">
        <GlyphPower size={30} />
      </span>
      <div>
        <p>It&rsquo;s been fun. Shut down SoubhikOS?</p>
        <p className="t-soft dlg-fine">
          Unsaved impressions will be committed to memory.
        </p>
      </div>
    </SysDialog>
  )
}

/* ---------- About SoubhikOS… ---------- */

export function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <SysDialog
      title="About SoubhikOS"
      width={410}
      onClose={onClose}
      buttons={<DlgButton label="OK" primary onClick={onClose} />}
    >
      <AppIcon name="os-logo" size={40} />
      <div>
        <p>
          <b>SoubhikOS 4.01</b>
          <br />
          <span className="t-soft">Retro Resume Environment</span>
        </p>
        <div className="dlg-rule" />
        <p>
          Licensed to: <b>whoever is reading this</b>
        </p>
        <p>
          Memory: 640K of RAM — which ought to be
          <br />
          enough for anybody&rsquo;s resume.
        </p>
        <p className="t-soft dlg-fine">
          Handcrafted by {identity.name} · {identity.location}
        </p>
      </div>
    </SysDialog>
  )
}

/* ---------- New > Folder ---------- */

export function NewFolderDialog({ onClose }: { onClose: () => void }) {
  return (
    <SysDialog
      title="New Folder"
      width={380}
      onClose={onClose}
      buttons={<DlgButton label="OK" primary onClick={onClose} />}
    >
      <BadgeErrorX size={32} />
      <p>Access denied: this desktop is already perfectly organized.</p>
    </SysDialog>
  )
}
