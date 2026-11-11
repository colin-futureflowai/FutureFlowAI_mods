import { opOpenrouter } from './api'
import { ORCA_WEIGER, orcaClaudeStart } from '../lib/openrouter.mjs'
import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { OverflowJob, SlotsHolder, SlotsSnapshot } from '../types'

import { accountsSessieEinde } from './accounts'
import { failOpen, log, oud } from './ctx'
import { openDashboard, PANE } from './paneel'
import { kaart, leeg, meter, paneelVan, vinkje } from './paneel-ui'
import { actieveKleuren, stopSkins } from './skins/register'

import { classify, hasShellBackground, maskSecrets, unwrapCommand, wrapCommand } from '../lib/classify.mjs'
import { reportMessage } from '../lib/report.mjs'
import { meterTekst, meterToon } from '../lib/slotsmeter.mjs'

// Tools die een nieuwe sessie of workflow starten: tegenhouden bij krap geheugen.
const SESSION_TOOLS = new Set(['Workflow', 'mcp__ccd_session__start_session'])
// Browser-tools die één gedeeld browserprofiel gebruiken.
const isBrowserTool = (tool: string) => tool.startsWith('mcp__') && /playwright/i.test(tool)
const isBrowserClose = (tool: string) => /browser_close$/.test(tool)

type Check = { ok: boolean; disabled?: boolean; reuse?: boolean; reason?: string; message?: string; memory?: { freePercent: number } }

let sessionId: string | undefined

// ---------- cloud-overflow: rapporten terugmelden ----------

// Een cloud-sessie kan niet terugpraten; zijn rapportcommit op GitHub is het signaal.
// Elke minuut kijkt de CLI of er rapporten zijn voor taken die déze sessie startte,
// en die zetten we hier als bericht van de mod in het gesprek.
let overflowWatch: { cancel: () => void } | undefined

// Eén controle tegelijk: een ingestuurd bericht wacht tot de beurt van Claude voorbij is,
// en zonder deze vlag stuurde de volgende tik hetzelfde rapport nog eens.
let delivering = false

async function deliverReports($: Engine) {
  if (delivering) return
  delivering = true
  try {
    await deliverOnce($)
  } finally {
    delivering = false
  }
}

async function deliverOnce($: Engine) {
  const id = await session($)
  const r = await cli($, ['overflow', 'check', '--session', id], 90_000)
  const line = r.stdout.trim().split('\n').pop()
  if (r.exitCode !== 0 || !line) throw new Error(`agent-slot overflow check gaf exitcode ${r.exitCode}: ${r.stderr.trim().slice(0, 200)}`)
  const { finished } = JSON.parse(line) as { finished: OverflowJob[] }
  for (const job of finished) {
    // Eerst als afgeleverd markeren, dan insturen: liever één keer te weinig (dan staat het
    // nog in het dashboard en in git) dan hetzelfde rapport meermaals in het gesprek.
    await cli($, ['overflow', 'delivered', job.id])
    $.ui.toast(`Cloud-worker klaar: ${job.branch}`)
    await $.prompt.submit({ text: reportMessage(job) })
  }
}

function startOverflowWatch($: Engine) {
  overflowWatch?.cancel()
  overflowWatch = $.clock.every(60_000, () => {
    void deliverReports($).catch(err => warn($, err))
  })
}

// ---------- dashboard ----------

const snapshot = atom({ plugin: 'futureflow', key: 'slots.snapshot' } as const, null as SlotsSnapshot | null)
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
export async function startSlotsTicker($: Engine) {
  await refresh($)
  ticker?.cancel()
  ticker = $.clock.every(3000, () => {
    void (async () => {
      const isUp = (await $.ui.panes()).some(p => p.id === PANE)
      if (!isUp) { ticker?.cancel(); ticker = undefined; return }
      await refresh($)
    })().catch(err => failOpen($, err))
  })
}

const pad = (n: number) => String(n).padStart(2, '0')
const clock = (t: string | number) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
const shortPath = (p?: string) => (p ?? '').replace(/^\/(Users|home)\/[^/]+/, '~').replace(/^C:\\Users\\[^\\]+/i, '~')

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
const cliPath = ($: Engine) => `${$.plugin.root}/cli/agent-slot.mjs`

