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
      // Een route mag een Promise teruggeven (antwoord vertragen).
      Promise.resolve(eigen ? eigen({ auth, body, req }) : standaard(pad, auth)).then(antwoord => {
        res.writeHead(antwoord.status ?? 200, { 'Content-Type': 'application/json', ...(antwoord.headers ?? {}) })
        res.end(JSON.stringify(antwoord.json ?? {}))
      })
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

// --- Task 4 ---------------------------------------------------------------------------------

// Twee accounts toegevoegd; live = account 2.
async function tweeAccounts(opts = {}) {
  const c1 = await voegToe(1, opts)
  const c2 = await voegToe(2, opts)
  return { c1, c2 }
}
const claudeJsonData = () => leesJson(t.claudeJson)

test('switch A→B→A: live = kopie + live gedeelde velden, oauthAccount vervangen, kopie uitgaand bijgewerkt', async () => {
  await tweeAccounts()
  // Claude Code roteerde het token van account 2 na het toevoegen.
  const geroteerd = maakCred(2, { expiresAt: Date.now() + 9 * UUR })
  geroteerd.mcpOAuth = { server: { token: 'MCP-LIVE-NIEUW' } }
  kcZet(LIVE, USER, JSON.stringify(geroteerd))
  const voor = fs.readFileSync(t.claudeJson, 'utf8')

  let r = await cli(['switch', '1', '--van', '2', '--ikzelf', 'sessie-x'])
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json, { gewisseld: true, van: 2, naar: 1, email: 'pe…@voorbeeld.nl', plan: 'Max 20x' })
  const live = JSON.parse(kcGet(LIVE, USER))
  const kopie1 = JSON.parse(kcGet('futureflow-accounts', sleutel(1)))
  assert.deepEqual(live, { ...kopie1, mcpOAuth: { server: { token: 'MCP-LIVE-NIEUW' } } })
  // Alleen oauthAccount anders; de rest byte-gelijk.
  const verwacht = JSON.parse(voor)
  verwacht.oauthAccount = oauthAccount(1)
  assert.equal(fs.readFileSync(t.claudeJson, 'utf8'), JSON.stringify(verwacht, null, 2) + '\n')
  assert.equal(fs.statSync(t.claudeJson).mode & 0o777, 0o600)
  // Kopie van 2 kreeg het geroteerde token.
  assert.equal(JSON.parse(kcGet('futureflow-accounts', sleutel(2))).claudeAiOauth.refreshToken, geroteerd.claudeAiOauth.refreshToken)
  const staat = leesJson(path.join(t.home, 'accounts.json'))
  assert.equal(staat.actief, 1)
  assert.equal(staat.laatsteWissel.van, 2)
  assert.equal(staat.laatsteWissel.naar, 1)
  assert.equal(staat.laatsteWissel.auto, false)
  assert.equal(fs.existsSync(path.join(t.claudeHome, '.oauth_refresh.lock')), false)
  assert.equal(fs.existsSync(t.claudeHome + '.lock'), false)
  assert.equal(fs.existsSync(t.claudeJson + '.lock'), false)
  assert.equal(fs.existsSync(path.join(t.home, 'wissel.lock')), false)

  r = await cli(['switch', '2', '--van', '1'])
  assert.equal(r.status, 0, r.stderr)
  const terug = JSON.parse(kcGet(LIVE, USER))
  assert.equal(terug.claudeAiOauth.refreshToken, geroteerd.claudeAiOauth.refreshToken)
  assert.deepEqual(terug.mcpOAuth, { server: { token: 'MCP-LIVE-NIEUW' } })
  assert.deepEqual(claudeJsonData().oauthAccount, oauthAccount(2))
  assert.equal((await cli(['status'])).json.actief, 2)
  assert.match(fs.readFileSync(path.join(t.home, 'log.jsonl'), 'utf8'), /"soort":"switch"/)
  geenGeheimen()
})

test('switch: groot live item (> 4 KB) via argv-hex, kopieën nooit via argv', async () => {
  await tweeAccounts({ groot: true })
  const r = await cli(['switch', '1'])
  assert.equal(r.status, 0, r.stderr)
  const argv = secRegels().filter(l => l.startsWith('ARGV ["add-generic-password"'))
  assert.equal(argv.length, 1)
  assert.ok(argv[0].includes(`"-s","${LIVE}","-X"`))
  assert.equal(JSON.parse(kcGet(LIVE, USER)).mcpOAuth.server.pad.length, 6000)
  geenGeheimen()
})

