import { expect, mock, test } from 'claude-code/testing'

import { HELPER } from '../lib/api.mjs'

const NU = Date.parse('2026-11-10T12:00:00Z')
const MIN = 60_000
const DIR = '/home/t/.claude/futureflow/accounts'
const RESET5 = NU + 2 * 60 * MIN
const RESET7 = NU + 3 * 24 * 60 * MIN

type Acc = { id: number; email: string; plan: string; inRotatie: boolean; status: string; pct5: number; pct7: number; gemetenOp?: number }
type Opties = {
  desktop?: boolean
  actief?: number | null
  accounts?: Acc[]
  instellingen?: Record<string, unknown>
  /** Exitcodes voor opeenvolgende `switch`-aanroepen; leeg = 0; 77 = exit 7 zonder `wie`. */
  switchCodes?: number[]
  apiModus?: 'abonnement' | 'api'
  store?: Record<string, unknown>
  rateLimits?: unknown[]
  /** fs.write gooit (hartslag faalt). */
  schrijfFaalt?: boolean
}

const acc = (id: number, pct5: number, extra: Partial<Acc> = {}): Acc => ({
  id,
  email: `a${id}…@futureflowai.com`,
  plan: id === 1 ? 'Max 20x' : 'Max 5x',
  inRotatie: true,
  status: 'ok',
  pct5,
  pct7: 18,
  gemetenOp: NU - 3 * MIN,
  ...extra,
})

const AUTO = { auto: true, marge5u: 90, marge7d: 90, stand: 'stil' }