// Draait de CLI. De desktop-app heeft een kaal PATH en argv[0] wordt daarop gezocht,
// dus `node` via /usr/bin/env met een PATH waar Homebrew vooraan staat.
async function cli($: Engine, args: string[], timeoutMs = 15_000) {
  const isWin = (await $.env.get('OS')) === 'Windows_NT'
  const hostPath = (await $.env.get('PATH')) ?? ''
  if (isWin) return $.process.run(['node', cliPath($), ...args], { timeoutMs })
  const PATH = `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${hostPath}`
  return $.process.run(['/usr/bin/env', 'node', cliPath($), ...args], { env: { PATH }, timeoutMs })
}

// Foutlog en toast lopen via ctx.ts (één toast per sessie, regels in ~/.claude/futureflow/mod.log).
function note($: Engine, text: string) {
  return log($, `[slots] ${text}`)
}

function warn($: Engine, err: unknown) {
  const text = err instanceof Error ? err.message : String(err)
  failOpen($, new Error(`[slots] ${text}`))
}

// Een fout in de mod blokkeert niets: melden en doorlaten.
const vangOp = ($: Engine, e: any, next: any) => {
  if (next.error.kind !== 're-entry') warn($, next.error.message ?? next.error.kind)
  return next(e)
}

async function cliJson($: Engine, args: string[]): Promise<Check> {
  const r = await cli($, args)
  const line = r.stdout.trim().split('\n').pop()
  if (r.exitCode !== 0 || !line) throw new Error(`agent-slot ${args[0]} gaf exitcode ${r.exitCode}: ${r.stderr.trim().slice(0, 200)}`)
  return JSON.parse(line) as Check
}

async function logEvent($: Engine, event: string, data: Record<string, unknown>) {
  await cli($, ['log', event, JSON.stringify({ session: await session($), ...data })]).catch(err => warn($, err))
}

async function bypassed($: Engine) {
  return (await $.env.get('AGENT_SLOT_BYPASS')) === '1'
}

// Start van het onderdeel Slots; register.tsx roept dit aan vanuit zijn ene session.start
// (de hooks-module weigert twee session.start-handlers zonder matcher).
export async function startSlots($: Engine): Promise<void> {
  try {
    // Staat de oude agent-slots-plugin nog aan, dan doet die het werk: hier niets registreren.
    if ((await oud($)).slots) return
    await $.command.register({ name: 'agent-slots', description: 'Dashboard met slots en geheugen; of: status, kill-idle, install (agent-slot op je PATH)' })
    startOverflowWatch($)
    // Na een herlaad staat het paneel misschien nog open: dan weer verversen.
    if ((await $.ui.panes()).some(p => p.id === PANE)) await startSlotsTicker($)
    // Houdt de vaste kopie van de CLI gelijk aan deze versie van de mod.
    await note($, `geladen vanuit ${$.plugin.root}`)
    await cli($, ['install', '--quiet']).then(r => note($, `install: exit ${r.exitCode} ${r.stderr.trim()}`), err => warn($, err))
  } catch (err) {
    warn($, err)
  }
}