test('switch: schrijffout live item → oude login terug, exit 5, ~/.claude.json ongewijzigd', async () => {
  await tweeAccounts()
  const S = kcGet(LIVE, USER)
  const voor = fs.readFileSync(t.claudeJson, 'utf8')
  for (const modus of ['kapot', 'exit']) {
    const r = await cli(['switch', '1'], { NEP_FAAL: JSON.stringify([{ op: 'add', svc: LIVE, keer: 1, modus }]) })
    fs.rmSync(t.keychain + '.tel', { force: true })
    assert.equal(r.status, 5, modus)
    assert.match(r.json.fout, /oude login staat er weer/)
    assert.equal(kcGet(LIVE, USER), S, modus)
    assert.equal(fs.readFileSync(t.claudeJson, 'utf8'), voor)
  }
  assert.equal(leesJson(path.join(t.home, 'accounts.json')).laatsteWissel, undefined)
  geenGeheimen()
})

test('switch: kapot ~/.claude.json → exit 2, niets geschreven', async () => {
  await tweeAccounts()
  const kcVoor = fs.readFileSync(t.keychain, 'utf8')
  fs.writeFileSync(t.claudeJson, '{ "oauthAccount": ')
  const r = await cli(['switch', '1'])
  assert.equal(r.status, 2)
  assert.equal(fs.readFileSync(t.keychain, 'utf8'), kcVoor)
  assert.equal(fs.readFileSync(t.claudeJson, 'utf8'), '{ "oauthAccount": ')
})

test('switch: ~/.credentials.json wordt herschreven als hij bestaat, nooit aangemaakt', async () => {
  await tweeAccounts()
  let r = await cli(['switch', '1'])
  assert.equal(r.status, 0, r.stderr)
  const bestand = path.join(t.claudeHome, '.credentials.json')
  assert.equal(fs.existsSync(bestand), false)
  fs.writeFileSync(bestand, '{}', { mode: 0o600 })
  r = await cli(['switch', '2'])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(fs.readFileSync(bestand, 'utf8'), kcGet(LIVE, USER))
  assert.equal(fs.statSync(bestand).mode & 0o777, 0o600)
})

test('switch: twee tegelijk met --van 2 → één wint, de ander exit 6', async () => {
  await tweeAccounts()
  const [a, b] = await Promise.all([cli(['switch', '1', '--van', '2']), cli(['switch', '1', '--van', '2'])])
  assert.deepEqual([a.status, b.status].sort(), [0, 6])
  assert.equal(JSON.parse(kcGet(LIVE, USER)).claudeAiOauth.refreshToken, JSON.parse(kcGet('futureflow-accounts', sleutel(1))).claudeAiOauth.refreshToken)
  // Al actief, of --van klopt niet meer.
  assert.equal((await cli(['switch', '1'])).status, 6)
  assert.equal((await cli(['switch', '2', '--van', '2'])).status, 6)
})

test('switch --auto: auto uit en wachttijd → exit 6', async () => {
  await tweeAccounts()
  assert.equal((await cli(['switch', '1', '--auto'])).status, 6, 'auto staat uit')
  await cli(['instellingen', '{"auto":true}'])
  assert.equal((await cli(['switch', '1', '--auto'])).status, 0)
  const r = await cli(['switch', '2', '--auto'])
  assert.equal(r.status, 6)
  assert.match(r.json.fout, /wachttijd/)
  const later = String(Date.now() + 6 * 60_000)
  assert.equal((await cli(['switch', '2', '--auto'], { ACCOUNTS_TEST_NU: later })).status, 0)
})

function slaper() {
  const p = spawn('/bin/sleep', ['30'])
  t.slapers = [...(t.slapers ?? []), p]
  return p.pid
}
function claudeRecord(pid, rec) {
  fs.mkdirSync(path.join(t.claudeHome, 'sessions'), { recursive: true })
  fs.writeFileSync(path.join(t.claudeHome, 'sessions', `${pid}.json`), JSON.stringify({ pid, ...rec }))
}

