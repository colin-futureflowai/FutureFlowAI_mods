import type { RenderElement } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// Claude Code's eigen weergave: wat onder de plugins tekent.
const STOCK: RenderElement = { type: 'Text', props: {}, children: ['eigen weergave'] }

type Opties = { stijl?: unknown; theme?: string }

// Nep-omgeving; alle on(...)-mocks vóór de eerste $-aanroep.
function fake(on: any, opties: Opties = {}) {
  const stock = { n: 0 }
  const toasts: string[] = []
  mock.clock(on)
  on('env.get', ($: any, e: { name: string }) => ({ value: e.name === 'HOME' ? '/home/t' : undefined }))
  on('fs.write', () => ({ value: undefined }))
  on('store.get', ($: any, e: { key: string }) => ({ value: e.key === 'stijl' ? opties.stijl : undefined }))
  on('store.set', () => ({ value: undefined }))
  on('config.list', () => ({
    value: opties.theme === undefined ? [] : [{ key: 'theme', label: 'Theme', kind: 'enum', value: opties.theme, provider: { kind: 'engine' }, isLocked: false }],
  }))
  on('ui.toast', ($: any, e: { text: string }) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', () => {
    stock.n++
    return STOCK
  })
  return { stock, toasts }
}

type Surface = 'terminal' | 'desktop'
const SITE = { plugin: 'futureflow', viewport: { columns: 100, rows: 30 } } as const

// Elke regel een eigen id per oppervlak: ▸ open of dicht hoort bij één regel.
const toolUse = (tool: string, input: unknown, surface: Surface, extra: object = {}) =>
  ({
    ...SITE,
    surface,
    component: 'ToolUse',
    requestId: `t-${tool}-${surface}`,
    props: { tool_use_id: `t-${tool}-${surface}`, tool, input, isRunning: false, isErrored: false, isInterrupted: false, ...extra },
  }) as any

const toolResult = (tool: string, output: unknown, isErrored: boolean, surface: Surface) =>
  ({ ...SITE, surface, component: 'ToolResult', requestId: `r-${tool}`, props: { tool_use_id: `r-${tool}`, tool, output, isErrored } }) as any

const tekst = (boom: unknown) => JSON.stringify(boom)

const EDIT = {
  filePath: '/r/src/a.ts',
  oldString: 'b',
  newString: 'c',
  structuredPatch: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [' a', '-b', '+c'] }],
}

test('ToolUse Bash toont $ en het commando', async ($, on) => {
  const f = fake(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(toolUse('Bash', { command: 'npm test' }, surface))
    expect(await ui.find({ type: 'Text', text: /^ \$ $/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /npm test/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^command/ })).toBeUndefined()
    expect(await ui.find({ key: 'open' })).toBeDefined()
    await ui.press({ key: 'open' })
    expect(await ui.find({ type: 'Text', text: /^command/ })).toBeDefined()
    await ui.unmount()
  }
  expect(f.stock.n).toBe(0)
})

test('Edit-resultaat wordt een diff-kaart met +1 −1', async ($, on) => {
  const f = fake(on)
  const term = await $.ui.mount(toolResult('Edit', EDIT, false, 'terminal'))
  expect(await term.find({ type: 'Text', text: /\+1 −1/ })).toBeDefined()
  expect(tekst(await term.drawn())).not.toContain('"type":"Svg"')
  await term.unmount()
  const desk = await $.ui.mount(toolResult('Edit', EDIT, false, 'desktop'))
  expect(await desk.find({ type: 'Svg', alt: /\+1 −1/ } as any)).toBeDefined()
  await desk.unmount()
  // De ToolUse-regel van dezelfde Edit telt ook mee.
  const rij = await $.ui.mount(toolUse('Edit', { file_path: '/r/src/a.ts' }, 'terminal', { output: EDIT }))
  expect(await rij.find({ type: 'Text', text: /\+1/ })).toBeDefined()
  await rij.unmount()
  expect(f.stock.n).toBe(0)
})

