import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Connect, Plugin, ViteDevServer } from 'vite'

/* =====================================================================
   Dev-server half of the ISBN scanner (scan.html).

   The deployed site is static and read-only: books are content, and
   content lives in git. So "adding a book" means editing
   src/data/library/books.ts — and this plugin is the thing that does
   the editing, on the developer's own machine, while `vite dev` runs.

   `apply: 'serve'` keeps it out of `vite build` entirely. There is no
   counterpart in production, by design.
   ===================================================================== */

const ROUTE = '/__stacks/add'
const MARKER = '/* @library:insert'
const BOOKS = 'src/data/library/books.ts'

/** Fields we are willing to write, in the order they appear in the file. */
const FIELDS = [
  'id', 'title', 'subtitle', 'authors', 'genre', 'year', 'pages', 'isbn',
  'tags', 'status', 'rating', 'finished', 'note', 'pick', 'spine',
] as const

type Field = (typeof FIELDS)[number]
type Draft = Partial<Record<Field, unknown>>

const SPINE_FIELDS = ['cloth', 'foil', 'tall', 'thick', 'bands']

/** Serialize server-side from a whitelist — never eval client text. */
function serialize(draft: Draft): string {
  const lines: string[] = ['  {']
  for (const key of FIELDS) {
    const value = draft[key]
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      if (!value.length) continue
      const items = value.map((v) => JSON.stringify(String(v))).join(', ')
      lines.push(`    ${key}: [${items}],`)
    } else if (key === 'spine' && typeof value === 'object') {
      const spine = value as Record<string, unknown>
      const parts = SPINE_FIELDS.filter(
        (k) => spine[k] !== undefined && spine[k] !== '' && spine[k] !== false,
      ).map((k) =>
        typeof spine[k] === 'string'
          ? `${k}: ${JSON.stringify(spine[k])}`
          : `${k}: ${JSON.stringify(spine[k])}`,
      )
      if (parts.length) lines.push(`    spine: { ${parts.join(', ')} },`)
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      lines.push(`    ${key}: ${JSON.stringify(value)},`)
    } else {
      lines.push(`    ${key}: ${JSON.stringify(String(value))},`)
    }
  }
  lines.push('  },')
  return lines.join('\n')
}

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer | string) => {
      body += chunk
      if (body.length > 64_000) reject(new Error('body too large'))
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

export function libraryWriter(): Plugin {
  return {
    name: 'stacks-library-writer',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(ROUTE, (req, res) => {
        const send = (code: number, payload: unknown): void => {
          res.statusCode = code
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(payload))
        }
        if (req.method !== 'POST') {
          send(405, { error: 'POST only' })
          return
        }
        void (async () => {
          try {
            const draft = JSON.parse(await readBody(req)) as Draft
            const id = typeof draft.id === 'string' ? draft.id : ''
            if (!/^[a-z0-9-]{2,80}$/.test(id)) {
              send(400, { error: 'id must be a kebab-case slug' })
              return
            }
            if (typeof draft.title !== 'string' || !draft.title.trim()) {
              send(400, { error: 'title is required' })
              return
            }

            const file = path.resolve(server.config.root, BOOKS)
            const source = await readFile(file, 'utf8')
            if (source.includes(`id: '${id}'`) || source.includes(`id: "${id}"`)) {
              send(409, { error: `"${id}" is already on the shelf` })
              return
            }
            const at = source.indexOf(MARKER)
            if (at < 0) {
              send(500, { error: `marker ${MARKER} missing from ${BOOKS}` })
              return
            }
            // insert above the marker line, keeping its indentation
            const lineStart = source.lastIndexOf('\n', at) + 1
            const next = `${serialize(draft)}\n\n`
            await writeFile(file, source.slice(0, lineStart) + next + source.slice(lineStart))
            server.config.logger.info(`  ➜  shelved "${draft.title}" (${id})`)
            send(200, { ok: true, id })
          } catch (err) {
            send(500, { error: err instanceof Error ? err.message : String(err) })
          }
        })()
      })
    },
  }
}
