// node --test futureflow/tests/openrouter-cli.test.mjs
// Alleen met een tijdelijk settings-bestand (SETTINGS_JSON), een nep-`security` (SECURITY_BIN), een
// tijdelijke map voor marker, cache en eigen settings (OPENROUTER_DIR), een tijdelijke map voor de
// shim (SHIM_DIR) en een lokale http-server (OPENROUTER_URL);
// nooit met het echte ~/.claude, de echte sleutelhanger of openrouter.ai.
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { HELPER, OR_HELPER } from '../lib/api.mjs'

const CLI = fileURLToPath(new URL('../cli/api.mjs', import.meta.url))
const ORKEY = 'sk-or-v1-0123456789abcdef0123456789abcdefQRST'
const APIKEY = 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ_abc-WXYZ'
let dir, bestand, nep, log, ordir, shim, server, url, verzoeken, antwoord

// Nep-security per service: bewaart een key (uit `-i … -s <service> … -w <key>`) in sleutel-<service>.
const NEP = `#!/bin/sh
D="$(dirname "$0")"
printf 'ARGV %s\\n' "$*" >> "$D/log"
S=""
case "$1" in
  -i)
    IN="$(cat)"
    S="$(printf '%s' "$IN" | sed -n 's/.* -s \\([^ ]*\\) .*/\\1/p')"
    printf '%s' "$IN" | sed -n 's/.* -w \\([^ ]*\\)$/\\1/p' > "$D/sleutel-$S"
    ;;
  find-generic-password)
    [ -s "$D/sleutel-$3" ] || exit 44
    cat "$D/sleutel-$3"
    ;;
  delete-generic-password)
    [ -s "$D/sleutel-$3" ] || exit 44
    rm "$D/sleutel-$3"
    ;;
esac
exit 0
`

const MODELLEN = {
  data: [
    { id: 'openai/gpt-5', name: 'OpenAI: GPT-5', context_length: 400000, pricing: { prompt: '0.00000125', completion: '0.00001' } },
    { id: 'anthropic/claude-sonnet-4.5', name: 'Anthropic: Claude Sonnet 4.5', context_length: 1000000, pricing: { prompt: '0.000003', completion: '0.000015' } },
  ],
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'or-test-'))
  bestand = path.join(dir, 'settings.json')
  ordir = path.join(dir, 'or')
  shim = path.join(dir, 'bin', 'claude-or')
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'or-security-'))
  nep = path.join(bin, 'security')
  log = path.join(bin, 'log')
  fs.writeFileSync(nep, NEP, { mode: 0o755 })
  verzoeken = []
  antwoord = { models: [200, MODELLEN], messages: [200, { id: 'x', content: [] }] }
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      verzoeken.push({ method: req.method, url: req.url, headers: req.headers, body })
      const [status, data] = req.url.startsWith('/v1/models') ? antwoord.models : req.url === '/v1/messages' ? antwoord.messages : [404, {}]
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(data))
    })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  url = `http://127.0.0.1:${server.address().port}`
})

afterEach(() => new Promise(r => server.close(r)))

// Asynchroon starten: de lokale server draait in dit proces.
function cli(args, stdin) {
  return new Promise(resolve => {
    const p = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, SETTINGS_JSON: bestand, SECURITY_BIN: nep, OPENROUTER_DIR: ordir, OPENROUTER_URL: url, SHIM_DIR: path.dirname(shim) },
    })
    let stdout = ''
    let stderr = ''
    p.stdout.on('data', c => { stdout += c })
    p.stderr.on('data', c => { stderr += c })
    p.on('close', status => resolve({ status, stdout, stderr }))
    p.stdin.end(stdin ?? '')
  })
}
const logTekst = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '')
const lees = () => JSON.parse(fs.readFileSync(bestand, 'utf8'))
const json = r => JSON.parse(r.stdout.trim().split('\n').pop())
const MODEL = ['--model', 'openai/gpt-5', '--snel', 'openai/gpt-5-mini']

test('openrouter zet-key: alleen via stdin, eigen service; status kent beide keys los', async () => {
  const r = await cli(['openrouter', 'zet-key'], ORKEY + '\n')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(json(r), { ok: true, staart: 'QRST' })
  assert.match(logTekst(), /-s futureflow-openrouter -a futureflow/)
  assert.ok(!logTekst().split('\n').filter(l => l.startsWith('ARGV')).join('\n').includes(ORKEY))
  assert.ok(!r.stdout.includes(ORKEY) && !r.stderr.includes(ORKEY))
  const s = json(await cli(['status']))
  assert.equal(s.orHeeftKey, true)
  assert.equal(s.orStaart, 'QRST')
  assert.equal(s.heeftKey, false)
})

