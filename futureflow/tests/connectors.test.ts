import { expect, mock, test } from 'claude-code/testing'

const SLOTS = JSON.stringify({ memory: { freePercent: 40, totalGB: 16 }, config: { limits: { dev: 2 }, floorPercent: 25, criticalPercent: 10 }, slots: [], refusals: [] }) + '\n'

const MCP = [
  { name: 'mcp__n8n-mcp__a', serverName: 'n8n-mcp', tokens: 3000, isLoaded: true },
  { name: 'mcp__n8n-mcp__b', serverName: 'n8n-mcp', tokens: 1000, isLoaded: false },
  { name: 'mcp__x__gmail', serverName: 'claude.ai Gmail', tokens: 500, isLoaded: true },
]

// Servers van de app en van mods: geen knop, wel meegeteld.
const INTERN = [
  { name: 'mcp__ccd_session__start_session', serverName: 'ccd_session', tokens: 700, isLoaded: true },
  { name: 'mcp__ccd_turn__wrap_up', serverName: 'ccd_turn', tokens: 300, isLoaded: true },
  { name: 'mcp__futureflow__design', serverName: 'futureflow', tokens: 100, isLoaded: false },
]

type Opties = {
  uit?: string[]
  servers?: string[]
  zetFaalt?: boolean
  usageFaalt?: boolean
  intern?: boolean
  cwd?: string
  /** Uitvoer van git rev-parse --show-toplevel; undefined = geen git-repo (exit 128). */
  gitRoot?: string
  paneelOpen?: boolean
}

type Run = { argv: string[]; init?: { cwd?: string; env?: Record<string, string> } }

