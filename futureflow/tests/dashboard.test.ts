import { expect, mock, test } from 'claude-code/testing'

const CLI = { stdout: JSON.stringify({ memory: { freePercent: 40, totalGB: 16 }, config: { limits: { dev: 2 }, floorPercent: 25, criticalPercent: 10 }, slots: [], refusals: [] }) + '\n' }

const WRITES: string[] = []
const STORED: Array<{ key: string; value: any }> = []

// Nep-omgeving: geen oude plugins, neppe CLI, en een ui.open die we kunnen afluisteren.
function fake(on: any, o: { oud?: boolean; storeKapot?: boolean } = {}) {
  const flags = { stuk: false, cliCalls: 0 }
  const toasts: string[] = []
  const opened: Array<{ id: string; title?: string }> = []
  on('env.get', ($: any, e: { name: string }) => ({ value: e.name === 'HOME' ? '/home/t' : undefined }))
  on('session.id', () => ({ value: 'sessie-1' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', ($: any, e: { key: string; value: any }) => { if (o.storeKapot) throw new Error('schijf vol'); STORED.push({ key: e.key, value: e.value }); return { value: undefined } })
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', ($: any, e: { text: string }) => { toasts.push(e.text); return { value: undefined } })
  on('fs.read', ($: any, e: { path: string }) => ({
    value: o.oud && e.path.endsWith('installed_plugins.json') ? JSON.stringify({ plugins: { 'agent-slots@futureflowai-mods': [{}] } }) : '',
  }))
  on('fs.write', ($: any, e: { path: string }) => { WRITES.push(e.path); return { value: undefined } })
  on('fs.exists', () => ({ value: false }))
  on('session.start', ($: any, e: any) => e)
  on('command.register', () => ({ value: undefined }) as any)
  on('ui.panes', () => { if (flags.stuk) throw new Error('panes stuk'); return { value: [] } })
  on('ui.open', ($: any, e: { id: string; title?: string }) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })
  const clock = mock.clock(on)
  on('process.run', () => { flags.cliCalls++; return { value: { exitCode: 0, stdout: CLI.stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } })
  return { opened, clock, flags, toasts }
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
  expect(await ui.find({ type: 'Svg', alt: /Tokens bespaard \(in\)/ })).toBeDefined()
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
  CLI.stdout = JSON.stringify({ config: {}, slots: [], refusals: [] }) + '\n' // zonder memory: slotsTab gooit
  const { toasts } = fake(on)
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
  await run($, 'futureflow', 'minify')
  WRITES.length = 0
  const ui = await $.ui.mount(PANE('desktop'))
  expect(await ui.find({ type: 'Text', text: /^Uitvoer ingekort$/ })).toBeDefined()
  await ui.unmount()
  expect(WRITES).toEqual([])
  expect(f.opened.length).toBe(1)
})

test('overzicht zonder gegevens crasht niet', async ($, on) => {
  fake(on)
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await ui.find({ type: 'Text', text: /Contextvenster/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /nog geen gegevens/ })).toBeDefined()
  await ui.unmount()
  const ui2 = await $.ui.mount(PANE('desktop'))
  expect(await ui2.find({ type: 'Svg' })).toBeDefined()
  await ui2.unmount()
})

// De tab Stijl stuurt de ingebouwde claude-skins: voorkeuren in de store onder `skins.prefs`.
const laatstePrefs = () => STORED.filter(s => s.key === 'skins.prefs').at(-1)?.value

test('stijl uit zet de skin op off', async ($, on) => {
  fake(on)
  STORED.length = 0
  const r = await run($, 'futureflow', 'stijl uit')
  expect(laatstePrefs().skin).toBe('off')
  expect(r.text).toContain('uit')
})

test('stijl aan en stijl noir kiezen een skin; standaard is futureflow', async ($, on) => {
  fake(on)
  STORED.length = 0
  await run($, 'futureflow', 'stijl noir')
  expect(laatstePrefs().skin).toBe('noir')
  const r = await run($, 'futureflow', 'stijl aan')
  expect(laatstePrefs().skin).toBe('futureflow')
  expect(r.text).toContain('futureflow')
})

test('stijl met onbekend woord geeft één regel uitleg en schrijft niets', async ($, on) => {
  const f = fake(on)
  STORED.length = 0
  const r = await run($, 'futureflow', 'stijl paars')
  expect(r.text).toContain('aan|uit|<skin>')
  expect(STORED.length).toBe(0)
  expect(f.opened.length).toBe(0)
})

test('kale /futureflow stijl opent de tab', async ($, on) => {
  const f = fake(on)
  await run($, 'futureflow', 'stijl')
  expect(f.opened[0]!.id).toBe('futureflow')
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await ui.find({ type: 'Text', text: /Uit = Claude Code's eigen weergave/ })).toBeDefined()
  await ui.unmount()
})

test('vinkje verbruiksbalk zet alleen band uit', async ($, on) => {
  fake(on)
  STORED.length = 0
  await run($, 'futureflow', 'stijl')
  const ui = await $.ui.mount(PANE('desktop'))
  await ui.press({ key: 'stijl-band' } as any)
  const p = laatstePrefs()
  expect(p.band).toBe(false)
  expect(p.skin).toBe('futureflow')
  expect(p.shell).toBe(true)
  expect(p.markdown).toBe(true)
  await ui.unmount()
})

test('stijl-tab tekent op terminal zonder Svg, met de skins als knoppen', async ($, on) => {
  fake(on)
  await run($, 'futureflow', 'stijl')
  const ui = await $.ui.mount(PANE('terminal'))
  expect(JSON.stringify(await ui.drawn())).not.toContain('"type":"Svg"')
  expect(await ui.find({ type: 'Text', text: /Verbruiksbalk boven de prompt/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'stijl-skin-futureflow' } as any)).toBeDefined()
  await ui.unmount()
})

test('knop Alle instellingen opent het instellingenpaneel van de skin', async ($, on) => {
  const f = fake(on)
  await run($, 'futureflow', 'stijl')
  const ui = await $.ui.mount(PANE('desktop'))
  await ui.press({ key: 'stijl-alles' } as any)
  expect(f.opened.map(o => o.id)).toContain('skins-settings')
  await ui.unmount()
})

test('/futureflow met oude agent-slots: geen agent-slot status-aanroep', async ($, on) => {
  const f = fake(on, { oud: true })
  await $.session.start(START)
  f.flags.cliCalls = 0
  const r = await run($, 'futureflow', 'slots')
  expect(r.text).toContain('Dashboard geopend')
  expect(f.flags.cliCalls).toBe(0)
})

test('/futureflow stijl met kapotte opslag gooit niet en geeft één regel', async ($, on) => {
  fake(on, { storeKapot: true })
  const r = await run($, 'futureflow', 'stijl uit')
  expect(typeof r.text).toBe('string')
  expect(r.text).not.toContain('Skin uit')
})

test('de slots-tikker faalt open als ui.panes gooit', async ($, on) => {
  const f = fake(on)
  await run($, 'futureflow', 'slots')
  f.flags.stuk = true
  await f.clock.advance(3000)
  expect(f.toasts.length).toBe(1)
})
