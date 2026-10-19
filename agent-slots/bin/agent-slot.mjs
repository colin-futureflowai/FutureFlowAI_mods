#!/usr/bin/env node
// agent-slot — gedeelde slots voor zware processen (dev-servers, tests, browser) over alle
// sessies en worktrees heen, met een geheugengrens. Alleen Node-builtins: dit ene bestand
// wordt ook los gekopieerd naar ~/.claude/agent-slots/bin/ en via een shim op het PATH gezet.
//
//   agent-slot run <soort> [--wait <s>] [--session <id>] -- <cmd…>
//   agent-slot wait <soort> [--timeout <s>]
//   agent-slot check <soort> [--session <id>] [--gate floor|critical]   (JSON)
//   agent-slot acquire|touch|release browser --session <id>               (JSON)
//   agent-slot release-session --session <id>
//   agent-slot status [--json]
//   agent-slot kill-idle
//   agent-slot log <event> [json]
//   agent-slot install [--shim]

import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HOME = process.env.AGENT_SLOT_HOME || path.join(os.homedir(), '.claude', 'agent-slots')
const LOCKS = path.join(HOME, 'locks')
const LOG = path.join(HOME, 'log.jsonl')
const CONFIG = path.join(HOME, 'config.json')
const JOBS = path.join(HOME, 'overflow.json')
const IS_WIN = process.platform === 'win32'
const TEMPFAIL = 75

const DEFAULTS = {
  limits: { dev: 2, test: 1, browser: 1 },
  floorPercent: 25,
  criticalPercent: 10,
  browserIdleMinutes: 10,
  waitTimeoutSeconds: 540,
  // Aan: weigeringen voor taken (tests, builds, subagents, sessies) noemen ook uitbesteden aan een cloud-worker.
  cloudOverflow: false,
}

// ---------- config, log ----------

function config() {
  let user = {}
  try { user = JSON.parse(fs.readFileSync(CONFIG, 'utf8')) } catch {}
  return { ...DEFAULTS, ...user, limits: { ...DEFAULTS.limits, ...(user.limits ?? {}) } }
}

function log(event, data = {}) {
  try {
    fs.mkdirSync(HOME, { recursive: true })
    fs.appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), event, ...data }) + '\n')
  } catch {}
}

