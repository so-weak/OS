import { books } from './books'
import type { Book } from './types'

export type { Book, ReadStatus, SpineStyle } from './types'
export { books }

/* =====================================================================
   Catalogue queries — pure functions over the static book list.
   The 3D library is a view onto these; nothing here ever mutates.
   ===================================================================== */

/** The brass tabs along the front of the catalogue slide. */
export type ShelfTab = 'all' | 'latest' | 'picks' | 'reading' | 'unread'

export type SortMode = 'shelf' | 'latest' | 'rating' | 'title' | 'author'

export interface LibraryQuery {
  text: string
  /** null = every genre */
  genre: string | null
  /** null = every author */
  author: string | null
  tab: ShelfTab
  sort: SortMode
}

/* The LATEST tab is about dates read; a shelf without any dates has no
   use for it, so it only appears once some book has one. */
const HAS_DATES = books.some((b) => b.finished)

export const SHELF_TABS: { id: ShelfTab; label: string }[] = [
  { id: 'all', label: 'ALL' },
  ...(HAS_DATES ? [{ id: 'latest' as const, label: 'LATEST' }] : []),
  { id: 'picks', label: 'PICKS' },
  { id: 'reading', label: 'READING' },
  { id: 'unread', label: 'UNREAD' },
]

export const SORT_MODES: { id: SortMode; label: string }[] = [
  /* the order the books stand on the real shelves — the order they are
     written in books.ts */
  { id: 'shelf', label: 'SHELF ORDER' },
  ...(HAS_DATES ? [{ id: 'latest' as const, label: 'DATE READ' }] : []),
  { id: 'rating', label: 'STARS' },
  { id: 'title', label: 'TITLE' },
  { id: 'author', label: 'AUTHOR' },
]

/* ---------- genre palette ----------
   Known genres get hand-picked cloth/foil pairs; anything the scanner
   invents falls back to a hashed hue so a new genre still looks bound
   rather than default-grey. */
export interface GenreStyle {
  cloth: string
  foil: string
}

const GENRE_STYLE: Record<string, GenreStyle> = {
  'AI & ML': { cloth: '#2c4a63', foil: '#cfe3f2' },
  Systems: { cloth: '#3a4a3c', foil: '#d7e3c8' },
  Craft: { cloth: '#7a3b2e', foil: '#f0d9b5' },
  Science: { cloth: '#2f4f4a', foil: '#dff0e6' },
  Fiction: { cloth: '#5b3a56', foil: '#f2d7ea' },
  History: { cloth: '#5c4326', foil: '#e8c477' },
  Philosophy: { cloth: '#413a5e', foil: '#ddd4f0' },
}

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Deterministic 0..1 from any string — shared by art and layout. */
export function seeded(s: string, salt = ''): number {
  return (hashString(s + salt) % 10000) / 10000
}

export function genreStyle(genre: string): GenreStyle {
  const known = GENRE_STYLE[genre]
  if (known) return known
  const hue = Math.floor(seeded(genre, 'hue') * 360)
  return {
    cloth: `hsl(${hue} 24% 28%)`,
    foil: `hsl(${hue} 40% 86%)`,
  }
}

/* ---------- derived index ---------- */

export interface Facet {
  name: string
  count: number
}

function facets(pick: (b: Book) => string[]): Facet[] {
  const counts = new Map<string, number>()
  for (const b of books) {
    for (const key of pick(b)) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/** Genres present in the catalogue, most-shelved first. */
export const genres: Facet[] = facets((b) => [b.genre])

/** Every author on the shelves, most-shelved first. */
export const authors: Facet[] = facets((b) => b.authors)

/** True while any entry still carries build-authored placeholder text. */
export const hasSamples: boolean = books.some((b) => b.sample)

/* ---------- text helpers ---------- */

const SUFFIX = /^(jr|sr|ii|iii|iv)\.?$/i
/** A publisher or series standing in for a person keeps its whole name. */
const ORGANISATION = /\b(corporation|network|press|series)$/i

/** "Le Guin" — last real word of the first author, for compact spines. */
export function surname(author: string): string {
  if (ORGANISATION.test(author)) return author
  const parts = author.replace(/[.,]$/, '').split(' ').filter(Boolean)
  while (parts.length > 1 && SUFFIX.test(parts[parts.length - 1])) parts.pop()
  return parts[parts.length - 1] || author
}

/** "Hastie, Tibshirani & Friedman" / "Beyer et al." */
export function authorLine(b: Book): string {
  const names = b.authors.map(surname)
  if (names.length === 0) return 'Anonymous'
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} & ${names[1]}`
  if (names.length === 3) return `${names[0]}, ${names[1]} & ${names[2]}`
  return `${names[0]} et al.`
}

/** Full byline for the cover: "Ian Goodfellow, Yoshua Bengio & …". */
export function fullByline(b: Book): string {
  if (b.authors.length <= 2) return b.authors.join(' & ')
  return `${b.authors.slice(0, -1).join(', ')} & ${b.authors[b.authors.length - 1]}`
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/** '2025-07' -> 'Jul 2025'. Unparseable input is passed through. */
export function readDate(iso: string | undefined): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})/.exec(iso)
  if (!m) return iso
  const month = MONTHS[Number(m[2]) - 1]
  return month ? `${month} ${m[1]}` : m[1]
}

/* ---------- the query ---------- */

function haystack(b: Book): string {
  return [
    b.title,
    b.subtitle ?? '',
    b.authors.join(' '),
    b.genre,
    (b.tags ?? []).join(' '),
    b.year ?? '',
    b.isbn ?? '',
    b.note ?? '',
    b.review ?? '',
  ]
    .join(' ')
    .toLowerCase()
}

/** Lazily built so the cost is paid on first search, not on import. */
let haystacks: Map<string, string> | null = null

function matchesText(b: Book, needle: string): boolean {
  if (!needle) return true
  if (!haystacks) {
    haystacks = new Map(books.map((x) => [x.id, haystack(x)]))
  }
  const hay = haystacks.get(b.id) ?? haystack(b)
  // every whitespace-separated term must appear somewhere
  return needle
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => hay.includes(term))
}

function matchesTab(b: Book, tab: ShelfTab): boolean {
  switch (tab) {
    case 'latest':
      return !!b.finished
    case 'picks':
      return !!b.pick
    case 'reading':
      return b.status === 'reading'
    case 'unread':
      return b.status === 'shelved'
    case 'all':
      return true
  }
}

/** Position in books.ts = position on the physical shelf. */
const SHELF_INDEX = new Map(books.map((b, i) => [b.id, i]))

function compare(a: Book, b: Book, sort: SortMode): number {
  switch (sort) {
    case 'shelf':
      return (SHELF_INDEX.get(a.id) ?? 0) - (SHELF_INDEX.get(b.id) ?? 0)
    case 'latest':
      return (b.finished ?? '').localeCompare(a.finished ?? '')
    case 'rating':
      return (b.rating ?? -1) - (a.rating ?? -1)
    case 'title':
      return a.title.localeCompare(b.title)
    case 'author':
      return surname(a.authors[0] ?? '').localeCompare(surname(b.authors[0] ?? ''))
  }
}

/** Filter + sort. Ties always break on title so the shelf is stable. */
export function selectBooks(q: LibraryQuery): Book[] {
  const needle = q.text.trim()
  return books
    .filter(
      (b) =>
        matchesTab(b, q.tab) &&
        (q.genre === null || b.genre === q.genre) &&
        (q.author === null || b.authors.includes(q.author)) &&
        matchesText(b, needle),
    )
    .sort((a, b) => compare(a, b, q.sort) || a.title.localeCompare(b.title))
}
