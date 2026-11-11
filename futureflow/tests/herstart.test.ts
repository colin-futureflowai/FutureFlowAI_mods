import { expect, mock, test } from 'claude-code/testing'

const NU = Date.parse('2026-11-10T12:00:00Z')
const ID = 'f2b8903e-a21c-4741-b219-c03db7d5e4cb'
const SHIM = '/home/t/.local/bin/claude-or'

type Opties = { surfaces?: string[]; shim?: boolean; keuze?: boolean; tokens?: number; ctx?: number; osaFout?: boolean; exitWeg?: boolean; term?: string; orca?: Record<string, string>; orcaFout?: boolean; settings?: string }

// Nep-omgeving: alle mocks vóór de eerste $-aanroep.
function fake(on: any, o: Opties = {}) {
  const clock = mock.clock(on, { now: NU })
  const toasts: string[] = []
  const runs: string[][] = []
  const exits: unknown[] = []
  const geopend: Array<{ id: string }> = []
  const store = new Map<string, unknown>()
  if (o.keuze !== false) {
    store.set('openrouter.keuze', { model: 'openai/gpt-5', snel: 'openai/gpt-5-mini' })
    store.set('openrouter.prijzen', { 'openai/gpt-5': { in: 1, uit: 2, ctx: o.ctx ?? 400_000 } })
  }
  on('tool.register', () => ({ value: undefined }))
  on('store.get', ($: any, e: { key: string }) => ({ value: store.get(e.key) }))
  on('store.set', ($: any, e: { key: string; value: unknown }) => { store.set(e.key, e.value); return { value: undefined } })
  on('env.get', ($: any, e: { name: string }) => ({ value: ({ HOME: '/home/t', PATH: '/usr/bin', ...(o.term ? { TERM_PROGRAM: o.term } : {}), ...(o.orca ?? {}) } as Record<string, string>)[e.name] }))
  on('session.id', () => ({ value: ID }))
  on('session.cwd', () => ({ value: "/Users/c/mijn map's" }))
  on('session.surfaces', () => ({ value: o.surfaces ?? ['terminal'] }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: o.tokens ?? 50_000, window: 200_000 }, rateLimits: [] } }))
  on('ui.toast', ($: any, e: { text: string }) => { toasts.push(e.text); return { value: undefined } })
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.open', ($: any, e: { id: string }) => { geopend.push(e); return { value: { isPlaced: true } } })
  on('fs.exists', ($: any, e: { path: string }) => ({ value: e.path === SHIM && o.shim !== false }))
  on('fs.read', ($: any, e: { path: string }) => ({ value: e.path === '/home/t/.claude/settings.json' ? (o.settings ?? '') : '' }))
  on('fs.list', () => ({ value: [] }))
  on('session.start', ($: any, e: any) => e)
  on('session.measure', () => ({ changed: [] }) as never)
  on('turn.complete', () => ({ text: 'x' }))
  on('config.list', () => ({ value: [] }))
  on('command.register', () => ({ value: undefined }) as any)
  on('ui.panes', () => ({ value: [] }))
  on('fs.write', () => ({ value: undefined }))
  on('tool.call', ($: any, e: any) => ({ result: `uitgevoerd: ${e.tool}` }))
  on('process.run', ($: any, e: { argv: string[] }) => {
    runs.push(e.argv)
    if (e.argv[0]?.endsWith('/orca') && o.orcaFout) return { value: { exitCode: 2, stdout: '', stderr: 'orca draait niet', isStdoutTruncated: false, isStderrTruncated: false } }
    if (e.argv[0] === '/usr/bin/osascript' && o.osaFout) return { value: { exitCode: 1, stdout: '', stderr: 'geen toegang', isStdoutTruncated: false, isStderrTruncated: false } }
    return { value: { exitCode: 0, stdout: '{}\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.run', ($: any, e: { command: string }, next: any) => {
    if (e.command === 'exit') {
      exits.push(e)
      if (o.exitWeg) throw new Error('unknown command')
      return { text: '' }
    }
    return next(e)
  })
  const osa = () => runs.filter(r => r[0] === '/usr/bin/osascript')
  return { clock, toasts, runs, osa, exits, geopend, store }
}

const BAND = (surface: 'terminal' | 'desktop' = 'terminal') =>
  ({
    plugin: 'futureflow',
    viewport: { columns: 120, rows: 30 },
    surface,
    component: 'AbovePrompt',
    requestId: 'band',
    props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 120, scroll: { offset: 0, bodyRows: 12 }, view: {} },
  }) as any
const PANE = { plugin: 'futureflow', surface: 'terminal', component: 'Pane', requestId: 'futureflow', props: {} } as any
const START = { cwd: '/proj', surface: 'terminal', isInteractive: true } as any
const run = ($: any, command: string, args: string) =>
  $.command.run({ origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 }, command, args } as any)

