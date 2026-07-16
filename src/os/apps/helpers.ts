import type { Project } from '../../data/resume'

/* =====================================================================
   Non-component helpers shared by the resume apps (Agent 4 module).
   ===================================================================== */

/* ---------- deterministic seeded randomness ---------- */

export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ---------- category metadata ---------- */

export const CATEGORY_ORDER: Project['category'][] = ['genai', 'ml-cv', 'oss']

export const CATEGORY_LABEL: Record<Project['category'], string> = {
  genai: 'Generative AI',
  'ml-cv': 'ML & Computer Vision',
  oss: 'Open Source',
}

export const CATEGORY_TINT: Record<
  Project['category'],
  { bg: string; px: string; hi: string }
> = {
  genai: {
    bg: 'var(--title-a)',
    px: 'var(--title-b)',
    hi: 'var(--face-light)',
  },
  'ml-cv': {
    bg: 'var(--face-darker)',
    px: 'var(--amber)',
    hi: 'var(--face-light)',
  },
  oss: {
    bg: 'var(--term-bg)',
    px: 'var(--term-green)',
    hi: 'var(--face-light)',
  },
}
