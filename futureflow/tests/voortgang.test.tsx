import type { On, RenderElement } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// Wat Claude Code tekent waar de mod een rij teruggeeft.
const STOCK: RenderElement = { type: 'Text', props: {}, children: ['stock row'] }

const SITE = { plugin: 'futureflow', viewport: { columns: 100, rows: 30 } } as const

const BAND = (surface: 'terminal' | 'desktop' = 'terminal', hasSurvey = false) =>
  ({
    ...SITE,
    surface,
    component: 'AbovePrompt',
    requestId: 'band',
    props: { hasSurvey, isWorking: true, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} },
  }) as any

const PANE = (surface: 'terminal' | 'desktop') =>
  ({ plugin: 'futureflow', surface, component: 'Pane', requestId: 'futureflow', props: {} }) as any

// Nep-omgeving; alle mocks vóór de eerste $-aanroep. `skin` kiest de skin (standaard futureflow).
function fake(on: On, o: { skin?: string } = {}) {
  const clock = mock.clock(on, { now: 100_000 })
  const store = new Map<string, unknown>()
  if (o.skin) store.set('skins.prefs', { skin: o.skin })
  const toasts: string[] = []
  on('session.id', () => ({ value: 'sessie-1' }))
  on('session.cwd', () => ({ value: '/work' }))
  on('env.get', () => ({ value: undefined }))
  on('fs.read', () => ({ value: '' }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', ($: any, e: { text: string }) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('store.get', ($: any, e: { key: string }) => ({ value: store.get(e.key) }))
  on('store.set', ($: any, e: { key: string; value: unknown }) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '{"ok":true}\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, percent: 42 }, rateLimits: [{ kind: 'five_hour', percentUsed: 18 }] } }))
  on('ui.render', () => STOCK)
  on('prompt.submit', ($: any, e: any) => e)
  // Voor session.start: de skin laadt dan zijn voorkeuren uit de store.
  on('session.start', ($: any, e: any) => e)
  on('command.register', () => ({ value: undefined }) as any)
  on('tool.register', () => ({ value: undefined }) as any)
  on('config.list', () => ({ value: [] }))
  // De tools zelf: TaskCreate geeft een id terug, de rest een leeg antwoord.
  let id = 0
  on('tool.call', ($: any, e: any) => {
    if (e.subject === 'Mislukt') return { isError: true, result: 'fout', text: 'fout' }
    if (e.tool === 'TaskCreate') return { result: { task: { id: String(++id), subject: e.subject } } }
    if (e.tool === 'mcp__ccd_turn__update_plan') return { result: [{ type: 'text', text: 'ok' }] }
    return { result: { success: true, taskId: e.taskId ?? '', updatedFields: [] } }
  })
  return { clock, store, toasts }
}

type Found = { props?: Record<string, unknown>; children?: readonly unknown[] } | undefined

// `find` vindt de hele regel; de kleur van een deel lees je uit zijn kinderen.
function kleurVan(rij: Found, tekst: string): unknown {
  for (const kind of rij?.children ?? []) {
    const el = kind as Found
    if (el?.children?.[0] === tekst) return el.props?.color
    const binnen = kleurVan(el, tekst)
    if (binnen !== undefined) return binnen
  }
  return undefined
}

const START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as any

const run = ($: any, command: string, args: string) =>
  $.command.run({ origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 }, command, args } as any)

async function drieTaken($: any) {
  for (const subject of ['Lib schrijven', 'Hook bouwen', 'Tests draaien']) {
    await $.tool.call({ tool: 'TaskCreate', subject, description: '' } as any)
  }
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' } as any)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'in_progress' } as any)
}

test('TaskCreate×3 + TaskUpdate: de balk toont 33% en de huidige stap', async ($, on) => {
  fake(on)
  await drieTaken($)
  const ui = await $.ui.mount(BAND('terminal'))
  expect(await ui.find({ type: 'Text', text: /FutureFlowAI ▰▱▱ 33%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▸ 2\/3 Hook bouwen/ })).toBeDefined()
  expect(await ui.find({ key: 'voortgang-wissel' } as any)).toBeDefined()
  // De rij komt erbij; wat eronder tekent blijft staan.
  expect(await ui.find({ type: 'Text', text: 'stock row' })).toBeDefined()
  await ui.unmount()
})

test('"AI" staat in de accentkleur van de skin (noir: ok is #ededed of licht #151515)', async ($, on) => {
  fake(on, { skin: 'noir' })
  await $.session.start(START)
  await drieTaken($)
  const ui = await $.ui.mount(BAND('desktop'))
  const kleur = kleurVan((await ui.find({ type: 'Text', text: /FutureFlowAI/ })) as Found, 'AI')
  expect(['#ededed', '#151515']).toContain(kleur)
  await ui.unmount()
})

test('update_plan-invoer werkt ook', async ($, on) => {
  fake(on)
  const items = ['Kijken', 'Bouwen', 'Testen', 'Commit'].map((content, i) => ({ content, status: i === 0 ? 'in_progress' : 'pending' }))
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', items, scope: 'first_task' } as any)
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', advance: true } as any)
  const ui = await $.ui.mount(BAND('terminal'))
  expect(await ui.find({ type: 'Text', text: /25%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▸ 2\/4 Bouwen/ })).toBeDefined()
  await ui.unmount()
})

test('TodoWrite-invoer werkt ook', async ($, on) => {
  fake(on)
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Een', status: 'completed', activeForm: '' },
      { content: 'Twee', status: 'pending', activeForm: '' },
    ],
  } as any)
  const ui = await $.ui.mount(BAND('terminal'))
  expect(await ui.find({ type: 'Text', text: /50%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▸ 2\/2 Twee/ })).toBeDefined()
  await ui.unmount()
})