test('bezig: levende cli-sessie busy → switch exit 7 met wie; desktop en eigen Claude Code-record tellen niet, eigen bestand bezig wel', async () => {
  try {
    await tweeAccounts()
    const pid = slaper()
    // Hergebruikte pid: record van een claude die lang geleden startte, nu een ander proces → telt niet.
    claudeRecord(pid, { sessionId: 'ander', entrypoint: 'cli', status: 'busy', procStart: 'Tue Nov 10 10:27:32 2020' })
    assert.deepEqual((await cli(['bezig', '--ikzelf', 'ik'])).json, { bezig: 0, wie: [] })
    claudeRecord(pid, { sessionId: 'ander', entrypoint: 'cli', status: 'busy' })
    let r = await cli(['switch', '1', '--ikzelf', 'ik'])
    assert.equal(r.status, 7)
    assert.deepEqual(r.json.wie, ['ander'])
    assert.equal(typeof r.json.sinds, 'number')
    assert.deepEqual((await cli(['status'])).json.wacht.wie, ['ander'])
    assert.equal(JSON.parse(kcGet(LIVE, USER)).claudeAiOauth.refreshToken, JSON.parse(kcGet('futureflow-accounts', sleutel(2))).claudeAiOauth.refreshToken)
    assert.deepEqual((await cli(['bezig', '--ikzelf', 'ik'])).json, { bezig: 1, wie: ['ander'] })
    // Dezelfde sessie als ikzelf: telt niet.
    assert.deepEqual((await cli(['bezig', '--ikzelf', 'ander'])).json, { bezig: 0, wie: [] })
    // Desktop telt niet; idle telt niet; dode pid telt niet.
    claudeRecord(pid, { sessionId: 'ander', entrypoint: 'claude-desktop', status: 'busy' })
    claudeRecord(999_999, { sessionId: 'dood', entrypoint: 'cli', status: 'busy' })
    const pid2 = slaper()
    claudeRecord(pid2, { sessionId: 'rustig', entrypoint: 'cli', status: 'idle' })
    // Eigen sessiebestanden: ook het eigen bestand `bezig` telt (nooit midden in de eigen beurt).
    assert.deepEqual((await cli(['sessie', 'ik', 'bezig'])).json, { sessie: 'ik', status: 'bezig' })
    r = await cli(['switch', '1', '--ikzelf', 'ik'])
    assert.equal(r.status, 7)
    assert.deepEqual(r.json.wie, ['ik'])
    await cli(['sessie', 'ik', 'tussen'])
    r = await cli(['switch', '1', '--ikzelf', 'ik'])
    assert.equal(r.status, 0, r.stderr)
    assert.equal(leesJson(path.join(t.home, 'accounts.json')).wacht, undefined)
    await cli(['sessie', 'buur', 'bezig'])
    r = await cli(['switch', '2', '--ikzelf', 'ik'])
    assert.equal(r.status, 7)
    assert.deepEqual(r.json.wie, ['buur'])
    await cli(['sessie', 'buur', 'tussen'])
    assert.equal((await cli(['bezig', '--ikzelf', 'ik'])).json.bezig, 0)
    // Oude hartslag (> 10 min) telt niet meer; weg wordt opgeruimd.
    await cli(['sessie', 'buur', 'bezig'], { ACCOUNTS_TEST_NU: String(Date.now() - 11 * 60_000) })
    assert.equal((await cli(['bezig', '--ikzelf', 'ik'])).json.bezig, 0)
    await cli(['sessie', 'buur', 'weg'])
    await cli(['bezig'])
    assert.equal(fs.existsSync(path.join(t.home, 'sessies', 'buur.json')), false)
    // Onleesbaar record met levende pid telt.
    fs.writeFileSync(path.join(t.claudeHome, 'sessions', `${pid2}.json`), '{ half')
    assert.deepEqual((await cli(['bezig', '--ikzelf', 'ik'])).json, { bezig: 1, wie: [`pid ${pid2}`] })
    assert.equal((await cli(['sessie', '../x', 'bezig'])).status, 1)
  } finally {
    for (const p of t.slapers ?? []) p.kill()
  }
})