test('openrouter zet-key: een Anthropic-key wordt geweigerd', async () => {
  const r = await cli(['openrouter', 'zet-key'], APIKEY)
  assert.equal(r.status, 1)
  assert.match(r.stderr, /sk-or-/)
  assert.equal(logTekst(), '')
})

test('modus openrouter zonder key: exit 4, niets geschreven; zonder model: exit 1', async () => {
  fs.writeFileSync(bestand, '{}\n')
  assert.equal((await cli(['modus', 'openrouter', ...MODEL])).status, 4)
  await cli(['openrouter', 'zet-key'], ORKEY)
  assert.equal((await cli(['modus', 'openrouter'])).status, 1)
  assert.equal((await cli(['modus', 'openrouter', '--model', 'gpt 5', '--snel', 'a/b'])).status, 1)
  assert.equal(fs.readFileSync(bestand, 'utf8'), '{}\n')
  assert.equal(fs.existsSync(path.join(ordir, 'settings.json')), false)
  assert.equal(fs.existsSync(shim), false)
})

test('klaarzetten: eigen settings-bestand en shim; ~/.claude/settings.json blijft byte-gelijk', async () => {
  const begin = JSON.stringify({ model: 'opus', env: { FOO: 'bar' }, permissions: { allow: ['Bash(ls)'] } }, null, 4) + '\n'
  fs.writeFileSync(bestand, begin, { mode: 0o640 })
  await cli(['openrouter', 'zet-key'], ORKEY)
  const r = await cli(['modus', 'openrouter', ...MODEL])
  assert.equal(r.status, 0, r.stderr)
  const uit = json(r)
  assert.equal(uit.modus, 'openrouter')
  assert.equal(uit.gewijzigd, true)
  assert.equal(uit.start, 'claude-or')
  assert.equal(uit.settings, path.join(ordir, 'settings.json'))
  assert.equal(uit.shim, shim)
  assert.equal(fs.readFileSync(bestand, 'utf8'), begin)
  assert.equal(fs.existsSync(path.join(ordir, 'marker.json')), false)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ordir, 'settings.json'), 'utf8')), {
    apiKeyHelper: OR_HELPER,
    env: {
      ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'openai/gpt-5',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'openai/gpt-5',
      ANTHROPIC_DEFAULT_FABLE_MODEL: 'openai/gpt-5',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'openai/gpt-5-mini',
      CLAUDE_CODE_SUBAGENT_MODEL: 'openai/gpt-5-mini',
      CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
    },
  })
  assert.equal(fs.statSync(shim).mode & 0o777, 0o755)
  assert.match(fs.readFileSync(shim, 'utf8'), /# futureflow: claude-or/)
  const s = json(await cli(['status']))
  assert.equal(s.modus, 'abonnement')
  assert.equal(s.orKlaar, true)
  assert.equal(s.orShim, true)
  assert.equal(s.orModel, 'openai/gpt-5')
  assert.equal(s.orSnel, 'openai/gpt-5-mini')
  assert.equal(s.oudeOr, false)
  // Zelfde keuze nog eens: niets te doen. Ander model: alleen het eigen bestand anders.
  assert.equal(json(await cli(['modus', 'openrouter', ...MODEL])).gewijzigd, false)
  assert.equal(json(await cli(['modus', 'openrouter', '--model', 'anthropic/claude-sonnet-4.5[1m]', '--snel', 'openai/gpt-5-mini'])).gewijzigd, true)
  assert.equal(JSON.parse(fs.readFileSync(path.join(ordir, 'settings.json'), 'utf8')).env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'anthropic/claude-sonnet-4.5[1m]')
  assert.equal(fs.readFileSync(bestand, 'utf8'), begin)
  // Terug naar abonnement raakt claude-or niet.
  assert.equal(json(await cli(['modus', 'abonnement'])).gewijzigd, false)
  assert.equal(json(await cli(['status'])).orKlaar, true)
})