test('Bash-resultaat met exit 2 toont ✗ exit 2 en stderr apart', async ($, on) => {
  fake(on)
  const uit = { stdout: 'regel 1\nregel 2', stderr: 'Exit code 2\nkapot', interrupted: false }
  const term = await $.ui.mount(toolResult('Bash', uit, true, 'terminal'))
  expect(await term.find({ type: 'Text', text: /✗ exit 2/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /^stderr$/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /^kapot$/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /^regel 1$/ })).toBeDefined()
  await term.unmount()
  const desk = await $.ui.mount(toolResult('Bash', uit, true, 'desktop'))
  const svg = (await desk.find({ type: 'Svg' })) as any
  expect(svg?.props.alt).toContain('✗ exit 2')
  expect(svg?.props.source).toContain('stderr')
  await desk.unmount()
})

test('lange uitvoer klapt in tot 8 + 4 regels', async ($, on) => {
  fake(on)
  const stdout = Array.from({ length: 30 }, (_, i) => `r${i}`).join('\n')
  const ui = await $.ui.mount(toolResult('Bash', { stdout, stderr: '', interrupted: false }, false, 'terminal'))
  expect(await ui.find({ type: 'Text', text: /✓/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^r7$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^r8$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /18 regels verborgen/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^r29$/ })).toBeDefined()
  await ui.unmount()
})

test('skin uit geeft Claude Code eigen weergave', async ($, on) => {
  const f = fake(on, { stijl: { aan: false } })
  const a = await $.ui.mount(toolUse('Bash', { command: 'ls' }, 'terminal'))
  const b = await $.ui.mount(toolResult('Edit', EDIT, false, 'desktop'))
  const c = await $.ui.mount({ ...SITE, surface: 'terminal', component: 'Spinner', requestId: 's', props: { word: 'Bakken', message: null, suffix: '…', mode: 'thinking' } } as any)
  expect(f.stock.n).toBe(3)
  for (const ui of [a, b, c]) await ui.unmount()
})

test('één onderdeel uit: alleen dat geeft next', async ($, on) => {
  const f = fake(on, { stijl: { diff: false } })
  const a = await $.ui.mount(toolResult('Edit', EDIT, false, 'terminal'))
  expect(f.stock.n).toBe(1)
  const b = await $.ui.mount(toolUse('Bash', { command: 'ls' }, 'terminal'))
  expect(f.stock.n).toBe(1)
  for (const ui of [a, b]) await ui.unmount()
})

test('kapotte invoer valt terug op next', async ($, on) => {
  const f = fake(on)
  const ui = await $.ui.mount(toolUse('Bash', undefined, 'terminal'))
  expect(f.stock.n).toBe(1)
  await ui.unmount()
  // Een onleesbare uitvoer ook: geen lege regel.
  const r = await $.ui.mount(toolResult('Edit', { niks: true }, false, 'terminal'))
  expect(f.stock.n).toBe(2)
  await r.unmount()
})

test('andere tools en agents houden hun eigen weergave', async ($, on) => {
  const f = fake(on)
  const a = await $.ui.mount(toolUse('Agent', { prompt: 'x' }, 'terminal'))
  const b = await $.ui.mount(toolResult('Read', { type: 'text' }, false, 'terminal'))
  expect(f.stock.n).toBe(2)
  for (const ui of [a, b]) await ui.unmount()
})

test('licht thema gebruikt inkt #3D3D3D', async ($, on) => {
  fake(on, { theme: 'light' })
  const ui = await $.ui.mount(toolUse('Read', { file_path: '/r/a.ts' }, 'terminal'))
  const teksten = (await ui.findAll({ type: 'Text' })) as any[]
  expect(teksten.some(t => t.props?.color === '#3D3D3D')).toBe(true)
  await ui.unmount()
})

test('spinner en beurtduur in groen', async ($, on) => {
  fake(on)
  const s = await $.ui.mount({ ...SITE, surface: 'terminal', component: 'Spinner', requestId: 's', props: { word: 'Bakken', message: null, suffix: '…', mode: 'thinking' } } as any)
  const st = (await s.find({ type: 'Text', text: /Bakken…/ })) as any
  expect(st?.props.color).toBe('#32a029')
  await s.unmount()
  const d = await $.ui.mount({ ...SITE, surface: 'terminal', component: 'TurnDuration', requestId: 'd', props: { word: 'Gebakken', durationMs: 64000 } } as any)
  const dt = (await d.find({ type: 'Text', text: /Gebakken for 1m 4s/ })) as any
  expect(dt?.props.color).toBe('#32a029')
  await d.unmount()
})
