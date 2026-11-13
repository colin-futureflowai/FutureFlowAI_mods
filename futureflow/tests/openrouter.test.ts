import { expect, mock, test } from 'claude-code/testing'

import { HELPER, OR_HELPER } from '../lib/api.mjs'

const NU = Date.parse('2026-11-10T12:00:00Z')
const ORKEY = 'sk-or-v1-0123456789abcdef0123456789abcdefQRST'
const SLOTS = JSON.stringify({ memory: { freePercent: 40, totalGB: 16 }, config: { limits: { dev: 2 }, floorPercent: 25, criticalPercent: 10 }, slots: [], refusals: [] }) + '\n'
const MODELLEN = [
  { id: 'openai/gpt-5', naam: 'OpenAI: GPT-5', context: 400000, in: 1.25, uit: 10 },
  { id: 'openai/gpt-5-mini', naam: 'OpenAI: GPT-5 Mini', context: 400000, in: 0.25, uit: 2 },
  { id: 'anthropic/claude-sonnet-4.5', naam: 'Anthropic: Claude Sonnet 4.5', context: 1000000, in: 3, uit: 15 },
]

type Modus = 'abonnement' | 'api' | 'openrouter'
type Opties = { proxy?: boolean; surfaces?: string[]; openFout?: boolean; cachetest?: Record<string, unknown>; veel?: boolean; modus?: Modus; orKey?: boolean; store?: Record<string, unknown>; rateLimits?: unknown[]; test?: unknown; env?: Record<string, string>; weiger?: string; orRijen?: Record<string, unknown> }

