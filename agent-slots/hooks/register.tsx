import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { SlotsHolder, SlotsSnapshot } from '../types'

import { classify, hasShellBackground, unwrapCommand, wrapCommand } from '../lib/classify.mjs'

// Tools die een nieuwe sessie of workflow starten: tegenhouden bij krap geheugen.
const SESSION_TOOLS = new Set(['Workflow', 'mcp__ccd_session__start_session'])
// Browser-tools die één gedeeld browserprofiel gebruiken.
const isBrowserTool = (tool: string) => tool.startsWith('mcp__') && /playwright/i.test(tool)
const isBrowserClose = (tool: string) => /browser_close$/.test(tool)

type Check = { ok: boolean; reuse?: boolean; reason?: string; message?: string; memory?: { freePercent: number } }

let sessionId: string | undefined

// ---------- dashboard ----------

const PANE = 'agent-slots'
const snapshot = atom({ plugin: 'agent-slots', key: 'snapshot' } as const, null as SlotsSnapshot | null)
let ticker: { cancel: () => void } | undefined

async function refresh($: Engine) {
  try {
    const r = await cli($, ['status', '--json'])
    const data = JSON.parse(r.stdout) as Omit<SlotsSnapshot, 'at'>
    await update($, snapshot, () => ({ ...data, at: Date.now() }))
  } catch (err) {
    await update($, snapshot, prev => (prev ? { ...prev, at: Date.now(), error: String(err) } : prev))
  }
}

// Ververst elke 3 s zolang het paneel open staat; stopt vanzelf als het dicht is.
async function startDashboard($: Engine) {
  await refresh($)
  ticker?.cancel()
  ticker = $.clock.every(3000, () => {
    void (async () => {
      const isUp = (await $.ui.panes()).some(p => p.id === PANE)
      if (!isUp) { ticker?.cancel(); ticker = undefined; return }
      await refresh($)
    })()
  })
}

const pad = (n: number) => String(n).padStart(2, '0')
const clock = (t: string | number) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
const shortPath = (p?: string) => (p ?? '').replace(/^\/(Users|home)\/[^/]+/, '~').replace(/^C:\\Users\\[^\\]+/i, '~')

function memoryBar(free: number, width = 24) {
  const used = Math.round(((100 - free) / 100) * width)
  return '█'.repeat(used) + '░'.repeat(Math.max(0, width - used))
}

// Let op: noem niets `h` in dit bestand; dat is de globale JSX-functie.
function holderLine(slot: SlotsHolder) {
  const who = slot.session ? `sessie ${slot.session.slice(0, 8)}` : `pid ${slot.childPid ?? slot.pid ?? '?'}`
  return [who, shortPath(slot.cwd), slot.command, slot.since ? `sinds ${clock(slot.since)}` : ''].filter(Boolean).join(' · ')
}

// Exact de commando's die deze mod zelf heeft ingepakt. Alleen die worden in tool.check
// uitgepakt; een nagemaakte wrapper (ander programma vooraan) wordt gewoon als geheel beoordeeld.
const produced = new Set<string>()

async function session($: Engine) {
  sessionId ??= await $.session.id()
  return sessionId
}

// De CLI in de plugin zelf: bestaat altijd, ook als de kopie voor de shim nog niet gemaakt is.
const cliPath = ($: Engine) => `${$.plugin.root}/bin/agent-slot.mjs`

// Draait de CLI. De desktop-app heeft een kaal PATH en argv[0] wordt daarop gezocht,
// dus `node` via /usr/bin/env met een PATH waar Homebrew vooraan staat.
async function cli($: Engine, args: string[], timeoutMs = 15_000) {
  const isWin = (await $.env.get('OS')) === 'Windows_NT'
  const hostPath = (await $.env.get('PATH')) ?? ''
  if (isWin) return $.process.run(['node', cliPath($), ...args], { timeoutMs })
  const PATH = `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${hostPath}`
  return $.process.run(['/usr/bin/env', 'node', cliPath($), ...args], { env: { PATH }, timeoutMs })
}

// Eigen foutlog van de mod, via $.fs zodat het ook werkt als Node niet te starten is.
const notes: string[] = []
async function note($: Engine, text: string) {
  notes.push(`${new Date().toISOString()} ${text}`)
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  if (home) await $.fs.write(`${home}/.claude/agent-slots-mod.log`, notes.slice(-50).join('\n') + '\n').catch(() => undefined)
}