// Nep-omgeving met een nep-cli/accounts.mjs en nep-cli/api.mjs; alle mocks vóór de eerste $-aanroep.
function fake(on: any, o: Opties = {}) {
  const clock = mock.clock(on, { now: NU })
  on('tool.register', () => ({ value: undefined }))
  const cli = {
    actief: o.actief === undefined ? 1 : o.actief,
    accounts: (o.accounts ?? [acc(1, 62), acc(2, 30)]).map(a => ({ ...a })),
    instellingen: { auto: false, marge5u: 90, marge7d: 90, stand: 'stil', ...(o.instellingen ?? {}) } as Record<string, unknown>,
    laatsteWissel: undefined as undefined | { tijd: number; van: number | null; naar: number; auto: boolean },
    switchCodes: [...(o.switchCodes ?? [])],
    apiModus: o.apiModus ?? 'abonnement',
  }
  const aanroepen: Array<{ args: string[]; argv: string[]; env?: Record<string, string>; timeoutMs?: number }> = []
  const toasts: string[] = []
  const writes: Array<{ path: string; text: string }> = []
  const store = new Map<string, unknown>(Object.entries(o.store ?? {}))
  const staatJson = () =>
    JSON.stringify({
      accounts: cli.accounts.map(a => ({ id: a.id, sleutel: `u${a.id}:o${a.id}`, email: a.email, plan: a.plan, inRotatie: a.inRotatie, status: a.status })),
      actief: cli.actief,
      instellingen: cli.instellingen,
      ...(cli.laatsteWissel ? { laatsteWissel: cli.laatsteWissel } : {}),
    })
  const status = () => ({
    actief: cli.actief,
    profiel: 'standaard',
    accounts: cli.accounts.map(a => ({
      id: a.id,
      email: a.email,
      plan: a.plan,
      inRotatie: a.inRotatie,
      status: a.status,
      gebruik: { '5u': { pct: a.pct5, resetsAt: RESET5 }, '7d': { pct: a.pct7, resetsAt: RESET7 } },
      ...(a.gemetenOp !== undefined ? { gemetenOp: a.gemetenOp, leeftijdS: Math.round((NU - a.gemetenOp) / 1000) } : {}),
    })),
    instellingen: { strategie: 'meeste-ruimte', wachttijd: 5 * MIN, hysterese: 10, maxWacht: 10 * MIN, ...cli.instellingen },
    ...(cli.laatsteWissel ? { laatsteWissel: cli.laatsteWissel } : {}),
  })

  on('store.get', ($: any, e: { key: string }) => ({ value: store.get(e.key) }))
  on('store.set', ($: any, e: { key: string; value: unknown }) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('env.get', ($: any, e: { name: string }) => ({
    value: ({ HOME: '/home/t', PATH: '/usr/bin', ...(o.desktop ? { CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH: '1' } : {}) } as Record<string, string>)[e.name],
  }))
  on('session.id', () => ({ value: 'sessie-1' }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: o.rateLimits ?? [] } }))
  on('session.measure', () => ({ changed: [] }) as never)
  on('session.start', ($: any, e: any) => e)
  on('session.end', ($: any, e: any) => ({ sessionId: 'sessie-1', ...e }))
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'x' }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', ($: any, e: { text: string }) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['stock row'] }))
  on('config.list', () => ({ value: [] }))
  on('fs.read', ($: any, e: { path: string }) => ({
    value:
      e.path === `${DIR}/accounts.json` ? staatJson()
      : e.path === '/home/t/.claude/settings.json' && cli.apiModus === 'api' ? JSON.stringify({ apiKeyHelper: HELPER })
      : '',
  }))
  on('fs.write', ($: any, e: { path: string; text: string }) => {
    if (o.schrijfFaalt) throw new Error('schijf vol')
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('command.register', () => ({ value: undefined }) as any)
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', ($: any, e: any) => ({ result: `uitgevoerd: ${e.tool}` }))
  on('process.run', ($: any, e: { argv: string[]; init?: { env?: Record<string, string>; timeoutMs?: number } }) => {
    const ok = (stdout: unknown) => ({ value: { exitCode: 0, stdout: JSON.stringify(stdout) + '\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const fout = (code: number, tekst: string, extra: Record<string, unknown> = {}) => ({
      value: { exitCode: code, stdout: JSON.stringify({ fout: tekst, code, ...extra }) + '\n', stderr: `[accounts] ${tekst}\n`, isStdoutTruncated: false, isStderrTruncated: false },
    })
    const api = e.argv.findIndex(a => a.endsWith('api.mjs'))
    if (api >= 0) {
      const args = e.argv.slice(api + 1)
      aanroepen.push({ args: ['api', ...args], argv: e.argv, env: e.init?.env })
      if (args[0] === 'status') return ok({ heeftKey: true, staart: 'WXYZ', modus: cli.apiModus, vreemdeHelper: false })
      if (args[0] === 'modus') {
        const gewijzigd = cli.apiModus !== args[1]
        cli.apiModus = args[1] as 'abonnement' | 'api'
        return ok({ modus: cli.apiModus, gewijzigd })
      }
      return ok({})
    }
    const i = e.argv.findIndex(a => a.endsWith('accounts.mjs'))
    if (i < 0 && e.argv.includes('overflow')) return ok({ finished: [] })
    if (i < 0) return ok({ memory: { freePercent: 40, totalGB: 16 }, config: { limits: {}, floorPercent: 25, criticalPercent: 10 }, slots: [], refusals: [] })
    const args = e.argv.slice(i + 1)
    aanroepen.push({ args, argv: e.argv, env: e.init?.env, timeoutMs: e.init?.timeoutMs })
    switch (args[0]) {
      case 'status':
        return ok(status())
      case 'sync':
        return ok({ gesynct: false, reden: 'al gelijk' })
      case 'usage':
        return ok({ opgehaald: [], overgeslagen: cli.accounts.map(a => a.id), fouten: {} })
      case 'switch': {
        const code = cli.switchCodes.shift() ?? 0
        if (code === 7) return fout(7, '1 sessie(s) midden in een beurt; nog niet gewisseld', { wie: ['andere-sessie'], sinds: NU })
        // 77: exit 7 zonder sessies (lock of login niet te controleren).
        if (code === 77) return fout(7, 'van wie de huidige login is, is niet te controleren (http-503); niet gewisseld, probeer het zo opnieuw')
        if (code !== 0) return fout(code, 'iets ging mis')
        const naar = Number(args[1])
        const van = cli.actief
        cli.actief = naar
        cli.laatsteWissel = { tijd: NU, van, naar, auto: args.includes('--auto') }
        const doel = cli.accounts.find(a => a.id === naar)!
        return ok({ gewisseld: true, van, naar, email: doel.email, plan: doel.plan })
      }
      case 'add':
        cli.accounts.push(acc(3, 0, { email: 'ni…@x.nl', plan: 'Pro' }))
        return ok({ id: 3, email: 'ni…@x.nl', plan: 'Pro', nieuw: true })
      case 'instellingen':
        Object.assign(cli.instellingen, JSON.parse(args[1]!))
        return ok({ instellingen: cli.instellingen })
      case 'zet': {
        const a = cli.accounts.find(x => x.id === Number(args[1]))!
        a.inRotatie = args[3] === 'aan'
        return ok({ id: a.id, inRotatie: a.inRotatie })
      }
      case 'remove':
        cli.accounts = cli.accounts.filter(a => a.id !== Number(args[1]))
        return ok({ verwijderd: Number(args[1]), actief: false })
      default:
        return fout(1, 'gebruik')
    }
  })
  const switches = () => aanroepen.filter(a => a.args[0] === 'switch').map(a => a.args)
  const modus = () => aanroepen.filter(a => a.args[0] === 'api' && a.args[1] === 'modus').map(a => a.args[2])
  const sessiebestanden = () =>
    writes.filter(w => w.path === `${DIR}/sessies/sessie-1.json`).map(w => JSON.parse(w.text) as { sessie: string; status: string; sinds: number; hartslag: number; terminal: boolean })
  return { cli, aanroepen, toasts, writes, store, clock, switches, modus, sessiebestanden }
}

const run = ($: any, command: string, args: string) =>
  $.command.run({ origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 }, command, args } as any)

const PANE = (surface: 'terminal' | 'desktop') => ({ plugin: 'futureflow', surface, component: 'Pane', requestId: 'futureflow', props: {} }) as any

const BAND = (surface: 'terminal' | 'desktop' = 'terminal') =>
  ({
    plugin: 'futureflow',
    viewport: { columns: 120, rows: 30 },
    surface,
    component: 'AbovePrompt',
    requestId: 'band',
    props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 120, scroll: { offset: 0, bodyRows: 12 }, view: {} },
  }) as any