// Nep-omgeving met een nep-cli/api.mjs; alle mocks vóór de eerste $-aanroep.
function fake(on: any, o: Opties = {}) {
  const clock = mock.clock(on, { now: NU })
  on('tool.register', () => ({ value: undefined }))
  const cli = { modus: (o.modus ?? 'abonnement') as Modus, orKey: o.orKey ?? false, model: undefined as string | undefined, snel: undefined as string | undefined }
  const aanroepen: Array<{ args: string[]; argv: string[]; stdin?: string }> = []
  const toasts: string[] = []
  const store = new Map<string, unknown>(Object.entries(o.store ?? {}))
  on('store.get', ($: any, e: { key: string }) => ({ value: store.get(e.key) }))
  on('store.set', ($: any, e: { key: string; value: unknown }) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('env.get', ($: any, e: { name: string }) => ({ value: ({ HOME: '/home/t', PATH: '/usr/bin', ...o.env } as Record<string, string>)[e.name] }))
  on('session.id', () => ({ value: 'sessie-1' }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('session.surfaces', () => ({ value: o.surfaces ?? ['terminal'] }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: o.rateLimits ?? [] } }))
  on('session.measure', () => ({ changed: [] }) as never)
  on('session.start', ($: any, e: any) => e)
  on('turn.complete', () => ({ text: 'x' }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', ($: any, e: { text: string }) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('config.list', () => ({ value: [] }))
  on('fs.read', ($: any, e: { path: string }) => ({
    value: e.path === '/home/t/.claude/settings.json' && cli.modus !== 'abonnement'
      ? JSON.stringify(cli.modus === 'api' ? { apiKeyHelper: HELPER } : { apiKeyHelper: OR_HELPER, env: { ANTHROPIC_BASE_URL: 'https://openrouter.ai/api' } })
      : '',
  }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('command.register', () => ({ value: undefined }) as any)
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const envs: Array<Record<string, string> | undefined> = []
  const geopend: string[][] = []
  on('process.run', ($: any, e: { argv: string[]; init?: { stdin?: string; env?: Record<string, string> } }) => {
    if (e.argv[0] === '/usr/bin/open') {
      geopend.push(e.argv)
      return { value: { exitCode: o.openFout ? 1 : 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    const ok = (stdout: unknown) => ({ value: { exitCode: 0, stdout: JSON.stringify(stdout) + '\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const fout = (exitCode: number, stderr: string) => ({ value: { exitCode, stdout: '', stderr: `[api] ${stderr}\n`, isStdoutTruncated: false, isStderrTruncated: false } })
    const i = e.argv.findIndex(a => a.endsWith('api.mjs'))
    if (i < 0) return { value: { exitCode: 0, stdout: SLOTS, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    const args = e.argv.slice(i + 1)
    const stdin = e.init?.stdin
    envs.push(e.init?.env)
    aanroepen.push({ args, argv: e.argv, stdin })
    if (args[0] === 'status') {
      return ok({ heeftKey: false, staart: '', modus: cli.modus === 'openrouter' ? 'abonnement' : cli.modus, oudeOr: cli.modus === 'openrouter', vreemdeHelper: false, vreemdeBasis: false, orHeeftKey: cli.orKey, orStaart: cli.orKey ? 'QRST' : '', orKlaar: !!cli.model, orShim: !!cli.model, orOpPad: true, ...(cli.model ? { orModel: cli.model, orSnel: cli.snel } : {}), ...(o.proxy ? { orProxy: true, orLogboek: 'http://127.0.0.1:20817/' } : {}), ...(o.orRijen ? { orKlaar: true, ...o.orRijen } : {}) })
    }
    if (args[0] === 'openrouter' && args[1] === 'zet-key') {
      cli.orKey = true
      return ok({ ok: true, staart: (stdin ?? '').trim().slice(-4) })
    }
    if (args[0] === 'openrouter' && args[1] === 'wis-key') {
      const gewist = cli.orKey
      cli.orKey = false
      return ok({ gewist })
    }
    if (args[0] === 'openrouter' && args[1] === 'modellen') return ok({ modellen: o.veel ? [...MODELLEN, ...Array.from({ length: 42 }, (_, i) => ({ id: `x/m-${i}`, naam: `M ${i}`, context: 128000, in: 1, uit: 2 }))] : MODELLEN, opgehaald: NU, uitCache: args[2] !== '--ververs' })
    if (args[0] === 'openrouter' && args[1] === 'test') return ok(o.test ?? { ok: true, status: 200 })
    if (args[0] === 'openrouter' && args[1] === 'cachetest') return ok(o.cachetest?.[args[3]] ?? { ok: false, status: 403, fout: 'Key limit exceeded' })
    // Startcheck: de mod geeft de metingen uit de store door; de CLI werkt shim en poortbestand bij.
    if (args[0] === 'openrouter' && args[1] === 'poort') return ok({ ok: true, redenen: [], shim: true })
    if (args[0] === 'openrouter' && args[1] === 'opruimen') {
      const gewijzigd = cli.modus === 'openrouter'
      if (gewijzigd) cli.modus = 'abonnement'
      return ok({ gewijzigd })
    }
    if (args[0] === 'modus') {
      if (args[1] === 'openrouter' && !cli.orKey) return fout(4, 'geen OpenRouter-key in de sleutelhanger; bewaar eerst een key')
      if (args[1] === 'api') return fout(4, 'geen key in de sleutelhanger; bewaar eerst een key')
      if (args[1] === 'openrouter' && o.weiger) return fout(7, o.weiger)
      if (args[1] === 'openrouter') {
        // claude-or klaarzetten: settings.json (de modus) blijft.
        const model = args[args.indexOf('--m1') + 1]
        const snel = args.includes('--m4') ? args[args.indexOf('--m4') + 1] : model
        const gewijzigd = cli.model !== model || cli.snel !== snel
        cli.model = model
        cli.snel = snel
        return ok({ modus: 'openrouter', gewijzigd, settings: '/home/t/.claude/futureflow/openrouter/settings.json', shim: '/home/t/.local/bin/claude-or', start: 'claude-or', opPad: true })
      }
      const gewijzigd = cli.modus !== args[1]
      cli.modus = args[1] as Modus
      return ok({ modus: cli.modus, gewijzigd })
    }
    return fout(1, 'gebruik')
  })
  const modusAanroepen = () => aanroepen.filter(a => a.args[0] === 'modus').map(a => a.args.slice(1).join(' '))
  return { cli, aanroepen, toasts, store, modusAanroepen, clock, envs, geopend }
}

const run = ($: any, command: string, args: string) =>
  $.command.run({ origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 }, command, args } as any)

const PANE = (surface: 'terminal' | 'desktop') =>
  ({ plugin: 'futureflow', surface, component: 'Pane', requestId: 'futureflow', props: {} }) as any

const START = { cwd: '/proj', surface: 'terminal', isInteractive: true } as any

async function meet($: any, rateLimits: unknown[], clock: { settle(): Promise<void> }) {
  await $.session.measure({ context: { window: 200000 }, rateLimits, changed: ['rateLimits'] } as never)
  await clock.settle()
}

test('tab Wisselen: OpenRouter met waarschuwingen (onder Meer), Claude-groep eerst, prijzen per Mtok', async ($, on) => {
  const f = fake(on)
  await run($, 'futureflow', '')
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'tab-wisselen' } as any)
  await f.clock.settle()
  await ui.press({ key: 'meer-wisselen' } as any)
  expect(await ui.find({ type: 'Input', key: 'or-key' } as any)).toBeDefined()
  expect(await ui.find({ type: 'Input', key: 'or-zoek' } as any)).toBeDefined()
  for (const tekst of [/werken niet gegarandeerd/, /Webzoeken werkt niet/, /Start een OpenRouter-sessie met claude-or; andere sessies en de desktop-app blijven op je abonnement/, /claude\.ai-connectors niet/, /te klein voor Claude Code/]) {
    expect(await ui.find({ type: 'Text', text: tekst })).toBeDefined()
  }
  expect(await ui.find({ type: 'Text', text: 'Claude via OpenRouter' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\$3 in \/ \$15 uit per Mtok/ })).toBeDefined()
  // De eerste rij is het Claude-model.
  expect(await ui.find({ type: 'Text', text: 'anthropic/claude-sonnet-4.5' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'or-kies-0' } as any)).toBeDefined()
  // Vijf rijen Model 1-5 met dimme uitleg; de woorden hoofd en snel zijn weg.
  for (const n of [1, 2, 3, 4, 5]) expect(await ui.find({ type: 'Button', key: `or-model-${n}` } as any)).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 · start \+ \/model opus/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /4 · subagents \+ \/model haiku/ })).toBeDefined()
  expect(JSON.stringify(await ui.drawn())).not.toMatch(/Hoofd|hoofdmodel|Snel model|Haiku\/snel/)
  const boom = JSON.stringify(await ui.drawn())
  expect(boom.indexOf('anthropic/claude-sonnet-4.5')).toBeLessThan(boom.indexOf('openai/gpt-5'))
  expect(boom).toContain('"flexWrap":"wrap"')
  await ui.unmount()
})

test('key alleen via stdin; een Anthropic-key wordt geweigerd', async ($, on) => {
  const f = fake(on)
  await run($, 'futureflow', 'openrouter')
  const ui = await $.ui.mount(PANE('terminal'))
  await (ui as any).input({ key: 'or-key', text: 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ' } as any)
  expect(f.toasts).toEqual(['Dat is geen OpenRouter-key (die begint met sk-or-); niets opgeslagen.'])
  await (ui as any).input({ key: 'or-key', text: ` ${ORKEY}\n` } as any)
  const zet = f.aanroepen.filter(a => a.args[0] === 'openrouter' && a.args[1] === 'zet-key')
  expect(zet.length).toBe(1)
  expect(zet[0]!.stdin).toBe(ORKEY)
  for (const a of f.aanroepen) expect(a.argv.join(' ')).not.toContain(ORKEY)
  expect(JSON.stringify([...f.store.entries()])).not.toContain(ORKEY)
  expect(f.toasts.join(' ')).not.toContain(ORKEY)
  expect(await ui.find({ type: 'Text', text: /sk-or-…QRST/ })).toBeDefined()
  expect(JSON.stringify(await ui.drawn())).not.toContain(ORKEY)
  for (const env of f.envs) {
    expect(env?.OPENROUTER_DIR).toBe('')
    expect(env?.OPENROUTER_URL).toBe('')
    expect(env?.SETTINGS_JSON).toBe('')
  }
  await ui.unmount()
})

test('Kies bij Model 4 opent de lijst; zoeken filtert; kiezen zet model 4 en sluit de lijst; Model 1 met [1m]', async ($, on) => {
  const f = fake(on)
  await run($, 'futureflow', 'openrouter')
  await f.clock.settle()
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await ui.find({ type: 'Input', key: 'or-zoek' } as any)).toBeUndefined()
  await ui.press({ key: 'or-model-4' } as any)
  expect(await ui.find({ type: 'Text', text: 'Kies Model 4' })).toBeDefined()
  await (ui as any).input({ key: 'or-zoek', text: 'mini' } as any)
  expect(await ui.find({ type: 'Text', text: 'openai/gpt-5-mini' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'anthropic/claude-sonnet-4.5' })).toBeUndefined()
  await ui.press({ key: 'or-kies-0' } as any)
  expect(await ui.find({ type: 'Input', key: 'or-zoek' } as any)).toBeUndefined()
  await ui.press({ key: 'or-model-1' } as any)
  await (ui as any).input({ key: 'or-zoek', text: '' } as any)
  await ui.press({ key: 'or-kies-0' } as any)
  expect(f.store.get('openrouter.keuze')).toEqual({ m4: 'openai/gpt-5-mini', m1: 'anthropic/claude-sonnet-4.5[1m]' })
  expect(f.store.get('openrouter.prijzen')).toEqual({
    'openai/gpt-5-mini': { in: 0.25, uit: 2, ctx: 400000 }, 'anthropic/claude-sonnet-4.5': { in: 3, uit: 15, ctx: 1000000 }, 'anthropic/claude-sonnet-4.5[1m]': { in: 3, uit: 15, ctx: 1000000 },
  })
  expect(await ui.find({ type: 'Text', text: 'anthropic/claude-sonnet-4.5[1m]' })).toBeDefined()
  // Nog niet klaargezet: kiezen zet niets klaar.
  expect(f.modusAanroepen()).toEqual([])
  await ui.unmount()
})

test('Gebruik nu: zonder modellen een uitleg; met modellen claude-or klaar, settings.json en de modus blijven', async ($, on) => {
  const f = fake(on, {
    orKey: true,
    cachetest: { 'anthropic/claude-sonnet-4.5': { ok: true, model: 'anthropic/claude-sonnet-4.5', oordeel: 'goed', raak: 5, van: 5, aandeel: 80, rondes: [], aanbieders: [], gemeten: 1 } },
    store: { 'openrouter.cache': { 'openai/gpt-5': { oordeel: 'goed', aandeel: 80, raak: 5, van: 5, gemeten: 1 }, 'openai/gpt-5-mini': { oordeel: 'goed', aandeel: 80, raak: 5, van: 5, gemeten: 1 } } },
  })
  await $.session.start(START)
  await run($, 'futureflow', 'openrouter')
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await ui.find({ type: 'Button', key: 'or-abonnement' } as any)).toBeUndefined()
  await ui.press({ key: 'or-naar' } as any)
  expect(f.modusAanroepen()).toEqual([])
  expect(f.toasts[0]).toContain('Kies eerst Model 1')
  f.store.set('openrouter.keuze', { model: 'openai/gpt-5', snel: 'openai/gpt-5-mini' })
  await ui.press({ key: 'or-naar' } as any)
  expect(f.modusAanroepen()).toEqual(['openrouter --m1 openai/gpt-5 --m4 openai/gpt-5-mini'])
  expect(f.toasts[1]).toBe('Klaar. Klik Herstart op OpenRouter boven de prompt, of start een OpenRouter-sessie met claude-or; andere sessies en de desktop-app blijven op je abonnement.')
  expect((f.store.get('api.toestand') as any)?.modus ?? 'abonnement').toBe('abonnement')
  expect(f.cli.modus).toBe('abonnement')
  expect(await ui.find({ type: 'Text', text: 'claude-or' })).toBeDefined()
  // Klaar en een ander Model 1 kiezen zet het meteen in het eigen bestand.
  await f.clock.settle()
  await ui.press({ key: 'or-model-1' } as any)
  await ui.press({ key: 'or-kies-0' } as any)
  // Het nieuwe model heeft nog geen meting: eerst meten, daarna pas in het eigen bestand.
  await f.clock.settle()
  expect(f.aanroepen.filter(a => a.args[1] === 'cachetest').map(a => a.args[3])).toEqual(['anthropic/claude-sonnet-4.5'])
  expect(f.modusAanroepen()[1]).toBe('openrouter --m1 anthropic/claude-sonnet-4.5[1m] --m4 openai/gpt-5-mini')
  await ui.unmount()
})

test('startcheck: ongemeten of zwak model komt niet in claude-or; de kaart zegt waarom; Gebruik nu toont de weigering', async ($, on) => {
  const goed = { oordeel: 'goed', aandeel: 80, raak: 5, van: 5, gemeten: 1 }
  const f = fake(on, {
    orKey: true,
    weiger: 'openai/gpt-5-mini is nog niet gemeten; niets klaargezet',
    store: { 'openrouter.keuze': { m1: 'openai/gpt-5', m4: 'openai/gpt-5-mini' }, 'openrouter.cache': { 'openai/gpt-5': goed } },
  })
  // Bij de sessiestart gaan de metingen uit de store naar de CLI (via stdin), één keer.
  await $.session.start(START)
  await f.clock.settle()
  const poort = f.aanroepen.filter(a => a.args[1] === 'poort')
  expect(poort.map(a => a.args.join(' '))).toEqual(['openrouter poort'])
  expect(JSON.parse(poort[0].stdin ?? '')).toEqual({ 'openai/gpt-5': goed })
  await run($, 'futureflow', 'openrouter')
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await ui.find({ type: 'Text', text: 'claude-or start niet met deze keuze: openai/gpt-5-mini is nog niet gemeten. Klik Meet cache (onder Meer).' })).toBeDefined()
  await ui.press({ key: 'or-naar' } as any)
  expect(f.toasts.at(-1)).toBe('claude-or niet klaargezet: openai/gpt-5-mini is nog niet gemeten; niets klaargezet. Kies een ander model of klik Meet cache.')
  // Zwak (vaste lijst): andere tekst, en na kiezen geen poging om klaar te zetten.
  f.store.set('openrouter.keuze', { m1: 'openai/gpt-5', m4: 'qwen/q-max' })
  f.cli.model = 'openai/gpt-5'
  await ui.press({ key: 'tab-wisselen' } as any)
  await f.clock.settle()
  expect(await ui.find({ type: 'Text', text: 'claude-or start niet met deze keuze: qwen/q-max cachet niet in een agent-lus. Kies een ander model.' })).toBeDefined()
  const voor = f.modusAanroepen().length
  await ui.press({ key: 'or-model-2' } as any)
  await (ui as any).input({ key: 'or-zoek', text: 'gpt-5-mini' } as any)
  await ui.press({ key: 'or-kies-0' } as any)
  await f.clock.settle()
  expect(f.modusAanroepen().length).toBe(voor)
  await ui.unmount()
})

test('zonder gekozen Model 1 start de sessie zonder poort-aanroep', async ($, on) => {
  const f = fake(on, { orKey: true })
  await $.session.start(START)
  await f.clock.settle()
  expect(f.aanroepen.filter(a => a.args[1] === 'poort')).toEqual([])
})

test('model met te weinig context: waarschuwing in de lijst en bij kiezen', async ($, on) => {
  const f = fake(on, { orKey: true, veel: true })
  await run($, 'futureflow', 'openrouter')
  await f.clock.settle()
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'meer-wisselen' } as any)
  await ui.press({ key: 'or-model-2' } as any)
  await (ui as any).input({ key: 'or-zoek', text: 'x/m-0' } as any)
  expect(await ui.find({ type: 'Text', text: 'te klein voor Claude Code' })).toBeDefined()
  await ui.press({ key: 'or-kies-0' } as any)
  expect(f.toasts.some(t => t.includes('x/m-0') && t.includes('te klein voor Claude Code'))).toBe(true)
  expect(await ui.find({ type: 'Text', text: /x\/m-0 heeft 128k context: te klein voor Claude Code/ })).toBeDefined()
  await ui.unmount()
})

test('Test verbinding: één aanroep met het snelle model, uitkomst in de tab', async ($, on) => {
  const f = fake(on, { orKey: true, test: { ok: false, status: 401, fout: 'User not found' }, store: { 'openrouter.keuze': { model: 'openai/gpt-5', snel: 'openai/gpt-5-mini' } } })
  await run($, 'futureflow', 'openrouter')
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'meer-wisselen' } as any)
  expect(f.aanroepen.filter(a => a.args[1] === 'test')).toEqual([])
  await ui.press({ key: 'or-test' } as any)
  const t = f.aanroepen.filter(a => a.args[1] === 'test')
  expect(t.map(a => a.args)).toEqual([['openrouter', 'test', '--model', 'openai/gpt-5-mini']])
  expect(await ui.find({ type: 'Text', text: /Verbinding werkt niet \(HTTP 401\): User not found/ })).toBeDefined()
  await ui.unmount()
})

test('Meet cache: één cachetest per gekozen model, uitslag in de kaart en bewaard; vaste waarschuwing voor qwen', async ($, on) => {
  const f = fake(on, {
    orKey: true,
    store: { 'openrouter.keuze': { m1: 'openai/gpt-5[1m]', m2: 'qwen/q-max', m4: 'openai/gpt-5-mini', m5: 'openai/gpt-5' } },
    cachetest: {
      'openai/gpt-5': { ok: true, model: 'openai/gpt-5', oordeel: 'goed', raak: 5, van: 5, aandeel: 78, rondes: [], aanbieders: ['OpenAI'], gemeten: 1 },
      'qwen/q-max': { ok: true, model: 'qwen/q-max', oordeel: 'zwak', raak: 0, van: 5, aandeel: 21, rondes: [], aanbieders: ['Alibaba'], gemeten: 1 },
    },
  })
  await run($, 'futureflow', 'openrouter')
  await f.clock.settle()
  const ui = await $.ui.mount(PANE('terminal'))
  // Vóór een meting: alleen de vaste waarschuwing, zonder percentage; nog geen aanroep.
  expect(await ui.find({ type: 'Text', text: 'qwen/q-max cachet niet in een agent-lus: duur in Claude Code.' })).toBeDefined()
  await ui.press({ key: 'meer-wisselen' } as any)
  expect(f.aanroepen.filter(a => a.args[1] === 'cachetest')).toEqual([])
  await ui.press({ key: 'or-cache' } as any)
  await f.clock.settle()
  // Elk gekozen model één keer, zonder [1m]; m1 en m5 zijn hetzelfde model.
  expect(f.aanroepen.filter(a => a.args[1] === 'cachetest').map(a => a.args[3])).toEqual(['openai/gpt-5', 'qwen/q-max', 'openai/gpt-5-mini'])
  expect(await ui.find({ type: 'Text', text: 'openai/gpt-5 cachet goed in een agent-lus (gemeten: 5 van 5 rondes raak, 78% uit cache).' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'qwen/q-max cachet niet in een agent-lus: duur in Claude Code (gemeten: 0 van 5 rondes raak, 21% uit cache).' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Cache niet gemeten: openai\/gpt-5-mini: Key limit exceeded/ })).toBeDefined()
  const bewaard = f.store.get('openrouter.cache') as Record<string, unknown>
  expect(Object.keys(bewaard)).toEqual(['openai/gpt-5', 'qwen/q-max'])
  expect(bewaard['qwen/q-max']).toEqual({ oordeel: 'zwak', aandeel: 21, raak: 0, van: 5, gemeten: NU })
  await ui.unmount()
})

test('een model kiezen meet zijn cache één keer vanzelf; een gemeten model niet opnieuw; zonder key niets', async ($, on) => {
  const f = fake(on, {
    orKey: true,
    cachetest: { 'openai/gpt-5-mini': { ok: true, model: 'openai/gpt-5-mini', oordeel: 'wisselend', raak: 3, van: 5, aandeel: 49, rondes: [], aanbieders: [], gemeten: 1 } },
  })
  await run($, 'futureflow', 'openrouter')
  await f.clock.settle()
  const ui = await $.ui.mount(PANE('terminal'))
  const kies = async (rij: number, zoek: string) => {
    await ui.press({ key: `or-model-${rij}` } as any)
    await (ui as any).input({ key: 'or-zoek', text: zoek } as any)
    await ui.press({ key: 'or-kies-0' } as any)
    await f.clock.settle()
  }
  await kies(1, 'gpt-5-mini')
  expect(f.aanroepen.filter(a => a.args[1] === 'cachetest').map(a => a.args[3])).toEqual(['openai/gpt-5-mini'])
  expect(await ui.find({ type: 'Text', text: 'openai/gpt-5-mini cachet wisselend: niet elke ronde raakt de cache (gemeten: 3 van 5 rondes raak, 49% uit cache).' })).toBeDefined()
  // Hetzelfde model in een andere rij: al gemeten, dus geen tweede meting.
  await kies(2, 'gpt-5-mini')
  expect(f.aanroepen.filter(a => a.args[1] === 'cachetest').length).toBe(1)
  await ui.unmount()
})

test('zonder key meet kiezen niets', async ($, on) => {
  const f = fake(on, { orKey: false })
  await run($, 'futureflow', 'openrouter')
  await f.clock.settle()
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'or-model-1' } as any)
  await (ui as any).input({ key: 'or-zoek', text: 'gpt-5-mini' } as any)
  await ui.press({ key: 'or-kies-0' } as any)
  await f.clock.settle()
  expect(f.aanroepen.filter(a => a.args[1] === 'cachetest')).toEqual([])
  await ui.unmount()
})

