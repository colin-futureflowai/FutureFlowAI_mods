// node --test futureflow/tests/accounts-cli.test.mjs
// Alleen tijdelijke mappen, een nep-`security` (tests/fixtures/nep-security.mjs, sleutelhanger in een
// JSON-bestand) en een lokale http-server als nep-API. Nooit de echte sleutelhanger, ~/.claude.json of
// ~/.claude.
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../cli/accounts.mjs', import.meta.url))
const NEP = fileURLToPath(new URL('./fixtures/nep-security.mjs', import.meta.url))
const LIVE = 'Claude Code-credentials'
const USER = 'tester'
const UUR = 3_600_000

let t

beforeEach(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'accounts-test-'))
  t = {
    dir,
    home: path.join(dir, 'accounts'),
    claudeHome: path.join(dir, 'claude'),
    claudeJson: path.join(dir, 'claude.json'),
    keychain: path.join(dir, 'keychain.json'),
    seclog: path.join(dir, 'security.log'),
    sec: path.join(dir, 'security'),
    geheimen: [],
    tokens: {}, // accessToken → account-nummer (voor /api/oauth/profile)
    verzoeken: [], // log van de nep-server
    route: {},
  }
  fs.mkdirSync(t.claudeHome)
  fs.writeFileSync(t.sec, `#!/bin/sh\nexec "${process.execPath}" "${NEP}" "$@"\n`, { mode: 0o755 })
  t.server = http.createServer((req, res) => {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', () => {
      const pad = req.url.split('?')[0]
      const auth = (req.headers.authorization ?? '').replace(/^Bearer /, '')
      t.verzoeken.push({ pad, auth, body, ua: req.headers['user-agent'], beta: req.headers['anthropic-beta'] })
      const eigen = t.route[pad]
      const antwoord = eigen ? eigen({ auth, body, req }) : standaard(pad, auth)
      res.writeHead(antwoord.status ?? 200, { 'Content-Type': 'application/json', ...(antwoord.headers ?? {}) })
      res.end(JSON.stringify(antwoord.json ?? {}))
    })
  })
  await new Promise(r => t.server.listen(0, '127.0.0.1', r))
  t.api = `http://127.0.0.1:${t.server.address().port}`
})

afterEach(async () => {
  await new Promise(r => t.server.close(r))
  fs.rmSync(t.dir, { recursive: true, force: true })
})

function standaard(pad, auth) {
  if (pad === '/api/oauth/profile') {
    const n = t.tokens[auth]
    if (!n) return { status: 401, json: { error: 'invalid' } }
    return { json: { account: { uuid: `uuid-${n}`, email: `persoon${n}@voorbeeld.nl` }, organization: { uuid: `org-${n}` } } }
  }
  return { status: 404, json: {} }
}

function env(extra = {}) {
  const e = { ...process.env }
  for (const k of ['CLAUDE_CONFIG_DIR', 'CLAUDE_SECURESTORAGE_CONFIG_DIR', 'ACCOUNTS_TEST_NU', 'NEP_FAAL']) delete e[k]
  return {
    ...e,
    ACCOUNTS_HOME: t.home,
    CLAUDE_JSON: t.claudeJson,
    CLAUDE_HOME: t.claudeHome,
    SECURITY_BIN: t.sec,
    KEYCHAIN_USER: USER,
    ACCOUNTS_API: t.api,
    NEP_KEYCHAIN: t.keychain,
    NEP_LOG: t.seclog,
    ACCOUNTS_TEST_LOCK_WACHT: '1500',
    ...extra,
  }
}

function cli(args, extra = {}) {
  return new Promise(resolve => {
    const p = spawn(process.execPath, [CLI, ...args], { env: env(extra) })
    let stdout = ''
    let stderr = ''
    p.stdout.on('data', d => { stdout += d })
    p.stderr.on('data', d => { stderr += d })
    p.on('close', status => {
      let json
      try { json = JSON.parse(stdout.trim().split('\n').pop()) } catch {}
      const r = { status, stdout, stderr, json }
      t.uitvoer = (t.uitvoer ?? '') + stdout + stderr
      resolve(r)
    })
  })
}