const START = { cwd: '/proj', surface: 'terminal', isInteractive: true } as any

// Een meting zoals Claude Code hem meldt; de beslissing loopt los, dus daarna de event-loop laten uitlopen.
async function meet($: any, clock: { settle(): Promise<void> }, percent = 92) {
  await $.session.measure({ context: { window: 200000 }, rateLimits: [{ kind: 'five_hour', percentUsed: percent, resetsAt: new Date(RESET5).toISOString() }], changed: ['rateLimits'] } as never)
  await clock.settle()
}

test('hotkey 7 opent de tab Accounts: rijen met gemaskeerd e-mailadres, verbruik, leeftijd en uitleg', async ($, on) => {
  const f = fake(on)
  await $.session.start(START)
  await run($, 'futureflow', '')
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await ui.find({ type: 'Button', key: 'tab-accounts', hotkey: '7' } as any)).toBeDefined()
  await ui.press({ key: 'tab-accounts' } as any)
  expect(await ui.find({ type: 'Text', text: /1  a1…@futureflowai\.com/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /2  a2…@futureflowai\.com/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Max 20x/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /5u ▰▰▰▱▱ 62% \(reset \d\d:\d\d\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /7d ▰▱▱▱▱ 18% \(\w\w \d\d-\d\d\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /3 min geleden/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /apart betaald abonnement/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Nooit \/logout tussen accounts/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Alleen terminal/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /sessiebestanden van Claude Code/ })).toBeDefined()
  for (const key of ['acc-toevoegen', 'acc-ververs', 'acc-wissel-2', 'acc-rotatie-1', 'acc-weg-2', 'acc-auto', 'acc-stil', 'acc-vragen']) {
    expect(await ui.find({ type: 'Button', key } as any)).toBeDefined()
  }
  // Het actieve account heeft geen wisselknop.
  expect(await ui.find({ type: 'Button', key: 'acc-wissel-1' } as any)).toBeUndefined()
  for (const key of ['acc-marge5u', 'acc-marge7d']) expect(await ui.find({ type: 'Input', key } as any)).toBeDefined()
  const boom = JSON.stringify(await ui.drawn())
  expect(boom).not.toMatch(/voorwaarden|terms/i)
  await ui.unmount()
  // Tekenen start geen CLI: alleen het openen las de status.
  expect(f.aanroepen.filter(a => a.args[0] === 'status').length).toBe(1)
})

test('desktop-app: verbruik zichtbaar, geen knoppen, de desktopzin; geen sessiebestand', async ($, on) => {
  const f = fake(on, { desktop: true })
  await $.session.start({ ...START, surface: 'desktop' })
  await run($, 'futureflow', 'accounts')
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount(PANE(surface))
    expect(await ui.find({ type: 'Text', text: /a2…@futureflowai\.com/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /De desktop-app regelt zijn eigen login; wisselen werkt alleen voor terminal-sessies\./ })).toBeDefined()
    const boom = JSON.stringify(await ui.drawn())
    expect(boom).not.toMatch(/"acc-(toevoegen|ververs|wissel|rotatie|weg|auto|stil|vragen|marge)/)
    await ui.unmount()
  }
  expect(f.sessiebestanden()).toEqual([])
  expect((await run($, 'accounts', 'wissel 2')).text).toContain('desktop-app regelt zijn eigen login')
  expect(f.switches()).toEqual([])
})

test('klik Wissel hierheen: switch <id> --van <actief> --ikzelf <sessie>, met vaste env en één toast', async ($, on) => {
  const f = fake(on)
  await $.session.start(START)
  await run($, 'futureflow', 'accounts')
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'acc-wissel-2' } as any)
  expect(f.switches()).toEqual([['switch', '2', '--van', '1', '--ikzelf', 'sessie-1']])
  const sw = f.aanroepen.find(a => a.args[0] === 'switch')!
  expect(sw.argv.slice(0, 2)).toEqual(['/usr/bin/env', 'node'])
  // Een switch krijgt 120 s (de CLI stopt zelf na 30 s vóór het schrijven); de rest 60 s.
  expect(sw.timeoutMs).toBe(120_000)
  expect(f.aanroepen.find(a => a.args[0] === 'status')!.timeoutMs).toBe(60_000)
  expect(f.toasts.length).toBe(1)
  expect(f.toasts[0]).toContain('Gewisseld naar account 2 (a2…@futureflowai.com, Max 5x; met de hand)')
  expect(f.toasts[0]).toContain('desktop-app houdt zijn eigen login')
  for (const a of f.aanroepen.filter(x => x.args[0] !== 'api')) {
    expect(a.env?.SECURITY_BIN).toBe('/usr/bin/security')
    for (const k of ['ACCOUNTS_HOME', 'CLAUDE_JSON', 'CLAUDE_HOME', 'ACCOUNTS_API', 'KEYCHAIN_USER', 'ACCOUNTS_TEST_NU', 'ACCOUNTS_TEST_LOCK_WACHT']) expect(a.env?.[k]).toBe('')
  }
  // De tab toont nu account 2 als actief; de eigen wissel geeft geen tweede melding boven de prompt.
  expect(await ui.find({ type: 'Text', text: /Nu in de terminal: account 2/ })).toBeDefined()
  await ui.unmount()
  const band = await $.ui.mount(BAND())
  expect(await band.find({ type: 'Text', text: /Gewisseld naar account 2/ })).toBeUndefined()
  await band.unmount()
})