test('ketting: OpenRouter is alleen een melding (claude-or), één keer per venster; de modus blijft', async ($, on) => {
  const resetsAt = '2026-11-10T14:00:00Z'
  const toestand = { modus: 'abonnement', auto: true, hoog: 90, laag: 50, laatsteWissel: 0, stappen: ['openrouter'] }
  const f = fake(on, { orKey: true, store: { 'api.toestand': toestand } })
  await $.session.start(START)
  // Zonder key-stand en modellen: overgeslagen, en zonder API in de ketting gebeurt niets.
  await meet($, [{ kind: 'five_hour', percentUsed: 95, resetsAt }], f.clock)
  expect(f.modusAanroepen()).toEqual([])
  expect(f.toasts).toEqual([])
  f.store.set('openrouter.heeftKey', true)
  f.store.set('openrouter.keuze', { model: 'openai/gpt-5', snel: 'openai/gpt-5-mini' })
  await meet($, [{ kind: 'five_hour', percentUsed: 95, resetsAt }], f.clock)
  expect(f.modusAanroepen()).toEqual(['openrouter --m1 openai/gpt-5 --m4 openai/gpt-5-mini'])
  expect(f.toasts.filter(t => t.includes('claude-or'))).toHaveLength(1)
  expect(f.toasts[0]).toContain('andere sessies en de desktop-app blijven op je abonnement')
  const t = f.store.get('api.toestand') as any
  expect(t.modus).toBe('abonnement')
  expect(t.overgeschakeldDoor).toBeUndefined()
  expect(f.store.get('api.orGemeldTot')).toBe(Date.parse(resetsAt))
  expect(f.cli.modus).toBe('abonnement')
  // Zelfde venster nog vol: geen tweede melding.
  await f.clock.advance(10 * 60_000)
  await meet($, [{ kind: 'five_hour', percentUsed: 97, resetsAt }], f.clock)
  expect(f.toasts.filter(t => t.includes('claude-or'))).toHaveLength(1)
})