test('shim start claude met --settings en het eigen bestand; zonder bestand een melding', async () => {
  await cli(['openrouter', 'zet-key'], ORKEY)
  await cli(['modus', 'openrouter', ...MODEL])
  const nepBin = fs.mkdtempSync(path.join(os.tmpdir(), 'or-claude-'))
  fs.writeFileSync(path.join(nepBin, 'claude'), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 })
  const env = { ...process.env, PATH: `${nepBin}:/usr/bin:/bin` }
  const r = spawnSync(shim, ['-p', 'hoi'], { env, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.stdout.trim().split('\n'), ['--settings', path.join(ordir, 'settings.json'), '-p', 'hoi'])
  fs.rmSync(path.join(ordir, 'settings.json'))
  const r2 = spawnSync(shim, [], { env, encoding: 'utf8' })
  assert.equal(r2.status, 1)
  assert.match(r2.stderr, /Gebruik nu/)
})

test('een claude-or die niet van futureflow is: exit 3 en blijft staan', async () => {
  await cli(['openrouter', 'zet-key'], ORKEY)
  fs.mkdirSync(path.dirname(shim), { recursive: true })
  fs.writeFileSync(shim, '#!/bin/sh\necho eigen\n', { mode: 0o755 })
  const r = await cli(['modus', 'openrouter', ...MODEL])
  assert.equal(r.status, 3)
  assert.match(r.stderr, /niet van futureflow/)
  assert.equal(fs.readFileSync(shim, 'utf8'), '#!/bin/sh\necho eigen\n')
})

