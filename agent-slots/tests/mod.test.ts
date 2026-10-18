import { expect, test } from 'claude-code/testing'

import { unwrapCommand } from '../lib/classify.mjs'

type Answer = Record<string, unknown>

// Nep-omgeving: env, sessie-id en de CLI (process.run) met vaste antwoorden per opdracht.
// De CLI zelf wordt los getest in cli.test.mjs.
function fake(on: any, cliAnswers: Record<string, Answer> = {}, env: Record<string, string> = {}) {
  const calls: string[][] = []
  const ran: Answer[] = []
  const vars: Record<string, string> = { HOME: '/home/t', PATH: '/usr/bin', ...env }
  on('env.get', ($: any, e: { name: string }) => ({ value: vars[e.name] }))
  on('session.id', () => ({ value: 'sessie-1' }))
  on('process.run', ($: any, e: { argv: string[] }) => {
    // Genormaliseerd naar ['node', cli, opdracht, …], wat er ook vóór node staat (/usr/bin/env).
    const argv = e.argv.slice(e.argv.findIndex(a => a.endsWith('agent-slot.mjs')) - 1)
    calls.push(argv)
    const sub = argv[2]
    const kind = argv[3]
    const answer = cliAnswers[`${sub} ${kind}`] ?? cliAnswers[sub ?? ''] ?? { ok: true }
    return { value: { exitCode: 0, stdout: JSON.stringify(answer) + '\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', ($: any, e: Answer) => {
    ran.push(e)
    return { result: 'klaar' }
  })
  return { calls, ran }
}

test('licht commando gaat ongewijzigd door, zonder de CLI aan te roepen', async ($, on) => {
  const f = fake(on)
  await $.tool.call({ tool: 'Bash', command: 'git status' } as any)
  expect(f.ran[0]!.command).toBe('git status')
  expect(f.calls.length).toBe(0)
})

const cmdOf = (f: { ran: Answer[] }) => f.ran[0]?.command as string | undefined

test('melding over geheugen: status- en wacht-commando worden uitvoerbaar, de zin blijft heel', async ($, on) => {
  fake(on, { 'check test': { ok: false, reason: 'memory', message: 'Te weinig vrij geheugen. Stop een server (`agent-slot status` laat zien wat er draait). Of wacht met: `agent-slot wait test`' } })
  const r = JSON.stringify(await $.tool.call({ tool: 'Bash', command: 'pnpm test' } as any))
  expect(r).toMatch(/agent-slot\.mjs' status` laat zien/)
  expect(r).toMatch(/agent-slot\.mjs' wait test`/)
})

test('dev-server met vrij slot wordt ingepakt in agent-slot run', async ($, on) => {
  const f = fake(on)
  await $.tool.call({ tool: 'Bash', command: 'cd web && pnpm dev', run_in_background: true } as any)
  const cmd = f.ran[0]!.command as string
  expect(cmd).toMatch(/agent-slot\.mjs' run dev --session 'sessie-1' --label 'pnpm dev' -- sh -c/)
  expect(unwrapCommand(cmd)).toBe('cd web && pnpm dev')
  expect(f.ran[0]!.run_in_background).toBe(true)
})

test('alle slots bezet: geweigerd met een direct uitvoerbare volgende stap', async ($, on) => {
  const f = fake(on, { 'check dev': { ok: false, reason: 'slots', message: 'Alle 2 dev-slots zijn bezet: sessie abc. Volgende stap: draai `agent-slot wait dev` (max. 9 min).' } })
  const r = await $.tool.call({ tool: 'Bash', command: 'pnpm dev' } as any)
  expect(f.ran.length).toBe(0)
  expect(JSON.stringify(r)).toMatch(/node '[^']*agent-slot\.mjs' wait dev/)
  expect(cmdOf(f)).toBeUndefined()
  expect(f.calls.some(c => c[2] === 'log' && c[3] === 'refuse')).toBe(true)
})

test('dev-server met losse & wordt geweigerd met uitleg over run_in_background', async ($, on) => {
  const f = fake(on)
  const r = await $.tool.call({ tool: 'Bash', command: 'pnpm dev > log 2>&1 &' } as any)
  expect(f.ran.length).toBe(0)
  expect(JSON.stringify(r)).toContain('run_in_background')
})

test('twijfelgeval gaat door en wordt gelogd', async ($, on) => {
  const f = fake(on)
  await $.tool.call({ tool: 'Bash', command: 'pnpm install' } as any)
  expect(f.ran[0]!.command).toBe('pnpm install')
  expect(f.calls.some(c => c[2] === 'log' && c[3] === 'unknown-heavy')).toBe(true)
})

test('AGENT_SLOT_BYPASS=1 zet alles uit', async ($, on) => {
  const f = fake(on, { 'check dev': { ok: false, message: 'bezet' } }, { AGENT_SLOT_BYPASS: '1' })
  await $.tool.call({ tool: 'Bash', command: 'pnpm dev' } as any)
  expect(f.ran[0]!.command).toBe('pnpm dev')
})

test('toestemming wordt beoordeeld op het originele commando', async ($, on) => {
  fake(on)
  const seen: string[] = []
  on('tool.check', ($: any, e: any) => {
    seen.push(e.input.command)
    return { decision: e.input.command === 'pnpm dev' ? 'allow' : 'ask' }
  })
  const wrapped = "'node' '/plugin/bin/agent-slot.mjs' run dev --session 'sessie-1' -- sh -c 'pnpm dev'"
  const verdict = await $.tool.check({ tool: 'Bash', input: { command: wrapped } })
  expect(seen).toEqual(['pnpm dev'])
  expect(verdict.decision).toBe('allow')
})

test('browser bezet door een andere sessie: geweigerd met volgende stap', async ($, on) => {
  const f = fake(on, { 'acquire browser': { ok: false, reason: 'slots', message: 'De browser is bezet door sessie abc. Volgende stap: draai `agent-slot wait browser`.' } })
  const r = await $.tool.call({ tool: 'mcp__plugin_playwright_playwright__browser_navigate', url: 'https://example.com' } as any)
  expect(f.ran.length).toBe(0)
  expect(JSON.stringify(r)).toContain('wait browser')
})

test('browser: elke aanroep pakt of ververst het slot, browser_close geeft het vrij', async ($, on) => {
  const f = fake(on)
  await $.tool.call({ tool: 'mcp__plugin_playwright_playwright__browser_close' } as any)
  expect(f.ran.length).toBe(1)
  expect(f.calls.map(c => c.slice(2, 4).join(' '))).toEqual(['acquire browser', 'release browser'])
})

test('subagent pas tegengehouden bij kritiek geheugen', async ($, on) => {
  const f = fake(on, { 'check agent': { ok: false, reason: 'memory', message: 'Te weinig vrij geheugen: 8% vrij.' } })
  const r = await $.tool.call({ tool: 'Agent', description: 'x', prompt: 'y' } as any)
  expect(f.ran.length).toBe(0)
  expect(JSON.stringify(r)).toContain('Geen nieuwe subagent')
  expect(f.calls.find(c => c[2] === 'check')).toEqual(expect.arrayContaining(['--gate', 'critical']))
})
