import { expect, test } from 'claude-code/testing'

const SLOTS = JSON.stringify({ memory: { freePercent: 40, totalGB: 16 }, config: { limits: { dev: 2 }, floorPercent: 25, criticalPercent: 10 }, slots: [], refusals: [] }) + '\n'

const MCP = [
  { name: 'mcp__n8n-mcp__a', serverName: 'n8n-mcp', tokens: 3000, isLoaded: true },
  { name: 'mcp__n8n-mcp__b', serverName: 'n8n-mcp', tokens: 1000, isLoaded: false },
  { name: 'mcp__x__gmail', serverName: 'claude.ai Gmail', tokens: 500, isLoaded: true },
]

type Opties = { uit?: string[]; zetFaalt?: boolean; usageFaalt?: boolean }

// Nep-omgeving; alle mocks vóór de eerste $-aanroep. De CLI connectors.mjs houdt een eigen lijst bij.
function fake(on: any, o: Opties = {}) {
  const uit = [...(o.uit ?? [])]
  const zet: string[][] = []
  const toasts: string[] = []
  on('env.get', ($: any, e: { name: string }) => ({ value: e.name === 'HOME' ? '/home/t' : e.name === 'PATH' ? '/usr/bin' : undefined }))
  on('session.id', () => ({ value: 'sessie-1' }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('session.usage', () => {
    if (o.usageFaalt) throw new Error('geen usage')
    return { value: { startedAt: 0, context: { window: 200000, breakdown: { mcpTools: MCP } }, rateLimits: [] } }
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
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', ($: any, e: { argv: string[]; env?: Record<string, string> }) => {
    const i = e.argv.findIndex(a => a.endsWith('connectors.mjs'))
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (i < 0) return ok(SLOTS)
    const args = e.argv.slice(i + 1)
    if (args[0] === 'list') return ok(JSON.stringify({ uit }) + '\n')
    zet.push(e.argv)
    if (o.zetFaalt) return { value: { exitCode: 2, stdout: '', stderr: '[connectors] /home/t/.claude.json is geen geldige JSON; niets gewijzigd\n', isStdoutTruncated: false, isStderrTruncated: false } }
    const server = args[args.indexOf('--server') + 1]!
    if (args.includes('--uit')) uit.push(server)
    else uit.splice(uit.indexOf(server), 1)
    return ok(JSON.stringify({ uit, gewijzigd: true }) + '\n')
  })
  return { zet, toasts, uit }
}

const run = ($: any, command: string, args: string) =>
  $.command.run({ origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 }, command, args } as any)

const PANE = (surface: 'terminal' | 'desktop') =>
  ({ plugin: 'futureflow', surface, component: 'Pane', requestId: 'futureflow', props: {} }) as any

test('/futureflow connectors toont per server tools en tokens, gesorteerd', async ($, on) => {
  fake(on, { uit: ['claude.ai Canva'] })
  const r = await run($, 'futureflow', 'connectors')
  expect(r.text).toContain('Connectors')
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

test('hotkey 5 opent de tab Connectors', async ($, on) => {
  fake(on)
  await run($, 'futureflow', '')
  const ui = await $.ui.mount(PANE('desktop'))
  expect(await ui.find({ type: 'Button', key: 'tab-connectors', hotkey: '5' } as any)).toBeDefined()
  await ui.press({ key: 'tab-connectors' } as any)
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