const kc = () => (fs.existsSync(t.keychain) ? JSON.parse(fs.readFileSync(t.keychain, 'utf8')) : {})
const kcGet = (svc, acct) => kc()[`${svc}\t${acct}`]
function kcZet(svc, acct, waarde) {
  const d = kc()
  if (waarde === undefined) delete d[`${svc}\t${acct}`]
  else d[`${svc}\t${acct}`] = waarde
  fs.writeFileSync(t.keychain, JSON.stringify(d))
}
const secRegels = () => (fs.existsSync(t.seclog) ? fs.readFileSync(t.seclog, 'utf8').split('\n').filter(Boolean) : [])
const sleutel = n => `uuid-${n}:org-${n}`
const leesJson = p => JSON.parse(fs.readFileSync(p, 'utf8'))

let teller = 0
// Een nieuwe login van account n: tokens (geheim), optioneel een groot mcpOAuth.
function maakCred(n, { expiresAt = Date.now() + 8 * UUR, groot = false, plan = ['max', 'default_claude_max_20x'] } = {}) {
  teller++
  const at = `sk-ant-oat01-GEHEIM-AT-${n}-${teller}-abcdefghijklmnop`
  const rt = `sk-ant-ort01-GEHEIM-RT-${n}-${teller}-qrstuvwxyz012345`
  t.geheimen.push(at, rt)
  t.tokens[at] = n
  return {
    claudeAiOauth: { accessToken: at, refreshToken: rt, expiresAt, scopes: ['user:inference', 'user:profile'], subscriptionType: plan[0], rateLimitTier: plan[1] },
    trustedDeviceToken: `tdt-${n}`,
    mcpOAuth: { server: { token: `MCP-GEHEIM-${teller}`, pad: groot ? 'x'.repeat(6000) : 'kort' } },
  }
}

const BASIS = () => ({ numStartups: 7, projects: { '/x': { allowedTools: [] } }, theme: 'dark' })
function oauthAccount(n) {
  return { accountUuid: `uuid-${n}`, emailAddress: `persoon${n}@voorbeeld.nl`, organizationUuid: `org-${n}`, organizationName: `Org ${n}`, displayName: `P${n}` }
}
function zetClaudeJson(n) {
  const d = { ...BASIS(), oauthAccount: oauthAccount(n), zzz: [1, 2] }
  fs.writeFileSync(t.claudeJson, JSON.stringify(d, null, 2) + '\n', { mode: 0o600 })
}
// Inloggen met account n: live item + ~/.claude.json.
function login(n, opts) {
  const cred = maakCred(n, opts)
  kcZet(LIVE, USER, JSON.stringify(cred))
  zetClaudeJson(n)
  return cred
}

function alleBestanden(map) {
  if (!fs.existsSync(map)) return []
  const uit = []
  for (const e of fs.readdirSync(map, { withFileTypes: true })) {
    const p = path.join(map, e.name)
    if (e.isDirectory()) uit.push(...alleBestanden(p))
    else uit.push(p)
  }
  return uit
}

// Geen token in stdout/stderr van alle aanroepen, in bestanden onder ACCOUNTS_HOME, en geen
// add-generic-password in argv behalve voor het live item.
function geenGeheimen() {
  const teksten = [t.uitvoer ?? '', ...alleBestanden(t.home).map(p => fs.readFileSync(p, 'utf8'))]
  for (const g of t.geheimen) {
    const hex = Buffer.from(g).toString('hex')
    for (const tekst of teksten) {
      assert.ok(!tekst.includes(g), `geheim gevonden: ${g.slice(0, 24)}…`)
      assert.ok(!tekst.includes(hex), 'geheim (hex) gevonden')
    }
  }
  for (const r of secRegels().filter(l => l.startsWith('ARGV'))) {
    const args = JSON.parse(r.slice(5))
    if (args[0] === 'add-generic-password') assert.equal(args[args.indexOf('-s') + 1], LIVE, `argv-schrijven buiten het live item: ${args.slice(0, 6)}`)
    for (const g of t.geheimen) assert.ok(!r.includes(g), 'token in argv')
  }
}

