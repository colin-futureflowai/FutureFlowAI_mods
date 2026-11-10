import { expect, mock, test } from 'claude-code/testing'

import { HELPER } from '../lib/api.mjs'

const NU = Date.parse('2026-11-09T12:00:00Z')
const KEY = 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ_abc-WXYZ'
const SLOTS = JSON.stringify({ memory: { freePercent: 40, totalGB: 16 }, config: { limits: { dev: 2 }, floorPercent: 25, criticalPercent: 10 }, slots: [], refusals: [] }) + '\n'

type Opties = { modus?: 'abonnement' | 'api'; heeftKey?: boolean; vreemd?: boolean; store?: Record<string, unknown>; rateLimits?: unknown[]; accountsJson?: unknown }

// Nep-omgeving met een nep-cli/api.mjs die zijn eigen stand bijhoudt; alle mocks vóór de eerste $-aanroep.
function fake(on: any, o: Opties = {}) {
  const clock = mock.clock(on, { now: NU })
  on('tool.register', () => ({ value: undefined }))
  const cli = { modus: o.modus ?? 'abonnement', heeftKey: o.heeftKey ?? false, staart: o.heeftKey ? 'WXYZ' : '', vreemd: o.vreemd ?? false }
  const aanroepen: Array<{ args: string[]; argv: string[]; stdin?: string }> = []
  const toasts: string[] = []
  const store = new Map<string, unknown>(Object.entries(o.store ?? {}))
  const state: unknown[] = []
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
  // settings.json zoals de nep-CLI hem zou schrijven: onze helper in modus api, of een andere.
  on('fs.read', ($: any, e: { path: string }) => ({
    value:
      e.path === '/home/t/.claude/futureflow/accounts/accounts.json' && o.accountsJson ? JSON.stringify(o.accountsJson)
      : e.path === '/home/t/.claude/settings.json' && (cli.vreemd || cli.modus === 'api') ? JSON.stringify({ apiKeyHelper: cli.vreemd ? '~/bin/eigen.sh' : HELPER }) : '',
  }))
  on('fs.write', ($: any, e: { text?: string }) => {
    state.push(e.text)
    return { value: undefined }
  })
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('command.register', () => ({ value: undefined }) as any)
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const envs: Array<Record<string, string> | undefined> = []
  const accInstellingen: unknown[] = []
  on('process.run', ($: any, e: { argv: string[]; init?: { stdin?: string; env?: Record<string, string> } }) => {
    const ok = (stdout: unknown) => ({ value: { exitCode: 0, stdout: JSON.stringify(stdout) + '\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const fout = (exitCode: number, stderr: string) => ({ value: { exitCode, stdout: '', stderr: `[api] ${stderr}\n`, isStdoutTruncated: false, isStderrTruncated: false } })
    // Nep-cli/accounts.mjs: alleen `instellingen` wordt onthouden.
    const j = e.argv.findIndex(a => a.endsWith('accounts.mjs'))
    if (j >= 0) {
      const aargs = e.argv.slice(j + 1)
      if (aargs[0] === 'instellingen') accInstellingen.push(JSON.parse(aargs[1]!))
      return { value: { exitCode: 0, stdout: JSON.stringify(aargs[0] === 'status' ? { accounts: [], instellingen: {} } : { ok: true }) + '\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    const i = e.argv.findIndex(a => a.endsWith('api.mjs'))
    if (i < 0) return { value: { exitCode: 0, stdout: SLOTS, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    const args = e.argv.slice(i + 1)
    const stdin = e.init?.stdin
    envs.push(e.init?.env)
    aanroepen.push({ args, argv: e.argv, stdin })
    if (args[0] === 'status') return ok({ heeftKey: cli.heeftKey, staart: cli.staart, modus: cli.vreemd ? 'abonnement' : cli.modus, vreemdeHelper: cli.vreemd })
    if (args[0] === 'zet-key') {
      cli.heeftKey = true
      cli.staart = (stdin ?? '').trim().slice(-4)
      return ok({ ok: true, staart: cli.staart })
    }
    if (args[0] === 'wis-key') {
      const gewist = cli.heeftKey
      cli.heeftKey = false
      cli.staart = ''
      return ok({ gewist })
    }
    if (args[0] === 'modus') {
      if (cli.vreemd) return fout(3, 'in /home/t/.claude/settings.json staat al een andere apiKeyHelper; futureflow laat die staan en wisselt niet')
      if (args[1] === 'api' && !cli.heeftKey) return fout(4, 'geen key in de sleutelhanger; bewaar eerst een key')
      const gewijzigd = cli.modus !== args[1]
      cli.modus = args[1] as 'abonnement' | 'api'
      return ok({ modus: cli.modus, gewijzigd })
    }
    return fout(1, 'gebruik')
  })
  const modusAanroepen = () => aanroepen.filter(a => a.args[0] === 'modus').map(a => a.args[1])
  return { cli, aanroepen, toasts, store, state, modusAanroepen, clock, envs, accountsInstellingen: () => accInstellingen }
}

const run = ($: any, command: string, args: string) =>
  $.command.run({ origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 }, command, args } as any)

const PANE = (surface: 'terminal' | 'desktop') =>
  ({ plugin: 'futureflow', surface, component: 'Pane', requestId: 'futureflow', props: {} }) as any

const START = { cwd: '/proj', surface: 'terminal', isInteractive: true } as any

// De wissel loopt los van de meting: daarna de event-loop laten uitlopen.
async function meet($: any, rateLimits: unknown[], clock: { settle(): Promise<void> }) {
  await $.session.measure({ context: { window: 200000 }, rateLimits, changed: ['rateLimits'] } as never)
  await clock.settle()
}

test('hotkey 6 opent de tab API met uitleg over terminal, desktop-app en connectors', async ($, on) => {
  fake(on)
  await run($, 'futureflow', '')
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await ui.find({ type: 'Button', key: 'tab-api', hotkey: '6' } as any)).toBeDefined()
  await ui.press({ key: 'tab-api' } as any)
  expect(await ui.find({ type: 'Input', key: 'api-key' } as any)).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /geen key/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /geldt voor nieuwe terminal-sessies/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /desktop-app regelt zijn eigen login/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /claude\.ai-connectors niet/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /zichtbaar tot je op Enter drukt; daarna bewaart futureflow alleen de laatste 4 tekens/ })).toBeDefined()
  for (const key of ['api-abonnement', 'api-api', 'wissel-auto']) expect(await ui.find({ type: 'Button', key } as any)).toBeDefined()
  for (const key of ['wissel-hoog', 'wissel-laag']) expect(await ui.find({ type: 'Input', key } as any)).toBeDefined()
  await ui.unmount()
})

test('verkeerde key: niets opgeslagen, één regel uitleg', async ($, on) => {
  const f = fake(on)
  await run($, 'futureflow', 'api')
  const ui = await $.ui.mount(PANE('terminal'))
  await (ui as any).input({ key: 'api-key', text: 'sk-proj-abcdefghijklmnopqrstuvwxyz0123' } as any)
  expect(f.aanroepen.filter(a => a.args[0] === 'zet-key')).toEqual([])
  expect(f.toasts).toEqual(['Dat is geen Anthropic API-key (die begint met sk-ant-); niets opgeslagen.'])
  expect(f.cli.heeftKey).toBe(false)
  await ui.unmount()
})

test('goede key: alleen via stdin naar de CLI, nergens anders; tab toont alleen de laatste 4', async ($, on) => {
  const f = fake(on)
  await run($, 'futureflow', 'api')
  const ui = await $.ui.mount(PANE('desktop'))
  await (ui as any).input({ key: 'api-key', text: `  ${KEY}\n` } as any)
  const zet = f.aanroepen.filter(a => a.args[0] === 'zet-key')
  expect(zet.length).toBe(1)
  expect(zet[0]!.argv.slice(0, 2)).toEqual(['/usr/bin/env', 'node'])
  expect(zet[0]!.stdin).toBe(KEY)
  for (const a of f.aanroepen) expect(a.argv.join(' ')).not.toContain(KEY)
  expect(f.toasts).toEqual(['Key bewaard in de sleutelhanger.'])
  expect(JSON.stringify([...f.store.entries()])).not.toContain(KEY)
  expect(JSON.stringify(f.state)).not.toContain(KEY)
  expect(f.toasts.join(' ')).not.toContain(KEY)
  expect(await ui.find({ type: 'Text', text: /sk-ant-…WXYZ/ })).toBeDefined()
  const boom = JSON.stringify(await ui.drawn())
  expect(boom).not.toContain(KEY)
  await ui.unmount()
})

test('knop API roept modus api aan, met toast over kosten, connectors en desktop-app', async ($, on) => {
  const f = fake(on, { heeftKey: true })
  await $.session.start(START)
  await run($, 'futureflow', 'api')
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'api-api' } as any)
  expect(f.modusAanroepen()).toEqual(['api'])
  expect(f.toasts.length).toBe(1)
  expect(f.toasts[0]).toContain('Naar API (met de hand)')
  expect(f.toasts[0]).toContain('claude.ai-connectors')
  expect(f.toasts[0]).toContain('desktop-app')
  expect((f.store.get('api.toestand') as any).modus).toBe('api')
  expect((f.store.get('api.toestand') as any).overgeschakeldDoor).toBeUndefined()
  // Terug met de hand.
  await ui.press({ key: 'api-abonnement' } as any)
  expect(f.modusAanroepen()).toEqual(['api', 'abonnement'])
  expect(f.toasts[1]).toContain('Terug naar het abonnement')
  await ui.unmount()
})

test('een andere apiKeyHelper: knop API wisselt niet en de tab legt het uit', async ($, on) => {
  const f = fake(on, { heeftKey: true, vreemd: true })
  await $.session.start(START)
  await run($, 'futureflow', 'api')
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await ui.find({ type: 'Text', text: /al een andere apiKeyHelper/ })).toBeDefined()
  await ui.press({ key: 'api-api' } as any)
  expect(f.toasts[0]).toContain('Niet gewisseld')
  expect(f.toasts[0]).toContain('andere apiKeyHelper')
  expect(f.cli.modus).toBe('abonnement')
  await ui.unmount()
})

