import { useEffect, useRef, useState } from 'react'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  ChangeEvent,
  SyntheticEvent,
} from 'react'
import type { AppProps } from '../registry'
import { apps } from '../registry'
import { useSystem, useWindows } from '../store'
import { DUCK_GOLDEN_AT, useEggs } from '../eggs'
import { useLibrary } from '../../three/libraryState'
import { LEDGER, useWorld, type Weather } from '../../world'
import { playBeep } from '../sound'
import { SCREEN_W, SCREEN_H } from '../../constants'
import { books } from '../../data/library'
import {
  identity,
  summary,
  experience,
  experienceTally,
  education,
  awards,
  projects,
  certifications,
} from '../../data/resume'
import './terminal.css'

/* =====================================================================
   SoubhikOS Terminal — a VT323 phosphor shell living inside a window.
   Real hidden <input> carries the keystrokes (the OS sits in a CSS-
   transformed div, so we keep focus management explicit), the visible
   line renders its own blinking block cursor. History via arrows,
   tab-completion, and a drawer full of undocumented commands.
   ===================================================================== */

const PROMPT = 'guest@soubhikos:~$'

interface Span {
  text: string
  /** extra class on the span: tc-amber | tc-red | tc-dim | tc-sw sw-* */
  cls?: string
}

interface Line {
  id: number
  spans: Span[]
}

const DOCUMENTED = [
  'help', 'ls', 'cat', 'open', 'whoami',
  'neofetch', 'snake', 'hire', 'clear', 'exit',
]

/** everything tab-completion knows about (documented + gags) */
const COMPLETABLE = [
  ...DOCUMENTED, 'dir', 'cls', 'sudo', 'matrix', 'crash', 'bsod',
  'format', 'echo', 'ver', 'history', 'whereis', 'pwd', 'cd', 'man',
  'duck', 'hack', 'quit', 'date', 'soweak', 'weather', 'forget',
  'konnichiwa',
]

const FILES = ['resume.txt', 'projects/', 'secrets.txt', 'snake.exe']

/* ---------- the shell's own guardrail (E-3) ----------
   Tested ONLY against input that fell through to "Bad command" — the
   set is deliberately narrow so a pasted job description, "you are now
   the lead of…" or "redundant" never trip it. */
const INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore (all |any |your )?(previous|prior|above) (instructions|prompts?|rules)/i,
  /(reveal|print|show|repeat|leak) (me )?(your |the )?system prompt/i,
  /\bjailbreak\b/i,
  /\bDAN mode\b/,
  /pretend (you are|to be) (an? )?(unrestricted|unfiltered)/i,
]

/** the OSS guardrail project, straight from resume.ts */
const SOWEAK = projects.find((p) => p.id === 'soweak')

/** the Japanese qualification, if (and only if) the resume states one */
const JLPT = certifications.find((c) => /\bJLPT\b/.test(c))
const JLPT_LEVEL = JLPT?.match(/\bN[1-5]\b/)?.[0]

/** every 64 bytes of secrets.txt is one thing you found */
const SECRET_BYTES = 64

const WEATHER_KINDS: readonly Weather[] = ['clear', 'rain', 'storm']
const WEATHER_LINE: Record<Weather, string> = {
  storm: 'weather: storm. the window will let you know.',
  rain: 'weather: rain. the glass will tell you before I do.',
  clear: 'weather: clear. nothing between you and the skyline.',
}

const NEOFETCH_LOGO = [
  '   .oooooooo.   ',
  '  d8P      Y8b  ',
  '  Y8b.          ',
  '   "Y8888ooo.   ',
  '       ""  Y8b  ',
  '  8b       d8P  ',
  '   "Y88888P"    ',
  '                ',
  '   SoubhikOS    ',
]

function appIds(): string {
  return apps.map((a) => a.id).join(', ')
}