test('/futureflow balk klapt uit: doel, alle stappen en de telling; nog eens klapt in', async ($, on) => {
  const { store, clock } = fake(on)
  await $.prompt.submit({ text: 'Bouw de voortgangsbalk\nmet tests' } as any)
  await drieTaken($)
  await clock.advance(3 * 60_000)
  const r = await run($, 'futureflow', 'balk')
  expect(r.text).toContain('uitgeklapt')
  expect(store.get('voortgang.open')).toBe(true)
  const ui = await $.ui.mount(BAND('terminal'))
  expect(await ui.find({ type: 'Text', text: /^Bouw de voortgangsbalk$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✓ Lib schrijven/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▸ Hook bouwen/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /○ Tests draaien/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '1 klaar · 1 bezig · 1 te gaan · 3 min bezig' })).toBeDefined()
  await ui.unmount()
  const r2 = await run($, 'futureflow', 'balk')
  expect(r2.text).toContain('ingeklapt')
  expect(store.get('voortgang.open')).toBe(false)
})

test('knop voortgang-wissel (hotkey v) klapt uit en in', async ($, on) => {
  fake(on)
  await drieTaken($)
  const ui = await $.ui.mount(BAND('terminal'))
  const knop = (await ui.find({ key: 'voortgang-wissel' } as any)) as { props: { hotkey?: string } } | undefined
  expect(knop?.props.hotkey).toBe('v')
  expect(await ui.find({ type: 'Text', text: /○ Tests draaien/ })).toBeUndefined()
  await ui.press({ key: 'voortgang-wissel' } as any)
  expect(await ui.find({ type: 'Text', text: /○ Tests draaien/ })).toBeDefined()
  await ui.press({ key: 'voortgang-wissel' } as any)
  expect(await ui.find({ type: 'Text', text: /○ Tests draaien/ })).toBeUndefined()
  await ui.unmount()
})

test('bij 100% nog 5 s een ✓-regel, daarna geen rij', async ($, on) => {
  const { clock } = fake(on)
  await $.prompt.submit({ text: 'Klusje' } as any)
  await drieTaken($)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'completed' } as any)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '3', status: 'completed' } as any)
  const ui = await $.ui.mount(BAND('terminal'))
  expect(await ui.find({ type: 'Text', text: /✓ Klusje: klaar/ })).toBeDefined()
  await clock.advance(4000)
  expect(await ui.find({ type: 'Text', text: /✓ Klusje: klaar/ })).toBeDefined()
  await clock.advance(1000)
  expect(await ui.find({ type: 'Text', text: /Klusje/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /FutureFlowAI/ })).toBeUndefined()
  await ui.unmount()
})

test('zonder takenlijst geen rij', async ($, on) => {
  fake(on)
  const ui = await $.ui.mount(BAND('terminal'))
  expect(await ui.find({ key: 'voortgang-wissel' } as any)).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /FutureFlowAI/ })).toBeUndefined()
  await ui.unmount()
})

test('skin uit: de voortgangsrij tekent toch, in de kleuren van FutureFlowAI', async ($, on) => {
  fake(on, { skin: 'off' })
  await $.session.start(START)
  await drieTaken($)
  const ui = await $.ui.mount(BAND('terminal'))
  expect(await ui.find({ type: 'Text', text: /33%/ })).toBeDefined()
  expect(kleurVan((await ui.find({ type: 'Text', text: /FutureFlowAI/ })) as Found, 'AI')).toBe('#3fbf35')
  expect(await ui.find({ type: 'Text', text: 'stock row' })).toBeDefined()
  await ui.unmount()
})

test('een enquête houdt de balk: geen voortgangsrij', async ($, on) => {
  fake(on)
  await drieTaken($)
  const ui = await $.ui.mount(BAND('terminal', true))
  expect(await ui.find({ type: 'Text', text: /33%/ })).toBeUndefined()
  await ui.unmount()
})

test('een mislukte of geweigerde aanroep verandert de lijst niet', async ($, on) => {
  fake(on)
  await drieTaken($)
  await $.tool.call({ tool: 'TaskCreate', subject: 'Mislukt', description: '' } as any)
  const ui = await $.ui.mount(BAND('terminal'))
  expect(await ui.find({ type: 'Text', text: /▰▱▱ 33%/ })).toBeDefined()
  await ui.unmount()
})

test('rommelige invoer crasht niet en geeft geen toast', async ($, on) => {
  const { toasts } = fake(on)
  await $.tool.call({ tool: 'TodoWrite', todos: 'geen lijst' } as any)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '99', status: 'completed' } as any)
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', done: 'x' } as any)
  const ui = await $.ui.mount(BAND('terminal'))
  expect(await ui.find({ key: 'voortgang-wissel' } as any)).toBeUndefined()
  await ui.unmount()
  expect(toasts).toEqual([])
})

test('dashboard Overzicht toont de lijst uitgeklapt', async ($, on) => {
  fake(on)
  await drieTaken($)
  await run($, 'futureflow', '')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(PANE(surface))
    expect(await ui.find({ type: 'Text', text: /✓ Lib schrijven/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 klaar · 1 bezig · 1 te gaan/ })).toBeDefined()
    await ui.unmount()
  }
})