test('auto-wissel bij 92% van het 5u-venster, met toast; binnen 5 min niet nog eens', async ($, on) => {
  const resetsAt = '2026-11-09T14:00:00Z'
  const f = fake(on, { heeftKey: true, store: { 'api.toestand': { modus: 'abonnement', auto: true, hoog: 90, laag: 50, laatsteWissel: 0 } } })
  await $.session.start(START)
  await meet($, [{ kind: 'five_hour', percentUsed: 92, resetsAt }], f.clock)
  expect(f.modusAanroepen()).toEqual(['api'])
  expect(f.toasts.length).toBe(1)
  expect(f.toasts[0]).toContain('Naar API (5u-venster op 92% (grens 90%))')
  const t = f.store.get('api.toestand') as any
  expect(t.modus).toBe('api')
  expect(t.overgeschakeldDoor).toEqual({ label: '5u', resetsAt: Date.parse(resetsAt) })
  expect(t.laatsteWissel).toBe(NU)
  // Deze sessie meet nog steeds hoog; geen nieuwe wissel.
  await meet($, [{ kind: 'five_hour', percentUsed: 95, resetsAt }], f.clock)
  expect(f.modusAanroepen()).toEqual(['api'])
})

test('terug naar het abonnement na de reset van het venster dat de wissel veroorzaakte', async ($, on) => {
  const f = fake(on, {
    heeftKey: true,
    modus: 'api',
    store: { 'api.toestand': { modus: 'api', auto: true, hoog: 90, laag: 50, laatsteWissel: NU - 3_600_000, overgeschakeldDoor: { label: '5u', resetsAt: NU - 1 } } },
  })
  await $.session.start(START)
  // Op de API meldt de sessie geen abonnementslimieten.
  await meet($, [], f.clock)
  expect(f.modusAanroepen()).toEqual(['abonnement'])
  expect(f.toasts[0]).toContain('Terug naar het abonnement (5u-venster is gereset)')
  expect((f.store.get('api.toestand') as any).overgeschakeldDoor).toBeUndefined()
})