test('sessiestart met oude OpenRouter-regels in settings.json: futureflow ruimt ze op', async ($, on) => {
  const f = fake(on, { modus: 'openrouter', orKey: true })
  await $.session.start(START)
  await f.clock.settle()
  expect(f.aanroepen.some(a => a.args.join(' ') === 'openrouter opruimen')).toBe(true)
  expect(f.cli.modus).toBe('abonnement')
  expect(f.toasts.some(t => t.includes('Oude OpenRouter-regels uit ~/.claude/settings.json gehaald'))).toBe(true)
})

test('ketting: API zonder key wordt overgeslagen, door naar OpenRouter (auto blijft aan)', async ($, on) => {
  const toestand = { modus: 'abonnement', auto: true, hoog: 90, laag: 50, laatsteWissel: 0, stappen: ['api', 'openrouter'] }
  const f = fake(on, { orKey: true, store: { 'api.toestand': toestand } })
  await $.session.start(START)
  f.store.set('api.heeftKey', false)
  f.store.set('openrouter.heeftKey', true)
  f.store.set('openrouter.keuze', { model: 'openai/gpt-5', snel: 'openai/gpt-5-mini' })
  await meet($, [{ kind: 'five_hour', percentUsed: 95, resetsAt: '2026-11-10T14:00:00Z' }], f.clock)
  expect(f.modusAanroepen()).toEqual(['openrouter --m1 openai/gpt-5 --m4 openai/gpt-5-mini'])
  expect((f.store.get('api.toestand') as any).auto).toBe(true)
  expect((f.store.get('api.toestand') as any).modus).toBe('abonnement')
})