test('auto bij 92%: na de beurt switch naar het account met ruimte (--auto), toast; daarna binnen een minuut niet opnieuw', async ($, on) => {
  const f = fake(on, { accounts: [acc(1, 92), acc(2, 30)], instellingen: AUTO, rateLimits: [{ kind: 'five_hour', percentUsed: 92 }] })
  await $.session.start(START)
  await $.turn.start({ text: 'hoi', turnId: 't1' } as any)
  // Tijdens de beurt: niet beslissen.
  await meet($, f.clock)
  expect(f.switches()).toEqual([])
  await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, reason: 'answer', turnId: 't1' } as any)
  await f.clock.settle()
  expect(f.aanroepen.filter(a => a.args[0] !== 'api').map(a => a.args[0])).toEqual(['sync', 'usage', 'status', 'switch', 'status'])
  expect(f.switches()).toEqual([['switch', '2', '--van', '1', '--ikzelf', 'sessie-1', '--auto']])
  expect(f.toasts.some(t => t.startsWith('Gewisseld naar account 2'))).toBe(true)
  expect(f.modus()).toEqual([])
  await meet($, f.clock)
  expect(f.switches().length).toBe(1)
})

test('alle accounts vol: de ketting wisselt via api.tsx naar de API, geen switch', async ($, on) => {
  const f = fake(on, {
    accounts: [acc(1, 92), acc(2, 95)],
    instellingen: AUTO,
    store: { 'api.toestand': { modus: 'abonnement', auto: true, hoog: 90, laag: 50, laatsteWissel: 0 } },
  })
  await $.session.start(START)
  await meet($, f.clock)
  expect(f.switches()).toEqual([])
  // Precies één wissel: apiMeet laat het besluit aan de ketting.
  expect(f.modus()).toEqual(['api'])
  expect(f.toasts.some(t => t.startsWith('Naar API'))).toBe(true)
  expect((f.store.get('api.toestand') as any).overgeschakeldDoor).toEqual({ label: '5u', resetsAt: RESET5 })
})