// De toestand die futureflow < 0.9 in settings.json achterliet: alle OpenRouter-regels plus de marker.
function oudeStand(env = {}) {
  const or = { ANTHROPIC_BASE_URL: 'https://openrouter.ai/api', ANTHROPIC_API_KEY: '', ANTHROPIC_DEFAULT_OPUS_MODEL: 'openai/gpt-5', ANTHROPIC_DEFAULT_SONNET_MODEL: 'openai/gpt-5', ANTHROPIC_DEFAULT_FABLE_MODEL: 'openai/gpt-5', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'openai/gpt-5-mini', CLAUDE_CODE_SUBAGENT_MODEL: 'openai/gpt-5-mini', CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1' }
  const marker = { env: Object.fromEntries(Object.entries(or).filter(([k]) => !(k in env))), apiKeyHelper: OR_HELPER }
  fs.mkdirSync(ordir, { recursive: true })
  fs.writeFileSync(path.join(ordir, 'marker.json'), JSON.stringify(marker))
  fs.writeFileSync(bestand, JSON.stringify({ env: { ...env, ...or }, apiKeyHelper: OR_HELPER }, null, 2) + '\n')
}

test('opruimen: haalt precies de oude OpenRouter-regels weg; eigen regels blijven; marker weg', async () => {
  oudeStand({ FOO: 'bar', CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1' })
  assert.equal(json(await cli(['status'])).oudeOr, true)
  assert.equal(json(await cli(['status'])).modus, 'abonnement')
  const r = await cli(['openrouter', 'opruimen'])
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(json(r), { gewijzigd: true })
  assert.deepEqual(lees(), { env: { FOO: 'bar', CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1' } })
  assert.equal(fs.existsSync(path.join(ordir, 'marker.json')), false)
  assert.equal(json(await cli(['status'])).oudeOr, false)
  assert.deepEqual(json(await cli(['openrouter', 'opruimen'])), { gewijzigd: false })
})

test('opruimen: met de hand veranderde modelregel blijft; een API-helper blijft', async () => {
  oudeStand()
  const d = lees()
  d.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'eigen/model'
  fs.writeFileSync(bestand, JSON.stringify(d, null, 2) + '\n')
  await cli(['openrouter', 'opruimen'])
  assert.deepEqual(lees(), { env: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'eigen/model' } })
  fs.writeFileSync(bestand, JSON.stringify({ apiKeyHelper: HELPER, env: { X: '1' } }))
  assert.deepEqual(json(await cli(['openrouter', 'opruimen'])), { gewijzigd: false })
  assert.deepEqual(lees(), { apiKeyHelper: HELPER, env: { X: '1' } })
})

test('marker kwijt: opruimen, abonnement of api halen de vaste OpenRouter-waarden weg', async () => {
  await cli(['zet-key'], APIKEY)
  for (const cmd of [['openrouter', 'opruimen'], ['modus', 'abonnement'], ['modus', 'api']]) {
    oudeStand({ FOO: 'bar' })
    fs.rmSync(path.join(ordir, 'marker.json'))
    const r = await cli(cmd)
    assert.equal(r.status, 0, r.stderr)
    const d = lees()
    assert.deepEqual(d.env, { FOO: 'bar' }, cmd.join(' '))
    assert.equal(d.apiKeyHelper, cmd[1] === 'api' ? HELPER : undefined)
  }
})

test('vreemde base-URL blokkeert de API, niet terug naar het abonnement en niet claude-or', async () => {
  await cli(['openrouter', 'zet-key'], ORKEY)
  await cli(['zet-key'], APIKEY)
  fs.writeFileSync(bestand, JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://gw.example' } }))
  assert.equal((await cli(['modus', 'api'])).status, 3)
  assert.equal((await cli(['modus', 'abonnement'])).status, 0)
  assert.equal(json(await cli(['status'])).vreemdeBasis, true)
  assert.deepEqual(json(await cli(['openrouter', 'opruimen'])), { gewijzigd: false })
  assert.equal((await cli(['modus', 'openrouter', ...MODEL])).status, 0)
  assert.deepEqual(lees(), { env: { ANTHROPIC_BASE_URL: 'https://gw.example' } })
})

test('modellen: ophalen met tools-filter, cache 6 u, --ververs haalt opnieuw, fout met cache valt terug', async () => {
  const r = await cli(['openrouter', 'modellen'])
  assert.equal(r.status, 0, r.stderr)
  const d = json(r)
  assert.equal(d.uitCache, false)
  assert.deepEqual(d.modellen.map(m => m.id), ['openai/gpt-5', 'anthropic/claude-sonnet-4.5'])
  assert.deepEqual(d.modellen[1], { id: 'anthropic/claude-sonnet-4.5', naam: 'Anthropic: Claude Sonnet 4.5', context: 1000000, in: 3, uit: 15 })
  assert.equal(verzoeken.length, 1)
  assert.equal(verzoeken[0].url, '/v1/models?supported_parameters=tools')
  assert.equal(verzoeken[0].headers.authorization, undefined)
  // Binnen 6 u: uit de cache, geen verzoek.
  assert.equal(json(await cli(['openrouter', 'modellen'])).uitCache, true)
  assert.equal(verzoeken.length, 1)
  // Knop: opnieuw; server stuk → cache met fout.
  antwoord.models = [500, {}]
  const f = json(await cli(['openrouter', 'modellen', '--ververs']))
  assert.equal(verzoeken.length, 2)
  assert.equal(f.uitCache, true)
  assert.match(f.fout, /HTTP 500/)
  // Cache ouder dan 6 u: opnieuw.
  const cache = path.join(ordir, 'modellen.json')
  const c = JSON.parse(fs.readFileSync(cache, 'utf8'))
  fs.writeFileSync(cache, JSON.stringify({ ...c, opgehaald: Date.now() - 7 * 3_600_000 }))
  antwoord.models = [200, MODELLEN]
  assert.equal(json(await cli(['openrouter', 'modellen'])).uitCache, false)
  assert.equal(verzoeken.length, 3)
})

test('modellen zonder cache en zonder server: exit 6', async () => {
  antwoord.models = [503, {}]
  const r = await cli(['openrouter', 'modellen'])
  assert.equal(r.status, 6)
  assert.match(r.stderr, /lijst niet opgehaald/)
})

test('test: één POST /v1/messages met Bearer uit de sleutelhanger; uitvoer zonder key', async () => {
  assert.equal((await cli(['openrouter', 'test', '--model', 'openai/gpt-5-mini'])).status, 4)
  await cli(['openrouter', 'zet-key'], ORKEY)
  const r = await cli(['openrouter', 'test', '--model', 'openai/gpt-5-mini'])
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(json(r), { ok: true, status: 200 })
  assert.equal(verzoeken.length, 1)
  assert.equal(verzoeken[0].method, 'POST')
  assert.equal(verzoeken[0].headers.authorization, `Bearer ${ORKEY}`)
  assert.deepEqual(JSON.parse(verzoeken[0].body), { model: 'openai/gpt-5-mini', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] })
  // Fout van de server, met de key erin: die gaat er niet uit.
  antwoord.messages = [401, { error: { message: `User not found for ${ORKEY}` } }]
  const f = await cli(['openrouter', 'test', '--model', 'openai/gpt-5-mini'])
  assert.deepEqual(json(f), { ok: false, status: 401, fout: 'User not found for …' })
  assert.ok(!f.stdout.includes(ORKEY) && !f.stderr.includes(ORKEY))
})