test('volgorde en stappen in de tab', async ($, on) => {
  const f = fake(on)
  await run($, 'futureflow', 'openrouter')
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'meer-wisselen' } as any)
  expect(await ui.find({ type: 'Button', key: 'wissel-volgorde' } as any)).toBeUndefined()
  await ui.press({ key: 'wissel-stap-openrouter' } as any)
  expect((f.store.get('api.toestand') as any).stappen).toEqual(['api', 'openrouter'])
  expect(f.toasts[0]).toContain('overgeslagen tot er een key en Model 1 is')
  await ui.press({ key: 'wissel-volgorde' } as any)
  expect((f.store.get('api.toestand') as any).stappen).toEqual(['openrouter', 'api'])
  expect(await ui.find({ type: 'Text', text: /^3\. OpenRouter — geen key$/ })).toBeDefined()
  await ui.press({ key: 'wissel-stap-api' } as any)
  expect((f.store.get('api.toestand') as any).stappen).toEqual(['openrouter'])
  await ui.unmount()
})

test('kosten tellen apart als deze sessie met claude-or draait', async ($, on) => {
  const usage = { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, model: 'openai/gpt-5' }
  const f = fake(on, { env: { ANTHROPIC_BASE_URL: 'https://openrouter.ai/api' }, orKey: true, store: { 'openrouter.prijzen': { 'openai/gpt-5': { in: 1.25, uit: 10 } }, 'openrouter.keuze': { model: 'openai/gpt-5', snel: 'openai/gpt-5-mini' } } })
  await $.session.start(START)
  await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, reason: 'answer', turnId: 't1', usage } as any)
  await f.clock.settle()
  const kosten = f.store.get('openrouter.kosten') as Record<string, number>
  const [bedrag] = Object.values(kosten)
  expect(Math.abs(bedrag! - (2000 * 1.25 + 2000 * 10) / 1e6)).toBeLessThan(1e-9)
  expect(f.store.get('api.kosten')).toBeUndefined()
})