test('freshen/switch: verloopt binnen 10 min → refresh, opvolger eerst bewaard; invalid_grant → exit 9 en opnieuw-inloggen', async () => {
  const { c1 } = await tweeAccounts({ expiresAt: Date.now() + 5 * 60_000 })
  let post
  t.geheimen.push('sk-ant-oat01-GEHEIM-NIEUW-AT', 'sk-ant-ort01-GEHEIM-NIEUW-RT')
  t.route['/v1/oauth/token'] = ({ body }) => {
    post = JSON.parse(body)
    return { json: { access_token: 'sk-ant-oat01-GEHEIM-NIEUW-AT', refresh_token: 'sk-ant-ort01-GEHEIM-NIEUW-RT', expires_in: 28800, scope: 'user:inference user:profile' } }
  }
  let r = await cli(['freshen', '1'])
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json, { id: 1, ververst: true })
  assert.equal(post.grant_type, 'refresh_token')
  assert.equal(post.client_id, '9d1c250a-e61b-44d9-88ed-5944d1962f5e')
  assert.equal(post.refresh_token, c1.claudeAiOauth.refreshToken)
  const kopie = JSON.parse(kcGet('futureflow-accounts', sleutel(1)))
  assert.equal(kopie.claudeAiOauth.refreshToken, 'sk-ant-ort01-GEHEIM-NIEUW-RT')
  assert.ok(kopie.claudeAiOauth.expiresAt > Date.now() + 7 * UUR)
  assert.deepEqual(kopie.claudeAiOauth.scopes, ['user:inference', 'user:profile'])
  assert.equal(JSON.parse(kcGet('futureflow-accounts-vorige', sleutel(1))).claudeAiOauth.refreshToken, c1.claudeAiOauth.refreshToken)
  // Het actieve account (2) wordt nooit ververst.
  r = await cli(['freshen', '2'])
  assert.equal(r.json.ververst, false)
  assert.equal(t.verzoeken.filter(v => v.pad === '/v1/oauth/token').length, 1)
  // Switch naar 1: kopie is vers, geen nieuwe refresh.
  r = await cli(['switch', '1'])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(t.verzoeken.filter(v => v.pad === '/v1/oauth/token').length, 1)
  assert.equal(JSON.parse(kcGet(LIVE, USER)).claudeAiOauth.refreshToken, 'sk-ant-ort01-GEHEIM-NIEUW-RT')

  // De kopie van 2 verloopt binnen 10 min en zijn lijn is dood.
  t.route['/v1/oauth/token'] = () => ({ status: 400, json: { error: 'invalid_grant', error_description: 'GEHEIM-DETAIL' } })
  r = await cli(['switch', '2'])
  assert.equal(r.status, 9)
  assert.ok(!r.stdout.includes('GEHEIM-DETAIL') && !r.stderr.includes('GEHEIM-DETAIL'))
  const a2 = (await cli(['status'])).json.accounts.find(a => a.id === 2)
  assert.equal(a2.status, 'opnieuw-inloggen')
  assert.equal((await cli(['switch', '2'])).status, 9, 'nooit naar een account dat opnieuw moet inloggen')
  assert.deepEqual(claudeJsonData().oauthAccount, oauthAccount(1))
  geenGeheimen()
})

test('switch vanaf een onbekende login → die login in redding; niets kwijt', async () => {
  await voegToe(1)
  const vreemd = login(3)
  const r = await cli(['switch', '1'])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.json.van, null)
  const gered = JSON.parse(kcGet('futureflow-accounts-redding', sleutel(3)))
  assert.equal(gered.claudeAiOauth.refreshToken, vreemd.claudeAiOauth.refreshToken)
  assert.equal(gered.mcpOAuth, undefined)
  geenGeheimen()
})

// --- Task 5 ---------------------------------------------------------------------------------

const iso = ms => new Date(ms).toISOString()
const usageVerzoeken = () => t.verzoeken.filter(v => v.pad === '/api/oauth/usage')
const refreshVerzoeken = () => t.verzoeken.filter(v => v.pad === '/v1/oauth/token')
function usageRoute(pct = n => 40 + n) {
  t.route['/api/oauth/usage'] = ({ auth }) => {
    const n = t.tokens[auth]
    if (!n) return { status: 401, json: {} }
    return {
      json: {
        five_hour: { utilization: pct(n), resets_at: iso(Date.now() + 2 * UUR) },
        seven_day: { utilization: 10, resets_at: iso(Date.now() + 72 * UUR) },
        seven_day_opus: { utilization: null, resets_at: null },
        extra_usage: { is_enabled: false },
      },
    }
  }
}
const gebruikJson = () => leesJson(path.join(t.home, 'gebruik.json'))

test('usage: headers, vensters, vloer 360 s (twee keer kort na elkaar → één verzoek per account)', async () => {
  const { c1, c2 } = await tweeAccounts()
  usageRoute()
  const T0 = Date.now()
  let r = await cli(['usage', '--refresh'], { ACCOUNTS_TEST_NU: String(T0) })
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json, { opgehaald: [1, 2], overgeslagen: [], fouten: {} })
  const vz = usageVerzoeken()
  assert.equal(vz.length, 2)
  assert.deepEqual(vz.map(v => v.auth), [c1.claudeAiOauth.accessToken, c2.claudeAiOauth.accessToken], 'niet-actief: kopie; actief: live item')
  for (const v of vz) {
    assert.equal(v.beta, 'oauth-2025-04-20')
    assert.match(v.ua, /^futureflow-accounts\//)
  }
  assert.equal(refreshVerzoeken().length, 0)

  r = await cli(['usage', '--refresh'], { ACCOUNTS_TEST_NU: String(T0 + 10_000) })
  assert.deepEqual(r.json, { opgehaald: [], overgeslagen: [1, 2], fouten: {} })
  r = await cli(['usage', '--refresh', '--nu'], { ACCOUNTS_TEST_NU: String(T0 + 60_000) })
  assert.deepEqual(r.json.overgeslagen, [1, 2])
  assert.equal(usageVerzoeken().length, 2)
  r = await cli(['usage', '--refresh', '--nu', '--id', '1'], { ACCOUNTS_TEST_NU: String(T0 + 361_000) })
  assert.deepEqual(r.json.opgehaald, [1])
  assert.equal(usageVerzoeken().length, 3)

  const g = gebruikJson()
  assert.deepEqual(g[1].vensters.map(v => v.label), ['5u', '7d', '7d opus'])
  assert.equal(g[1].vensters[2].pct, undefined)
  assert.ok(g[1].volgende >= T0 + 361_000 + 360_000, 'nooit binnen de vloer')
  const s = await cli(['status', '--json'], { ACCOUNTS_TEST_NU: String(T0 + 400_000) })
  const a1 = s.json.accounts.find(a => a.id === 1)
  assert.equal(a1.gebruik['5u'].pct, 41)
  assert.equal(a1.gebruik['7d'].pct, 10)
  assert.equal(a1.leeftijdS, 39)
  assert.equal(s.json.accounts.find(a => a.id === 2).gebruik['5u'].pct, 42)
  geenGeheimen()
})