function readLog(limit = 2000) {
  try {
    const lines = fs.readFileSync(LOG, 'utf8').trim().split('\n')
    return lines.slice(-limit).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}

// Hoe de gebruiker/agent de CLI aanroept in meldingen: `agent-slot` als dat op het PATH
// staat (na /agent-slots install), anders het volledige pad naar dit bestand.
let invokeCache
function invoke() {
  if (invokeCache) return invokeCache
  const names = IS_WIN ? ['agent-slot.cmd', 'agent-slot.exe'] : ['agent-slot']
  const onPath = (process.env.PATH ?? '').split(path.delimiter).some(dir => names.some(n => { try { return fs.statSync(path.join(dir, n)).isFile() } catch { return false } }))
  let self = fileURLToPath(import.meta.url)
  try { self = fs.realpathSync(self) } catch {}
  return (invokeCache = onPath ? 'agent-slot' : `node '${self}'`)
}
const cmd = rest => `\`${invoke()} ${rest}\``

// Lokale tijd voor meldingen en status (het log zelf blijft UTC/ISO).
const localTime = iso => {
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  const time = d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return today ? time : `${d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })} ${time}`
}

// ---------- geheugen ----------

// Vrij geheugen als percentage. macOS houdt "vrij" bewust laag (cache), dus daar de
// systeemwaarde van memory_pressure; Linux MemAvailable; Windows os.freemem() (beschikbaar).
export function memory() {
  const fake = process.env.AGENT_SLOT_FAKE_FREE
  const total = os.totalmem()
  if (fake) return { freePercent: Number(fake), totalGB: +(total / 2 ** 30).toFixed(1), source: 'fake' }
  let freePercent = null
  let source = 'os.freemem'
  try {
    if (process.platform === 'darwin') {
      const out = execFileSync('/usr/bin/memory_pressure', ['-Q'], { encoding: 'utf8', timeout: 3000 })
      const m = /free percentage:\s*(\d+)%/.exec(out)
      if (m) { freePercent = Number(m[1]); source = 'memory_pressure' }
    } else if (process.platform === 'linux') {
      const info = fs.readFileSync('/proc/meminfo', 'utf8')
      const avail = /MemAvailable:\s+(\d+) kB/.exec(info)
      const tot = /MemTotal:\s+(\d+) kB/.exec(info)
      if (avail && tot) { freePercent = Math.round((100 * Number(avail[1])) / Number(tot[1])); source = 'MemAvailable' }
    }
  } catch {}
  if (freePercent === null) freePercent = Math.round((100 * os.freemem()) / total)
  return { freePercent, totalGB: +(total / 2 ** 30).toFixed(1), source }
}

// ---------- processen ----------

function pidExists(pid) {
  if (!pid) return false
  try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
}

// Starttijd van een proces als tekst, zodat een hergebruikte PID niet voor levend doorgaat.
export function procStart(pid) {
  if (!pid) return null
  try {
    if (IS_WIN) {
      return execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${Number(pid)}).StartTime.ToString('o')`], { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim() || null
    }
    if (process.platform === 'linux') {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
      return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? null // starttime in ticks sinds boot
    }
    return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', timeout: 3000 }).trim() || null
  } catch { return null }
}

function procAlive(pid, start) {
  if (!pidExists(pid)) return false
  if (!start) return true
  const now = procStart(pid)
  return now === null ? true : now === start
}

// Alle nakomelingen van een proces (om een dev-server met kinderen netjes te stoppen).
function descendants(pid) {
  if (IS_WIN) return []
  try {
    const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8', timeout: 3000 })
      .trim().split('\n').map(l => l.trim().split(/\s+/).map(Number))
    const out = []
    const walk = p => { for (const [c, pp] of rows) if (pp === p) { out.push(c); walk(c) } }
    walk(pid)
    return out
  } catch { return [] }
}

function killTree(pid, signal = 'SIGTERM') {
  if (!pid) return
  if (IS_WIN) {
    try { execFileSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true }) } catch {}
    return
  }
  for (const p of [...descendants(pid).reverse(), pid]) { try { process.kill(p, signal) } catch {} }
}

// ---------- locks ----------

function lockFiles() {
  try { return fs.readdirSync(LOCKS).filter(f => f.endsWith('.json')).map(f => path.join(LOCKS, f)) } catch { return [] }
}

function readLock(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8')
    return { ...JSON.parse(raw), file }
  } catch {
    // Net aangemaakt en nog leeg: even laten staan; ouder dan 10 s is het rommel.
    try { if (Date.now() - fs.statSync(file).mtimeMs < 10_000) return { file, kind: path.basename(file).split('-')[0], pending: true } } catch { return null }
    return { file, broken: true }
  }
}

function isAlive(lock, cfg) {
  if (lock.pending) return true
  if (lock.broken) return false
  if (lock.pid || lock.childPid) {
    if (procAlive(lock.pid, lock.pidStart) || procAlive(lock.childPid, lock.childStart)) return true
    return false
  }
  // Browser-slot van een sessie: leeft zolang hij recent gebruikt is.
  const idleMs = cfg.browserIdleMinutes * 60_000
  return Date.now() - Date.parse(lock.lastUsed ?? lock.since ?? 0) < idleMs
}

// Ruimt dode en verlopen slots op; geeft de levende terug.
function reap(cfg = config()) {
  const alive = []
  for (const file of lockFiles()) {
    const lock = readLock(file)
    if (!lock) continue
    if (isAlive(lock, cfg)) { alive.push(lock); continue }
    try { fs.unlinkSync(file) } catch {}
    log('reap', { kind: lock.kind, session: lock.session, cwd: lock.cwd, command: lock.command, pid: lock.pid, reason: lock.broken ? 'broken' : lock.pid || lock.childPid ? 'process-dead' : 'idle' })
  }
  return alive
}

function holderText(l) {
  const who = l.session ? `sessie ${String(l.session).slice(0, 8)}` : l.pid ? `pid ${l.childPid ?? l.pid}` : 'onbekend'
  const where = l.cwd ? ` in ${l.cwd.replace(os.homedir(), '~')}` : ''
  const what = l.command ? ` (${String(l.command).slice(0, 80)})` : ''
  return `${who}${where}${what}, sinds ${l.since ? localTime(l.since) : '?'}`
}

// Mag er nu een slot van deze soort bij? `gate` is de geheugengrens voor aanroepen zonder slot.
// Uitweg naar de cloud, alleen voor taken: een dev-server of browser is een preview die lokaal hoort.
const OVERFLOW_KINDS = new Set(['test', 'agent', 'session', 'unknown-heavy'])
function withOverflow(result, kind, cfg) {
  if (result.ok || !cfg.cloudOverflow || !OVERFLOW_KINDS.has(kind)) return result
  return {
    ...result,
    overflow: true,
    message: `${result.message} Cloud-overflow staat aan: is dit een afgebakende taak, besteed hem dan uit aan een cloud-worker (skill cloud-overflow, agent-type agent-slots:cloud-worker). Push eerst je werk naar een eigen branch en leg het voor aan de gebruiker voordat je pusht.`,
  }
}

export function check(kind, opts = {}) {
  const cfg = config()
  return withOverflow(checkRaw(kind, opts, cfg), kind, cfg)
}

function checkRaw(kind, { session, gate = 'floor' } = {}, cfg) {
  const alive = reap(cfg)
  const mem = memory()
  const threshold = gate === 'critical' ? cfg.criticalPercent : cfg.floorPercent
  const mine = session ? alive.find(l => l.kind === kind && l.session === session && !l.pid) : null
  if (mine) return { ok: true, reuse: true, lock: mine, memory: mem }
  if (mem.freePercent < threshold) {
    return {
      ok: false, reason: 'memory', memory: mem, threshold,
      message: `Te weinig vrij geheugen: ${mem.freePercent}% vrij, de grens is ${threshold}%. Rond eerst lopend werk af of stop een dev-server die je niet meer nodig hebt (${cmd('status')} laat zien wat er draait), en probeer het daarna opnieuw. Of wacht met: ${cmd(`wait ${kind}${gate === 'critical' ? ' --gate critical' : ''}`)}`,
    }
  }
  const limit = cfg.limits[kind]
  if (limit === undefined) return { ok: true, memory: mem }
  const holders = alive.filter(l => l.kind === kind)
  if (holders.length < limit) return { ok: true, memory: mem, used: holders.length, limit }
  return {
    ok: false, reason: 'slots', memory: mem, used: holders.length, limit,
    holders: holders.map(l => ({ session: l.session, cwd: l.cwd, command: l.command, since: l.since, pid: l.childPid ?? l.pid })),
    message: `Alle ${limit} ${kind}-slot${limit === 1 ? '' : 's'} zijn bezet: ${holders.map(holderText).join('; ')}. Volgende stap: draai ${cmd(`wait ${kind}`)} (wacht tot er plek is, max. ${Math.round(cfg.waitTimeoutSeconds / 60)} min) en probeer het dan opnieuw, of hergebruik de server die al draait.`,
  }
}

// Probeert atomair een slot te pakken; geeft het lockbestand of null.
function tryAcquire(kind, data) {
  const cfg = config()
  fs.mkdirSync(LOCKS, { recursive: true })
  const limit = cfg.limits[kind] ?? 1
  for (let n = 1; n <= limit; n++) {
    const file = path.join(LOCKS, `${kind}-${n}.json`)
    try {
      fs.writeFileSync(file, JSON.stringify({ kind, ...data }), { flag: 'wx' })
      return file
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
    }
  }
  return null
}

function acquire(kind, data, { session } = {}) {
  const c = check(kind, { session })
  if (c.reuse) return { ok: true, file: c.lock.file, reuse: true }
  if (!c.ok) return c
  const file = tryAcquire(kind, data)
  if (!file) return { ...check(kind, { session }), ok: false }
  log('acquire', { kind, session: data.session, cwd: data.cwd, command: data.command, pid: data.pid, memory: c.memory.freePercent })
  // pid is altijd het proces dat het slot houdt (bij `run` de wrapper); childPid staat erbij zodra bekend.
  return { ok: true, file }
}

function updateLock(file, patch) {
  try {
    const cur = JSON.parse(fs.readFileSync(file, 'utf8'))
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ ...cur, ...patch }))
    fs.renameSync(tmp, file)
  } catch {}
}

function release(file, reason = 'release', extra = {}) {
  let lock = null
  try { lock = JSON.parse(fs.readFileSync(file, 'utf8')) } catch {}
  try { fs.unlinkSync(file) } catch { return }
  log(reason, { kind: lock?.kind, session: lock?.session, cwd: lock?.cwd, command: lock?.command, pid: lock?.pid, childPid: lock?.childPid, ...extra })
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ---------- opdrachten ----------

function parseArgs(argv) {
  const opts = {}
  const pos = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') { opts['--'] = argv.slice(i + 1); break }
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const val = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true
      opts[key] = val
    } else pos.push(a)
  }
  return { pos, opts }
}

const out = obj => process.stdout.write(JSON.stringify(obj) + '\n')

async function cmdRun(kind, opts) {
  const cmd = opts['--']
  if (!kind || !cmd?.length) { console.error('gebruik: agent-slot run <soort> [--wait <s>] -- <commando…>'); return 2 }
  const cfg = config()
  const waitS = opts.wait === true ? cfg.waitTimeoutSeconds : Number(opts.wait ?? 30)
  const full = cmd[0] === 'sh' && cmd[1] === '-c' ? cmd[2] : cmd.join(' ')
  // `--label` is het zware deel (bv. `pnpm dev` uit `cd web && pnpm dev`), voor leesbare meldingen.
  const command = typeof opts.label === 'string' ? opts.label : full
  const data = { session: opts.session ?? process.env.CLAUDE_SESSION_ID, cwd: process.cwd(), command, pid: process.pid, pidStart: procStart(process.pid), since: new Date().toISOString() }

  const deadline = Date.now() + waitS * 1000
  let got = acquire(kind, data)
  let waited = false
  while (!got.ok && Date.now() < deadline) {
    if (!waited) { console.error(`[agent-slot] wachten op een ${kind}-slot: ${got.message}`); waited = true }
    await sleep(2000)
    got = acquire(kind, data)
  }
  if (!got.ok) {
    log('refuse', { kind, via: 'run', cwd: data.cwd, command, session: data.session, reason: got.reason, memory: got.memory?.freePercent })
    console.error(`[agent-slot] geweigerd: ${got.message}`)
    return TEMPFAIL
  }
  const file = got.file

  const child = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit', env: { ...process.env, AGENT_SLOT_HELD: kind } })
  updateLock(file, { childPid: child.pid, childStart: procStart(child.pid) })

  let stopping = false
  const stop = sig => {
    if (stopping) return
    stopping = true
    killTree(child.pid, sig)
  }
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => stop(sig))

  const code = await new Promise(resolve => {
    child.on('error', err => { console.error(`[agent-slot] kon niet starten: ${err.message}`); resolve(127) })
    child.on('exit', (c, s) => resolve(c ?? (s ? 128 + (os.constants.signals[s] ?? 15) : 1)))
  })
  release(file)
  return code
}

async function cmdWait(kind, opts) {
  if (!kind) { console.error('gebruik: agent-slot wait <soort> [--timeout <s>]'); return 2 }
  const cfg = config()
  const timeout = Number(opts.timeout ?? cfg.waitTimeoutSeconds)
  const deadline = Date.now() + timeout * 1000
  const gate = opts.gate === 'critical' ? 'critical' : 'floor'
  let c = check(kind, { session: opts.session, gate })
  if (!c.ok) console.error(`[agent-slot] wachten: ${c.message}`)
  while (!c.ok && Date.now() < deadline) {
    await sleep(2000)
    c = check(kind, { session: opts.session, gate })
  }
  if (c.ok) { console.log(`Er is een ${kind}-slot vrij (${c.memory.freePercent}% geheugen vrij). Start je commando nu.`); return 0 }
  console.log(`Na ${timeout} s nog geen ${kind}-slot vrij: ${c.message}`)
  return TEMPFAIL
}

function cmdBrowser(action, opts) {
  const session = opts.session
  if (!session) { out({ ok: false, message: '--session ontbreekt' }); return 2 }
  const cfg = config()
  if (action === 'release') {
    for (const l of reap(cfg)) if (l.kind === 'browser' && l.session === session && !l.pid) release(l.file, 'release', { tool: opts.tool })
    out({ ok: true }); return 0
  }
  const alive = reap(cfg)
  const mine = alive.find(l => l.kind === 'browser' && l.session === session && !l.pid)
  if (mine) { updateLock(mine.file, { lastUsed: new Date().toISOString() }); out({ ok: true, reuse: true }); return 0 }
  if (action === 'touch') { out({ ok: false, message: 'geen browser-slot voor deze sessie' }); return 0 }
  const now = new Date().toISOString()
  const got = acquire('browser', { session, cwd: opts.cwd ?? process.cwd(), command: 'Playwright MCP-browser', tool: opts.tool, since: now, lastUsed: now }, { session })
  if (!got.ok) {
    const idle = cfg.browserIdleMinutes
    log('refuse', { kind: 'browser', via: 'mcp', session, reason: got.reason, memory: got.memory?.freePercent })
    out({ ...got, message: got.reason === 'slots' ? `${got.message.replace(/Volgende stap:.*/, '')}De browser komt vanzelf vrij na ${idle} min zonder gebruik. Volgende stap: draai ${cmd('wait browser')} en probeer het daarna opnieuw.` : got.message })
    return 0
  }
  out({ ok: true }); return 0
}

function cmdReleaseSession(opts) {
  if (!opts.session) return 2
  for (const l of reap()) if (l.session === opts.session && !l.pid) release(l.file, 'release-session')
  return 0
}

function cmdStatus(opts) {
  const cfg = config()
  const alive = reap(cfg)
  const mem = memory()
  const refusals = readLog().filter(e => e.event === 'refuse').slice(-5)
  const unknown = readLog().filter(e => e.event === 'unknown-heavy').slice(-5)
  if (opts.json) { out({ memory: mem, config: cfg, slots: alive.map(({ file, ...l }) => l), refusals, unknown, overflow: readJobs().slice(-8) }); return 0 }
  const lines = [`Geheugen: ${mem.freePercent}% vrij van ${mem.totalGB} GB (grens ${cfg.floorPercent}%, kritiek ${cfg.criticalPercent}%)`, '']
  for (const [kind, limit] of Object.entries(cfg.limits)) {
    const held = alive.filter(l => l.kind === kind)
    lines.push(`${kind}: ${held.length}/${limit}`)
    for (const l of held) lines.push(`  - ${holderText(l)}`)
  }
  lines.push('', refusals.length ? 'Laatste weigeringen (nieuwste eerst):' : 'Geen weigeringen.')
  for (const r of [...refusals].reverse()) lines.push(`  ${localTime(r.t)}  ${r.kind ?? r.tool ?? ''}  ${r.reason ?? ''}  ${String(r.command ?? r.tool ?? '').slice(0, 70)}`)
  if (unknown.length) {
    lines.push('', 'Doorgelaten twijfelgevallen (om de regels aan te scherpen):')
    for (const u of [...unknown].reverse()) lines.push(`  ${localTime(u.t)}  ${String(u.command ?? '').slice(0, 70)}`)
  }
  lines.push('', `Log: ${LOG}`)
  console.log(lines.join('\n'))
  return 0
}

function cmdKillIdle() {
  const before = lockFiles().length
  const alive = reap()
  console.log(`${before - alive.length} slot(s) opgeruimd, ${alive.length} in gebruik.`)
  log('kill-idle', { freed: before - alive.length })
  return 0
}

function cmdInstall(opts) {
  const self = fileURLToPath(import.meta.url)
  const binDir = path.join(HOME, 'bin')
  const target = path.join(binDir, 'agent-slot.mjs')
  fs.mkdirSync(binDir, { recursive: true })
  if (path.resolve(self) !== path.resolve(target)) {
    const src = fs.readFileSync(self)
    let same = false
    try { same = fs.readFileSync(target).equals(src) } catch {}
    if (!same) { fs.writeFileSync(`${target}.tmp`, src); fs.renameSync(`${target}.tmp`, target) }
  }
  if (!opts.shim) { if (!opts.quiet) console.log(`CLI staat in ${target}`); return 0 }

  const shimDir = path.join(os.homedir(), '.local', 'bin')
  fs.mkdirSync(shimDir, { recursive: true })
  const shim = IS_WIN ? path.join(shimDir, 'agent-slot.cmd') : path.join(shimDir, 'agent-slot')
  const body = IS_WIN
    ? `@echo off\r\nnode "%USERPROFILE%\\.claude\\agent-slots\\bin\\agent-slot.mjs" %*\r\n`
    : `#!/bin/sh\nexec node "$HOME/.claude/agent-slots/bin/agent-slot.mjs" "$@"\n`
  fs.writeFileSync(shim, body, { mode: 0o755 })
  const onPath = (process.env.PATH ?? '').split(path.delimiter).some(p => path.resolve(p) === path.resolve(shimDir))
  console.log(`agent-slot staat in ${shim}.`)
  if (!onPath) {
    console.log(IS_WIN
      ? `Let op: ${shimDir} staat nog niet op je PATH. Voeg het toe via Systeeminstellingen > Omgevingsvariabelen.`
      : `Let op: ${shimDir} staat nog niet op je PATH. Voeg dit toe aan ~/.zshrc of ~/.bashrc:\n  export PATH="$HOME/.local/bin:$PATH"`)
  }
  log('install', { shim })
  return 0
}

// Instellingen lezen of één waarde zetten in config.json (gedeeld door alle sessies).
const SETTABLE = { cloudOverflow: 'bool', floorPercent: 'number', criticalPercent: 'number', browserIdleMinutes: 'number' }
// ---------- cloud-overflow: taken die in een cloud-sessie lopen ----------
//
// Een cloud-sessie kan niet terugpraten. Het terugkanaal is git: de worker pusht naar
// overflow/<…> en sluit af met een commit `overflow: rapport …`. `overflow check` kijkt
// op de remote of dat rapport er is; de mod meldt het dan aan de sessie die de taak startte.

const TRAILER = 'Agent-Slots-Overflow: cloud-worker'
const REPORT_PREFIX = 'overflow: rapport'

function readJobs() {
  try { return JSON.parse(fs.readFileSync(JOBS, 'utf8')) } catch { return [] }
}
function writeJobs(jobs) {
  fs.mkdirSync(HOME, { recursive: true })
  fs.writeFileSync(`${JOBS}.tmp`, JSON.stringify(jobs.slice(-50), null, 2) + '\n')
  fs.renameSync(`${JOBS}.tmp`, JOBS)
}
const git = (repo, args, timeout = 20_000) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const slug = s => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'taak'
const today = () => new Date().toISOString().slice(0, 10).replace(/-/g, '')

// De volledige opdracht voor een cloud-worker: de taak plus de vaste werkwijze en git-conventies.
export function brief({ task, base, branch }) {
  return `Je bent een cloud-worker van agent-slots (overflow-taak). Je werkt zelfstandig en kunt niet terugpraten: alles wat je wilt melden gaat in je rapportcommit.

1. Maak branch \`${branch}\` vanaf \`origin/${base}\` (git fetch origin eerst). Werk nooit op ${base === 'main' ? '\`main\` zelf' : `\`main\` of op \`${base}\` zelf`}.
2. Taak:
${task}
   Lees eerst CLAUDE.md als die er is en houd je aan de conventies van de repo. Blijf binnen de taak; wat erbuiten valt zet je onder Open.
3. Elke commit krijgt onderaan deze trailers:
${TRAILER}
Overflow-Base: ${base}
Overflow-Task: ${String(task).split('\n')[0].slice(0, 80)}
4. Laatste commit (mag leeg, --allow-empty): onderwerp \`${REPORT_PREFIX} ${branch.replace(/^overflow\//, '')}\`, body met de kopjes Gedaan, Tests (wat gedraaid, uitslag) en Open, met dezelfde trailers. Deze commit is het signaal dat je klaar bent: maak hem pas als alles gepusht kan worden.
5. Push naar origin \`${branch}\`. Geen PR, niets naar main of \`${base}\`, geen deploys of berichten.
6. Ontbreekt er iets (secrets, toegang, onduidelijke opdracht), maak dan toch de rapportcommit en zet onder Open precies wat er nodig is.`
}

function cmdOverflow(pos, opts) {
  const [action, id] = pos
  const repo = path.resolve(typeof opts.repo === 'string' ? opts.repo : process.cwd())

  if (action === 'brief') {
    const task = typeof opts.task === 'string' ? opts.task : ''
    if (!task) { console.error('gebruik: agent-slot overflow brief --task "<taak>" [--base <branch>] [--branch overflow/…]'); return 2 }
    const base = typeof opts.base === 'string' ? opts.base : (() => { try { return git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']) } catch { return 'main' } })()
    const branch = typeof opts.branch === 'string' ? opts.branch : `overflow/${today()}-${slug(task)}`
    console.log(brief({ task, base, branch }))
    return 0
  }

  if (action === 'add') {
    const branch = opts.branch
    if (typeof branch !== 'string' || !branch.startsWith('overflow/')) { console.error('--branch overflow/<naam> is verplicht'); return 2 }
    let top = repo
    try { top = git(repo, ['rev-parse', '--show-toplevel']) } catch { console.error(`${repo} is geen git-repo`); return 2 }
    const job = {
      id: `${Date.now().toString(36)}-${slug(branch.replace(/^overflow\//, ''))}`,
      repo: top,
      branch,
      base: typeof opts.base === 'string' ? opts.base : 'main',
      task: typeof opts.task === 'string' ? opts.task.split('\n')[0].slice(0, 120) : '',
      session: typeof opts.session === 'string' ? opts.session : process.env.CLAUDE_SESSION_ID,
      cloudSession: typeof opts['cloud-session'] === 'string' ? opts['cloud-session'] : undefined,
      started: new Date().toISOString(),
      status: 'running',
    }
    writeJobs([...readJobs(), job])
    log('overflow-add', { id: job.id, branch, repo: top, session: job.session })
    out({ ok: true, job })
    return 0
  }

  if (action === 'check') {
    const jobs = readJobs()
    const finished = []
    for (const job of jobs) {
      if (job.status !== 'running') continue
      if (typeof opts.session === 'string' && job.session !== opts.session) continue
      try {
        const remote = git(job.repo, ['ls-remote', 'origin', `refs/heads/${job.branch}`])
        if (!remote) continue
        const sha = remote.split(/\s+/)[0]
        if (job.lastSeen === sha) continue
        job.lastSeen = sha
        git(job.repo, ['fetch', '-q', 'origin', `+refs/heads/${job.branch}:refs/remotes/origin/${job.branch}`], 60_000)
        const subject = git(job.repo, ['log', '-1', '--format=%s', sha])
        if (!subject.startsWith(REPORT_PREFIX)) { job.progress = subject; continue }
        job.status = 'done'
        job.finished = new Date().toISOString()
        job.commit = sha.slice(0, 7)
        job.report = git(job.repo, ['log', '-1', '--format=%b', sha]).split('\n').filter(l => !/^(Agent-Slots-Overflow|Overflow-[A-Za-z]+|Co-Authored-By):/i.test(l)).join('\n').trim().slice(0, 4000)
        job.delivered = false
        log('overflow-done', { id: job.id, branch: job.branch, commit: job.commit })
        finished.push(job)
      } catch (err) {
        job.error = String(err.stderr ?? err.message ?? err).trim().slice(0, 200)
      }
    }
    writeJobs(jobs)
    const undelivered = jobs.filter(j => j.status === 'done' && !j.delivered && (typeof opts.session !== 'string' || j.session === opts.session))
    out({ ok: true, running: jobs.filter(j => j.status === 'running').length, finished: undelivered })
    return 0
  }

  if (action === 'delivered' || action === 'remove') {
    const jobs = readJobs()
    const next = action === 'remove' ? jobs.filter(j => j.id !== id) : jobs.map(j => (j.id === id ? { ...j, delivered: true } : j))
    writeJobs(next)
    out({ ok: true })
    return 0
  }

  // list
  const jobs = readJobs().filter(j => typeof opts.session !== 'string' || j.session === opts.session)
  out({ ok: true, jobs })
  return 0
}

function cmdConfig(pos, opts) {
  const [action, key, raw] = pos
  if (action !== 'set') { out(config()); return 0 }
  const type = SETTABLE[key]
  if (!type) { console.error(`onbekende instelling: ${key} (kan: ${Object.keys(SETTABLE).join(', ')})`); return 2 }
  const value = type === 'bool' ? ['on', 'true', '1', 'aan'].includes(String(raw).toLowerCase()) : Number(raw)
  if (type === 'number' && !Number.isFinite(value)) { console.error(`${key} moet een getal zijn`); return 2 }
  let cur = {}
  try { cur = JSON.parse(fs.readFileSync(CONFIG, 'utf8')) } catch {}
  fs.mkdirSync(HOME, { recursive: true })
  fs.writeFileSync(`${CONFIG}.tmp`, JSON.stringify({ ...cur, [key]: value }, null, 2) + '\n')
  fs.renameSync(`${CONFIG}.tmp`, CONFIG)
  log('config', { key, value })
  out({ ok: true, [key]: value })
  return 0
}

export async function main(argv) {
  const [cmd, ...rest] = argv
  const { pos, opts } = parseArgs(rest)
  switch (cmd) {
    case 'run': return cmdRun(pos[0], opts)
    case 'wait': return cmdWait(pos[0], opts)
    case 'check': out(check(pos[0], { session: opts.session, gate: opts.gate })); return 0
    case 'acquire': case 'touch': case 'release':
      if (pos[0] !== 'browser') { console.error(`${cmd} werkt alleen voor browser; gebruik run voor processen`); return 2 }
      return cmdBrowser(cmd, opts)
    case 'release-session': return cmdReleaseSession(opts)
    case 'status': return cmdStatus(opts)
    case 'kill-idle': return cmdKillIdle()
    case 'log': { let data = {}; try { data = JSON.parse(pos[1] ?? '{}') } catch {} log(pos[0] ?? 'note', data); return 0 }
    case 'install': return cmdInstall(opts)
    case 'memory': out(memory()); return 0
    case 'config': return cmdConfig(pos, opts)
    case 'overflow': return cmdOverflow(pos, opts)
    default:
      console.log(`agent-slot — gedeelde slots voor dev-servers, tests en de browser

  agent-slot run <dev|test|browser> [--wait <s>] -- <commando…>
  agent-slot wait <soort> [--timeout <s>]
  agent-slot status [--json]
  agent-slot kill-idle
  agent-slot install --shim        zet agent-slot op je PATH (~/.local/bin)
  agent-slot config set cloudOverflow on|off
  agent-slot overflow brief --task "<taak>" [--base <branch>]   opdracht voor een cloud-worker
  agent-slot overflow add --branch overflow/<naam> --base <branch> --task "<taak>" [--session <id>]
  agent-slot overflow check | list | delivered <id> | remove <id>

Instellingen: ${CONFIG}
Log: ${LOG}`)
      return cmd ? 2 : 0
  }
}

// Hoofdscript? Via realpath vergelijken: bij een symlink (dev-mods, shim) wijst argv[1]
// naar de link en import.meta.url naar het echte bestand.
const isMain = (() => {
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)) } catch { return false }
})()

if (isMain) {
  main(process.argv.slice(2)).then(code => process.exit(code ?? 0), err => { console.error(`[agent-slot] ${err.stack ?? err}`); process.exit(1) })
}