test('lange lijst: bladeren met Volgende (n) en Vorige (p) tekent op de terminal', async ($, on) => {
  const f = fake(on, { veel: true })
  await run($, 'futureflow', 'openrouter')
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'meer-wisselen' } as any)
  await f.clock.settle()
  expect(await ui.find({ type: 'Text', text: /Pagina 1 van 3/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'or-volgende', hotkey: 'n' } as any)).toBeDefined()
  await ui.press({ key: 'or-volgende' } as any)
  expect(await ui.find({ type: 'Text', text: /Pagina 2 van 3/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'or-vorige', hotkey: 'p' } as any)).toBeDefined()
  await ui.unmount()
})

test('Model 2 en 5 kiezen en leegmaken; Gebruik nu geeft --m1 … --m5 mee', async ($, on) => {
  const f = fake(on, { orKey: true, store: { 'openrouter.keuze': { model: 'openai/gpt-5', snel: 'openai/gpt-5-mini' } } })
  await $.session.start(START)
  await run($, 'futureflow', 'openrouter')
  await f.clock.settle()
  const ui = await $.ui.mount(PANE('terminal'))
  // Oude keuze: hoofd → 1, snel → 4.
  expect(await ui.find({ type: 'Text', text: /2 · \/model sonnet \(leeg: Model 1\)/ })).toBeDefined()
  await ui.press({ key: 'or-model-2' } as any)
  await ui.press({ key: 'or-kies-0' } as any)
  await ui.press({ key: 'or-model-5' } as any)
  await ui.press({ key: 'or-kies-1' } as any)
  expect(f.store.get('openrouter.keuze')).toEqual({ m1: 'openai/gpt-5', m4: 'openai/gpt-5-mini', m2: 'anthropic/claude-sonnet-4.5[1m]', m5: 'openai/gpt-5' })
  await ui.press({ key: 'or-naar' } as any)
  expect(f.modusAanroepen().at(-1)).toBe('openrouter --m1 openai/gpt-5 --m2 anthropic/claude-sonnet-4.5[1m] --m4 openai/gpt-5-mini --m5 openai/gpt-5')
  await ui.press({ key: 'or-model-2' } as any)
  await ui.press({ key: 'or-leeg' } as any)
  expect(f.store.get('openrouter.keuze')).toEqual({ m1: 'openai/gpt-5', m4: 'openai/gpt-5-mini', m5: 'openai/gpt-5' })
  await ui.unmount()
})