test('op de API en account 2 heeft weer ruimte: switch naar 2 en terug naar het abonnement', async ($, on) => {
  const f = fake(on, {
    accounts: [acc(1, 95), acc(2, 20)],
    instellingen: AUTO,
    apiModus: 'api',
    store: { 'api.toestand': { modus: 'api', auto: true, hoog: 90, laag: 50, laatsteWissel: NU - 60 * MIN, overgeschakeldDoor: { label: '5u', resetsAt: RESET5 } } },
  })
  await $.session.start(START)
  await $.session.measure({ context: { window: 200000 }, rateLimits: [], changed: ['context'] } as never)
  await f.clock.settle()
  expect(f.switches()).toEqual([['switch', '2', '--van', '1', '--ikzelf', 'sessie-1', '--auto']])
  expect(f.modus()).toEqual(['abonnement'])
  expect((f.store.get('api.toestand') as any).modus).toBe('abonnement')
})

test('op de API en het actieve account heeft weer ruimte: geen switch, alleen terug naar het abonnement', async ($, on) => {
  const f = fake(on, {
    accounts: [acc(1, 10), acc(2, 95)],
    instellingen: AUTO,
    apiModus: 'api',
    store: { 'api.toestand': { modus: 'api', auto: true, hoog: 90, laag: 50, laatsteWissel: NU - 60 * MIN, overgeschakeldDoor: { label: '5u', resetsAt: RESET5 } } },
  })
  await $.session.start(START)
  await $.session.measure({ context: { window: 200000 }, rateLimits: [], changed: ['context'] } as never)
  await f.clock.settle()
  expect(f.switches()).toEqual([])
  expect(f.modus()).toEqual(['abonnement'])
})