// Nep-omgeving; alle mocks vóór de eerste $-aanroep. De CLI connectors.mjs houdt een eigen lijst bij.
function fake(on: any, o: Opties = {}) {
  const clock = mock.clock(on, { now: 1_000_000 })
  const uit = [...(o.uit ?? [])]
  const zet: string[][] = []
  const lijsten: string[][] = []
  const git: Run[] = []
  const envs: Array<Record<string, string> | undefined> = []
  const toasts: string[] = []
  on('env.get', ($: any, e: { name: string }) => ({ value: e.name === 'HOME' ? '/home/t' : e.name === 'PATH' ? '/usr/bin' : undefined }))
  on('session.id', () => ({ value: 'sessie-1' }))
  on('session.cwd', () => ({ value: o.cwd ?? '/proj' }))
  on('session.usage', () => {
    if (o.usageFaalt) throw new Error('geen usage')
    return { value: { startedAt: 0, context: { window: 200000, breakdown: { mcpTools: o.intern ? [...MCP, ...INTERN] : MCP } }, rateLimits: [] } }
  })
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', ($: any, e: { text: string }) => { toasts.push(e.text); return { value: undefined } })
  on('fs.read', () => ({ value: '' }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))
  on('command.register', () => ({ value: undefined }) as any)
  on('ui.panes', () => ({ value: o.paneelOpen ? [{ id: 'futureflow' }] : [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', ($: any, e: Run) => {
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv.includes('git')) {
      git.push(e)
      if (o.gitRoot === undefined) return { value: { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository\n', isStdoutTruncated: false, isStderrTruncated: false } }
      return ok(`${o.gitRoot}\n`)
    }
    const i = e.argv.findIndex(a => a.endsWith('connectors.mjs'))
    if (i < 0) return ok(SLOTS)
    envs.push(e.init?.env)
    const args = e.argv.slice(i + 1)
    if (args[0] === 'list') {
      lijsten.push(args)
      return ok(JSON.stringify({ uit, servers: o.servers ?? ['n8n-mcp'] }) + '\n')
    }
    zet.push(e.argv)
    if (o.zetFaalt) return { value: { exitCode: 2, stdout: '', stderr: '[connectors] /home/t/.claude.json is geen geldige JSON; niets gewijzigd\n', isStdoutTruncated: false, isStderrTruncated: false } }
    const server = args[args.indexOf('--server') + 1]!
    if (args.includes('--uit')) uit.push(server)
    else uit.splice(uit.indexOf(server), 1)
    return ok(JSON.stringify({ uit, gewijzigd: true }) + '\n')
  })
  return { zet, toasts, uit, lijsten, git, envs, clock }
}

const run = ($: any, command: string, args: string) =>
  $.command.run({ origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 }, command, args } as any)

const PANE = (surface: 'terminal' | 'desktop') =>
  ({ plugin: 'futureflow', surface, component: 'Pane', requestId: 'futureflow', props: {} }) as any

test('/futureflow connectors toont per server tools en tokens, gesorteerd', async ($, on) => {
  fake(on, { uit: ['claude.ai Canva'] })
  const r = await run($, 'futureflow', 'connectors')
  expect(r.text).toContain('Instellingen')
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await ui.find({ type: 'Text', text: /MCP in context 3\.500 tokens/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /2% van het venster/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /2 tools · 3\.000 \/ 4\.000 tokens/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 tool · 500 \/ 500 tokens/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Geldt vanaf de volgende sessie in deze map, net als \/mcp\./ })).toBeDefined()
  // Uitgezet en niet geladen: staat er ook in, met knop Weer aan.
  expect(await ui.find({ type: 'Button', key: 'conn-claude.ai Canva' } as any)).toBeDefined()
  const boom = JSON.stringify(await ui.drawn())
  expect(boom.indexOf('n8n-mcp')).toBeLessThan(boom.indexOf('claude.ai Gmail'))
  expect(boom).toContain('Weer aan')
  await ui.unmount()
})

test('hotkey 4 opent de tab Instellingen met de connectors', async ($, on) => {
  fake(on)
  await run($, 'futureflow', '')
  const ui = await $.ui.mount(PANE('desktop'))
  expect(await ui.find({ type: 'Button', key: 'tab-instellingen', hotkey: '4' } as any)).toBeDefined()
  await ui.press({ key: 'tab-instellingen' } as any)
  expect(await ui.find({ type: 'Button', key: 'conn-n8n-mcp' } as any)).toBeDefined()
  await ui.unmount()
})

test('klik zet de server uit via de CLI, met één toast en de melding bij de rij', async ($, on) => {
  const f = fake(on)
  await run($, 'futureflow', 'connectors')
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'conn-n8n-mcp' } as any)
  expect(f.zet.length).toBe(1)
  expect(f.zet[0]!.slice(0, 2)).toEqual(['/usr/bin/env', 'node'])
  expect(f.zet[0]!.slice(3)).toEqual(['zet', '--cwd', '/proj', '--server', 'n8n-mcp', '--uit'])
  expect(f.toasts).toEqual(['n8n-mcp staat uit vanaf de volgende sessie in deze map.'])
  expect(await ui.find({ type: 'Text', text: /uit vanaf volgende sessie/ })).toBeDefined()
  // Weer aan: tweede klik, tweede toast.
  await ui.press({ key: 'conn-n8n-mcp' } as any)
  expect(f.zet[1]!.slice(3)).toEqual(['zet', '--cwd', '/proj', '--server', 'n8n-mcp', '--aan'])
  expect(f.toasts.length).toBe(2)
  await ui.unmount()
})

test('CLI weigert (kapot bestand): één toast met de reden, tab blijft staan', async ($, on) => {
  const f = fake(on, { zetFaalt: true })
  await run($, 'futureflow', 'connectors')
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'conn-claude.ai Gmail' } as any)
  expect(f.toasts.length).toBe(1)
  expect(f.toasts[0]).toContain('geen geldige JSON')
  expect(await ui.find({ type: 'Button', key: 'conn-claude.ai Gmail' } as any)).toBeDefined()
  await ui.unmount()
})

test('zonder usage-gegevens tekent de tab toch (faalt open)', async ($, on) => {
  fake(on, { usageFaalt: true, uit: ['n8n-mcp'] })
  await run($, 'futureflow', 'connectors')
  const ui = await $.ui.mount(PANE('desktop'))
  expect(await ui.find({ type: 'Text', text: /MCP in context 0 tokens/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'conn-n8n-mcp' } as any)).toBeDefined()
  await ui.unmount()
})