export const registerSlots = (on: Parameters<Register>[0]): void => {
  on('command.run', { command: 'agent-slots' }, async ($, e, next) => {
    if ((await oud($)).slots) return next(e)
    const arg = (e.args ?? '').trim()
    if (!arg || arg === 'dashboard') {
      await openDashboard($, 'zuinig')
      await startSlotsTicker($)
      return { text: 'Dashboard geopend op de tab Zuinig. Tekst-versie: /agent-slots status' }
    }
    const args = arg === 'install' ? ['install', '--shim'] : arg === 'kill-idle' ? ['kill-idle'] : ['status']
    const r = await cli($, args)
    return { text: (r.stdout + r.stderr).trim() || 'Geen uitvoer.' }
  })

  // Zware Bash-commando's: inpakken in `agent-slot run`, of weigeren met een volgende stap.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    // OpenRouter-sessie (claude-or) die een Orca-worker als gewone claude wil starten: weigeren met de
    // route via een claude-or-terminal (0.13.1; Orca-config blijft onaangeraakt).
    if (opOpenrouter() && orcaClaudeStart(e.command)) return { deny: ORCA_WEIGER }
    if ((await oud($)).slots) return next(e)
    if (await bypassed($)) return next(e)
    const c = classify(e.command)
    if (!c.kind || c.kind === 'self') return next(e)

    if (c.kind === 'unknown-heavy') {
      await logEvent($, 'unknown-heavy', { command: c.segment, full: maskSecrets(e.command).slice(0, 300), reason: c.reason })
      return next(e)
    }

    if (c.kind === 'agent') {
      const check = await cliJson($, ['check', 'agent', '--gate', 'floor'])
      if (check.ok) return next(e)
      await logEvent($, 'refuse', { kind: 'agent', tool: 'Bash', command: c.segment, reason: check.reason, memory: check.memory?.freePercent })
      return { deny: `futureflow slots: ${check.message ?? 'te weinig geheugen'}` }
    }

    if (hasShellBackground(e.command)) {
      await logEvent($, 'refuse', { kind: c.kind, tool: 'Bash', command: c.segment, reason: 'shell-background' })
      return { deny: `futureflow slots: start "${c.segment}" niet met een losse & op de achtergrond; dan kan het slot niet bijhouden wanneer het proces stopt. Gebruik in plaats daarvan run_in_background: true met hetzelfde commando zonder &.` }
    }

    const id = await session($)
    const check = await cliJson($, ['check', c.kind, '--session', id])
    // Uitgezet in het dashboard (of met `agent-slot config set enabled off`): niet inpakken.
    if (check.disabled) return next(e)
    if (!check.ok) {
      await logEvent($, 'refuse', { kind: c.kind, tool: 'Bash', command: c.segment, reason: check.reason, memory: check.memory?.freePercent })
      return { deny: `futureflow slots: ${check.message ?? 'geen slot vrij'}` }
    }
    const wrapped = wrapCommand(e.command, c.kind, cliPath($), { session: id, label: c.segment })
    if (produced.size > 500) produced.clear()
    produced.add(wrapped)
    return next({ ...e, command: wrapped })
  }).catch(vangOp as any)

  // Toestemming: het ingepakte commando beoordelen als het origineel, zodat bestaande regels blijven werken.
  // De invoer van tool.check ligt vast, dus vragen we het oordeel voor het origineel apart op.
  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    if ((await oud($)).slots) return next(e)
    const input = e.input as { command?: unknown }
    const cmd = input?.command
    const inner = typeof cmd === 'string' && produced.has(cmd) ? unwrapCommand(cmd) : null
    if (inner === null) return next(e)
    return $.tool.check({ tool: 'Bash', input: { ...input, command: inner } })
  })

  // Browser (Playwright MCP), nieuwe sessies/workflows en subagents.
  on('tool.call', async ($, e, next) => {
    if ((await oud($)).slots) return next(e)
    const tool = e.tool as string
    const isBrowser = isBrowserTool(tool)
    const isSession = SESSION_TOOLS.has(tool)
    const isAgent = tool === 'Agent'
    if (!isBrowser && !isSession && !isAgent) return next(e)
    if (await bypassed($)) return next(e)

    if (isBrowser) {
      const id = await session($)
      const got = await cliJson($, ['acquire', 'browser', '--session', id, '--tool', tool])
      if (!got.ok) return { deny: `futureflow slots: ${got.message ?? 'de browser is bezet'}` }
      const ran = await next(e)
      if (isBrowserClose(tool)) await cli($, ['release', 'browser', '--session', id, '--tool', tool]).catch(err => warn($, err))
      return ran
    }

    const check = await cliJson($, ['check', isAgent ? 'agent' : 'session', '--gate', isAgent ? 'critical' : 'floor'])
    if (check.ok) return next(e)
    await logEvent($, 'refuse', { kind: isAgent ? 'agent' : 'session', tool, reason: check.reason, memory: check.memory?.freePercent })
    const what = isAgent ? 'Geen nieuwe subagent gestart' : 'Geen nieuwe sessie of workflow gestart'
    return { deny: `futureflow slots: ${what}. ${check.message ?? 'te weinig geheugen'}` }
  }).catch(vangOp as any)

  // Browser-slot van deze sessie vrijgeven als de sessie stopt.
  on('session.end', async ($, e, next) => {
    stopSkins() // tikkers van de skin
    // Tab Accounts: eigen sessiebestand op weg (faalt open).
    await accountsSessieEinde($).catch(err => failOpen($, err))
    if ((await oud($)).slots) return next(e)
    if (sessionId) await cli($, ['release-session', '--session', sessionId]).catch(() => undefined)
    return next(e)
  })
}