test('binnen 5 min na een wissel geen nieuwe automatische wissel', async ($, on) => {
  const f = fake(on, { heeftKey: true, store: { 'api.toestand': { modus: 'abonnement', auto: true, hoog: 90, laag: 50, laatsteWissel: NU - 60_000 } } })
  await $.session.start(START)
  await meet($, [{ kind: 'seven_day', percentUsed: 97 }], f.clock)
  expect(f.modusAanroepen()).toEqual([])
  expect(f.toasts).toEqual([])
})

test('één schakelaar: zet API-auto én accounts-auto; de eerste keer één uitleg-toast', async ($, on) => {
  const f = fake(on)
  await $.session.start(START)
  await run($, 'futureflow', 'api')
  const ui = await $.ui.mount(PANE('terminal'))
  // Zonder key mag het: de ketting slaat de API dan over.
  await ui.press({ key: 'wissel-auto' } as any)
  expect((f.store.get('api.toestand') as any).auto).toBe(true)
  expect(f.accountsInstellingen()).toEqual([{ auto: true }])
  const uitleg = f.toasts.filter(t => t.startsWith('Automatisch wisselen staat aan. Bij de grens'))
  expect(uitleg.length).toBe(1)
  expect(uitleg[0]).toContain('kosten geld per token')
  expect(uitleg[0]).toContain('nieuwe terminal-sessies')
  await ui.press({ key: 'wissel-auto' } as any)
  expect((f.store.get('api.toestand') as any).auto).toBe(false)
  expect(f.accountsInstellingen()).toEqual([{ auto: true }, { auto: false }])
  await ui.press({ key: 'wissel-auto' } as any)
  expect(f.toasts.filter(t => t.startsWith('Automatisch wisselen staat aan. Bij de grens')).length).toBe(1)
  await ui.unmount()
})

