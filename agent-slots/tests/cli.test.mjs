// node --test agent-slots/tests/
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../bin/agent-slot.mjs', import.meta.url))
let home

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-slot-test-'))
})

const env = (extra = {}) => ({ ...process.env, AGENT_SLOT_HOME: home, AGENT_SLOT_FAKE_FREE: '60', ...extra })
const cli = (args, extra) => spawnSync(process.execPath, [CLI, ...args], { env: env(extra), encoding: 'utf8' })
const json = (args, extra) => JSON.parse(cli(args, extra).stdout)
const locks = () => { try { return fs.readdirSync(path.join(home, 'locks')).filter(f => f.endsWith('.json')) } catch { return [] } }
const writeConfig = c => fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(c))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const waitFor = async (fn, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await sleep(50) } return false }

// Start `agent-slot run` op de achtergrond met een commando dat blijft lopen.
function startRun(kind, extra = {}, cmd = ['sh', '-c', 'cd . && sleep 30'], label = 'sleep 30') {
  return spawn(process.execPath, [CLI, 'run', kind, '--wait', '0', '--label', label, '--', ...cmd], { env: env(extra), stdio: 'ignore' })
}

test('run houdt het slot vast zolang het proces leeft en geeft het daarna vrij', () => {
  const r = cli(['run', 'test', '--', 'sh', '-c', 'exit 3'])
  assert.equal(r.status, 3, 'exitcode van het kind wordt doorgegeven')
  assert.deepEqual(locks(), [])
  const log = fs.readFileSync(path.join(home, 'log.jsonl'), 'utf8')
  assert.match(log, /"event":"acquire"/)
  assert.match(log, /"event":"release"/)
})

test('limiet bereikt: weigering noemt de houder en de volgende stap', async () => {
  writeConfig({ limits: { dev: 1 } })
  const a = startRun('dev')
  assert.ok(await waitFor(() => locks().length === 1))
  const c = json(['check', 'dev'])
  assert.equal(c.ok, false)
  assert.equal(c.reason, 'slots')
  assert.match(c.message, /agent-slot wait dev/)
  assert.match(c.message, /sleep 30/)
  const r = cli(['run', 'dev', '--wait', '0', '--', 'sh', '-c', 'true'])
  assert.equal(r.status, 75)
  assert.match(r.stderr, /geweigerd/)
  a.kill('SIGTERM')
  assert.ok(await waitFor(() => locks().length === 0), 'slot vrij na kill')
  assert.equal(json(['check', 'dev']).ok, true)
})

test('kill van het kind maakt het slot direct vrij', async () => {
  const a = startRun('dev')
  assert.ok(await waitFor(() => locks().length === 1))
  const lock = JSON.parse(fs.readFileSync(path.join(home, 'locks', locks()[0]), 'utf8'))
  assert.ok(await waitFor(() => { try { return !!JSON.parse(fs.readFileSync(path.join(home, 'locks', locks()[0]), 'utf8')).childPid } catch { return false } }))
  const { childPid } = JSON.parse(fs.readFileSync(path.join(home, 'locks', locks()[0]), 'utf8'))
  process.kill(childPid, 'SIGTERM')
  assert.ok(await waitFor(() => locks().length === 0))
  assert.ok(lock.pidStart, 'starttijd van het proces is vastgelegd')
  a.kill()
})

test('slot van een dood proces wordt opgeruimd (na crash of herstart)', () => {
  fs.mkdirSync(path.join(home, 'locks'), { recursive: true })
  const dead = spawnSync('sh', ['-c', 'echo $$']).stdout.toString().trim()
  fs.writeFileSync(path.join(home, 'locks', 'dev-1.json'), JSON.stringify({ kind: 'dev', pid: Number(dead), pidStart: 'x', since: new Date().toISOString() }))
  assert.equal(json(['check', 'dev']).ok, true)
  assert.deepEqual(locks(), [])
  assert.match(fs.readFileSync(path.join(home, 'log.jsonl'), 'utf8'), /"event":"reap".*process-dead/)
})

test('hergebruikte PID met andere starttijd telt niet als levend', () => {
  writeConfig({ limits: { dev: 1 } })
  fs.mkdirSync(path.join(home, 'locks'), { recursive: true })
  // Ons eigen proces leeft, maar met een andere starttijd dan in het slot staat.
  fs.writeFileSync(path.join(home, 'locks', 'dev-1.json'), JSON.stringify({ kind: 'dev', pid: process.pid, pidStart: 'Mon Jan  1 00:00:00 2001', since: new Date().toISOString() }))
  assert.equal(json(['check', 'dev']).ok, true)
  assert.deepEqual(locks(), [])
})

test('browser-slot hoort bij een sessie en verloopt na stilte', async () => {
  const a = json(['acquire', 'browser', '--session', 'sessie-a'])
  assert.equal(a.ok, true)
  assert.equal(json(['acquire', 'browser', '--session', 'sessie-a']).reuse, true, 'zelfde sessie mag door')
  const b = json(['acquire', 'browser', '--session', 'sessie-b'])
  assert.equal(b.ok, false)
  assert.match(b.message, /sessie sessie-a/)
  assert.match(b.message, /agent-slot wait browser/)
  writeConfig({ browserIdleMinutes: 0.002 }) // ~120 ms
  await sleep(250)
  assert.equal(json(['acquire', 'browser', '--session', 'sessie-b']).ok, true, 'na stilte vrij')
  cli(['release-session', '--session', 'sessie-b'])
  assert.deepEqual(locks(), [])
})

test('te weinig geheugen: geweigerd met uitleg', () => {
  const c = json(['check', 'dev'], { AGENT_SLOT_FAKE_FREE: '12' })
  assert.equal(c.ok, false)
  assert.equal(c.reason, 'memory')
  assert.match(c.message, /12% vrij/)
  assert.equal(json(['check', 'agent', '--gate', 'critical'], { AGENT_SLOT_FAKE_FREE: '12' }).ok, true, 'subagents pas bij kritiek')
  const crit = json(['check', 'agent', '--gate', 'critical'], { AGENT_SLOT_FAKE_FREE: '8' })
  assert.equal(crit.ok, false)
  assert.match(crit.message, /`agent-slot wait agent --gate critical`/)
  assert.match(c.message, /`agent-slot status` laat zien/)
})

test('wait geeft vrij zodra er plek is', async () => {
  writeConfig({ limits: { test: 1 } })
  const a = startRun('test', {}, ['sh', '-c', 'sleep 1'])
  assert.ok(await waitFor(() => locks().length === 1))
  const t0 = Date.now()
  const r = cli(['wait', 'test', '--timeout', '10'])
  assert.equal(r.status, 0)
  assert.ok(Date.now() - t0 >= 300, 'heeft echt gewacht')
  a.kill()
})

test('status toont slots, geheugen en weigeringen', () => {
  cli(['log', 'refuse', JSON.stringify({ kind: 'dev', reason: 'slots', command: 'pnpm dev' })])
  const s = cli(['status']).stdout
  assert.match(s, /Geheugen: 60% vrij/)
  assert.match(s, /dev: 0\/2/)
  assert.match(s, /pnpm dev/)
})

test('install zet de CLI op een vaste plek', () => {
  const r = cli(['install'])
  assert.equal(r.status, 0)
  assert.ok(fs.existsSync(path.join(home, 'bin', 'agent-slot.mjs')))
})
