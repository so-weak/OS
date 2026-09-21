/* =====================================================================
   The Stacks — data contract for the 3D library.

   Books are STATIC content: they are authored in code (books.ts) and
   the site never mutates them. The dev-only ISBN scanner (scan.html)
   appends entries to books.ts through the Vite dev server; production
   ships whatever is committed.
   ===================================================================== */

/** Where a volume sits in the reading pipeline. */
export type ReadStatus =
  /** finished */
  | 'read'
  /** on the nightstand right now — gets a ribbon on the shelf */
  | 'reading'
  /** owned, not read yet — puffs dust when pulled */
  | 'shelved'

/** Optional art direction for a book's 3D spine. All fields optional. */
export interface SpineStyle {
  /** binding cloth colour (hex). Defaults to the genre colour. */
  cloth?: string
  /** foil/ink colour for the stamped title. Defaults to the genre foil. */
  foil?: string
  /** relative height, 0.8–1.15 (1 = 0.215m). Defaults to a hash of the id. */
  tall?: number
  /** relative thickness, 0.7–1.6 (1 = 0.032m). Defaults to a hash of the id. */
  thick?: number
  /** raised bands + double rules across the spine (old cloth binding) */
  bands?: boolean
}

export interface Book {
  /** stable slug — also the seed for all generated art */
  id: string
  title: string
  subtitle?: string
  authors: string[]
  /** free text; known genres get a palette, unknown ones get a hashed one */
  genre: string
  /** first publication year */
  year?: number
  pages?: number
  /** ISBN-13 (digits only) — drawn as a real EAN-13 barcode on the back */
  isbn?: string
  tags?: string[]
  status: ReadStatus
  /** 0–5, halves allowed. Omit for unrated. */
  rating?: number
  /** 'YYYY-MM' or 'YYYY-MM-DD' — drives the LATEST shelf */
  finished?: string
  /** the personal note, printed on the back cover — keep it to one
      punchy line (about 140 characters): the back board wraps at seven */
  note?: string
  /** the fuller review, shown on the catalogue page under the note.
      Plain paragraphs separated by a blank line. */
  review?: string
  /** surfaces the book on the PICKS shelf */
  pick?: boolean
  spine?: SpineStyle
  /**
   * true while the rating/note are build-authored placeholders rather
   * than Soubhik's own words. The catalogue card shows a "sample
   * catalogue" tag for as long as any book carries this flag — delete
   * the flag as you write real notes and the tag retires itself.
   */
  sample?: boolean
}