// Laat zien dat de mod niet werkt, in plaats van stil door te gaan (toast één keer per sessie).
let warned = false
function warn($: Engine, err: unknown) {
  const text = err instanceof Error ? err.message : String(err)
  void note($, `fout: ${text}`)
  if (warned) return
  warned = true
  $.ui.toast(`agent-slots werkt niet (alles gaat door): ${text}`)
}

// Een fout in de mod blokkeert niets: melden en doorlaten.
const failOpen = ($: Engine, e: any, next: any) => {
  if (next.error.kind !== 're-entry') warn($, next.error.message ?? next.error.kind)
  return next(e)
}

async function cliJson($: Engine, args: string[]): Promise<Check> {
  const r = await cli($, args)
  const line = r.stdout.trim().split('\n').pop()
  if (r.exitCode !== 0 || !line) throw new Error(`agent-slot ${args[0]} gaf exitcode ${r.exitCode}: ${r.stderr.trim().slice(0, 200)}`)
  return JSON.parse(line) as Check
}

async function log($: Engine, event: string, data: Record<string, unknown>) {
  await cli($, ['log', event, JSON.stringify({ session: await session($), ...data })]).catch(err => warn($, err))
}

async function bypassed($: Engine) {
  return (await $.env.get('AGENT_SLOT_BYPASS')) === '1'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'agent-slots', description: 'Dashboard met slots en geheugen; of: status, kill-idle, install (agent-slot op je PATH)' })
    // Na een herlaad staat het paneel misschien nog open: dan weer verversen.
    if ((await $.ui.panes()).some(p => p.id === PANE)) await startDashboard($)
    // Houdt de vaste kopie van de CLI gelijk aan deze versie van de mod.
    await note($, `geladen vanuit ${$.plugin.root}`)
    await cli($, ['install', '--quiet']).then(r => note($, `install: exit ${r.exitCode} ${r.stderr.trim()}`), err => warn($, err))
    return next(e)
  }).catch(failOpen)

  on('command.run', { command: 'agent-slots' }, async ($, e) => {
    const arg = (e.args ?? '').trim()
    if (!arg || arg === 'dashboard') {
      const opened = await $.ui.open({ id: PANE, title: 'agent-slots' })
      await startDashboard($)
      return { text: opened.isPlaced ? 'Dashboard van agent-slots geopend.' : 'Dashboard klaargezet; het verschijnt zodra er ruimte is. Tekst-versie: /agent-slots status' }
    }
    const args = arg === 'install' ? ['install', '--shim'] : arg === 'kill-idle' ? ['kill-idle'] : ['status']
    const r = await cli($, args)
    return { text: (r.stdout + r.stderr).trim() || 'Geen uitvoer.' }
  })

  // Zware Bash-commando's: inpakken in `agent-slot run`, of weigeren met een volgende stap.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (await bypassed($)) return next(e)
    const c = classify(e.command)
    if (!c.kind || c.kind === 'self') return next(e)

    if (c.kind === 'unknown-heavy') {
      await log($, 'unknown-heavy', { command: c.segment, full: e.command.slice(0, 300), reason: c.reason })
      return next(e)
    }

    if (c.kind === 'agent') {
      const check = await cliJson($, ['check', 'agent', '--gate', 'floor'])
      if (check.ok) return next(e)
      await log($, 'refuse', { kind: 'agent', tool: 'Bash', command: c.segment, reason: check.reason, memory: check.memory?.freePercent })
      return { deny: `agent-slots: ${check.message ?? 'te weinig geheugen'}` }
    }

    if (hasShellBackground(e.command)) {
      await log($, 'refuse', { kind: c.kind, tool: 'Bash', command: c.segment, reason: 'shell-background' })
      return { deny: `agent-slots: start "${c.segment}" niet met een losse & op de achtergrond; dan kan het slot niet bijhouden wanneer het proces stopt. Gebruik in plaats daarvan run_in_background: true met hetzelfde commando zonder &.` }
    }

    const id = await session($)
    const check = await cliJson($, ['check', c.kind, '--session', id])
    if (!check.ok) {
      await log($, 'refuse', { kind: c.kind, tool: 'Bash', command: c.segment, reason: check.reason, memory: check.memory?.freePercent })
      return { deny: `agent-slots: ${check.message ?? 'geen slot vrij'}` }
    }
    const wrapped = wrapCommand(e.command, c.kind, cliPath($), { session: id, label: c.segment })
    if (produced.size > 500) produced.clear()
    produced.add(wrapped)
    return next({ ...e, command: wrapped })
  }).catch(failOpen)

  // Toestemming: het ingepakte commando beoordelen als het origineel, zodat bestaande regels blijven werken.
  // De invoer van tool.check ligt vast, dus vragen we het oordeel voor het origineel apart op.
  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const input = e.input as { command?: unknown }
    const cmd = input?.command
    const inner = typeof cmd === 'string' && produced.has(cmd) ? unwrapCommand(cmd) : null
    if (inner === null) return next(e)
    return $.tool.check({ tool: 'Bash', input: { ...input, command: inner } })
  })

  // Browser (Playwright MCP), nieuwe sessies/workflows en subagents.
  on('tool.call', async ($, e, next) => {
    const tool = e.tool as string
    const isBrowser = isBrowserTool(tool)
    const isSession = SESSION_TOOLS.has(tool)
    const isAgent = tool === 'Agent'
    if (!isBrowser && !isSession && !isAgent) return next(e)
    if (await bypassed($)) return next(e)

    if (isBrowser) {
      const id = await session($)
      const got = await cliJson($, ['acquire', 'browser', '--session', id, '--tool', tool])
      if (!got.ok) return { deny: `agent-slots: ${got.message ?? 'de browser is bezet'}` }
      const ran = await next(e)
      if (isBrowserClose(tool)) await cli($, ['release', 'browser', '--session', id, '--tool', tool]).catch(err => warn($, err))
      return ran
    }

    const check = await cliJson($, ['check', isAgent ? 'agent' : 'session', '--gate', isAgent ? 'critical' : 'floor'])
    if (check.ok) return next(e)
    await log($, 'refuse', { kind: isAgent ? 'agent' : 'session', tool, reason: check.reason, memory: check.memory?.freePercent })
    const what = isAgent ? 'Geen nieuwe subagent gestart' : 'Geen nieuwe sessie of workflow gestart'
    return { deny: `agent-slots: ${what}. ${check.message ?? 'te weinig geheugen'}` }
  }).catch(failOpen)

  // Browser-slot van deze sessie vrijgeven als de sessie stopt.
  on('session.end', async ($, e, next) => {
    if (sessionId) await cli($, ['release-session', '--session', sessionId]).catch(() => undefined)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const snap = await read($, snapshot)
    if (!snap) return <Text dimColor>Laden…</Text>

    const { memory, config, slots, refusals } = snap
    const free = memory.freePercent
    const tone = free < config.criticalPercent ? 'error' : free < config.floorPercent ? 'warning' : free < config.floorPercent + 15 ? 'warning' : 'success'
    const state = free < config.criticalPercent ? 'kritiek' : free < config.floorPercent ? 'krap: nieuwe zware taken worden geweigerd' : 'ok'

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>Geheugen</Text>
          <Text>
            <Text color={tone}>{memoryBar(free)}</Text> {free}% vrij van {memory.totalGB} GB
          </Text>
          <Text dimColor>
            grens {config.floorPercent}% · kritiek {config.criticalPercent}% · {state}
          </Text>
        </Box>

        <Box flexDirection="column">
          <Text bold>Slots</Text>
          {Object.entries(config.limits).map(([kind, limit]) => {
            const held = slots.filter(s => s.kind === kind)
            const full = held.length >= limit
            return (
              <Box flexDirection="column">
                <Text>
                  <Text color={full ? 'warning' : 'success'}>{'●'.repeat(held.length)}{'○'.repeat(Math.max(0, limit - held.length))}</Text>
                  {'  '}{kind.padEnd(8)}{held.length}/{limit}
                </Text>
                {held.map(holder => <Text dimColor wrap="truncate-end">{"    "}{holderLine(holder)}</Text>)}
              </Box>
            )
          })}
        </Box>

        <Box flexDirection="column">
          <Text bold>Laatste weigeringen</Text>
          {refusals.length === 0 && <Text dimColor>Geen.</Text>}
          {[...refusals].reverse().map(r => (
            <Text wrap="truncate-end">
              <Text dimColor>{clock(r.t)}</Text>  {(r.kind ?? r.tool ?? '').padEnd(8)}<Text color="warning">{r.reason ?? ''}</Text>  {r.command ?? ''}
            </Text>
          ))}
        </Box>

        <Text dimColor>
          Bijgewerkt {clock(snap.at)}{snap.error ? ` · fout: ${snap.error.slice(0, 80)}` : ''} · /agent-slots status voor tekst
        </Text>
      </Box>
    )
  })
}