test('usage: 429 met Retry-After → laatste meting blijft, volgende poging pas daarna', async () => {
  await tweeAccounts()
  usageRoute()
  const T0 = Date.now()
  await cli(['usage', '--refresh', '--id', '1'], { ACCOUNTS_TEST_NU: String(T0) })
  t.route['/api/oauth/usage'] = () => ({ status: 429, headers: { 'Retry-After': '1200' }, json: { error: 'rate_limited' } })
  let r = await cli(['usage', '--refresh', '--nu', '--id', '1'], { ACCOUNTS_TEST_NU: String(T0 + 400_000) })
  assert.deepEqual(r.json.fouten, { 1: 'te veel verzoeken (429)' })
  const g = gebruikJson()[1]
  assert.equal(g.gemetenOp, T0, 'laatste goede meting blijft')
  assert.equal(g.vensters[0].pct, 41)
  assert.equal(g.nietVoor, T0 + 400_000 + 1_260_000)
  assert.ok(g.interval >= 600_000)
  usageRoute()
  const aantal = usageVerzoeken().length
  r = await cli(['usage', '--refresh', '--nu', '--id', '1'], { ACCOUNTS_TEST_NU: String(T0 + 1_500_000) })
  assert.deepEqual(r.json.overgeslagen, [1])
  assert.equal(usageVerzoeken().length, aantal)
  r = await cli(['usage', '--refresh', '--nu', '--id', '1'], { ACCOUNTS_TEST_NU: String(T0 + 1_700_000) })
  assert.deepEqual(r.json.opgehaald, [1])
  const na = gebruikJson()[1]
  assert.equal(na.fout, undefined)
  assert.equal(na.laatste429, T0 + 400_000)
  assert.ok(na.interval >= 600_000, 'na een 429 een uur lang minstens 600 s')
  const s = await cli(['status'], { ACCOUNTS_TEST_NU: String(T0 + 1_700_000) })
  assert.equal(s.json.accounts.find(a => a.id === 1).fout, undefined)
})

test('usage: actief verlopen token → geen refresh, overslaan met uitleg', async () => {
  await voegToe(1)
  await voegToe(2, { expiresAt: Date.now() - 1000 })
  usageRoute()
  const r = await cli(['usage', '--refresh', '--id', '2'])
  assert.deepEqual(r.json.fouten, { 2: 'token verlopen, ververst bij het volgende bericht' })
  assert.equal(refreshVerzoeken().length, 0)
  assert.equal(usageVerzoeken().length, 0)
  geenGeheimen()
})

test('usage: niet-actief verlopen → refresh, nieuwe kopie bewaard vóór het usage-verzoek', async () => {
  await voegToe(1, { expiresAt: Date.now() + 60_000 })
  await voegToe(2)
  const nieuwAt = 'sk-ant-oat01-GEHEIM-VERS-AT-1'
  t.geheimen.push(nieuwAt, 'sk-ant-ort01-GEHEIM-VERS-RT-1')
  t.tokens[nieuwAt] = 1
  t.route['/v1/oauth/token'] = () => ({ json: { access_token: nieuwAt, refresh_token: 'sk-ant-ort01-GEHEIM-VERS-RT-1', expires_in: 28800 } })
  let kopieBijUsage
  usageRoute()
  const gewoon = t.route['/api/oauth/usage']
  t.route['/api/oauth/usage'] = a => {
    kopieBijUsage = JSON.parse(kcGet('futureflow-accounts', sleutel(1))).claudeAiOauth.accessToken
    return gewoon(a)
  }
  const r = await cli(['usage', '--refresh', '--id', '1'])
  assert.deepEqual(r.json.opgehaald, [1], r.stderr)
  assert.deepEqual(t.verzoeken.map(v => v.pad).slice(-2), ['/v1/oauth/token', '/api/oauth/usage'])
  assert.equal(kopieBijUsage, nieuwAt, 'opvolger bewaard vóór het usage-verzoek')
  assert.equal(usageVerzoeken().at(-1).auth, nieuwAt)
  geenGeheimen()
})