async function voegToe(n, opts) {
  const cred = login(n, opts)
  const r = await cli(['add'])
  assert.equal(r.status, 0, r.stderr)
  return cred
}

// --- Task 3 ---------------------------------------------------------------------------------

test('add: identiteit klopt → kopie zonder gedeelde velden, config, gemaskeerd, geen tokens', async () => {
  const cred = login(1)
  const r = await cli(['add', '--label', 'werk'])
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json, { id: 1, email: 'pe…@voorbeeld.nl', plan: 'Max 20x', nieuw: true })
  const kopie = JSON.parse(kcGet('futureflow-accounts', sleutel(1)))
  assert.deepEqual(kopie, { claudeAiOauth: cred.claudeAiOauth, trustedDeviceToken: 'tdt-1' })
  assert.equal(kopie.mcpOAuth, undefined)
  assert.deepEqual(leesJson(path.join(t.home, 'config', 'uuid-1_org-1.json')), oauthAccount(1))
  const staat = leesJson(path.join(t.home, 'accounts.json'))
  assert.equal(staat.accounts[0].label, 'werk')
  assert.equal(fs.statSync(t.home).mode & 0o777, 0o700)
  for (const p of alleBestanden(t.home)) assert.equal(fs.statSync(p).mode & 0o777, 0o600, p)
  // Kopie via stdin van security -i, niet via argv.
  assert.ok(secRegels().includes('ARGV ["-i"]'))
  assert.ok(secRegels().some(l => l.startsWith('STDIN add-generic-password -U -a "uuid-1:org-1" -s "futureflow-accounts" -X ')))
  assert.ok(t.verzoeken.some(v => v.pad === '/api/oauth/profile' && v.ua?.startsWith('futureflow-accounts/')))
  assert.equal(fs.existsSync(path.join(t.claudeHome, '.oauth_refresh.lock')), false, 'lock opgeruimd')
  geenGeheimen()
})

test('add: opnieuw = bijwerken met dezelfde id; tweede account krijgt id 2', async () => {
  await voegToe(1)
  const cred = login(1)
  const r = await cli(['add'])
  assert.deepEqual(r.json, { id: 1, email: 'pe…@voorbeeld.nl', plan: 'Max 20x', nieuw: false })
  assert.equal(JSON.parse(kcGet('futureflow-accounts', sleutel(1))).claudeAiOauth.refreshToken, cred.claudeAiOauth.refreshToken)
  assert.ok(kcGet('futureflow-accounts-vorige', sleutel(1)), 'oude kopie naar -vorige')
  login(2, { plan: ['team', 'default_claude_max_5x'] })
  const r2 = await cli(['add'])
  assert.deepEqual(r2.json, { id: 2, email: 'pe…@voorbeeld.nl', plan: 'Team', nieuw: true })
  geenGeheimen()
})

test('add: token van een ander account, geen login, API-key, profiel onbereikbaar → exit 3, niets bewaard', async () => {
  const cred = maakCred(2)
  kcZet(LIVE, USER, JSON.stringify(cred))
  zetClaudeJson(1)
  let r = await cli(['add'])
  assert.equal(r.status, 3)
  assert.match(r.json.fout, /hoort niet bij/)

  kcZet(LIVE, USER, JSON.stringify({ primaryApiKey: 'sk-ant-api03-GEHEIM-xyz' }))
  t.geheimen.push('sk-ant-api03-GEHEIM-xyz')
  r = await cli(['add'])
  assert.equal(r.status, 3)
  assert.match(r.json.fout, /geen abonnement-login/)

  kcZet(LIVE, USER, undefined)
  r = await cli(['add'])
  assert.equal(r.status, 3)

  login(1)
  t.route['/api/oauth/profile'] = () => ({ status: 500 })
  r = await cli(['add'])
  assert.equal(r.status, 3)
  assert.match(r.json.fout, /niet te controleren/)

  assert.equal(Object.keys(kc()).filter(k => k.startsWith('futureflow')).length, 0)
  geenGeheimen()
})