test('exit 7 (een andere sessie is bezig): wachtregel boven de prompt; na 10 min de melding "nog niet gewisseld" en geen pogingen meer tot de volgende beurt', async ($, on) => {
  const f = fake(on, { accounts: [acc(1, 92), acc(2, 30)], instellingen: AUTO, switchCodes: [7, 7, 7, 7] })
  await $.session.start(START)
  await meet($, f.clock)
  expect(f.switches().length).toBe(1)
  const band = await $.ui.mount(BAND())
  expect(await band.find({ type: 'Text', text: /Wissel naar account 2 wacht op 1 sessie\(s\) die midden in een beurt zitten/ })).toBeDefined()
  await band.unmount()
  expect(f.toasts).toEqual([])
  await f.clock.advance(5 * MIN)
  await meet($, f.clock)
  expect(f.switches().length).toBe(2)
  expect(f.toasts).toEqual([])
  await f.clock.advance(5 * MIN)
  await meet($, f.clock)
  expect(f.switches().length).toBe(3)
  expect(f.toasts).toEqual(['Wacht op een sessie die bezig is; nog niet gewisseld.'])
  // Geen nieuwe pogingen tot de volgende beurt van deze sessie.
  await f.clock.advance(2 * MIN)
  await meet($, f.clock)
  expect(f.switches().length).toBe(3)
  const band2 = await $.ui.mount(BAND())
  expect(await band2.find({ type: 'Text', text: /wacht op/ })).toBeUndefined()
  await band2.unmount()
  await $.turn.start({ text: 'verder', turnId: 't2' } as any)
  await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, reason: 'answer', turnId: 't2' } as any)
  await f.clock.settle()
  expect(f.switches().length).toBe(4)
})

test('stand vragen: geen switch maar een vraag boven de prompt; Wissel voert hem uit, Niet nu wacht 30 min', async ($, on) => {
  const f = fake(on, { accounts: [acc(1, 92), acc(2, 30)], instellingen: { ...AUTO, stand: 'vragen' } })
  await $.session.start(START)
  await meet($, f.clock)
  expect(f.switches()).toEqual([])
  expect(f.toasts.length).toBe(1)
  expect(f.toasts[0]).toContain('stelt voor te wisselen naar account 2')
  const band = await $.ui.mount(BAND())
  expect(await band.find({ type: 'Text', text: /Wisselen naar account 2\?/ })).toBeDefined()
  expect(await band.find({ type: 'Button', key: 'acc-vraag-nee' } as any)).toBeDefined()
  await band.press({ key: 'acc-vraag-ja' } as any)
  expect(f.switches()).toEqual([['switch', '2', '--van', '1', '--ikzelf', 'sessie-1', '--auto']])
  expect(await band.find({ type: 'Text', text: /Wisselen naar account 2\?/ })).toBeUndefined()
  await band.unmount()
})

test('stand vragen, Niet nu: 30 min geen vraag en geen switch', async ($, on) => {
  const f = fake(on, { accounts: [acc(1, 92), acc(2, 30)], instellingen: { ...AUTO, stand: 'vragen' } })
  await $.session.start(START)
  await meet($, f.clock)
  const band = await $.ui.mount(BAND())
  await band.press({ key: 'acc-vraag-nee' } as any)
  expect(await band.find({ type: 'Text', text: /Wisselen naar account 2\?/ })).toBeUndefined()
  await band.unmount()
  expect(f.store.get('accounts.nietNuTot')).toBe(NU + 30 * MIN)
  await f.clock.advance(2 * MIN)
  await meet($, f.clock)
  expect(f.toasts.filter(t => t.includes('stelt voor')).length).toBe(1)
  expect(f.switches()).toEqual([])
})

