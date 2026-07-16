import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

/* =====================================================================
   App registry — the OS's "installed programs".
   Each app is lazy-loaded; window manager opens them by id.
   ===================================================================== */

export interface AppProps {
  windowId: string
  props?: Record<string, unknown>
}

export interface AppDefinition {
  id: string
  title: string
  /** icon name resolved by <AppIcon /> (src/os/icons) */
  icon: string
  component: LazyExoticComponent<ComponentType<AppProps>>
  defaultSize: [number, number]
  minSize?: [number, number]
  /** default true — re-opening focuses the existing window */
  singleInstance?: boolean
  /** show on the desktop */
  desktop?: boolean
  /** show in the Start menu */
  startMenu?: boolean
  /** if false, window has no resize handles */
  resizable?: boolean
}

export const apps: AppDefinition[] = [
  {
    id: 'about',
    title: 'About Me',
    icon: 'about',
    component: lazy(() => import('./apps/AboutMe')),
    defaultSize: [620, 600],
    desktop: true,
    startMenu: true,
  },
  {
    id: 'projects',
    title: 'My Work',
    icon: 'folder-work',
    component: lazy(() => import('./apps/Projects')),
    defaultSize: [800, 620],
    desktop: true,
    startMenu: true,
  },
  {
    id: 'experience',
    title: 'Experience',
    icon: 'briefcase',
    component: lazy(() => import('./apps/Experience')),
    defaultSize: [700, 620],
    desktop: true,
    startMenu: true,
  },
  {
    id: 'skills',
    title: 'Skill Manager',
    icon: 'chip',
    component: lazy(() => import('./apps/Skills')),
    defaultSize: [580, 620],
    desktop: true,
    startMenu: true,
  },
  {
    id: 'resume',
    title: 'Resume.pdf',
    icon: 'pdf',
    component: lazy(() => import('./apps/Resume')),
    defaultSize: [700, 680],
    desktop: true,
    startMenu: true,
  },
  {
    id: 'contact',
    title: 'Contact',
    icon: 'mail',
    component: lazy(() => import('./apps/Contact')),
    defaultSize: [580, 520],
    desktop: true,
    startMenu: true,
  },
  {
    id: 'awards',
    title: 'Awards',
    icon: 'trophy',
    component: lazy(() => import('./apps/Awards')),
    defaultSize: [560, 500],
    desktop: false,
    startMenu: true,
  },
  {
    id: 'terminal',
    title: 'Terminal',
    icon: 'terminal',
    component: lazy(() => import('./apps/Terminal')),
    defaultSize: [600, 420],
    desktop: true,
    startMenu: true,
  },
  {
    id: 'snake',
    title: 'Nibbles',
    icon: 'snake',
    component: lazy(() => import('./apps/Snake')),
    defaultSize: [440, 480],
    desktop: true,
    startMenu: true,
    resizable: false,
  },
  {
    id: 'welcome',
    title: 'Welcome',
    icon: 'os-logo',
    component: lazy(() => import('./apps/Welcome')),
    defaultSize: [540, 470],
    desktop: false,
    startMenu: false,
  },
]

export function getApp(id: string): AppDefinition | undefined {
  return apps.find((a) => a.id === id)
}