// Twee kaarten naast elkaar als één Svg (desktop), in de stijl van de kaarten op het Overzicht.
type KaartInvoer = { vrij: number; totaalGB: number; toonKleur: string; slots: { kind: string; n: number; limit: number }[] }
type KaartKleuren = { mut: string; fg: string; vlak: string }
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
function slotsKaartenSvg(inv: KaartInvoer, c: KaartKleuren): string {
  const b = 190, hoogte = 104, gat = 12
  const lijn = c.mut
  const kaart = (i: number, titel: string, waarde: string, kleur: string, sub: string, fractie: number) => {
    const x = i * (b + gat)
    const f = Math.max(0, Math.min(1, fractie))
    return `<rect x="${x}" y="0" width="${b}" height="${hoogte}" rx="10" fill="${c.vlak}" stroke="${lijn}" stroke-opacity="0.35"/>` +
      `<text x="${x + 14}" y="24" font-size="11" fill="${c.mut}">${esc(titel)}</text>` +
      `<text x="${x + 14}" y="55" font-size="28" font-weight="600" fill="${kleur}">${esc(waarde)}</text>` +
      `<text x="${x + 14}" y="76" font-size="11" fill="${c.mut}">${esc(sub)}</text>` +
      `<rect x="${x + 14}" y="${hoogte - 14}" width="${b - 28}" height="4" rx="2" fill="${lijn}" fill-opacity="0.35"/>` +
      `<rect x="${x + 14}" y="${hoogte - 14}" width="${f * (b - 28)}" height="4" rx="2" fill="${kleur}"/>`
  }
  const bezet = inv.slots.reduce((t, s) => t + s.n, 0)
  const totaal = inv.slots.reduce((t, s) => t + s.limit, 0)
  const breed = 2 * b + gat
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${breed}" height="${hoogte}" viewBox="0 0 ${breed} ${hoogte}" font-family="-apple-system, 'Segoe UI', sans-serif">` +
    kaart(0, 'Geheugen vrij', `${Math.round(inv.vrij)}%`, inv.toonKleur, `van ${inv.totaalGB} GB`, inv.vrij / 100) +
    kaart(1, 'Slots bezet', `${bezet}/${totaal}`, c.fg, inv.slots.map(s => `${s.kind} ${s.n}/${s.limit}`).join(' · '), totaal === 0 ? 0 : bezet / totaal) +
    '</svg>'
}