test('oude of kapotte keuze in de store crasht de tab niet', async ($, on) => {
  const f = fake(on, { orKey: true })
  for (const keuze of [{ model: 'openai/gpt-5', snel: 'openai/gpt-5-mini' }, { model: 'openai/gpt-5', opus: 42, sonnet: null }, 'onzin', ['a/b']]) {
    f.store.set('openrouter.keuze', keuze)
    await run($, 'futureflow', 'openrouter')
    await f.clock.settle()
    const ui = await $.ui.mount(PANE('terminal'))
    await ui.press({ key: 'meer-wisselen' } as any)
    expect(await ui.find({ type: 'Text', text: /laden lukte niet/ })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'or-model-5' } as any)).toBeDefined()
    await ui.press({ key: 'meer-wisselen' } as any)
    await ui.unmount()
  }
})

test('0.17: keuze volgt het settings-bestand bij openen; 2-4 gelijk aan 1 = leeg; zonder bestand blijft de store', async ($, on) => {
  const f = fake(on, { orKey: true, store: { 'openrouter.keuze': { m1: 'oud/een', m2: 'oud/twee' } }, orRijen: { orM1: 'nieuw/een', orM2: 'nieuw/een', orM3: 'x/drie', orM4: 'nieuw/een', orM5: 'x/vijf' } })
  await run($, 'futureflow', 'wisselen')
  await f.clock.settle()
  expect(f.store.get('openrouter.keuze')).toEqual({ m1: 'nieuw/een', m3: 'x/drie', m5: 'x/vijf' })
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await ui.find({ type: 'Text', text: 'nieuw/een' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'x/drie' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'oud/twee' })).toBeUndefined()
  await ui.unmount()
})

