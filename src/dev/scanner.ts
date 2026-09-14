import '@fontsource/vt323/400.css'
import '@fontsource/silkscreen/400.css'
import '../styles/tokens.css'
import './scanner.css'
import { books, genres } from '../data/library'
import type { Book, ReadStatus } from '../data/library'

/* =====================================================================
   THE STACKS — ISBN intake (development only)

   Point a camera at the barcode on the back of a book (or type the
   number, or upload a photo of it), pull the metadata from Open Library
   / Google Books, add your own stars and note, and SHELVE IT. The Vite
   dev server writes the entry into src/data/library/books.ts; git and
   the next deploy do the rest.

   This file is never bundled: only scan.html imports it, and `vite
   build` only ever builds index.html. The deployed site has no way to
   add, edit or delete a book — that is the whole point of hosting a
   library on a static host.
   ===================================================================== */

if (!import.meta.env.DEV) {
  throw new Error('The intake console is a development-only tool.')
}

/* ---------- BarcodeDetector (no lib.dom types for it yet) ---------- */

interface DetectedBarcode {
  rawValue: string
  format: string
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource | Blob | ImageData): Promise<DetectedBarcode[]>
}
interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike
  getSupportedFormats?: () => Promise<string[]>
}

const BarcodeDetector = (
  window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }
).BarcodeDetector

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e']

/* ---------- ISBN helpers ---------- */

function digits(s: string): string {
  return s.replace(/[^0-9Xx]/g, '').toUpperCase()
}

/** ISBN-10 -> ISBN-13, or pass a 13 through. Returns '' if not an ISBN. */
function toIsbn13(raw: string): string {
  const d = digits(raw)
  if (/^\d{13}$/.test(d)) return ean13Valid(d) ? d : ''
  if (/^\d{9}[\dX]$/.test(d)) {
    const core = `978${d.slice(0, 9)}`
    return core + ean13Check(core)
  }
  return ''
}

function ean13Check(twelve: string): string {
  let sum = 0
  for (let i = 0; i < 12; i++) {
    sum += Number(twelve[i]) * (i % 2 === 0 ? 1 : 3)
  }
  return String((10 - (sum % 10)) % 10)
}

function ean13Valid(thirteen: string): boolean {
  return ean13Check(thirteen.slice(0, 12)) === thirteen[12]
}

function slug(title: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .split('-')
    .slice(0, 8)
    .join('-')
  let id = base || 'untitled'
  let n = 2
  while (books.some((b) => b.id === id)) id = `${base}-${n++}`
  return id
}

/* ---------- metadata lookup (authoring time only, never at runtime) ---------- */

interface Draft {
  id: string
  title: string
  subtitle: string
  authors: string
  genre: string
  year: string
  pages: string
  isbn: string
  tags: string
  status: ReadStatus
  rating: number
  finished: string
  note: string
  pick: boolean
}

const EMPTY: Draft = {
  id: '', title: '', subtitle: '', authors: '', genre: '', year: '', pages: '',
  isbn: '', tags: '', status: 'read', rating: 0, finished: '', note: '', pick: false,
}

interface OpenLibraryRecord {
  title?: string
  subtitle?: string
  authors?: { name?: string }[]
  number_of_pages?: number
  publish_date?: string
  subjects?: { name?: string }[]
}

interface GoogleVolume {
  volumeInfo?: {
    title?: string
    subtitle?: string
    authors?: string[]
    pageCount?: number
    publishedDate?: string
    categories?: string[]
  }
}

function year(text: string | undefined): string {
  const m = text ? /\d{4}/.exec(text) : null
  return m ? m[0] : ''
}

/** Nudge a subject list toward one of the genres already on the shelf. */
function guessGenre(subjects: string[]): string {
  const hay = subjects.join(' ').toLowerCase()
  const rules: [RegExp, string][] = [
    [/machine learning|artificial intelligence|neural|data mining/, 'AI & ML'],
    [/operating system|database|distributed|network|computer architecture/, 'Systems'],
    [/software|programming|refactor|agile|engineering/, 'Craft'],
    [/physics|biology|mathematic|science|psycholog/, 'Science'],
    [/fiction|novel|fantasy|science fiction/, 'Fiction'],
    [/histor|biograph|war/, 'History'],
    [/philosoph|ethic/, 'Philosophy'],
  ]
  for (const [re, genre] of rules) if (re.test(hay)) return genre
  return ''
}

/** Metadata providers are a nicety, not a dependency — give up quickly. */
const LOOKUP_TIMEOUT = 7000

