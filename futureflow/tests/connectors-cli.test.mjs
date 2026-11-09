// node --test futureflow/tests/connectors-cli.test.mjs
// Werkt alleen op een tijdelijk bestand via CLAUDE_JSON, nooit op het echte ~/.claude.json.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../cli/connectors.mjs', import.meta.url))
let dir, bestand

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'connectors-test-'))
  bestand = path.join(dir, '.claude.json')
})

const cli = (args, pad = bestand) => spawnSync(process.execPath, [CLI, ...args], { env: { ...process.env, CLAUDE_JSON: pad }, encoding: 'utf8' })
const schrijf = (data, ruimte = 2) => fs.writeFileSync(bestand, JSON.stringify(data, null, ruimte), { mode: 0o600 })
const lees = () => JSON.parse(fs.readFileSync(bestand, 'utf8'))
const rest = () => fs.readdirSync(dir).filter(f => f !== '.claude.json')

const BASIS = () => ({
  numStartups: 42,
  oauthAccount: { emailAddress: 'x@y.z' },
  projects: {
    '/a': { allowedTools: ['Bash'], disabledMcpServers: ['claude.ai Gmail'], history: [{ display: 'hoi' }] },
    '/b': { mcpServers: { n8n: { command: 'x' } }, hasTrustDialogAccepted: true },
  },
  mcpServers: { global: { url: 'https://example.test' } },
  zzzLaatste: [1, 2, 3],
})

test('list geeft de uitgezette servers van de map, of een lege lijst', () => {
  schrijf(BASIS())
  assert.deepEqual(JSON.parse(cli(['list', '--cwd', '/a']).stdout), { uit: ['claude.ai Gmail'] })
  assert.deepEqual(JSON.parse(cli(['list', '--cwd', '/b']).stdout), { uit: [] })
  assert.deepEqual(JSON.parse(cli(['list', '--cwd', '/nergens']).stdout), { uit: [] })
})

test('zet --uit voegt alleen aan die lijst toe; al het andere blijft exact', () => {
  schrijf(BASIS())
  const r = cli(['zet', '--cwd', '/a', '--server', 'n8n-mcp', '--uit'])
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(JSON.parse(r.stdout), { uit: ['claude.ai Gmail', 'n8n-mcp'], gewijzigd: true })
  const verwacht = BASIS()
  verwacht.projects['/a'].disabledMcpServers.push('n8n-mcp')
  assert.deepEqual(lees(), verwacht)
  // Volgorde van sleutels en opmaak (2 spaties, geen eind-newline) blijven gelijk.
  assert.equal(fs.readFileSync(bestand, 'utf8'), JSON.stringify(verwacht, null, 2))
  assert.equal(fs.statSync(bestand).mode & 0o777, 0o600)
  assert.deepEqual(rest(), [], 'geen tijdelijk bestand achtergelaten')
})

test('zet --aan haalt de server weg en laat de rest van het project staan', () => {
  schrijf(BASIS())
  const r = cli(['zet', '--cwd', '/a', '--server', 'claude.ai Gmail', '--aan'])
  assert.equal(r.status, 0, r.stderr)
  const verwacht = BASIS()
  verwacht.projects['/a'].disabledMcpServers = []
  assert.deepEqual(lees(), verwacht)
})

test('ontbrekend project: alleen { disabledMcpServers } erbij, andere projecten exact', () => {
  schrijf(BASIS())
  const r = cli(['zet', '--cwd', '/nieuw', '--server', 'claude.ai Gmail', '--uit'])
  assert.equal(r.status, 0, r.stderr)
  const verwacht = BASIS()
  verwacht.projects['/nieuw'] = { disabledMcpServers: ['claude.ai Gmail'] }
  assert.deepEqual(lees(), verwacht)
})