test('add: login verandert tussen profielcheck en lock → exit 3, niets bewaard', async () => {
  login(1)
  t.route['/api/oauth/profile'] = ({ auth }) => {
    const n = t.tokens[auth]
    // Claude Code roteert precies nu het token.
    kcZet(LIVE, USER, JSON.stringify(maakCred(1)))
    return { json: { account: { uuid: `uuid-${n}` }, organization: { uuid: `org-${n}` } } }
  }
  const r = await cli(['add'])
  assert.equal(r.status, 3)
  assert.match(r.json.fout, /veranderde/)
  assert.equal(kcGet('futureflow-accounts', sleutel(1)), undefined)
  geenGeheimen()
})

test('list/status: gemaskeerd, actief volgens ~/.claude.json, gebruik met leeftijd, geen tokens', async () => {
  await voegToe(1)
  await voegToe(2)
  const nu = Date.now()
  fs.writeFileSync(path.join(t.home, 'gebruik.json'), JSON.stringify({
    1: { vensters: [{ label: '5u', pct: 62, resetsAt: nu + UUR }, { label: '7d', pct: 18, resetsAt: nu + 50 * UUR }, { label: '7d opus', pct: 3 }], gemetenOp: nu - 180_000 },
    2: { vensters: [], fout: 'http-429' },
  }))
  const r = await cli(['status', '--json'], { ACCOUNTS_TEST_NU: String(nu) })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.json.actief, 2)
  assert.equal(r.json.profiel, 'standaard')
  assert.equal(r.json.accounts.length, 2)
  const [a, b] = r.json.accounts
  assert.deepEqual(a, {
    id: 1, email: 'pe…@voorbeeld.nl', plan: 'Max 20x', inRotatie: true, status: 'ok',
    gebruik: { '5u': { pct: 62, resetsAt: nu + UUR }, '7d': { pct: 18, resetsAt: nu + 50 * UUR } }, gemetenOp: nu - 180_000, leeftijdS: 180,
  })
  assert.equal(b.fout, 'http-429')
  assert.deepEqual(r.json.instellingen.auto, false)
  const l = await cli(['list'])
  assert.deepEqual(l.json.accounts.map(x => x.id), [1, 2])
  for (const x of [r.stdout, l.stdout]) assert.ok(!x.includes('persoon'), 'geen volledig e-mailadres')
  geenGeheimen()
})

test('remove: kopieën en config weg; actief account blijft ingelogd', async () => {
  await voegToe(1)
  await voegToe(2)
  let r = await cli(['remove', '1'])
  assert.deepEqual(r.json, { verwijderd: 1, actief: false })
  assert.equal(kcGet('futureflow-accounts', sleutel(1)), undefined)
  assert.equal(fs.existsSync(path.join(t.home, 'config', 'uuid-1_org-1.json')), false)
  r = await cli(['remove', '2'])
  assert.deepEqual(r.json, { verwijderd: 2, actief: true, uitleg: 'blijft ingelogd; futureflow beheert het niet meer' })
  assert.ok(kcGet(LIVE, USER), 'live login blijft staan')
  r = await cli(['remove', '9'])
  assert.equal(r.status, 4)
  assert.deepEqual((await cli(['status'])).json.accounts, [])
})

test('zet rotatie en instellingen', async () => {
  await voegToe(1)
  let r = await cli(['zet', '1', 'rotatie', 'uit'])
  assert.deepEqual(r.json, { id: 1, inRotatie: false })
  r = await cli(['instellingen', '{"auto":true,"marge5u":80,"marge7d":20,"wachttijd":1,"onzin":1}'])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.json.instellingen.auto, true)
  assert.equal(r.json.instellingen.marge5u, 80)
  assert.equal(r.json.instellingen.marge7d, 90)
  assert.equal(r.json.instellingen.wachttijd, 300_000)
  assert.equal((await cli(['instellingen', 'geen json'])).status, 1)
  assert.equal((await cli(['zet', '1', 'rotatie', 'misschien'])).status, 1)
  assert.equal((await cli(['zet', '5', 'rotatie', 'aan'])).status, 4)
})