// Inhoud van de tab Slots in het dashboard (was het losse paneel agent-slots), in kaarten.
// `meer`: ook de Svg-kaarten, weigeringen, cloud-workers en de bijwerkregel (Meer ▸ in tab Zuinig).
export async function slotsTab($: Engine, e: any, meer = true) {
    const el = $.ui.resolve(e)
    const { Box, Text } = el
    // Alleen de desktop tekent kaarten (Svg); de terminal krijgt tekst. `'Svg' in el` zegt in de terminal niets.
    const Svg = e.surface !== 'terminal' && 'Svg' in el ? el.Svg : undefined
    const k = await actieveKleuren($)
    const ui = paneelVan(el, e, k)
    if ((await oud($)).slots) return leeg(ui, 'De oude agent-slots-plugin staat nog aan en beheert dit onderdeel.')
    const snap = await read($, snapshot)
    if (!snap) return leeg(ui, 'Laden…')

    const { memory, config, slots, refusals } = snap
    const free = memory.freePercent
    const toon = meterToon(free, config.floorPercent, config.criticalPercent)
    const toonKleur = k[toon]
    const kaartSlots = Object.entries(config.limits).map(([kind, limit]) => ({ kind, n: slots.filter(s => s.kind === kind).length, limit }))
    const state = free < config.criticalPercent ? 'kritiek' : free < config.floorPercent ? 'krap: nieuwe zware taken worden geweigerd' : 'ok'

    const isOff = config.enabled === false
    const zetEnabled = async () => {
      await cli($, ['config', 'set', 'enabled', isOff ? 'on' : 'off'])
      await refresh($)
    }
    const zetOverflow = async () => {
      await cli($, ['config', 'set', 'cloudOverflow', config.cloudOverflow ? 'off' : 'on'])
      await refresh($)
    }

    return (
      <Box flexDirection="column" gap={1}>
        {meer && Svg ? (
          <Svg
            source={slotsKaartenSvg({ vrij: free, totaalGB: memory.totalGB, toonKleur, slots: kaartSlots }, k)}
            alt={`Geheugen: ${meterTekst(free, memory.totalGB)}. Slots: ${kaartSlots.map(c => `${c.kind} ${c.n}/${c.limit}`).join(', ')}`}
          />
        ) : null}

        {kaart(ui, 'Geheugen', [
          <Text color={toonKleur} bold>{meterTekst(free, memory.totalGB)}</Text>,
          meter(ui, free / 100, Math.min(24, ui.binnen), toonKleur),
          <Text color={k.mut}>grens {config.floorPercent}% · kritiek {config.criticalPercent}% · {state}</Text>,
        ], { rechts: state === 'ok' ? 'ok' : state === 'kritiek' ? 'kritiek' : 'krap' })}

        {kaart(ui, 'Slots', Object.entries(config.limits).map(([kind, limit]) => {
          const held = slots.filter(s => s.kind === kind)
          const full = held.length >= limit
          return (
            <Box key={`slot-${kind}`} flexDirection="column">
              <Text>
                <Text color={full ? k.warn : k.ok}>{'●'}</Text>
                {'  '}{kind.padEnd(8)}<Text color={k.mut}>bezet </Text>{held.length}/{limit}
              </Text>
              {held.map(holder => <Text color={k.mut} wrap="truncate-end">{'   '}{holderLine(holder)}</Text>)}
            </Box>
          )
        }))}

        {!meer ? null : kaart(ui, 'Laatste weigeringen', refusals.length === 0 ? leeg(ui, 'Geen — alles mocht door.') : [...refusals].reverse().map(r => (
          <Text wrap="truncate-end">
            <Text color={k.mut}>{clock(r.t)}  {(r.kind ?? r.tool ?? '').padEnd(8)}</Text><Text color={k.warn}>{r.reason ?? ''}</Text><Text color={k.mut}>  {r.command ?? ''}</Text>
          </Text>
        )))}

        {meer && (snap.overflow ?? []).length > 0 ? kaart(ui, 'Cloud-workers', [...(snap.overflow ?? [])].reverse().slice(0, 5).map(job => (
          <Box flexDirection="column">
            <Text wrap="truncate-end">
              <Text color={job.status === 'done' ? k.ok : k.warn}>{job.status === 'done' ? '✓' : '…'}</Text>
              {'  '}{job.branch.replace(/^overflow\//, '')}  <Text color={k.mut}>{job.status === 'done' ? `klaar ${clock(job.finished ?? job.started)}${job.delivered ? ' · gemeld' : ''}` : `loopt sinds ${clock(job.started)}`}</Text>
            </Text>
            {job.task ? <Text color={k.mut} wrap="truncate-end">{'   '}{job.task}</Text> : null}
            {job.error ? <Text color={k.err} wrap="truncate-end">{'   '}{job.error}</Text> : null}
          </Box>
        ))) : null}

        {kaart(ui, 'Instellingen', [
          vinkje(ui, 'enabled', !isOff, 'agent-slots aan', zetEnabled, 'a'),
          <Text color={isOff ? k.warn : k.mut}>
            {isOff
              ? 'Uit: niets wordt tegengehouden of ingepakt, in alle sessies op deze computer. Slots en geheugen hierboven zijn alleen ter info.'
              : 'Aan: zware commando\'s, browsers en sessies wachten als er geen slot of geheugen vrij is.'}
          </Text>,
          vinkje(ui, 'overflow', !!config.cloudOverflow, 'Cloud-overflow', zetOverflow, 'c'),
          <Text color={k.mut}>
            {config.cloudOverflow
              ? 'Aan: bij een weigering voor een taak (tests, builds, subagents) stelt de agent voor om hem uit te besteden aan een cloud-worker.'
              : 'Uit: bij een weigering wacht de agent tot er lokaal plek is.'}
          </Text>,
        ])}

        {!meer ? null : <Text color={k.mut}>
          Bijgewerkt {clock(snap.at)}{snap.error ? ` · fout: ${snap.error.slice(0, 80)}` : ''} · /agent-slots status voor tekst
        </Text>}
      </Box>
    )
}
