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
type Opties = { modus?: Modus; orKey?: boolean; store?: Record<string, unknown>; rateLimits?: unknown[]; test?: unknown }

// Nep-omgeving met een nep-cli/api.mjs; alle mocks vóór de eerste $-aanroep.
function fake(on: any, o: Opties = {}) {
  const clock = mock.clock(on, { now: NU })
  on('tool.register', () => ({ value: undefined }))
  const cli = { modus: (o.modus ?? 'abonnement') as Modus, orKey: o.orKey ?? false, model: undefined as string | undefined }
  const aanroepen: Array<{ args: string[]; argv: string[]; stdin?: string }> = []
  const toasts: string[] = []
  const store = new Map<string, unknown>(Object.entries(o.store ?? {}))
  on('store.get', ($: any, e: { key: string }) => ({ value: store.get(e.key) }))
  on('store.set', ($: any, e: { key: string; value: unknown }) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('env.get', ($: any, e: { name: string }) => ({ value: ({ HOME: '/home/t', PATH: '/usr/bin' } as Record<string, string>)[e.name] }))
  on('session.id', () => ({ value: 'sessie-1' }))
  on('session.cwd', () => ({ value: '/proj' }))
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
  on('process.run', ($: any, e: { argv: string[]; init?: { stdin?: string; env?: Record<string, string> } }) => {
    const ok = (stdout: unknown) => ({ value: { exitCode: 0, stdout: JSON.stringify(stdout) + '\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const fout = (exitCode: number, stderr: string) => ({ value: { exitCode, stdout: '', stderr: `[api] ${stderr}\n`, isStdoutTruncated: false, isStderrTruncated: false } })
    const i = e.argv.findIndex(a => a.endsWith('api.mjs'))
    if (i < 0) return { value: { exitCode: 0, stdout: SLOTS, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    const args = e.argv.slice(i + 1)
    const stdin = e.init?.stdin
    envs.push(e.init?.env)
    aanroepen.push({ args, argv: e.argv, stdin })
    if (args[0] === 'status') {
      return ok({ heeftKey: false, staart: '', modus: cli.modus, vreemdeHelper: false, vreemdeBasis: false, orHeeftKey: cli.orKey, orStaart: cli.orKey ? 'QRST' : '', ...(cli.model ? { orModel: cli.model } : {}) })
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
    if (args[0] === 'openrouter' && args[1] === 'modellen') return ok({ modellen: MODELLEN, opgehaald: NU, uitCache: args[2] !== '--ververs' })
    if (args[0] === 'openrouter' && args[1] === 'test') return ok(o.test ?? { ok: true, status: 200 })
    if (args[0] === 'modus') {
      if (args[1] === 'openrouter' && !cli.orKey) return fout(4, 'geen OpenRouter-key in de sleutelhanger; bewaar eerst een key')
      if (args[1] === 'api') return fout(4, 'geen key in de sleutelhanger; bewaar eerst een key')
      const model = args[1] === 'openrouter' ? args[args.indexOf('--model') + 1] : undefined
      const gewijzigd = cli.modus !== args[1] || cli.model !== model
      cli.modus = args[1] as Modus
      cli.model = model
      return ok({ modus: cli.modus, gewijzigd })
    }
    return fout(1, 'gebruik')
  })
  const modusAanroepen = () => aanroepen.filter(a => a.args[0] === 'modus').map(a => a.args.slice(1).join(' '))
  return { cli, aanroepen, toasts, store, modusAanroepen, clock, envs }
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

test('hotkey 8 opent de tab OpenRouter: waarschuwingen, Claude-groep eerst, prijzen per Mtok', async ($, on) => {
  const f = fake(on)
  await run($, 'futureflow', '')
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await ui.find({ type: 'Button', key: 'tab-openrouter', hotkey: '8' } as any)).toBeDefined()
  await ui.press({ key: 'tab-openrouter' } as any)
  await f.clock.settle()
  expect(await ui.find({ type: 'Input', key: 'or-key' } as any)).toBeDefined()
  expect(await ui.find({ type: 'Input', key: 'or-zoek' } as any)).toBeDefined()
  for (const tekst of [/werken niet gegarandeerd/, /Webzoeken werkt niet/, /nieuwe terminal-sessies/, /claude\.ai-connectors niet/]) {
    expect(await ui.find({ type: 'Text', text: tekst })).toBeDefined()
  }
  expect(await ui.find({ type: 'Text', text: 'Claude via OpenRouter' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\$3 in \/ \$15 uit per Mtok/ })).toBeDefined()
  // De eerste rij is het Claude-model.
  expect(await ui.find({ type: 'Text', text: 'anthropic/claude-sonnet-4.5' })).toBeDefined()
  const hoofd0 = await ui.find({ type: 'Button', key: 'or-hoofd-0' } as any)
  expect(hoofd0).toBeDefined()
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

test('zoeken filtert; Hoofd en Snel kiezen bewaart de keuze en de prijzen', async ($, on) => {
  const f = fake(on)
  await run($, 'futureflow', 'openrouter')
  await f.clock.settle()
  const ui = await $.ui.mount(PANE('terminal'))
  await (ui as any).input({ key: 'or-zoek', text: 'mini' } as any)
  expect(await ui.find({ type: 'Text', text: 'openai/gpt-5-mini' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'anthropic/claude-sonnet-4.5' })).toBeUndefined()
  await ui.press({ key: 'or-snel-0' } as any)
  await (ui as any).input({ key: 'or-zoek', text: '' } as any)
  await ui.press({ key: 'or-hoofd-0' } as any)
  expect(f.store.get('openrouter.keuze')).toEqual({ snel: 'openai/gpt-5-mini', model: 'anthropic/claude-sonnet-4.5' })
  expect(f.store.get('openrouter.prijzen')).toEqual({ 'openai/gpt-5-mini': { in: 0.25, uit: 2 }, 'anthropic/claude-sonnet-4.5': { in: 3, uit: 15 } })
  expect(await ui.find({ type: 'Text', text: /Hoofdmodel: anthropic\/claude-sonnet-4\.5/ })).toBeDefined()
  // Nog niet op OpenRouter: kiezen wisselt niet.
  expect(f.modusAanroepen()).toEqual([])
  await ui.unmount()
})

test('wisselen met de hand: zonder modellen een uitleg, met modellen modus openrouter met --model en --snel', async ($, on) => {
  const f = fake(on, { orKey: true })
  await $.session.start(START)
  await run($, 'futureflow', 'openrouter')
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'or-naar' } as any)
  expect(f.modusAanroepen()).toEqual([])
  expect(f.toasts[0]).toContain('kies eerst een hoofdmodel en een snel model')
  f.store.set('openrouter.keuze', { model: 'openai/gpt-5', snel: 'openai/gpt-5-mini' })
  await ui.press({ key: 'or-naar' } as any)
  expect(f.modusAanroepen()).toEqual(['openrouter --model openai/gpt-5 --snel openai/gpt-5-mini'])
  expect(f.toasts[1]).toContain('Naar OpenRouter (met de hand)')
  expect(f.toasts[1]).toContain('webzoeken')
  expect(f.toasts[1]).toContain('claude.ai-connectors')
  expect((f.store.get('api.toestand') as any).modus).toBe('openrouter')
  // Op OpenRouter een ander hoofdmodel kiezen zet het meteen.
  await f.clock.settle()
  await ui.press({ key: 'or-hoofd-0' } as any)
  expect(f.modusAanroepen()[1]).toBe('openrouter --model anthropic/claude-sonnet-4.5 --snel openai/gpt-5-mini')
  await ui.press({ key: 'or-abonnement' } as any)
  expect(f.modusAanroepen()[2]).toBe('abonnement')
  await ui.unmount()
})

test('Test verbinding: één aanroep met het snelle model, uitkomst in de tab', async ($, on) => {
  const f = fake(on, { orKey: true, test: { ok: false, status: 401, fout: 'User not found' }, store: { 'openrouter.keuze': { model: 'openai/gpt-5', snel: 'openai/gpt-5-mini' } } })
  await run($, 'futureflow', 'openrouter')
  const ui = await $.ui.mount(PANE('terminal'))
  expect(f.aanroepen.filter(a => a.args[1] === 'test')).toEqual([])
  await ui.press({ key: 'or-test' } as any)
  const t = f.aanroepen.filter(a => a.args[1] === 'test')
  expect(t.map(a => a.args)).toEqual([['openrouter', 'test', '--model', 'openai/gpt-5-mini']])
  expect(await ui.find({ type: 'Text', text: /Verbinding werkt niet \(HTTP 401\): User not found/ })).toBeDefined()
  await ui.unmount()
})

test('ketting: OpenRouter eerst, alleen met key en modellen; terug na de reset', async ($, on) => {
  const resetsAt = '2026-11-10T14:00:00Z'
  const toestand = { modus: 'abonnement', auto: true, hoog: 90, laag: 50, laatsteWissel: 0, stappen: ['openrouter'] }
  const f = fake(on, { orKey: true, store: { 'api.toestand': toestand } })
  await $.session.start(START)
  // Zonder key-stand en modellen: overgeslagen, en zonder API in de ketting gebeurt niets.
  await meet($, [{ kind: 'five_hour', percentUsed: 95, resetsAt }], f.clock)
  expect(f.modusAanroepen()).toEqual([])
  f.store.set('openrouter.heeftKey', true)
  f.store.set('openrouter.keuze', { model: 'openai/gpt-5', snel: 'openai/gpt-5-mini' })
  await meet($, [{ kind: 'five_hour', percentUsed: 95, resetsAt }], f.clock)
  expect(f.modusAanroepen()).toEqual(['openrouter --model openai/gpt-5 --snel openai/gpt-5-mini'])
  const t = f.store.get('api.toestand') as any
  expect(t.modus).toBe('openrouter')
  expect(t.overgeschakeldDoor).toEqual({ label: '5u', resetsAt: Date.parse(resetsAt) })
  // Na de reset (en na de wachttijd) terug.
  f.store.set('api.toestand', { ...t, laatsteWissel: NU - 10 * 60_000, overgeschakeldDoor: { label: '5u', resetsAt: NU - 1 } })
  await meet($, [], f.clock)
  expect(f.modusAanroepen()[1]).toBe('abonnement')
})

test('ketting: API zonder key wordt overgeslagen, door naar OpenRouter (auto blijft aan)', async ($, on) => {
  const toestand = { modus: 'abonnement', auto: true, hoog: 90, laag: 50, laatsteWissel: 0, stappen: ['api', 'openrouter'] }
  const f = fake(on, { orKey: true, store: { 'api.toestand': toestand } })
  await $.session.start(START)
  f.store.set('api.heeftKey', false)
  f.store.set('openrouter.heeftKey', true)
  f.store.set('openrouter.keuze', { model: 'openai/gpt-5', snel: 'openai/gpt-5-mini' })
  await meet($, [{ kind: 'five_hour', percentUsed: 95, resetsAt: '2026-11-10T14:00:00Z' }], f.clock)
  expect(f.modusAanroepen()).toEqual(['openrouter --model openai/gpt-5 --snel openai/gpt-5-mini'])
  expect((f.store.get('api.toestand') as any).auto).toBe(true)
})

test('volgorde en stappen in de tab', async ($, on) => {
  const f = fake(on)
  await run($, 'futureflow', 'openrouter')
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await ui.find({ type: 'Button', key: 'or-volgorde' } as any)).toBeUndefined()
  await ui.press({ key: 'or-stap-openrouter' } as any)
  expect((f.store.get('api.toestand') as any).stappen).toEqual(['api', 'openrouter'])
  expect(f.toasts[0]).toContain('overgeslagen tot er een key en beide modellen zijn')
  await ui.press({ key: 'or-volgorde' } as any)
  expect((f.store.get('api.toestand') as any).stappen).toEqual(['openrouter', 'api'])
  expect(await ui.find({ type: 'Text', text: /2\. OpenRouter/ })).toBeDefined()
  await ui.press({ key: 'or-stap-api' } as any)
  expect((f.store.get('api.toestand') as any).stappen).toEqual(['openrouter'])
  await ui.unmount()
})

test('kosten tellen apart als deze sessie op OpenRouter draait', async ($, on) => {
  const usage = { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, model: 'openai/gpt-5' }
  const f = fake(on, { modus: 'openrouter', orKey: true, store: { 'openrouter.prijzen': { 'openai/gpt-5': { in: 1.25, uit: 10 } }, 'openrouter.keuze': { model: 'openai/gpt-5', snel: 'openai/gpt-5-mini' } } })
  await $.session.start(START)
  await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, reason: 'answer', turnId: 't1', usage } as any)
  await f.clock.settle()
  const kosten = f.store.get('openrouter.kosten') as Record<string, number>
  const [bedrag] = Object.values(kosten)
  expect(Math.abs(bedrag! - (2000 * 1.25 + 2000 * 10) / 1e6)).toBeLessThan(1e-9)
  expect(f.store.get('api.kosten')).toBeUndefined()
})