test('niets te doen: bestand niet aangeraakt', () => {
  schrijf(BASIS())
  const voor = fs.statSync(bestand)
  const tekst = fs.readFileSync(bestand, 'utf8')
  for (const args of [
    ['zet', '--cwd', '/a', '--server', 'claude.ai Gmail', '--uit'],
    ['zet', '--cwd', '/b', '--server', 'n8n-mcp', '--aan'],
    ['zet', '--cwd', '/nieuw', '--server', 'n8n-mcp', '--aan'],
  ]) {
    const r = cli(args)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(JSON.parse(r.stdout).gewijzigd, false)
  }
  assert.equal(fs.readFileSync(bestand, 'utf8'), tekst)
  assert.equal(fs.statSync(bestand).ino, voor.ino)
  assert.equal(lees().projects['/nieuw'], undefined)
})

test('kapot bestand: exit 2, melding, niets overschreven', () => {
  const kapot = '{ "projects": { "/a": '
  fs.writeFileSync(bestand, kapot)
  for (const args of [['zet', '--cwd', '/a', '--server', 'x', '--uit'], ['list', '--cwd', '/a']]) {
    const r = cli(args)
    assert.equal(r.status, 2)
    assert.match(r.stderr, /geen geldige JSON/)
  }
  assert.equal(fs.readFileSync(bestand, 'utf8'), kapot)
  assert.deepEqual(rest(), [])
})

test('ontbrekend bestand: exit 2 en er wordt niets aangemaakt', () => {
  const r = cli(['zet', '--cwd', '/a', '--server', 'x', '--uit'])
  assert.equal(r.status, 2)
  assert.match(r.stderr, /niet gelezen/)
  assert.equal(fs.existsSync(bestand), false)
  assert.equal(cli(['list', '--cwd', '/a']).status, 2)
})

test('projects of het project is geen object: exit 2, niets geschreven', () => {
  fs.writeFileSync(bestand, JSON.stringify({ projects: [] }))
  assert.equal(cli(['zet', '--cwd', '/a', '--server', 'x', '--uit']).status, 2)
  assert.equal(fs.readFileSync(bestand, 'utf8'), '{"projects":[]}')
  fs.writeFileSync(bestand, JSON.stringify({ projects: { '/a': 'kapot' } }))
  assert.equal(cli(['zet', '--cwd', '/a', '--server', 'x', '--uit']).status, 2)
  assert.equal(lees().projects['/a'], 'kapot')
})

test('bestand zonder projects krijgt alleen projects[cwd] erbij; opmaak en eind-newline blijven', () => {
  fs.writeFileSync(bestand, '{\n    "a": 1\n}\n')
  assert.equal(cli(['zet', '--cwd', '/p', '--server', 'x', '--uit']).status, 0)
  assert.equal(fs.readFileSync(bestand, 'utf8'), JSON.stringify({ a: 1, projects: { '/p': { disabledMcpServers: ['x'] } } }, null, 4) + '\n')
})

test('symlink blijft een symlink; het doel wordt bijgewerkt', () => {
  const echt = path.join(dir, 'echt.json')
  fs.writeFileSync(echt, JSON.stringify(BASIS(), null, 2), { mode: 0o600 })
  fs.symlinkSync(echt, bestand)
  assert.equal(cli(['zet', '--cwd', '/b', '--server', 'n8n-mcp', '--uit']).status, 0)
  assert.equal(fs.lstatSync(bestand).isSymbolicLink(), true)
  assert.deepEqual(JSON.parse(fs.readFileSync(echt, 'utf8')).projects['/b'].disabledMcpServers, ['n8n-mcp'])
})

test('foute argumenten: exit 1, niets geschreven', () => {
  schrijf(BASIS())
  const tekst = fs.readFileSync(bestand, 'utf8')
  assert.equal(cli(['zet', '--cwd', 'relatief', '--server', 'x', '--uit']).status, 1)
  assert.equal(cli(['zet', '--cwd', '/a', '--uit']).status, 1)
  assert.equal(cli(['zet', '--cwd', '/a', '--server', 'x']).status, 1)
  assert.equal(cli(['zet', '--cwd', '/a', '--server', 'x', '--uit', '--aan']).status, 1)
  assert.equal(cli(['onbekend']).status, 1)
  assert.equal(fs.readFileSync(bestand, 'utf8'), tekst)
})
