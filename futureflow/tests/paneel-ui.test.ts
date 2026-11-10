import { expect, mock, test } from 'claude-code/testing'

// Het dashboard in een smal (44) en breed (100) terminalpaneel: alle acht tabs zichtbaar, korte
// namen als het smal is, en geen regel die breder is dan het paneel. De testkit tekent geen
// tekens, dus schatten we per element hoe smal het minstens kan: tekst breekt af op woorden
// (truncate-end tot 1 teken), een knop breekt nooit af, een rij zonder flexWrap telt op.

const SNAPSHOT = {
  memory: { freePercent: 31, totalGB: 16 },
  config: { limits: { dev: 2, test: 1, browser: 1 }, floorPercent: 25, criticalPercent: 10, cloudOverflow: true },
  slots: [{ kind: 'dev', session: 'abcdef1234567890', cwd: '/Users/x/orca/workspaces/heel-lange-mapnaam-die-niet-past', command: 'PORT=6001 pnpm dev --filter @futureflowai/website-met-een-lange-naam', since: Date.now() }],
  refusals: [{ t: Date.now(), kind: 'test', reason: 'geen-slot', command: 'pnpm vitest run --reporter=verbose src/onderdelen/een-heel-lang-pad.test.ts' }],
  overflow: [{ id: 'j1', branch: 'overflow/tests-draaien-voor-de-hele-monorepo', status: 'running', started: Date.now(), task: 'Draai alle tests van de monorepo en rapporteer de fouten' }],
}

const NU = Date.parse('2026-11-10T12:00:00Z')
const MCP = [
  { name: 'mcp__n8n-mcp__a', serverName: 'n8n-mcp-met-een-hele-lange-servernaam', tokens: 3000, isLoaded: true },
  { name: 'mcp__x__gmail', serverName: 'claude.ai Gmail', tokens: 500, isLoaded: true },
]
const ACCOUNTS = {
  actief: 1,
  profiel: 'standaard',
  accounts: [1, 2].map(id => ({
    id,
    email: `colin.lange.naam${id}…@futureflowai.com`,
    plan: 'Max 20x',
    label: 'werk',
    inRotatie: id === 1,
    status: 'ok',
    gebruik: { '5u': { pct: 62, resetsAt: NU + 7_200_000 }, '7d': { pct: 18, resetsAt: NU + 259_200_000 } },
    gemetenOp: NU - 180_000,
  })),
  instellingen: { auto: true, marge5u: 90, marge7d: 90, stand: 'stil', strategie: 'meeste-ruimte', wachttijd: 300_000 },
  laatsteWissel: { tijd: NU - 600_000, van: 2, naar: 1, auto: true },
}