test('een andere apiKeyHelper: de schakelaar gaat niet aan', async ($, on) => {
  const f = fake(on, { vreemd: true })
  await run($, 'futureflow', 'api')
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'wissel-auto' } as any)
  expect(f.toasts[0]).toContain('andere apiKeyHelper')
  expect(f.store.get('api.toestand')).toBeUndefined()
  expect(f.accountsInstellingen()).toEqual([])
  await ui.unmount()
})

test('grenzen: "wissel vanaf" zet de API-grens én beide marges; ongeldige waarden geweigerd', async ($, on) => {
  const f = fake(on)
  await run($, 'futureflow', 'api')
  const ui = await $.ui.mount(PANE('terminal'))
  await (ui as any).input({ key: 'wissel-hoog', text: '85' } as any)
  expect((f.store.get('api.toestand') as any).hoog).toBe(85)
  expect(f.accountsInstellingen()).toEqual([{ marge5u: 85, marge7d: 85 }])
  await (ui as any).input({ key: 'wissel-laag', text: '95' } as any)
  await (ui as any).input({ key: 'wissel-hoog', text: '40' } as any)
  await (ui as any).input({ key: 'wissel-hoog', text: '100' } as any)
  expect((f.store.get('api.toestand') as any).laag).toBe(50)
  expect((f.store.get('api.toestand') as any).hoog).toBe(85)
  expect(f.toasts.length).toBe(3)
  await (ui as any).input({ key: 'wissel-laag', text: '40' } as any)
  expect((f.store.get('api.toestand') as any).laag).toBe(40)
  expect(f.accountsInstellingen().length).toBe(1)
  expect(await ui.find({ type: 'Text', text: /Haalt je huidige abonnement 85% van het 5u- of 7d-venster/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /zodra het weer onder 40% zit of gereset is/ })).toBeDefined()
  await ui.unmount()
})

test('de kaart: alle vier stappen met hun stand, ← nu bij het abonnement', async ($, on) => {
  const f = fake(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 42 }, { kind: 'seven_day', percentUsed: 18 }] })
  await run($, 'futureflow', 'api')
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await ui.find({ type: 'Text', text: /^Je werkt nu op: / })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Abonnement$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^1\. Je abonnement — 5u 42% · 7d 18%$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^2\. Ander abonnement — geen tweede account \(uit\)$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^3\. Anthropic API — geen key$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^4\. OpenRouter — geen key \(uit\)$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /← nu/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Geldt voor nieuwe terminal-sessies\. Kies je zelf, dan blijft futureflow eraf tot de reset\./ })).toBeDefined()
  for (const key of ['wissel-auto', 'wissel-stap-account', 'wissel-stap-api', 'wissel-stap-openrouter']) expect(await ui.find({ type: 'Button', key } as any)).toBeDefined()
  // Stap account zonder schakelaar: eerst de schakelaar.
  await ui.press({ key: 'wissel-stap-account' } as any)
  expect(f.toasts).toEqual(['Zet eerst Automatisch wisselen aan.'])
  expect(f.accountsInstellingen()).toEqual([])
  await ui.press({ key: 'wissel-stap-api' } as any)
  expect((f.store.get('api.toestand') as any).stappen).toEqual([])
  expect(await ui.find({ type: 'Text', text: /^3\. Anthropic API — geen key \(uit\)$/ })).toBeDefined()
  await ui.unmount()
})

test('migratie: stond alleen accounts-auto aan, dan staat na de start ook API-auto aan', async ($, on) => {
  const f = fake(on, { accountsJson: { accounts: [], instellingen: { auto: true } } })
  await $.session.start(START)
  expect((f.store.get('api.toestand') as any).auto).toBe(true)
})

test('kosten tellen alleen als deze sessie op de API draait', async ($, on) => {
  const usage = { input_tokens: 2000, output_tokens: 2000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-4-6' }
  const f = fake(on, { heeftKey: true, modus: 'api' })
  await $.session.start(START)
  await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, reason: 'answer', turnId: 't1', usage } as any)
  await f.clock.settle()
  const kosten = f.store.get('api.kosten') as Record<string, number>
  const [bedrag] = Object.values(kosten)
  expect(Math.abs(bedrag! - (2000 * 5 + 2000 * 25) / 1e6)).toBeLessThan(1e-9)
  await run($, 'futureflow', 'api')
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await ui.find({ type: 'Text', text: /^\$ 0,06$/ })).toBeDefined()
  await ui.unmount()
})