test('servers van de app en van mods: geen knop, wel één regel met hun tools en tokens', async ($, on) => {
  fake(on, { intern: true })
  await run($, 'futureflow', 'connectors')
  const ui = await $.ui.mount(PANE('terminal'))
  for (const server of ['ccd_session', 'ccd_turn', 'futureflow']) expect(await ui.find({ type: 'Button', key: `conn-${server}` } as any)).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'conn-n8n-mcp' } as any)).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'conn-claude.ai Gmail' } as any)).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Intern \(app en mods\): 3 tools, 1\.000 tokens/ })).toBeDefined()
  // Het totaal bovenaan telt ze wel mee: 3.500 + 1.000 in context.
  expect(await ui.find({ type: 'Text', text: /MCP in context 4\.500 tokens/ })).toBeDefined()
  await ui.unmount()
})

test('een server die niet in de eigen configuratie staat krijgt geen knop', async ($, on) => {
  fake(on, { servers: [] })
  await run($, 'futureflow', 'connectors')
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await ui.find({ type: 'Button', key: 'conn-n8n-mcp' } as any)).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'conn-claude.ai Gmail' } as any)).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Intern \(app en mods\): 2 tools/ })).toBeDefined()
  await ui.unmount()
})

test('projectsleutel = git-root van de sessiemap, voor list én zet', async ($, on) => {
  const f = fake(on, { cwd: '/repo/sub/dieper', gitRoot: '/repo' })
  await run($, 'futureflow', 'connectors')
  expect(f.git[0]!.init?.cwd).toBe('/repo/sub/dieper')
  expect(f.git[0]!.argv.slice(-3)).toEqual(['git', 'rev-parse', '--show-toplevel'].slice(-3))
  expect(f.lijsten[0]).toEqual(['list', '--cwd', '/repo', '--map', '/repo/sub/dieper'])
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await ui.find({ type: 'Text', text: /Projectmap \(git-root\): \/repo/ })).toBeDefined()
  await ui.press({ key: 'conn-n8n-mcp' } as any)
  expect(f.zet[0]!.slice(3)).toEqual(['zet', '--cwd', '/repo', '--server', 'n8n-mcp', '--uit'])
  await ui.unmount()
})

test('geen git-repo: de sessiemap zelf is de sleutel', async ($, on) => {
  const f = fake(on, { cwd: '/los' })
  await run($, 'futureflow', 'connectors')
  expect(f.lijsten[0]).toEqual(['list', '--cwd', '/los', '--map', '/los'])
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await ui.find({ type: 'Text', text: /Projectmap/ })).toBeUndefined()
  await ui.unmount()
})

test('de CLI krijgt een vaste env: CLAUDE_JSON, SETTINGS_JSON en SECURITY_BIN uit de sessie komen er niet in', async ($, on) => {
  const f = fake(on)
  await run($, 'futureflow', 'connectors')
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'conn-n8n-mcp' } as any)
  await ui.unmount()
  expect(f.envs.length).toBeGreaterThan(1)
  for (const env of f.envs) {
    expect(env?.CLAUDE_JSON).toBe('')
    expect(env?.SETTINGS_JSON).toBe('')
    expect(env?.SECURITY_BIN).toBe('/usr/bin/security')
  }
})

test('tekenen start geen CLI: lezen bij openen, na een klik en elke 30 s zolang de tab open is', async ($, on) => {
  const f = fake(on, { paneelOpen: true })
  await run($, 'futureflow', 'connectors')
  expect(f.lijsten.length).toBe(1)
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.unmount()
  const ui2 = await $.ui.mount(PANE('desktop'))
  expect(f.lijsten.length).toBe(1)
  await ui2.press({ key: 'conn-n8n-mcp' } as any)
  expect(f.lijsten.length).toBe(2)
  await f.clock.advance(30_000)
  expect(f.lijsten.length).toBe(3)
  // Andere tab: de 30 s-lus stopt.
  await ui2.press({ key: 'tab-wisselen' } as any)
  const voor = f.lijsten.length
  await f.clock.advance(60_000)
  expect(f.lijsten.length).toBe(voor)
  await ui2.unmount()
})