test('0.17: zonder settings-bestand blijft de keuze in de store', async ($, on) => {
  const f = fake(on, { orKey: true, store: { 'openrouter.keuze': { m1: 'oud/een', m2: 'oud/twee' } } })
  await run($, 'futureflow', 'wisselen')
  await f.clock.settle()
  expect(f.store.get('openrouter.keuze')).toEqual({ m1: 'oud/een', m2: 'oud/twee' })
})

test('0.17: een model dat de proxy stopte, geeft één rode regel', async ($, on) => {
  const f = fake(on, { orKey: true, store: { 'openrouter.keuze': { m1: 'x/een' }, 'openrouter.cache': { 'x/een': { oordeel: 'goed', aandeel: 80, raak: 5, van: 5, gemeten: 1 } } }, orRijen: { orM1: 'x/een', orM2: 'x/een', orM3: 'x/een', orM4: 'x/een', orGestopt: ['x/een'] } })
  await run($, 'futureflow', 'wisselen')
  await f.clock.settle()
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await ui.find({ type: 'Text', text: /x\/een cachet niet in claude-or en is gestopt/ })).toBeDefined()
  await ui.unmount()
})

test('knop Logboek: alleen met de proxy en onder Meer; opent het adres in de terminal', async ($, on) => {
  const f = fake(on, { orKey: true, proxy: true })
  await run($, 'futureflow', '')
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'tab-wisselen' } as any)
  await f.clock.settle()
  expect(await ui.find({ type: 'Button', key: 'or-logboek' } as any)).toBeUndefined()
  await ui.press({ key: 'meer-wisselen' } as any)
  expect(await ui.find({ type: 'Button', key: 'or-logboek' } as any)).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /modellen kiezen, aanvragen en cache/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'or-logboek', label: 'Proxy' } as any)).toBeDefined()
  await ui.press({ key: 'or-logboek' } as any)
  await f.clock.settle()
  expect(f.geopend).toEqual([['/usr/bin/open', 'http://127.0.0.1:20817/']])
  expect(f.toasts.filter(t => t.startsWith('Logboek'))).toEqual([])
  await ui.unmount()
})

test('knop Logboek: zonder proxy geen knop', async ($, on) => {
  const f = fake(on, { orKey: true })
  await run($, 'futureflow', '')
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'tab-wisselen' } as any)
  await f.clock.settle()
  await ui.press({ key: 'meer-wisselen' } as any)
  expect(await ui.find({ type: 'Button', key: 'or-logboek' } as any)).toBeUndefined()
  await ui.unmount()
})

test('knop Logboek: zonder terminal of als open faalt een toast met het adres', async ($, on) => {
  const f = fake(on, { orKey: true, proxy: true, surfaces: ['desktop'] })
  await run($, 'futureflow', '')
  const ui = await $.ui.mount(PANE('desktop'))
  await ui.press({ key: 'tab-wisselen' } as any)
  await f.clock.settle()
  await ui.press({ key: 'meer-wisselen' } as any)
  await ui.press({ key: 'or-logboek' } as any)
  await f.clock.settle()
  expect(f.geopend).toEqual([])
  expect(f.toasts.at(-1)).toBe('Logboek: http://127.0.0.1:20817/')
  await ui.unmount()
})

test('knop Logboek: open faalt in de terminal: toast met het adres', async ($, on) => {
  const f = fake(on, { orKey: true, proxy: true, openFout: true })
  await run($, 'futureflow', '')
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'tab-wisselen' } as any)
  await f.clock.settle()
  await ui.press({ key: 'meer-wisselen' } as any)
  await ui.press({ key: 'or-logboek' } as any)
  await f.clock.settle()
  expect(f.geopend.length).toBe(1)
  expect(f.toasts.at(-1)).toBe('Logboek: http://127.0.0.1:20817/')
  await ui.unmount()
})