test('usage: invalid_grant → opnieuw-inloggen, daarna overgeslagen', async () => {
  await voegToe(1, { expiresAt: Date.now() - 1000 })
  await voegToe(2)
  usageRoute()
  t.route['/v1/oauth/token'] = () => ({ status: 400, json: { error: 'invalid_grant' } })
  let r = await cli(['usage', '--refresh', '--id', '1'])
  assert.deepEqual(r.json.fouten, { 1: 'opnieuw inloggen nodig' })
  assert.equal(usageVerzoeken().length, 0)
  const s = await cli(['status'])
  assert.equal(s.json.accounts.find(a => a.id === 1).status, 'opnieuw-inloggen')
  r = await cli(['usage', '--refresh', '--nu', '--id', '1'], { ACCOUNTS_TEST_NU: String(Date.now() + UUR) })
  assert.deepEqual(r.json.overgeslagen, [1])
  assert.equal(refreshVerzoeken().length, 1)
  geenGeheimen()
})

test('usage: schrijffout na refresh → opvolger in redding, status onbekend', async () => {
  const c1 = await voegToe(1, { expiresAt: Date.now() - 1000 })
  await voegToe(2)
  usageRoute()
  t.geheimen.push('sk-ant-oat01-GEHEIM-R-AT', 'sk-ant-ort01-GEHEIM-R-RT')
  t.route['/v1/oauth/token'] = () => ({ json: { access_token: 'sk-ant-oat01-GEHEIM-R-AT', refresh_token: 'sk-ant-ort01-GEHEIM-R-RT', expires_in: 28800 } })
  const r = await cli(['usage', '--refresh', '--id', '1'], { NEP_FAAL: JSON.stringify([{ op: 'add', svc: 'futureflow-accounts' }]) })
  assert.ok(r.json.fouten[1])
  assert.equal(usageVerzoeken().length, 0)
  assert.equal(JSON.parse(kcGet('futureflow-accounts-redding', sleutel(1))).claudeAiOauth.refreshToken, 'sk-ant-ort01-GEHEIM-R-RT')
  assert.equal(JSON.parse(kcGet('futureflow-accounts', sleutel(1))).claudeAiOauth.refreshToken, c1.claudeAiOauth.refreshToken)
  const a1 = (await cli(['status'])).json.accounts.find(a => a.id === 1)
  assert.equal(a1.status, 'onbekend')
  assert.match(a1.statusUitleg, /redding/)
  assert.equal((await cli(['switch', '1'])).status, 9, 'niet naar een account met status onbekend')
  geenGeheimen()
})

test('usage: actief dicht bij zijn marge → kandidaat met een meting > 10 min wordt bijgehaald', async () => {
  await tweeAccounts()
  usageRoute()
  const T0 = Date.now()
  fs.writeFileSync(path.join(t.home, 'gebruik.json'), JSON.stringify({
    1: { vensters: [{ label: '5u', pct: 30 }], gemetenOp: T0 - 11 * 60_000, poging: T0 - 11 * 60_000, volgende: T0 + 300_000, interval: 900_000 },
    2: { vensters: [{ label: '5u', pct: 80 }], gemetenOp: T0 - 60_000, poging: T0 - 60_000, volgende: T0 + 300_000, interval: 360_000 },
  }))
  let r = await cli(['usage', '--refresh'], { ACCOUNTS_TEST_NU: String(T0) })
  assert.deepEqual(r.json, { opgehaald: [1], overgeslagen: [2], fouten: {} })
  // Zonder escalatie (actief op 50 %): wacht op `volgende`.
  fs.writeFileSync(path.join(t.home, 'gebruik.json'), JSON.stringify({
    1: { vensters: [{ label: '5u', pct: 30 }], gemetenOp: T0 - 11 * 60_000, poging: T0 - 11 * 60_000, volgende: T0 + 300_000, interval: 900_000 },
    2: { vensters: [{ label: '5u', pct: 50 }], gemetenOp: T0 - 60_000, poging: T0 - 60_000, volgende: T0 + 300_000, interval: 360_000 },
  }))
  r = await cli(['usage', '--refresh'], { ACCOUNTS_TEST_NU: String(T0) })
  assert.deepEqual(r.json.opgehaald, [])
})