test('op het abonnement geen kosten', async ($, on) => {
  const usage = { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }
  const f = fake(on, { heeftKey: true, modus: 'abonnement' })
  await $.session.start(START)
  await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, reason: 'answer', turnId: 't1', usage } as any)
  await f.clock.settle()
  expect(f.store.get('api.kosten')).toBeUndefined()
})

test('auto-wissel na een beurt loopt los van de beurt: turn.complete wacht niet op de CLI', async ($, on) => {
  const resetsAt = '2026-11-09T14:00:00Z'
  const f = fake(on, {
    heeftKey: true,
    rateLimits: [{ kind: 'five_hour', percentUsed: 95, resetsAt }],
    store: { 'api.toestand': { modus: 'abonnement', auto: true, hoog: 90, laag: 50, laatsteWissel: 0 } },
  })
  await $.session.start(START)
  await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, reason: 'answer', turnId: 't1' } as any)
  await f.clock.settle()
  expect(f.modusAanroepen()).toEqual(['api'])
})

test('met de hand terug naar het abonnement terwijl auto aan staat: auto wacht tot de reset; de tab zegt het', async ($, on) => {
  const resetsAt = '2026-11-09T14:00:00Z'
  const f = fake(on, {
    heeftKey: true,
    modus: 'api',
    rateLimits: [{ kind: 'seven_day', percentUsed: 93, resetsAt }],
    store: { 'api.toestand': { modus: 'api', auto: true, hoog: 90, laag: 50, laatsteWissel: NU - 3_600_000, overgeschakeldDoor: { label: '7d', resetsAt: Date.parse(resetsAt) } } },
  })
  await $.session.start(START)
  await run($, 'futureflow', 'api')
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'api-abonnement' } as any)
  expect(f.modusAanroepen()).toEqual(['abonnement'])
  const t = f.store.get('api.toestand') as any
  expect(t.handmatigTot).toBe(Date.parse(resetsAt))
  expect(await ui.find({ type: 'Text', text: /Met de hand gekozen: automatisch wisselen wacht tot/ })).toBeDefined()
  // 10 min later nog steeds 93%: geen wissel terug naar API.
  await f.clock.advance(10 * 60_000)
  await meet($, [{ kind: 'seven_day', percentUsed: 93, resetsAt }], f.clock)
  expect(f.modusAanroepen()).toEqual(['abonnement'])
  // Auto uit- en aanzetten beëindigt de keuze met de hand: dan wel weer naar API.
  await ui.press({ key: 'wissel-auto' } as any)
  await ui.press({ key: 'wissel-auto' } as any)
  await f.clock.settle()
  expect((f.store.get('api.toestand') as any).handmatigTot).toBeUndefined()
  expect(f.modusAanroepen()).toEqual(['abonnement', 'api'])
  await ui.unmount()
})

test('met de hand naar API terwijl auto aan staat: auto zet het niet terug', async ($, on) => {
  const f = fake(on, { heeftKey: true, store: { 'api.toestand': { modus: 'abonnement', auto: true, hoog: 90, laag: 50, laatsteWissel: 0 } } })
  await $.session.start(START)
  await run($, 'futureflow', 'api')
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'api-api' } as any)
  expect(await ui.find({ type: 'Text', text: /Met de hand op API: automatisch wisselen zet dit niet terug/ })).toBeDefined()
  // Voorbij de wachttijd van 5 min, venster ver onder de grens: toch geen wissel terug.
  await f.clock.advance(6 * 60_000)
  await meet($, [{ kind: 'five_hour', percentUsed: 5 }], f.clock)
  expect(f.modusAanroepen()).toEqual(['api'])
  await ui.unmount()
})

test('de CLI krijgt een vaste env: SECURITY_BIN en SETTINGS_JSON uit de sessie komen er niet in', async ($, on) => {
  const f = fake(on)
  await run($, 'futureflow', 'api')
  const ui = await $.ui.mount(PANE('terminal'))
  await (ui as any).input({ key: 'api-key', text: KEY } as any)
  await ui.unmount()
  expect(f.envs.length).toBeGreaterThan(1)
  for (const env of f.envs) {
    expect(env?.SECURITY_BIN).toBe('/usr/bin/security')
    expect(env?.SETTINGS_JSON).toBe('')
    expect(env?.CLAUDE_JSON).toBe('')
  }
})