test('sync: kopie bijgewerkt na een rotatie door Claude Code; weigert een token van een ander account', async () => {
  const oud = await voegToe(1)
  let r = await cli(['sync'])
  assert.deepEqual(r.json, { gesynct: false, id: 1, reden: 'al gelijk' })
  // Claude Code roteert: nieuw token, zelfde account.
  const nieuw = maakCred(1, { expiresAt: Date.now() + 9 * UUR })
  kcZet(LIVE, USER, JSON.stringify(nieuw))
  r = await cli(['sync'])
  assert.deepEqual(r.json, { gesynct: true, id: 1 })
  assert.equal(JSON.parse(kcGet('futureflow-accounts', sleutel(1))).claudeAiOauth.refreshToken, nieuw.claudeAiOauth.refreshToken)
  assert.equal(JSON.parse(kcGet('futureflow-accounts-vorige', sleutel(1))).claudeAiOauth.refreshToken, oud.claudeAiOauth.refreshToken)
  // Tweede keer: profielcheck onthouden per vingerafdruk.
  const profielen = t.verzoeken.filter(v => v.pad === '/api/oauth/profile').length
  r = await cli(['sync'])
  assert.equal(r.json.reden, 'al gelijk')
  assert.equal(t.verzoeken.filter(v => v.pad === '/api/oauth/profile').length, profielen)

  // ~/.claude.json zegt account 1, maar het token is van account 2.
  const vreemd = maakCred(2, { expiresAt: Date.now() + 10 * UUR })
  kcZet(LIVE, USER, JSON.stringify(vreemd))
  r = await cli(['sync'])
  assert.equal(r.status, 3)
  assert.equal(JSON.parse(kcGet('futureflow-accounts', sleutel(1))).claudeAiOauth.refreshToken, nieuw.claudeAiOauth.refreshToken)
  geenGeheimen()
})

test('lock vastgehouden → wacht en exit 7, niets geschreven; stale lock (> 60 s) wordt overgenomen', async () => {
  login(1)
  const lock = path.join(t.claudeHome, '.oauth_refresh.lock')
  fs.mkdirSync(lock)
  const start = Date.now()
  let r = await cli(['add'])
  assert.equal(r.status, 7)
  assert.ok(Date.now() - start >= 1400, 'heeft gewacht')
  assert.equal(kcGet('futureflow-accounts', sleutel(1)), undefined)
  assert.ok(fs.existsSync(lock), 'lock van een ander blijft staan')

  const oud = new Date(Date.now() - 120_000)
  fs.utimesSync(lock, oud, oud)
  r = await cli(['add'])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(fs.existsSync(lock), false)
  assert.equal(fs.existsSync(lock + '.takeover'), false)

  // ~/.claude.lock (naast CLAUDE_HOME) telt ook.
  const tweede = t.claudeHome + '.lock'
  fs.mkdirSync(tweede)
  r = await cli(['add'])
  assert.equal(r.status, 7)
  fs.rmdirSync(tweede)
})

test('eigen profiel (CLAUDE_CONFIG_DIR) → exit 8, status werkt; kapot accounts.json → exit 2', async () => {
  login(1)
  let r = await cli(['add'], { CLAUDE_CONFIG_DIR: path.join(t.dir, 'ander') })
  assert.equal(r.status, 8)
  r = await cli(['sync'], { CLAUDE_SECURESTORAGE_CONFIG_DIR: path.join(t.dir, 'ander') })
  assert.equal(r.status, 8)
  r = await cli(['status', '--json'], { CLAUDE_CONFIG_DIR: path.join(t.dir, 'ander') })
  assert.equal(r.status, 0)
  assert.equal(r.json.profiel, 'eigen')
  assert.equal(r.json.actief, null)

  fs.mkdirSync(t.home, { recursive: true })
  fs.writeFileSync(path.join(t.home, 'accounts.json'), '{ kapot')
  r = await cli(['status'])
  assert.equal(r.status, 2)
  r = await cli(['add'])
  assert.equal(r.status, 2)
  assert.equal(fs.readFileSync(path.join(t.home, 'accounts.json'), 'utf8'), '{ kapot')
})

test('onbekende opdracht → exit 1 met JSON', async () => {
  const r = await cli(['vlieg'])
  assert.equal(r.status, 1)
  assert.equal(r.json.code, 1)
})