// --- Eindreview (0.5.1) -----------------------------------------------------------------------

test('I1: refresh van een "niet-actief" account waarvan de keten live is → geen POST (usage en freshen)', async () => {
  // ~/.claude.json zegt account 2, maar het live item is de keten van account 1 (half gewisseld).
  const c1 = await voegToe(1, { expiresAt: Date.now() + 3 * 60_000 })
  await voegToe(2)
  kcZet(LIVE, USER, JSON.stringify(c1))
  usageRoute()
  t.route['/v1/oauth/token'] = () => ({ json: { access_token: 'x', refresh_token: 'y', expires_in: 28800 } })
  let r = await cli(['usage', '--refresh', '--id', '1'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.json.fouten[1], /live login/)
  r = await cli(['freshen', '1'])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.json.ververst, false)
  assert.equal(refreshVerzoeken().length, 0, 'het live refresh-token is niet gebruikt')
  assert.equal(JSON.parse(kcGet(LIVE, USER)).claudeAiOauth.refreshToken, c1.claudeAiOauth.refreshToken)
  geenGeheimen()
})

test('I1: usage ververst het doel terwijl switch het doel leest → live krijgt nooit het opgebruikte refresh-token', async () => {
  const c1 = await voegToe(1, { expiresAt: Date.now() + 3 * 60_000 })
  await voegToe(2)
  usageRoute()
  const nieuwAt = 'sk-ant-oat01-GEHEIM-RACE-AT'
  const nieuwRt = 'sk-ant-ort01-GEHEIM-RACE-RT'
  t.geheimen.push(nieuwAt, nieuwRt)
  t.tokens[nieuwAt] = 1
  let sw
  // usage houdt refresh-1.lock vast tijdens de POST; precies dan loopt een switch naar 1.
  t.route['/v1/oauth/token'] = async () => {
    sw = await cli(['switch', '1'], { ACCOUNTS_TEST_LOCK_WACHT: '800' })
    return { json: { access_token: nieuwAt, refresh_token: nieuwRt, expires_in: 28800 } }
  }
  const r = await cli(['usage', '--refresh', '--id', '1'])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(refreshVerzoeken().length, 1)
  assert.equal(JSON.parse(kcGet('futureflow-accounts', sleutel(1))).claudeAiOauth.refreshToken, nieuwRt)
  const live = JSON.parse(kcGet(LIVE, USER))
  assert.notEqual(live.claudeAiOauth.refreshToken, c1.claudeAiOauth.refreshToken, 'live item kreeg een al gebruikt refresh-token')
  assert.equal(sw.status, 7, sw.stderr)
  assert.deepEqual(claudeJsonData().oauthAccount, oauthAccount(2))
  // Daarna gewoon wisselen: live = de opvolger.
  const r2 = await cli(['switch', '1'])
  assert.equal(r2.status, 0, r2.stderr)
  assert.equal(JSON.parse(kcGet(LIVE, USER)).claudeAiOauth.refreshToken, nieuwRt)
  geenGeheimen()
})

test('I2: SIGTERM terwijl het live item geschreven wordt → wissel afgemaakt; sleutelhanger en ~/.claude.json noemen hetzelfde account', async () => {
  await tweeAccounts()
  const p = spawn(process.execPath, [CLI, 'switch', '1'], { env: env({ NEP_FAAL: JSON.stringify([{ op: 'add', svc: LIVE, keer: 1, modus: 'traag' }]) }) })
  let uit = ''
  p.stdout.on('data', d => { uit += d })
  const klaar = new Promise(r => p.on('close', (code, signaal) => r({ code, signaal })))
  const start = Date.now()
  while (!secRegels().some(l => l.startsWith('STDIN add-generic-password') && l.includes(`-s "${LIVE}"`))) {
    assert.ok(Date.now() - start < 10_000, 'live item niet geschreven')
    await new Promise(r => setTimeout(r, 10))
  }
  p.kill('SIGTERM')
  const r = await klaar
  // Het nep-security-proces kan nog bezig zijn met schrijven.
  await new Promise(r => setTimeout(r, 1300))
  const liveAcc = t.tokens[JSON.parse(kcGet(LIVE, USER)).claudeAiOauth.accessToken]
  assert.equal(claudeJsonData().oauthAccount.accountUuid, `uuid-${liveAcc}`, 'half gewisseld')
  assert.equal(r.code, 0, `exit ${r.code} ${r.signaal ?? ''}`)
  assert.equal(liveAcc, 1)
  assert.equal(JSON.parse(uit.trim()).gewisseld, true)
  for (const lock of [path.join(t.claudeHome, '.oauth_refresh.lock'), t.claudeHome + '.lock', t.claudeJson + '.lock']) assert.equal(fs.existsSync(lock), false, lock)
  geenGeheimen()
})