async function lookup(isbn: string): Promise<Partial<Draft>> {
  try {
    const res = await fetch(
      `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`,
      { signal: AbortSignal.timeout(LOOKUP_TIMEOUT) },
    )
    const data = (await res.json()) as Record<string, OpenLibraryRecord>
    const rec = data[`ISBN:${isbn}`]
    if (rec?.title) {
      const subjects = (rec.subjects ?? []).map((s) => s.name ?? '').filter(Boolean)
      return {
        title: rec.title,
        subtitle: rec.subtitle ?? '',
        authors: (rec.authors ?? []).map((a) => a.name ?? '').filter(Boolean).join(', '),
        pages: rec.number_of_pages ? String(rec.number_of_pages) : '',
        year: year(rec.publish_date),
        genre: guessGenre(subjects),
        tags: subjects.slice(0, 3).map((s) => s.toLowerCase()).join(', '),
      }
    }
  } catch {
    /* fall through to Google */
  }
  try {
    const res = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`,
      { signal: AbortSignal.timeout(LOOKUP_TIMEOUT) },
    )
    const data = (await res.json()) as { items?: GoogleVolume[] }
    const info = data.items?.[0]?.volumeInfo
    if (info?.title) {
      return {
        title: info.title,
        subtitle: info.subtitle ?? '',
        authors: (info.authors ?? []).join(', '),
        pages: info.pageCount ? String(info.pageCount) : '',
        year: year(info.publishedDate),
        genre: guessGenre(info.categories ?? []),
        tags: (info.categories ?? []).slice(0, 3).map((c) => c.toLowerCase()).join(', '),
      }
    }
  } catch {
    /* nothing found — the form still works by hand */
  }
  return {}
}

/* ---------- tiny DOM helpers ---------- */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v
    else node.setAttribute(k, v)
  }
  for (const kid of kids) node.append(kid)
  return node
}

function field(
  label: string,
  input: HTMLElement,
): HTMLDivElement {
  return el('div', {}, el('label', {}, label), input)
}

/* ---------- the page ---------- */

const draft: Draft = { ...EMPTY }
const root = document.getElementById('scan') as HTMLDivElement
const wrap = el('div', { class: 'wrap' })
root.append(wrap)

wrap.append(
  el('h1', {}, 'THE STACKS — ISBN INTAKE'),
  el(
    'p',
    { class: 'sub' },
    `${books.length} volumes shelved · writes straight into src/data/library/books.ts`,
  ),
)

/* --- scan panel --- */
const scanPanel = el('div', { class: 'panel' })
scanPanel.append(el('h2', {}, 'scan a barcode'))
const video = el('video', { playsinline: '', muted: '' })
const camBtn = el('button', { type: 'button' }, 'start camera')
const stopBtn = el('button', { type: 'button', class: 'ghost' }, 'stop')
const fileInput = el('input', {
  type: 'file',
  accept: 'image/*',
  capture: 'environment',
})
const isbnInput = el('input', {
  type: 'text',
  placeholder: '978… (or type it by hand)',
  inputmode: 'numeric',
})
const fetchBtn = el('button', { type: 'button' }, 'look it up')
const scanStatus = el('div', { class: 'note' }, '')

scanPanel.append(
  el('div', { class: 'row' }, camBtn, stopBtn, fetchBtn),
  el('div', { class: 'grid' }, field('ISBN', isbnInput), field('…or a photo of the barcode', fileInput)),
  video,
  scanStatus,
)
wrap.append(scanPanel)

/* --- details panel --- */
const detail = el('div', { class: 'panel' })
detail.append(el('h2', {}, 'the volume'))

const inTitle = el('input', { type: 'text' })
const inSubtitle = el('input', { type: 'text' })
const inAuthors = el('input', { type: 'text', placeholder: 'comma separated' })
const inGenre = el('input', { type: 'text', list: 'genre-list' })
const genreList = el('datalist', { id: 'genre-list' })
for (const g of genres) genreList.append(el('option', { value: g.name }))
const inYear = el('input', { type: 'text', inputmode: 'numeric' })
const inPages = el('input', { type: 'text', inputmode: 'numeric' })
const inTags = el('input', { type: 'text', placeholder: 'comma separated' })
const inId = el('input', { type: 'text' })

detail.append(
  el(
    'div',
    { class: 'grid' },
    field('title', inTitle),
    field('subtitle', inSubtitle),
    field('authors', inAuthors),
    field('genre', inGenre),
    field('first published', inYear),
    field('pages', inPages),
    field('tags', inTags),
    field('id (slug)', inId),
  ),
  genreList,
)
wrap.append(detail)

/* --- verdict panel --- */
const verdict = el('div', { class: 'panel' })
verdict.append(el('h2', {}, 'your verdict — this is the part only you can write'))

const starRow = el('div', { class: 'stars' })
const starBtns: HTMLButtonElement[] = []
for (let i = 1; i <= 5; i++) {
  const b = el('button', { type: 'button', title: `${i} stars` }, '★')
  b.addEventListener('click', (e) => {
    // clicking the left half of a star gives the half star
    const half = e.offsetX < b.clientWidth / 2
    draft.rating = half ? i - 0.5 : i
    paintStars()
  })
  starBtns.push(b)
  starRow.append(b)
}
const clearStars = el('button', { type: 'button', class: 'ghost' }, 'unrated')
clearStars.addEventListener('click', () => {
  draft.rating = 0
  paintStars()
})
const starLabel = el('span', { class: 'note' }, 'unrated')

function paintStars(): void {
  starBtns.forEach((b, i) => {
    b.classList.toggle('lit', draft.rating >= i + 0.5)
    b.textContent = draft.rating >= i + 1 ? '★' : draft.rating >= i + 0.5 ? '⯨' : '★'
  })
  starLabel.textContent = draft.rating ? `${draft.rating} / 5` : 'unrated'
  refresh()
}

const inStatus = el('select')
for (const [value, label] of [
  ['read', 'read it'],
  ['reading', 'reading it now'],
  ['shelved', 'owned, not read yet'],
] as const) {
  inStatus.append(el('option', { value }, label))
}
const inFinished = el('input', { type: 'month' })
const inNote = el('textarea', {
  placeholder: 'What it did for you. One or two sentences — this is what the back cover shows.',
})
const inPick = el('input', { type: 'checkbox' })

verdict.append(
  el('div', { class: 'row' }, starRow, starLabel, clearStars),
  el(
    'div',
    { class: 'grid' },
    field('status', inStatus),
    field('finished', inFinished),
    el('div', { class: 'check' }, inPick, el('label', {}, 'shelf it under PICKS')),
  ),
  field('note', inNote),
)
wrap.append(verdict)

/* --- output panel --- */
const out = el('div', { class: 'panel' })
out.append(el('h2', {}, 'what gets written'))
const preview = el('pre', {}, '')
const shelveBtn = el('button', { type: 'button' }, 'SHELVE IT')
const copyBtn = el('button', { type: 'button', class: 'ghost' }, 'copy TS')
const outStatus = el('div', { class: 'note' }, '')
out.append(preview, el('div', { class: 'row' }, shelveBtn, copyBtn, outStatus))
wrap.append(out)

/* ---------- wiring ---------- */

function collect(): void {
  draft.title = inTitle.value.trim()
  draft.subtitle = inSubtitle.value.trim()
  draft.authors = inAuthors.value.trim()
  draft.genre = inGenre.value.trim()
  draft.year = inYear.value.trim()
  draft.pages = inPages.value.trim()
  draft.tags = inTags.value.trim()
  draft.isbn = toIsbn13(isbnInput.value)
  draft.status = inStatus.value as ReadStatus
  draft.finished = inFinished.value
  draft.note = inNote.value.trim()
  draft.pick = inPick.checked
  if (!inId.value.trim() && draft.title) inId.value = slug(draft.title)
  draft.id = inId.value.trim()
}

function asBook(): Partial<Book> & { id: string } {
  const list = (s: string): string[] =>
    s.split(',').map((x) => x.trim()).filter(Boolean)
  return {
    id: draft.id,
    title: draft.title,
    ...(draft.subtitle ? { subtitle: draft.subtitle } : {}),
    authors: list(draft.authors),
    genre: draft.genre || 'Unshelved',
    ...(draft.year ? { year: Number(draft.year) } : {}),
    ...(draft.pages ? { pages: Number(draft.pages) } : {}),
    ...(draft.isbn ? { isbn: draft.isbn } : {}),
    ...(draft.tags ? { tags: list(draft.tags) } : {}),
    status: draft.status,
    ...(draft.rating ? { rating: draft.rating } : {}),
    ...(draft.finished ? { finished: draft.finished } : {}),
    ...(draft.note ? { note: draft.note } : {}),
    ...(draft.pick ? { pick: true } : {}),
  }
}

function refresh(): void {
  collect()
  const body = asBook()
  preview.textContent = JSON.stringify(body, null, 2)
  shelveBtn.disabled = !body.title || !body.id
}

for (const input of [
  inTitle, inSubtitle, inAuthors, inGenre, inYear, inPages, inTags, inId,
  inFinished, inNote, isbnInput,
]) {
  input.addEventListener('input', refresh)
}
inStatus.addEventListener('change', refresh)
inPick.addEventListener('change', refresh)

function fill(found: Partial<Draft>): void {
  if (found.title) inTitle.value = found.title
  if (found.subtitle) inSubtitle.value = found.subtitle
  if (found.authors) inAuthors.value = found.authors
  if (found.genre) inGenre.value = found.genre
  if (found.year) inYear.value = found.year
  if (found.pages) inPages.value = found.pages
  if (found.tags) inTags.value = found.tags
  inId.value = ''
  refresh()
}

async function handleIsbn(raw: string): Promise<void> {
  const isbn = toIsbn13(raw)
  if (!isbn) {
    scanStatus.textContent = `"${raw}" is not a valid ISBN/EAN-13.`
    scanStatus.className = 'note bad'
    return
  }
  isbnInput.value = isbn
  const already = books.find((b) => b.isbn === isbn)
  if (already) {
    scanStatus.textContent = `already shelved: ${already.title}`
    scanStatus.className = 'note bad'
    return
  }
  fetchBtn.disabled = true
  scanStatus.textContent = `looking up ${isbn}…`
  scanStatus.className = 'note'
  const found = await lookup(isbn)
  fetchBtn.disabled = false
  if (found.title) {
    scanStatus.textContent = `found "${found.title}" — check it, then add your verdict.`
    scanStatus.className = 'note ok'
  } else {
    scanStatus.textContent =
      'no record found. Fill it in by hand — the shelf does not mind.'
    scanStatus.className = 'note'
  }
  fill(found)
}

fetchBtn.addEventListener('click', () => void handleIsbn(isbnInput.value))
isbnInput.addEventListener('keydown', (e) => {
  // USB barcode wedges type the digits and press Enter
  if (e.key === 'Enter') void handleIsbn(isbnInput.value)
})

/* --- camera --- */
let stream: MediaStream | null = null
let scanning = false

async function detectFrom(source: CanvasImageSource | Blob): Promise<string> {
  if (!BarcodeDetector) return ''
  const detector = new BarcodeDetector({ formats: FORMATS })
  const hits = await detector.detect(source)
  return hits.find((h) => /^97[89]/.test(digits(h.rawValue)))?.rawValue ?? ''
}

async function tick(): Promise<void> {
  if (!scanning) return
  try {
    const code = await detectFrom(video)
    if (code) {
      stopCamera()
      await handleIsbn(code)
      return
    }
  } catch {
    /* a frame that will not decode is not an error */
  }
  window.setTimeout(() => void tick(), 220)
}

function stopCamera(): void {
  scanning = false
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
  video.srcObject = null
}

camBtn.addEventListener('click', () => {
  void (async () => {
    if (!BarcodeDetector) {
      scanStatus.textContent =
        'This browser has no BarcodeDetector. Use the photo field or type the number.'
      scanStatus.className = 'note bad'
      return
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      video.srcObject = stream
      await video.play()
      scanning = true
      scanStatus.textContent = 'hold the back cover barcode steady…'
      scanStatus.className = 'note'
      void tick()
    } catch (err) {
      scanStatus.textContent = `camera unavailable: ${
        err instanceof Error ? err.message : String(err)
      }. Over plain http only localhost may use a camera — use the photo field instead.`
      scanStatus.className = 'note bad'
    }
  })()
})

stopBtn.addEventListener('click', stopCamera)

fileInput.addEventListener('change', () => {
  void (async () => {
    const file = fileInput.files?.[0]
    if (!file) return
    if (!BarcodeDetector) {
      scanStatus.textContent = 'No BarcodeDetector in this browser — type the number.'
      scanStatus.className = 'note bad'
      return
    }
    try {
      const bitmap = await createImageBitmap(file)
      const code = await detectFrom(bitmap)
      bitmap.close()
      if (code) await handleIsbn(code)
      else {
        scanStatus.textContent = 'no barcode in that photo — try again or type it.'
        scanStatus.className = 'note bad'
      }
    } catch (err) {
      scanStatus.textContent = err instanceof Error ? err.message : String(err)
      scanStatus.className = 'note bad'
    }
  })()
})

/* --- shelve --- */
shelveBtn.addEventListener('click', () => {
  void (async () => {
    refresh()
    shelveBtn.disabled = true
    outStatus.textContent = 'writing to books.ts…'
    outStatus.className = 'note'
    try {
      const res = await fetch('/__stacks/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(asBook()),
      })
      const body = (await res.json()) as { ok?: boolean; id?: string; error?: string }
      if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`)
      outStatus.textContent = `shelved as "${body.id}" — commit books.ts and it is live on the next deploy.`
      outStatus.className = 'note ok'
    } catch (err) {
      outStatus.textContent = `could not write: ${
        err instanceof Error ? err.message : String(err)
      }`
      outStatus.className = 'note bad'
      shelveBtn.disabled = false
    }
  })()
})

copyBtn.addEventListener('click', () => {
  void navigator.clipboard.writeText(preview.textContent ?? '').then(
    () => {
      outStatus.textContent = 'copied — paste it into books.ts yourself if you prefer.'
      outStatus.className = 'note ok'
    },
    () => {
      outStatus.textContent = 'clipboard refused; select the text above instead.'
      outStatus.className = 'note bad'
    },
  )
})

paintStars()
refresh()