export default function Terminal({ windowId }: AppProps) {
  const [lines, setLines] = useState<Line[]>(() => [
    { id: 0, spans: [{ text: "SoubhikOS Terminal — type 'help'" }] },
    {
      id: 1,
      spans: [
        { text: 'guest login from tty1 · no privileges, no problem', cls: 'tc-dim' },
      ],
    },
    { id: 2, spans: [{ text: '' }] },
  ])
  const [val, setVal] = useState('')
  const [caret, setCaret] = useState(0)
  const [focused, setFocused] = useState(false)
  const [busy, setBusy] = useState(false)
  const [matrix, setMatrix] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const idRef = useRef(3)
  const histRef = useRef<string[]>([])
  const histIdxRef = useRef(-1)
  const draftRef = useRef('')
  const timersRef = useRef<Set<number>>(new Set())

  /* ---------- timers with strict cleanup ---------- */
  const after = (ms: number, fn: () => void): number => {
    const t = window.setTimeout(() => {
      timersRef.current.delete(t)
      fn()
    }, ms)
    timersRef.current.add(t)
    return t
  }
  const every = (ms: number, fn: () => void): number => {
    const t = window.setInterval(fn, ms)
    timersRef.current.add(t)
    return t
  }
  const cancelTimers = (): void => {
    timersRef.current.forEach((t) => {
      window.clearTimeout(t)
      window.clearInterval(t)
    })
    timersRef.current.clear()
  }
  useEffect(() => cancelTimers, [])

  /* ---------- output helpers ---------- */
  const pushSpans = (spans: Span[]): number => {
    const id = idRef.current++
    setLines((ls) => [...ls, { id, spans }])
    return id
  }
  const push = (text: string, cls?: string): number =>
    pushSpans(cls ? [{ text, cls }] : [{ text }])
  const pushAll = (texts: string[], cls?: string): void => {
    setLines((ls) => [
      ...ls,
      ...texts.map((text) => ({
        id: idRef.current++,
        spans: cls ? [{ text, cls }] : [{ text }],
      })),
    ])
  }
  const replaceLine = (id: number, spans: Span[]): void => {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, spans } : l)))
  }
  const err = (text: string): void => {
    push(text, 'tc-red')
    playBeep()
  }

  /* ---------- focus management ---------- */
  const focusInput = (): void => {
    inputRef.current?.focus({ preventScroll: true })
  }
  useEffect(() => {
    focusInput()
  }, [busy, matrix])

  /* ---------- autoscroll ---------- */
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines, val, busy, matrix])

  /* =====================================================================
     Commands
     ===================================================================== */

  const cmdHelp = (): void => {
    pushAll([
      'SoubhikOS shell — the useful ones:',
      '  help           this list',
      '  ls / dir       look around',
      '  cat <file>     read a file',
      '  open <app>     launch an app (no args lists them)',
      '  whoami         identity check',
      '  neofetch       system info, the vain way',
      '  snake          the load-bearing snake',
      '  hire           cut to the chase',
      '  clear          wipe the slate',
      '  exit           close this window',
    ])
    push(
      '…and a few undocumented ones. a resume, like an OS, rewards curiosity.',
      'tc-dim',
    )
  }

  const cmdLs = (arg: string): void => {
    if (arg.replace(/\/$/, '') === 'projects') {
      push(' Directory of C:\\GUEST\\PROJECTS', 'tc-dim')
      push('')
      // real project list lives in My Work — point there instead of duplicating
      push(`  ${projects.length} folders. genai, ml-cv and open source.`)
      push("  the pretty version has screenshots: try 'open projects'.")
      return
    }
    if (arg) {
      err(`ls: cannot access '${arg}': no such directory`)
      return
    }
    const found = useWorld.getState().found.length
    const secretSize = found
      ? `${(found * SECRET_BYTES).toLocaleString('en-US')} bytes`
      : '0 bytes   (locked)'
    pushAll([
      ' Directory of C:\\GUEST',
      '',
      '  resume.txt      <FILE>    4,096 bytes',
      '  projects        <DIR>',
      `  secrets.txt     <FILE>    ${secretSize}`,
      '  snake.exe       <FILE>    64K       (load-bearing)',
      '',
      '        3 file(s), 1 dir(s), 640K free (enough for anybody)',
    ])
  }

  const cmdCat = (arg: string): void => {
    const f = arg.toLowerCase().replace(/^\.\//, '')
    if (!f) {
      err('cat: which file? (hint: ls)')
      return
    }
    if (f === 'resume.txt' || f === 'resume') {
      push('')
      push(`  ${identity.name.toUpperCase()}`, 'tc-amber')
      push(`  ${identity.title}`)
      push(`  ${identity.location} · ${identity.email}`, 'tc-dim')
      push('')
      push(`  ${summary}`)
      push('')
      push('  experience:', 'tc-amber')
      experience.forEach((j) => {
        push(`    ${j.company} — ${j.role}`)
        push(`      ${j.period} · ${j.location}`, 'tc-dim')
      })
      push('')
      push('  education:', 'tc-amber')
      const edu = education[0]
      push(`    ${edu.degree}, ${edu.school} — ${edu.score} (${edu.period})`)
      push('')
      push("  full story with pictures: 'open resume'", 'tc-dim')
      return
    }
    if (f === 'secrets.txt' || f === 'secrets') {
      cmdSecrets()
      return
    }
    if (f === 'snake.exe') {
      err("cat: snake.exe is a binary. it bites. run 'snake' instead.")
      return
    }
    if (f === 'projects' || f === 'projects/') {
      err("cat: projects is a directory. try 'ls projects' or 'open projects'.")
      return
    }
    err(`cat: ${arg}: no such file`)
  }

  /* the ledger (E-1): what the room remembers you finding */
  const cmdSecrets = (): void => {
    const found = useWorld.getState().found
    const n = LEDGER.filter((e) => found.includes(e.id)).length
    const total = LEDGER.length
    push('')
    push(
      n
        ? `  SECRETS.TXT — ${n * SECRET_BYTES} bytes, and counting`
        : '  SECRETS.TXT — 0 bytes. locked, but it keeps a ledger:',
      'tc-amber',
    )
    LEDGER.forEach((e) => {
      if (found.includes(e.id)) push(`  [x] ${e.done}`)
      else push(`  [ ] ${e.riddle}`, 'tc-dim')
    })
    push('')
    push(
      n === total
        ? '  all of them. go open the envelope.'
        : `  ${n} of ${total}. the envelope in the drawer is waiting.`,
      'tc-amber',
    )
  }

  const cmdOpen = (arg: string): void => {
    if (!arg) {
      push('usage: open <app>')
      push(`installed: ${appIds()}`, 'tc-dim')
      return
    }
    const id = arg.toLowerCase()
    const app = apps.find((a) => a.id === id)
    if (!app) {
      err(`open: no app called '${arg}'`)
      push(`installed: ${appIds()}`, 'tc-dim')
      return
    }
    push(`launching ${app.title}…`)
    useWindows.getState().openApp(app.id)
  }

  const cmdNeofetch = (): void => {
    const job = experience[0]
    const specs: Span[][] = [
      [{ text: 'guest@soubhikos', cls: 'tc-amber' }],
      [{ text: '---------------', cls: 'tc-dim' }],
      [{ text: 'OS: ', cls: 'tc-amber' }, { text: 'SoubhikOS 4.01 (beige edition)' }],
      [{ text: 'Host: ', cls: 'tc-amber' }, { text: `${identity.name} · ${identity.location}` }],
      [{ text: 'Kernel: ', cls: 'tc-amber' }, { text: 'beige-4.01-generic' }],
      ...(JLPT_LEVEL
        ? [[{ text: 'Locale: ', cls: 'tc-amber' }, { text: `en_IN · ja_JP (JLPT ${JLPT_LEVEL})` }]]
        : []),
      [{ text: 'Uptime: ', cls: 'tc-amber' }, { text: `${experienceTally.fullTimeYears} years full-time (+${experienceTally.internYears} intern)` }],
      [{ text: 'Shell: ', cls: 'tc-amber' }, { text: 'sbsh 1.0 (feature-incomplete on purpose)' }],
      [{ text: 'Resolution: ', cls: 'tc-amber' }, { text: `${SCREEN_W}×${SCREEN_H} @ 60Hz-ish` }],
      [{ text: 'DE: ', cls: 'tc-amber' }, { text: `${job.company} — ${job.role}` }],
      [{ text: 'GPU: ', cls: 'tc-amber' }, { text: 'Gemini 2.5 Flash (cloud-attached)' }],
      [{ text: 'Awards: ', cls: 'tc-amber' }, { text: `${awards[0].title.split(' — ')[0]} · ${awards[1].title.split(' — ')[0]}` }],
      [{ text: 'Contact: ', cls: 'tc-amber' }, { text: identity.email }],
      [
        { text: '   ' },
        { text: '  ', cls: 'tc-sw sw-ink' },
        { text: '  ', cls: 'tc-sw sw-red' },
        { text: '  ', cls: 'tc-sw sw-green' },
        { text: '  ', cls: 'tc-sw sw-amber' },
        { text: '  ', cls: 'tc-sw sw-blue' },
        { text: '  ', cls: 'tc-sw sw-teal' },
        { text: '  ', cls: 'tc-sw sw-face' },
        { text: '  ', cls: 'tc-sw sw-paper' },
      ],
    ]
    push('')
    const rows = Math.max(NEOFETCH_LOGO.length, specs.length)
    for (let i = 0; i < rows; i++) {
      const logo = NEOFETCH_LOGO[i] ?? '                '
      const right = specs[i] ?? [{ text: '' }]
      pushSpans([{ text: `${logo}  `, cls: 'tc-amber' }, ...right])
    }
    push('')
  }

  const cmdHire = (): void => {
    push('')
    push('  excellent decision. patching you through:', 'tc-amber')
    pushAll([
      `      name  ${identity.name}`,
      `      role  ${identity.title}`,
      `     email  ${identity.email}`,
      `     phone  ${identity.phone}`,
      `  whatsapp  ${identity.whatsapp}`,
      `  linkedin  ${identity.linkedin}`,
      `    github  ${identity.github}`,
      `  location  ${identity.location}`,
    ])
    push('')
    push('  opening Contact.exe — bring an offer.', 'tc-dim')
    playBeep()
    useWindows.getState().openApp('contact')
  }

  const cmdFormat = (arg: string): void => {
    if (arg.toLowerCase() !== 'c:') {
      err("format: only drive c: exists. this is a very small computer.")
      return
    }
    setBusy(true)
    playBeep()
    useWorld.getState().mark('format')
    push('')
    push('WARNING: ALL DATA ON NON-REMOVABLE DISK', 'tc-red')
    push('DRIVE C: (SOUBHIK_RESUME) WILL BE LOST!', 'tc-red')
    push('Proceeding anyway, since you seem sure…', 'tc-dim')
    const barId = pushSpans([{ text: 'Formatting  [                    ]   0%' }])
    let pct = 0
    const iv = every(90, () => {
      pct = Math.min(100, pct + 2 + Math.floor(Math.random() * 4))
      const cells = Math.round(pct / 5)
      const bar = '#'.repeat(cells) + ' '.repeat(20 - cells)
      replaceLine(barId, [
        { text: `Formatting  [${bar}] ${String(pct).padStart(3)}%` },
      ])
      if (pct >= 100) {
        window.clearInterval(iv)
        timersRef.current.delete(iv)
        after(700, () => {
          push('')
          push('Just kidding. The resume is immutable.', 'tc-amber')
          push('Nice reflexes though.', 'tc-dim')
          setBusy(false)
        })
      }
    })
  }

  /* the thing he actually ships — every line here is from resume.ts */
  const cmdSoweak = (): void => {
    if (!SOWEAK) {
      err('soweak: not installed on this machine.')
      return
    }
    push('')
    push(`  ${SOWEAK.name}`, 'tc-amber')
    push(`  ${SOWEAK.tagline} · ${SOWEAK.org}`)
    push(`  ${SOWEAK.stack.join(' · ')}`, 'tc-dim')
    const link = SOWEAK.links?.[0]
    if (link) push(`  ${link.label.toLowerCase()}: ${link.url}`, 'tc-dim')
    push('')
    push('  opening My Work → soweak…', 'tc-dim')
    // openApp only focuses an existing window (props stay), so re-open
    // to land on the detail view
    const wm = useWindows.getState()
    if (wm.windows.some((w) => w.appId === 'projects')) wm.close('projects')
    useWindows.getState().openApp('projects', { projectId: SOWEAK.id })
  }

  const cmdWeather = (arg: string): void => {
    const world = useWorld.getState()
    const kind = arg.trim().toLowerCase()
    if (!kind) {
      push(`weather: ${world.weather}.`)
      push('(storm, rain or clear — the window takes requests.)', 'tc-dim')
      return
    }
    const want = WEATHER_KINDS.find((k) => k === kind)
    if (!want) {
      err(`weather: '${arg}' is not on the menu. storm, rain or clear.`)
      return
    }
    world.setWeather(want)
    push(WEATHER_LINE[want], 'tc-amber')
  }

  const cmdDuck = (): void => {
    const world = useWorld.getState()
    const golden = world.duckClicks >= DUCK_GOLDEN_AT
    pushAll([
      '   __', '  ( o>   quack.', '  /))', '   ""',
    ])
    if (golden) {
      // the golden debugger whispers one thing you have not found yet
      const left = LEDGER.filter((e) => !world.found.includes(e.id))
      if (left.length) {
        const riddle = left[world.duckClicks % left.length].riddle
        push(`the golden one, quietly: "${riddle}"`, 'tc-amber')
        push(`(it knows ${left.length} more. ask again.)`, 'tc-dim')
      } else {
        push('the golden one has nothing left to tell you. respect.', 'tc-amber')
      }
    } else {
      push('the rubber duck in the room heard that.', 'tc-dim')
    }
    useEggs.getState().clickDuck()
  }

  const cmdKonnichiwa = (): void => {
    if (!JLPT_LEVEL) {
      err('konnichiwa: no such locale on this machine.')
      return
    }
    push('')
    push(`  こんにちは。日本語は ${JLPT_LEVEL} くらいです — 短い文なら、だいじょうぶ。`, 'tc-amber')
    push(
      `  (hello. my Japanese is about ${JLPT_LEVEL} — short sentences are fine.)`,
      'tc-dim',
    )
    push(`  on file: ${JLPT}`, 'tc-dim')
    playBeep()
    useWorld.getState().mark('nihongo')
  }

  const abortBusy = (): void => {
    cancelTimers()
    push('^C', 'tc-dim')
    push('format aborted. the resume lives on.', 'tc-amber')
    setBusy(false)
  }

  /* ---------- dispatcher ---------- */
  const run = (raw: string): void => {
    const cmd = raw.trim()
    pushSpans([{ text: `${PROMPT} `, cls: 'tc-amber' }, { text: cmd }])
    if (!cmd) return

    const hist = histRef.current
    if (hist[hist.length - 1] !== cmd) hist.push(cmd)
    histIdxRef.current = -1
    draftRef.current = ''

    const [headRaw, ...rest] = cmd.split(/\s+/)
    const head = headRaw.toLowerCase()
    const arg = rest.join(' ')

    switch (head) {
      case 'help':
      case '?':
        cmdHelp()
        break
      case 'ls':
      case 'dir':
        cmdLs(arg)
        break
      case 'cat':
      case 'type':
        cmdCat(arg)
        break
      case 'open':
      case 'start':
        cmdOpen(arg)
        break
      case 'whoami':
        push("guest — but Soubhik is looking for the right 'sudo'.")
        break
      case 'neofetch':
        cmdNeofetch()
        break
      case 'snake':
      case 'snake.exe':
      case './snake.exe':
      case 'nibbles':
        push('loading NIBBLES… mind the walls.')
        useWindows.getState().openApp('snake')
        break
      case 'hire':
        cmdHire()
        break
      case 'sudo':
        if (arg.toLowerCase() === 'hire') {
          push('with great power… fine. opening Contact.', 'tc-amber')
          useWindows.getState().openApp('contact')
        } else {
          err(
            'guest is not in the sudoers file. This incident will be reported (to Soubhik).',
          )
        }
        break
      case 'format':
        cmdFormat(arg)
        break
      case 'matrix':
        push('entering the matrix — any key to wake up', 'tc-dim')
        setMatrix(true)
        playBeep()
        break
      case 'crash':
      case 'bsod':
        push('oh no.', 'tc-red')
        playBeep()
        useWorld.getState().mark('crash')
        after(350, () => useEggs.getState().triggerBsod())
        break
      case 'clear':
      case 'cls':
        setLines([])
        break
      case 'exit':
      case 'quit':
      case 'logout':
        push('bye. the snake will miss you.', 'tc-dim')
        after(300, () => useWindows.getState().close(windowId))
        break
      /* ---------- undocumented drawer ---------- */
      case 'library':
      case 'books':
      case 'read':
        push('')
        push(`  ${books.length} volumes catalogued. leaving the desk…`, 'tc-amber')
        push('  (the shelf is read-only. so is this terminal, mostly.)', 'tc-dim')
        playBeep()
        after(500, () => {
          useSystem.getState().zoomOut()
          useLibrary.getState().openLibrary()
        })
        break
      case 'echo':
        push(arg)
        break
      case 'ver':
        push('SoubhikOS [Version 4.01] — lovingly overengineered.')
        break
      case 'date':
      case 'time':
        push(new Date().toString())
        push('time flies. inboxes fill. (see: hire)', 'tc-dim')
        break
      case 'history':
        pushAll(hist.map((h, i) => `  ${String(i + 1).padStart(3)}  ${h}`))
        break
      case 'pwd':
        push('/home/guest  (C:\\GUEST to friends)')
        break
      case 'cd':
        push('there is nowhere else to go. this is the whole filesystem.', 'tc-dim')
        break
      case 'man':
        push("no manuals. real engineers read the source. (try 'open projects')")
        break
      case 'whereis':
        push(arg.toLowerCase() === 'soubhik'
          ? `${identity.location}. also: ${identity.github}`
          : `whereis: ${arg || 'what'}: not found (Soubhik is in ${identity.location}, if that helps)`)
        break
      case 'duck':
        cmdDuck()
        break
      case 'soweak':
        cmdSoweak()
        break
      case 'weather':
        cmdWeather(arg)
        break
      case 'forget':
        useWorld.getState().forget()
        push('memory wiped. the duck is yellow again.', 'tc-amber')
        break
      case 'konnichiwa':
      case 'konnichiha':
      case 'こんにちは':
        cmdKonnichiwa()
        break
      case 'hack':
      case 'hackerman':
        useEggs.getState().toggleHacker()
        playBeep()
        push('phosphor mode toggled. you look very serious right now.', 'tc-amber')
        break
      case 'rm':
        err('permission denied. also: rude.')
        break
      default:
        // E-3: the shell runs the same guardrail he ships (unknown input only)
        if (INJECTION_PATTERNS.some((re) => re.test(cmd))) {
          err(
            'soweak: PROMPT_INJECTION 0.97 — blocked at the input boundary. audit row written.',
          )
          push('(this is the thing I actually ship. try: soweak)', 'tc-dim')
          useWorld.getState().mark('soweak')
          break
        }
        err(`Bad command or file name: ${headRaw}`)
        push("(type 'help' — or guess. guessing is encouraged.)", 'tc-dim')
    }
  }

  /* =====================================================================
     Input plumbing
     ===================================================================== */

  const syncFromInput = (el: HTMLInputElement): void => {
    setVal(el.value)
    setCaret(el.selectionStart ?? el.value.length)
  }

  /**
   * Replace the line synchronously in BOTH the DOM input and React state.
   * A deferred setSelectionRange (rAF) can land *after* the next fast
   * keystroke and yank the caret to a stale position — so never defer.
   */
  const setInputValue = (v: string): void => {
    const el = inputRef.current
    if (el) {
      el.value = v
      el.setSelectionRange(v.length, v.length)
    }
    setVal(v)
    setCaret(v.length)
  }

  const complete = (): void => {
    const parts = val.split(/\s+/)
    if (parts.length <= 1) {
      const frag = parts[0] ?? ''
      if (!frag) return
      const hits = COMPLETABLE.filter((c) => c.startsWith(frag.toLowerCase()))
      if (hits.length === 1) setInputValue(`${hits[0]} `)
      else if (hits.length > 1) push(hits.join('  '), 'tc-dim')
      return
    }
    const head = parts[0].toLowerCase()
    const frag = parts[parts.length - 1].toLowerCase()
    const pool =
      head === 'open' || head === 'start'
        ? apps.map((a) => a.id)
        : head === 'cat' || head === 'type' || head === 'ls' || head === 'dir'
          ? FILES
          : []
    const hits = pool.filter((c) => c.toLowerCase().startsWith(frag))
    if (hits.length === 1) {
      setInputValue(`${parts.slice(0, -1).join(' ')} ${hits[0]}`)
    } else if (hits.length > 1) {
      push(hits.join('  '), 'tc-dim')
    }
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (busy) {
      if (e.key.toLowerCase() === 'c' && e.ctrlKey) {
        e.preventDefault()
        abortBusy()
      }
      return
    }
    const hist = histRef.current
    if (e.key === 'Enter') {
      e.preventDefault()
      const v = val
      setInputValue('')
      run(v)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!hist.length) return
      if (histIdxRef.current === -1) {
        draftRef.current = val
        histIdxRef.current = hist.length - 1
      } else if (histIdxRef.current > 0) {
        histIdxRef.current--
      }
      setInputValue(hist[histIdxRef.current])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (histIdxRef.current === -1) return
      if (histIdxRef.current < hist.length - 1) {
        histIdxRef.current++
        setInputValue(hist[histIdxRef.current])
      } else {
        histIdxRef.current = -1
        setInputValue(draftRef.current)
      }
    } else if (e.key === 'Tab') {
      e.preventDefault()
      complete()
    } else if (e.key.toLowerCase() === 'l' && e.ctrlKey) {
      e.preventDefault()
      setLines([])
    } else if (e.key.toLowerCase() === 'c' && e.ctrlKey) {
      e.preventDefault()
      pushSpans([
        { text: `${PROMPT} `, cls: 'tc-amber' },
        { text: val },
        { text: '^C', cls: 'tc-dim' },
      ])
      setInputValue('')
      histIdxRef.current = -1
    }
  }

  const before = val.slice(0, caret)
  const cursorCh = val.charAt(caret) || ' '
  const afterTxt = val.slice(caret + 1)

  return (
    <div
      className="term-root"
      onPointerUp={() => {
        if (!matrix) focusInput()
      }}
    >
      <div className="term-scroll" ref={scrollRef}>
        {lines.map((l) => (
          <div className="term-line" key={l.id}>
            {l.spans.map((s, i) => (
              <span key={i} className={s.cls}>
                {s.text === '' && l.spans.length === 1 ? ' ' : s.text}
              </span>
            ))}
          </div>
        ))}
        {!busy && (
          <div className="term-line">
            <span className="tc-amber">{PROMPT}&nbsp;</span>
            <span>{before}</span>
            <span className={`term-cursor${focused ? '' : ' idle'}`}>
              {cursorCh}
            </span>
            <span>{afterTxt}</span>
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        className="term-input"
        type="text"
        value={val}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        aria-label="terminal input"
        onChange={(e: ChangeEvent<HTMLInputElement>) => syncFromInput(e.target)}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => syncFromInput(e.currentTarget)}
        onSelect={(e: SyntheticEvent<HTMLInputElement>) =>
          syncFromInput(e.currentTarget)
        }
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />

      {matrix && (
        <MatrixRain
          onExit={() => {
            setMatrix(false)
            push('back so soon? the desktop is also a construct.', 'tc-dim')
            push('those were real katakana, by the way.', 'tc-dim')
            focusInput()
          }}
        />
      )}
    </div>
  )
}