// Nep-omgeving met echte gegevens voor elke tab (slots, connectors, api, accounts).
function fake(on: any) {
  mock.clock(on, { now: NU })
  on('tool.register', () => ({ value: undefined }))
  on('env.get', ($: any, e: { name: string }) => ({ value: ({ HOME: '/home/t', PATH: '/usr/bin' } as Record<string, string>)[e.name] }))
  on('session.id', () => ({ value: 'sessie-1' }))
  on('session.cwd', () => ({ value: '/r' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 50_000, window: 200_000, breakdown: { mcpTools: MCP } }, rateLimits: [] } }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('config.list', () => ({ value: [] }))
  on('fs.read', () => ({ value: '' }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('session.start', ($: any, e: any) => e)
  on('command.register', () => ({ value: undefined }) as any)
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', ($: any, e: { argv: string[] }) => {
    const ok = (data: unknown) => ({ value: { exitCode: 0, stdout: (typeof data === 'string' ? data : JSON.stringify(data)) + '\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const cli = (naam: string) => e.argv.findIndex(a => a.endsWith(naam))
    if (e.argv.includes('git')) return ok('/r')
    if (cli('connectors.mjs') >= 0) return ok({ uit: ['claude.ai Gmail'], servers: ['n8n-mcp-met-een-hele-lange-servernaam'] })
    if (cli('api.mjs') >= 0) {
      const args = e.argv.slice(cli('api.mjs') + 1)
      return args[0] === 'status' ? ok({ heeftKey: true, staart: 'WXYZ', modus: 'abonnement', vreemdeHelper: false }) : ok({ aan: true })
    }
    if (cli('accounts.mjs') >= 0) {
      const args = e.argv.slice(cli('accounts.mjs') + 1)
      return args[0] === 'status' ? ok(ACCOUNTS) : ok({})
    }
    if (e.argv.includes('overflow')) return ok({ finished: [] })
    return ok(SNAPSHOT)
  })
}

const run = ($: any, command: string, args: string) =>
  $.command.run({ origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 }, command, args } as any)

const PANE = (columns: number) =>
  ({ plugin: 'futureflow', surface: 'terminal', component: 'Pane', requestId: 'futureflow', props: {}, viewport: { columns, rows: 60 } }) as any

const TABS = ['overzicht', 'slots', 'minify', 'stijl', 'connectors', 'api', 'accounts']
const KORT = ['Over', 'Slots', 'Minify', 'Stijl', 'Conn', 'API', 'Acc']
const LANG = ['Overzicht', 'Slots', 'Minify', 'Stijl', 'Connectors', 'API', 'Accounts']

type Knoop = { type?: string; props?: Record<string, any>; children?: unknown[] } | string | unknown[] | null | undefined

const kinderen = (n: any): unknown[] => (Array.isArray(n) ? n : Array.isArray(n?.children) ? n.children : n?.children === undefined ? [] : [n.children])
const tekstVan = (n: Knoop): string =>
  typeof n === 'string' || typeof n === 'number' ? String(n) : n && typeof n === 'object' ? kinderen(n).map(c => tekstVan(c as Knoop)).join('') : ''
const getal = (v: unknown) => (typeof v === 'number' ? v : 0)

// Hoe smal een element minstens kan; te brede plekken komen in `fout`.
function minBreed(n: Knoop, fout: string[]): number {
  if (n === null || n === undefined || n === false as any) return 0
  if (typeof n === 'string' || typeof n === 'number') return Math.max(0, ...String(n).split(/\s+/).map(w => w.length))
  if (Array.isArray(n)) return Math.max(0, ...n.map(c => minBreed(c as Knoop, fout)))
  const p = n.props ?? {}
  if (n.type === 'Text') {
    if (p.wrap === 'truncate-end' || p.wrap === 'truncate') return 1
    const t = tekstVan(n)
    // Alleen spaties tussen woorden; een regel als '─────' of '  ▔▔▔' is één woord.
    return Math.max(0, ...t.split(/(?<=\S) +(?=\S)/).map(w => w.length))
  }
  if (n.type === 'Button') {
    const label = String(p.label ?? tekstVan(n))
    return p.plain ? (p.hotkey ? p.hotkey.length + 2 : 0) + label.length : label.length + 4
  }
  if (n.type === 'Input') return 20
  if (n.type !== 'Box') return 0
  const rand = (p.borderStyle ? 2 : 0) + 2 * getal(p.paddingX ?? p.padding) + getal(p.paddingLeft) + getal(p.paddingRight)
  const ks = kinderen(n).filter(c => c !== '' && c !== null && c !== undefined)
  const maten = ks.map(c => minBreed(c as Knoop, fout))
  const rij = p.flexDirection === 'row' && p.flexWrap !== 'wrap'
  const gat = getal(p.columnGap ?? p.gap)
  const binnen = rij ? maten.reduce((a, b) => a + b, 0) + gat * Math.max(0, maten.length - 1) : Math.max(0, ...maten)
  const nodig = binnen + rand
  if (typeof p.width === 'number') {
    if (nodig > p.width) fout.push(`Box width ${p.width} < ${nodig}: ${tekstVan(n).slice(0, 60)}`)
    return p.width
  }
  return nodig
}

for (const kolommen of [44, 100]) {
  test(`terminal ${kolommen} kolommen: alle acht tabs, juiste namen, wrap-rij`, async ($, on) => {
    fake(on)
    await run($, 'futureflow', '')
    const ui = await $.ui.mount(PANE(kolommen))
    const namen = kolommen < 50 ? KORT : LANG
    for (const [i, t] of TABS.entries()) {
      const knop = await ui.find({ type: 'Button', key: `tab-${t}` })
      expect(knop).toBeDefined()
      expect(knop!.props.hotkey).toBe(String(i + 1))
      expect(knop!.props.plain).toBe(true)
      expect(knop!.text).toBe(namen[i])
    }
    const boom = JSON.stringify(await ui.drawn())
    expect(boom).toContain('"flexWrap":"wrap"')
    expect(boom).not.toContain('"type":"Svg"')
    // De gekozen tab heeft een ▔-regel eronder.
    // De gekozen tab krijgt een ●; geen ▔-streep meer (die verschoof bij afbreken).
    expect(await ui.find({ type: 'Text', text: /●/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▔/ })).toBeUndefined()
    await ui.unmount()
  })

  for (const tab of TABS) {
    test(`terminal ${kolommen} kolommen: tab ${tab} past`, async ($, on) => {
      fake(on)
      await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true } as any)
      await run($, 'futureflow', tab)
      const ui = await $.ui.mount(PANE(kolommen))
      const fout: string[] = []
      const breed = minBreed((await ui.drawn()) as Knoop, fout)
      // De tab tekende echt, geen terugvaltekst.
      expect(await ui.find({ type: 'Text', text: /laden lukte niet|Laden…/ })).toBeUndefined()
      expect(fout).toEqual([])
      expect(breed).toBeLessThanOrEqual(kolommen)
      await ui.unmount()
    })
  }
}

test('overzicht: vier kerncijfers die de breedte vullen en zelf afbreken', async ($, on) => {
  fake(on)
  await run($, 'futureflow', '')
  for (const kolommen of [100, 44]) {
    const ui = await $.ui.mount(PANE(kolommen))
    // De gemeten kolommen zijn die van de hele terminal: de kaarten groeien mee en breken zelf af.
    const kaart = (await ui.findAll({ type: 'Box' })).filter(b => b.props.flexGrow === 1 && typeof b.props.minWidth === 'number')
    expect(kaart.length).toBe(4)
    expect(await ui.find({ type: 'Button', key: 'snel-slots' })).toBeUndefined()
    await ui.unmount()
  }
})