// "Gebruik nu" bij OpenRouter in tab Wisselen: zet claude-or klaar en zet de vraag boven de prompt.
async function gebruikNu($: any, f: ReturnType<typeof fake>) {
  await $.session.start(START)
  await run($, 'futureflow', 'openrouter')
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'or-naar' } as any)
  await ui.unmount()
  await f.clock.settle()
}

test('Gebruik nu zet de vraag met de knop boven de prompt; één klik = één venster met claude-or --resume', async ($, on) => {
  const f = fake(on)
  await gebruikNu($, f)
  const band = await $.ui.mount(BAND())
  expect(await band.find({ type: 'Text', text: /Verder op OpenRouter\?/ })).toBeDefined()
  expect(await band.find({ type: 'Button', key: 'or-herstart-ja' } as any)).toBeDefined()
  await band.press({ key: 'or-herstart-ja' } as any)
  await band.press({ key: 'or-herstart-ja' } as any).catch(() => undefined)
  expect(f.osa().length).toBe(1)
  const script = f.osa()[0]![2]!
  expect(script).toContain('tell application "Terminal"')
  expect(script).toContain(`cd '/Users/c/mijn map'\\\\''s' && '/home/t/.local/bin/claude-or' --resume '${'f2b8903e-a21c-4741-b219-c03db7d5e4cb'}'`)
  expect(f.exits.length).toBe(1)
  expect(await band.find({ type: 'Text', text: /deze sessie kun je sluiten/ })).toBeDefined()
  await band.unmount()
  // Nog een keer via de tab: geen tweede venster.
  const ui = await $.ui.mount(PANE)
  const knop = await ui.find({ type: 'Button', key: 'or-herstart' } as any)
  if (knop) await ui.press({ key: 'or-herstart' } as any)
  await ui.unmount()
  expect(f.osa().length).toBe(1)
})

test('iTerm als de sessie in iTerm draait; zonder /exit een toast dat je deze kunt sluiten', async ($, on) => {
  const f = fake(on, { term: 'iTerm.app', exitWeg: true })
  await gebruikNu($, f)
  const band = await $.ui.mount(BAND())
  await band.press({ key: 'or-herstart-ja' } as any)
  expect(f.osa()[0]![2]).toContain('tell application "iTerm"')
  expect(f.toasts.some(t => t.includes('deze kun je sluiten'))).toBe(true)
  await band.unmount()
})