test('I4: uitgaande login van een bekend account niet te controleren → exit 7, niets gewijzigd; daarna wel', async () => {
  const { c2 } = await tweeAccounts()
  // Claude Code roteerde het token van 2; het profiel is onbereikbaar.
  const geroteerd = maakCred(2, { expiresAt: Date.now() + 9 * UUR })
  kcZet(LIVE, USER, JSON.stringify(geroteerd))
  t.route['/api/oauth/profile'] = () => ({ status: 503 })
  const kcVoor = fs.readFileSync(t.keychain, 'utf8')
  const voor = fs.readFileSync(t.claudeJson, 'utf8')
  let r = await cli(['switch', '1'])
  assert.equal(r.status, 7, r.stderr)
  assert.equal(r.json.wie, undefined)
  assert.equal(fs.readFileSync(t.keychain, 'utf8'), kcVoor)
  assert.equal(fs.readFileSync(t.claudeJson, 'utf8'), voor)
  assert.equal(kcGet('futureflow-accounts-redding', sleutel(2)), undefined)
  assert.equal(JSON.parse(kcGet('futureflow-accounts', sleutel(2))).claudeAiOauth.refreshToken, c2.claudeAiOauth.refreshToken)
  delete t.route['/api/oauth/profile']
  r = await cli(['switch', '1'])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(JSON.parse(kcGet('futureflow-accounts', sleutel(2))).claudeAiOauth.refreshToken, geroteerd.claudeAiOauth.refreshToken)
  assert.equal(kcGet('futureflow-accounts-redding', sleutel(2)), undefined)
  geenGeheimen()
})

test('I4: redding overschrijft alleen een oudere redding', async () => {
  await voegToe(1)
  const vreemd = login(3, { expiresAt: Date.now() + UUR })
  const nieuwer = maakCred(3, { expiresAt: Date.now() + 9 * UUR })
  const bewaard = JSON.stringify({ claudeAiOauth: nieuwer.claudeAiOauth })
  kcZet('futureflow-accounts-redding', sleutel(3), bewaard)
  let r = await cli(['switch', '1'])
  assert.equal(r.status, 5, r.stderr)
  assert.equal(kcGet('futureflow-accounts-redding', sleutel(3)), bewaard)
  assert.equal(JSON.parse(kcGet(LIVE, USER)).claudeAiOauth.refreshToken, vreemd.claudeAiOauth.refreshToken)
  assert.deepEqual(claudeJsonData().oauthAccount, oauthAccount(3))
  // Een oudere redding wordt wel vervangen.
  const ouder = maakCred(3, { expiresAt: Date.now() - UUR })
  kcZet('futureflow-accounts-redding', sleutel(3), JSON.stringify({ claudeAiOauth: ouder.claudeAiOauth }))
  r = await cli(['switch', '1'])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(JSON.parse(kcGet('futureflow-accounts-redding', sleutel(3))).claudeAiOauth.refreshToken, vreemd.claudeAiOauth.refreshToken)
  geenGeheimen()
})

test('minor: bezette refresh-lock → usage gaat door met een tijdelijke fout; wacht verdwijnt zodra niemand meer bezig is', async () => {
  await voegToe(1, { expiresAt: Date.now() + 60_000 })
  await voegToe(2)
  usageRoute()
  // refresh-1.lock van een levend proces (deze test).
  fs.writeFileSync(path.join(t.home, 'refresh-uuid-1_org-1.lock'), JSON.stringify({ pid: process.pid, tijd: Date.now() }))
  let r = await cli(['usage', '--refresh'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.json.fouten[1], /refresh bezig/)
  assert.deepEqual(r.json.opgehaald, [2])
  fs.rmSync(path.join(t.home, 'refresh-uuid-1_org-1.lock'))
  // wacht van een eerdere exit 7 blijft niet hangen.
  await cli(['sessie', 'buur', 'bezig'])
  assert.equal((await cli(['switch', '1'])).status, 7)
  assert.ok((await cli(['status'])).json.wacht)
  await cli(['sessie', 'buur', 'tussen'])
  // Exit 6 onder wissel.lock (auto staat uit): wacht weg.
  assert.equal((await cli(['switch', '1', '--auto'])).status, 6)
  assert.equal((await cli(['status'])).json.wacht, undefined)
})