test('sessiebestand: tussen bij de start, bezig bij turn.start, tussen bij turn.complete, weg bij session.end', async ($, on) => {
  const f = fake(on)
  await $.session.start(START)
  await $.turn.start({ text: 'hoi', turnId: 't1' } as any)
  await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, reason: 'answer', turnId: 't1' } as any)
  await f.clock.settle()
  await $.session.end({ reason: 'exit', sessionId: 'sessie-1' } as any)
  const s = f.sessiebestanden()
  expect(s.map(x => x.status)).toEqual(['tussen', 'bezig', 'tussen', 'weg'])
  expect(s[1]).toEqual({ sessie: 'sessie-1', status: 'bezig', sinds: NU, hartslag: NU, terminal: true })
  // Een subagent verandert het bestand niet.
  await $.turn.start({ text: 'sub', turnId: 't3', agentId: 'agent-1' } as any)
  expect(f.sessiebestanden().length).toBe(4)
})

test('hartslag tijdens een beurt hoogstens elke 30 s; een fout daarin laat de tool-aanroep doorgaan', async ($, on) => {
  const f = fake(on)
  await $.session.start(START)
  await $.turn.start({ text: 'hoi', turnId: 't1' } as any)
  await f.clock.advance(31_000)
  expect((await $.tool.call({ tool: 'Read', file_path: '/x' } as any) as any).result).toBe('uitgevoerd: Read')
  await f.clock.settle()
  await $.tool.call({ tool: 'Read', file_path: '/y' } as any)
  await f.clock.settle()
  const s = f.sessiebestanden()
  expect(s.map(x => x.status)).toEqual(['tussen', 'bezig', 'bezig'])
  expect(s[2]!.hartslag).toBe(NU + 31_000)
  expect(s[2]!.sinds).toBe(NU)
})

test('een fout in de hartslag laat de tool-aanroep doorgaan', async ($, on) => {
  const f = fake(on, { schrijfFaalt: true })
  await $.session.start(START)
  await $.turn.start({ text: 'hoi', turnId: 't1' } as any)
  await f.clock.advance(31_000)
  const r = (await $.tool.call({ tool: 'Bash', command: 'ls' } as any)) as any
  await f.clock.settle()
  expect(r.result).toBe('uitgevoerd: Bash')
})

test('een wissel uit een andere sessie: 10 s een groene regel boven de prompt', async ($, on) => {
  const f = fake(on)
  await $.session.start(START)
  f.cli.actief = 2
  f.cli.laatsteWissel = { tijd: NU + 1000, van: 1, naar: 2, auto: true }
  await $.turn.start({ text: 'hoi', turnId: 't1' } as any)
  const band = await $.ui.mount(BAND())
  expect(await band.find({ type: 'Text', text: /Gewisseld naar account 2 \(a2…@futureflowai\.com\)/ })).toBeDefined()
  await band.unmount()
  await f.clock.advance(11_000)
  const band2 = await $.ui.mount(BAND())
  expect(await band2.find({ type: 'Text', text: /Gewisseld naar account 2/ })).toBeUndefined()
  await band2.unmount()
})

test('tab-acties: toevoegen, rotatie, marge, stand en verwijderen met een tweede klik', async ($, on) => {
  const f = fake(on)
  await $.session.start(START)
  await run($, 'futureflow', 'accounts')
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'acc-toevoegen' } as any)
  expect(f.toasts.at(-1)).toBe('Toegevoegd: account 3 (ni…@x.nl, Pro).')
  expect(await ui.find({ type: 'Text', text: /3  ni…@x\.nl/ })).toBeDefined()
  await ui.press({ key: 'acc-rotatie-2' } as any)
  expect(f.cli.accounts.find(a => a.id === 2)!.inRotatie).toBe(false)
  await (ui as any).input({ key: 'acc-marge5u', text: '85' })
  expect(f.cli.instellingen.marge5u).toBe(85)
  await (ui as any).input({ key: 'acc-marge7d', text: '40' })
  expect(f.cli.instellingen.marge7d).toBe(90)
  expect(f.toasts.at(-1)).toContain('kies een heel getal van 50 tot 99')
  await ui.press({ key: 'acc-vragen' } as any)
  expect(f.cli.instellingen.stand).toBe('vragen')
  await ui.press({ key: 'acc-weg-3' } as any)
  expect(f.aanroepen.filter(a => a.args[0] === 'remove')).toEqual([])
  expect(await ui.find({ type: 'Text', text: /Zeker\? Klik nog eens/ })).toBeDefined()
  await ui.press({ key: 'acc-weg-3' } as any)
  expect(f.aanroepen.filter(a => a.args[0] === 'remove').map(a => a.args)).toEqual([['remove', '3']])
  await ui.unmount()
})