test('desktop-app: geen venster, wel het commando om te kopiëren', async ($, on) => {
  const f = fake(on, { surfaces: ['desktop'] })
  await gebruikNu($, f)
  const band = await $.ui.mount(BAND())
  await band.press({ key: 'or-herstart-ja' } as any)
  expect(f.osa().length).toBe(0)
  expect(f.exits.length).toBe(0)
  expect(await band.find({ type: 'Text', text: /--resume 'f2b8903e/ })).toBeDefined()
  await band.unmount()
})

test('zonder shim: de knop wijst naar tab Wisselen en opent geen venster', async ($, on) => {
  const f = fake(on, { shim: false })
  await gebruikNu($, f)
  const band = await $.ui.mount(BAND())
  await band.press({ key: 'or-herstart-ja' } as any)
  expect(f.osa().length).toBe(0)
  expect(f.toasts.at(-1)).toContain('tab 2 Wisselen')
  expect(f.geopend.some(g => g.id === 'futureflow')).toBe(true)
  await band.unmount()
})

test('osascript faalt: toast met het commando, geen /exit; de knop blijft', async ($, on) => {
  const f = fake(on, { osaFout: true })
  await gebruikNu($, f)
  const band = await $.ui.mount(BAND())
  await band.press({ key: 'or-herstart-ja' } as any)
  expect(f.exits.length).toBe(0)
  expect(f.toasts.at(-1)).toContain('--resume')
  expect(await band.find({ type: 'Button', key: 'or-herstart-ja' } as any)).toBeDefined()
  await band.unmount()
})

test('gesprek groter dan het venster van het model: waarschuwing bij de knop; Niet nu haalt de vraag weg', async ($, on) => {
  const f = fake(on, { tokens: 300_000, ctx: 200_000 })
  await gebruikNu($, f)
  const band = await $.ui.mount(BAND())
  expect(await band.find({ type: 'Text', text: /groter dan het venster van openai\/gpt-5/ })).toBeDefined()
  await band.press({ key: 'or-herstart-nee' } as any)
  expect(await band.find({ type: 'Button', key: 'or-herstart-ja' } as any)).toBeUndefined()
  await band.unmount()
})

test('Orca: nieuwe Orca-terminal in dezelfde worktree, geen Terminal.app', async ($, on) => {
  const f = fake(on, { orca: { ORCA_TERMINAL_HANDLE: 'term-1', ORCA_WORKTREE_ID: 'repo-1::/w/gimc', ORCA_CLI_BIN_DIR: '/o/bin' } })
  await gebruikNu($, f)
  const band = await $.ui.mount(BAND())
  await band.press({ key: 'or-herstart-ja' } as any)
  expect(f.osa().length).toBe(0)
  const orca = f.runs.filter(r => r[0] === '/o/bin/orca')
  expect(orca.length).toBe(1)
  expect(orca[0]!.slice(1, 5)).toEqual(['terminal', 'create', '--worktree', 'id:repo-1::/w/gimc'])
  expect(orca[0]![8]).toContain('--resume')
  expect(f.exits.length).toBe(1)
  await band.unmount()
})

test('Orca CLI faalt: regel met het commando om te kopiëren, geen Terminal.app en geen /exit', async ($, on) => {
  const f = fake(on, { orca: { ORCA_TERMINAL_HANDLE: 'term-1', ORCA_CLI_BIN_DIR: '/o/bin' }, orcaFout: true })
  await gebruikNu($, f)
  const band = await $.ui.mount(BAND())
  await band.press({ key: 'or-herstart-ja' } as any)
  expect(f.osa().length).toBe(0)
  expect(f.exits.length).toBe(0)
  expect(f.toasts.some(t => t.includes('orca draait niet'))).toBe(true)
  expect(await band.find({ type: 'Text', text: /plak dit in een terminal/ })).toBeDefined()
  await band.unmount()
})

test('OpenRouter-model als standaard in settings.json: melding met knop; knop draait model-weg met de waarde', async ($, on) => {
  const f = fake(on, { settings: JSON.stringify({ model: 'openai/gpt-5.1' }) })
  await $.session.start(START)
  await f.clock.settle()
  const band = await $.ui.mount(BAND())
  expect(await band.find({ type: 'Text', text: /staat als standaard in je algemene settings/ })).toBeDefined()
  await band.press({ key: 'or-standaard-weg' } as any)
  const weg = f.runs.find(r => r.includes('model-weg'))
  expect(weg?.slice(-3)).toEqual(['model-weg', '--waarde', 'openai/gpt-5.1'])
  await band.unmount()
})

test('Claude-model als standaard: geen melding', async ($, on) => {
  const f = fake(on, { settings: JSON.stringify({ model: 'opus' }) })
  await $.session.start(START)
  await f.clock.settle()
  const band = await $.ui.mount(BAND())
  expect(await band.find({ type: 'Text', text: /staat als standaard/ })).toBeUndefined()
  await band.unmount()
})

test('claude-or-sessie (FUTUREFLOW_OPENROUTER=1): tab Overzicht zegt OpenRouter, niet Abonnement', async ($, on) => {
  const f = fake(on, { orca: { FUTUREFLOW_OPENROUTER: '1' } })
  await $.session.start(START)
  await f.clock.settle()
  await run($, 'futureflow', 'overzicht')
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^OpenRouter/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Abonnement/ })).toBeUndefined()
  await ui.unmount()
})

test('claude-or-sessie: orca worker-start --agent claude wordt geweigerd met de route via claude-or; --terminal mag', async ($, on) => {
  const f = fake(on, { orca: { FUTUREFLOW_OPENROUTER: '1' } })
  await $.session.start(START)
  await f.clock.settle()
  const r = (await $.tool.call({ tool: 'Bash', command: 'orca orchestration worker-start --spec "x" --worktree current --agent claude --json' } as any)) as any
  expect(String(r.deny ?? '')).toContain('claude-or')
  const ok = (await $.tool.call({ tool: 'Bash', command: 'orca orchestration worker-start --spec "x" --terminal t1 --worktree current --json' } as any)) as any
  expect(ok.deny).toBeUndefined()
})

test('gewone sessie: geen OpenRouter-weigering voor orca agent launch --agent claude', async ($, on) => {
  const f = fake(on)
  await $.session.start(START)
  await f.clock.settle()
  const r = (await $.tool.call({ tool: 'Bash', command: 'orca agent launch --agent claude --json' } as any)) as any
  // (slots kan een agent-start om geheugen weigeren; de OpenRouter-weigering mag er niet bij zijn)
  expect(String(r.deny ?? '')).not.toContain('OpenRouter')
})
