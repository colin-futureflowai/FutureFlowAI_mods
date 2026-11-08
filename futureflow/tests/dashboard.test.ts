import { expect, mock, test } from 'claude-code/testing'

const CLI = { stdout: JSON.stringify({ memory: { freePercent: 40, totalGB: 16 }, config: { limits: { dev: 2 }, floorPercent: 25, criticalPercent: 10 }, slots: [], refusals: [] }) + '\n' }

const WRITES: string[] = []

// Nep-omgeving: geen oude plugins, neppe CLI, en een ui.open die we kunnen afluisteren.
function fake(on: any) {
  const opened: Array<{ id: string; title?: string }> = []
  on('env.get', ($: any, e: { name: string }) => ({ value: e.name === 'HOME' ? '/home/t' : undefined }))
  on('session.id', () => ({ value: 'sessie-1' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('fs.write', ($: any, e: { path: string }) => { WRITES.push(e.path); return { value: undefined } })
  on('fs.exists', () => ({ value: false }))
  on('session.start', ($: any, e: any) => e)
  on('command.register', () => ({ value: undefined }) as any)
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', ($: any, e: { id: string; title?: string }) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })
  mock.clock(on)
  on('process.run', () => ({ value: { exitCode: 0, stdout: CLI.stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  return { opened }
}

const START = { cwd: '/r', surface: 'terminal', isInteractive: true } as any

const run = ($: any, command: string, args: string) =>
  $.command.run({ origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 }, command, args } as any)

const PANE = (surface: 'terminal' | 'desktop') =>
  ({ plugin: 'futureflow', surface, component: 'Pane', requestId: 'futureflow', props: {} }) as any

test('/futureflow opent het paneel op overzicht', async ($, on) => {
  const f = fake(on)
  await run($, 'futureflow', '')
  expect(f.opened[0]!.id).toBe('futureflow')
  expect(f.opened[0]!.title).toBe('FutureFlowAI')
  const ui = await $.ui.mount(PANE('desktop'))
  expect(await ui.find({ type: 'Text', text: /Komt in de volgende stap/ })).toBeDefined()
  await ui.unmount()
})

test('/futureflow minify kiest de minify-tab', async ($, on) => {
  const f = fake(on)
  await $.session.start(START)
  await run($, 'futureflow', 'minify')
  expect(f.opened[0]!.id).toBe('futureflow')
  const ui = await $.ui.mount(PANE('desktop'))
  expect(await ui.find({ type: 'Text', text: /^Uitvoer ingekort$/ })).toBeDefined()
  await ui.unmount()
})

test('/futureflow met onbekende tab geeft uitleg en opent niets', async ($, on) => {
  const f = fake(on)
  const r = await run($, 'futureflow', 'bestaatniet')
  expect(r.text).toContain('Onbekende tab')
  expect(f.opened.length).toBe(0)
})

test('tabknop 3 schakelt naar minify', async ($, on) => {
  fake(on)
  await $.session.start(START)
  await run($, 'futureflow', '')
  const ui = await $.ui.mount(PANE('desktop'))
  await ui.press({ key: 'tab-minify' } as any)
  expect(await ui.find({ type: 'Text', text: /^Uitvoer ingekort$/ })).toBeDefined()
  await ui.unmount()
})

test('/agent-slots zonder argument opent het dashboard op slots', async ($, on) => {
  const f = fake(on)
  await run($, 'agent-slots', '')
  expect(f.opened[0]!.id).toBe('futureflow')
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await ui.find({ type: 'Text', text: /40% vrij van 16 GB/ })).toBeDefined()
  await ui.unmount()
})

test('/minify zonder argument opent het dashboard op minify', async ($, on) => {
  const f = fake(on)
  await $.session.start(START)
  await run($, 'minify', '')
  expect(f.opened[0]!.id).toBe('futureflow')
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await ui.find({ type: 'Text', text: /^Uitvoer ingekort$/ })).toBeDefined()
  await ui.unmount()
})

test('/agent-slots status geeft nog steeds tekst', async ($, on) => {
  CLI.stdout = 'Geheugen: 31% vrij\n'
  fake(on)
  const r = await run($, 'agent-slots', 'status')
  expect(r.text).toContain('31% vrij')
})

test('terminal tekent geen Svg', async ($, on) => {
  fake(on)
  const ui = await $.ui.mount(PANE('terminal'))
  const boom = JSON.stringify(await ui.drawn())
  expect(boom).not.toContain('"type":"Svg"')
  expect(await ui.find({ type: 'Text', text: /^AI$/ })).toBeDefined()
  await ui.unmount()
})

test('desktop tekent het woordmerk', async ($, on) => {
  fake(on)
  const ui = await $.ui.mount(PANE('desktop'))
  expect(await ui.find({ type: 'Svg', alt: 'FutureFlowAI' } as any)).toBeDefined()
  await ui.unmount()
})

test('een tab waarvan het tekenen faalt valt terug op next, met één toast', async ($, on) => {
  const toasts: string[] = []
  CLI.stdout = JSON.stringify({ config: {}, slots: [], refusals: [] }) + '\n' // zonder memory: slotsTab gooit
  fake(on)
  on('ui.toast', ($: any, e: { text: string }) => { toasts.push(e.text); return { value: undefined } })
  let viaNext = 0
  on('ui.render', () => { viaNext++; throw new Error('terugval') })
  await $.session.start(START)
  await run($, 'futureflow', 'slots')
  try {
    const ui = await $.ui.mount(PANE('desktop'))
    await ui.unmount()
  } catch {
    // zonder tekenaar onder de plugins mag mounten falen
  }
  expect(viaNext).toBeGreaterThan(0)
  expect(toasts.length).toBe(1)
})

test('de minify-tab tekent zonder session.start en schrijft niets', async ($, on) => {
  const f = fake(on)
  on('fs.read', () => ({ value: '' }))
  await run($, 'futureflow', 'minify')
  WRITES.length = 0
  const ui = await $.ui.mount(PANE('desktop'))
  expect(await ui.find({ type: 'Text', text: /^Uitvoer ingekort$/ })).toBeDefined()
  await ui.unmount()
  expect(WRITES).toEqual([])
  expect(f.opened.length).toBe(1)
})