test('/accounts lijst geeft de tekstversie; /accounts wissel 2 wisselt met de hand', async ($, on) => {
  const f = fake(on)
  await $.session.start(START)
  const lijst = (await run($, 'accounts', 'lijst')).text as string
  expect(lijst).toContain('● 1  a1…@futureflowai.com  Max 20x  5u ▰▰▰▱▱ 62%')
  expect(lijst).toContain('○ 2  a2…@futureflowai.com')
  expect(lijst).toContain('Automatisch wisselen: uit.')
  expect((await run($, 'accounts', 'wissel 2')).text).toBe('Gewisseld naar account 2.')
  expect(f.switches()).toEqual([['switch', '2', '--van', '1', '--ikzelf', 'sessie-1']])
  expect((await run($, 'accounts', 'raar')).text).toContain('Gebruik: /accounts')
})

test('accounts-auto uit: geen CLI na een meting, en de API-wissel werkt zoals voorheen', async ($, on) => {
  const f = fake(on, {
    accounts: [acc(1, 92), acc(2, 30)],
    store: { 'api.toestand': { modus: 'abonnement', auto: true, hoog: 90, laag: 50, laatsteWissel: 0 } },
  })
  await $.session.start(START)
  await meet($, f.clock)
  expect(f.aanroepen.filter(a => a.args[0] !== 'api')).toEqual([])
  expect(f.modus()).toEqual(['api'])
})

test('midden in een eigen beurt: Wissel boven de prompt en /accounts wissel starten geen switch', async ($, on) => {
  const f = fake(on, { accounts: [acc(1, 92), acc(2, 30)], instellingen: { ...AUTO, stand: 'vragen' } })
  await $.session.start(START)
  await meet($, f.clock)
  expect(f.toasts[0]).toContain('stelt voor te wisselen naar account 2')
  // De gebruiker begint een nieuwe beurt en klikt dan pas op Wissel.
  await $.turn.start({ text: 'verder', turnId: 't1' } as any)
  const band = await $.ui.mount(BAND())
  await band.press({ key: 'acc-vraag-ja' } as any)
  await band.unmount()
  expect(f.switches()).toEqual([])
  expect(f.toasts.at(-1)).toContain('midden in een beurt')
  expect((await run($, 'accounts', 'wissel 2')).text).toContain('Niet gewisseld naar account 2')
  expect(f.switches()).toEqual([])
  // Na de beurt wel.
  await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, reason: 'answer', turnId: 't1' } as any)
  await f.clock.settle()
  const band2 = await $.ui.mount(BAND())
  await band2.press({ key: 'acc-vraag-ja' } as any)
  await band2.unmount()
  expect(f.switches()).toEqual([['switch', '2', '--van', '1', '--ikzelf', 'sessie-1', '--auto']])
})

test('exit 7 zonder sessies (login niet te controleren): geen wachtregel; met de hand een melding', async ($, on) => {
  const f = fake(on, { switchCodes: [77] })
  await $.session.start(START)
  expect((await run($, 'accounts', 'wissel 2')).text).toContain('Niet gewisseld naar account 2')
  expect(f.switches().length).toBe(1)
  expect(f.toasts.at(-1)).toContain('Nog niet gewisseld: van wie de huidige login is')
  const band = await $.ui.mount(BAND())
  expect(await band.find({ type: 'Text', text: /wacht op/ })).toBeUndefined()
  await band.unmount()
})