/* =====================================================================
   MatrixRain — falling phosphor glyphs over the whole terminal until
   any key (or click). Colors read from tokens at mount; strict cleanup.
   ===================================================================== */

const GLYPHS = 'アイウエオカキクケコサシスセソ0123456789$#%*+=-<>ﾊﾋﾌﾍﾎ'

function MatrixRain({ onExit }: { onExit: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const exitRef = useRef(onExit)

  useEffect(() => {
    exitRef.current = onExit
  }, [onExit])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = canvas.offsetWidth
    const h = canvas.offsetHeight
    canvas.width = w
    canvas.height = h

    const styles = getComputedStyle(canvas)
    const green = styles.getPropertyValue('--term-green').trim() || '#33ff66'
    const bg = styles.getPropertyValue('--term-bg').trim() || '#050a06'
    const bright = styles.getPropertyValue('--face-lighter').trim() || '#ffffff'

    const FS = 16
    const cols = Math.ceil(w / FS)
    const drops = Array.from({ length: cols }, () => Math.random() * (h / FS))

    ctx.fillStyle = bg
    ctx.fillRect(0, 0, w, h)

    let raf = 0
    let last = 0
    const tick = (t: number): void => {
      raf = requestAnimationFrame(tick)
      if (t - last < 50) return
      last = t
      ctx.globalAlpha = 0.14
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, w, h)
      ctx.globalAlpha = 1
      ctx.font = `${FS}px VT323, monospace`
      for (let i = 0; i < cols; i++) {
        const ch = GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
        const x = i * FS
        const y = drops[i] * FS
        ctx.fillStyle = Math.random() < 0.08 ? bright : green
        ctx.fillText(ch, x, y)
        drops[i] = y > h && Math.random() > 0.975 ? 0 : drops[i] + 1
      }
    }
    raf = requestAnimationFrame(tick)

    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      exitRef.current()
    }
    window.addEventListener('keydown', onKey, { capture: true })

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey, { capture: true })
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="term-matrix"
      onPointerDown={() => exitRef.current()}
    />
  )
}
