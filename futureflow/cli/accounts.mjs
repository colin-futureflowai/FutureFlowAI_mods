#!/usr/bin/env node
// accounts — wisselen tussen eigen, apart betaalde Claude-abonnementen in de terminal. Kopie van een
// login in de sleutelhanger, verbruik per account, wisselen onder de locks van Claude Code.
// Alleen Node-builtins (plus de pure lib/accounts.mjs). Werkwijze en getallen van claude-swap (MIT,
// github.com/realiti4/claude-swap, commit 5ac68bfb); zie NOTICE.
//
//   accounts add [--label <tekst>]             huidige login bewaren      → { id, email, plan, nieuw }
//   accounts list | status [--json]            geen netwerk               → { actief, profiel, accounts, instellingen, … }
//   accounts remove <id>                                                  → { verwijderd, actief, uitleg? }
//   accounts zet <id> rotatie aan|uit                                     → { id, inRotatie }
//   accounts instellingen '<json>'                                        → { instellingen }
//   accounts sync                              kopie van het actieve account bijwerken → { gesynct, id?, reden? }
//
// Uitvoer: altijd één JSON-regel op stdout, ook bij een fout ({ fout, code, … }; de melding staat ook
// op stderr). Nooit een token, credential of volledig e-mailadres.
// Exitcodes: 1 gebruik, 2 bestand onleesbaar/kapot (niets geschreven), 3 niet ingelogd of identiteit
// klopt niet, 4 onbekend account, 5 sleutelhanger-fout, 6 niets te doen, 7 bezig (sessies of lock),
// 8 eigen profiel (CLAUDE_CONFIG_DIR), 9 opnieuw inloggen nodig.
//
// Omgeving (tests; leeg = standaard): ACCOUNTS_HOME (~/.claude/futureflow/accounts), CLAUDE_JSON
// (~/.claude.json), CLAUDE_HOME (~/.claude), SECURITY_BIN (/usr/bin/security), KEYCHAIN_USER ($USER),
// ACCOUNTS_API (basis-URL voor api.anthropic.com én platform.claude.com), ACCOUNTS_TEST_NU (klok, ms),
// ACCOUNTS_TEST_LOCK_WACHT (max wachten op een lock, ms).

import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { GEDEELD, instellingenVan, KOPIE, LIVE, maskEmail, planLabel, VORIGE } from '../lib/accounts.mjs'

const THUIS = os.homedir()
const CLAUDE_HOME = process.env.CLAUDE_HOME || path.join(THUIS, '.claude')
const HOME = process.env.ACCOUNTS_HOME || path.join(CLAUDE_HOME, 'futureflow', 'accounts')
const CLAUDE_JSON = process.env.CLAUDE_JSON || path.join(THUIS, '.claude.json')
const SECURITY = process.env.SECURITY_BIN || '/usr/bin/security'
const KEYCHAIN_USER = process.env.KEYCHAIN_USER || process.env.USER || gebruikersnaam() || 'claude-code-user'
const API = process.env.ACCOUNTS_API || 'https://api.anthropic.com'
const PLATFORM = process.env.ACCOUNTS_API || 'https://platform.claude.com'
const LOCK_WACHT = Number(process.env.ACCOUNTS_TEST_LOCK_WACHT) || 9_000
const NIET_GEVONDEN = 44
const UUR = 3_600_000

// Locks van Claude Code (proper-lockfile: mappen). Volgorde altijd: wissel.lock → .oauth_refresh.lock
// → ~/.claude.lock → ~/.claude.json.lock (claude-swap claude_locks.py).
const OAUTH_LOCK = path.join(CLAUDE_HOME, '.oauth_refresh.lock')
const CLAUDE_LOCK = path.join(path.dirname(CLAUDE_HOME), path.basename(CLAUDE_HOME) + '.lock')
const CONFIG_LOCK = path.join(path.dirname(CLAUDE_JSON), path.basename(CLAUDE_JSON) + '.lock')
const STALE_CRED = 60_000
const STALE_CONFIG = 10_000
const AANRAKEN = 3_000

const ACCOUNTS_JSON = path.join(HOME, 'accounts.json')
const GEBRUIK_JSON = path.join(HOME, 'gebruik.json')
const LOG = path.join(HOME, 'log.jsonl')

const VERSIE = (() => {
  try { return JSON.parse(fs.readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version ?? '0' } catch { return '0' }
})()
const UA = `futureflow-accounts/${VERSIE}`

function gebruikersnaam() {
  try { return os.userInfo().username } catch { return undefined }
}

const nu = () => Number(process.env.ACCOUNTS_TEST_NU) || Date.now()
const slaap = ms => new Promise(r => setTimeout(r, ms))

class Fout extends Error {
  constructor(bericht, code, extra = {}) {
    super(bericht)
    this.code = code
    this.extra = extra
  }
}

// --- algemeen ---------------------------------------------------------------------------------

const eigenProfiel = () => !!(process.env.CLAUDE_CONFIG_DIR || process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR)

function eisStandaard() {
  if (eigenProfiel()) throw new Fout('eigen profiel (CLAUDE_CONFIG_DIR); wisselen niet ondersteund', 8)
}

const vinger = t => crypto.createHash('sha256').update(String(t)).digest('hex').slice(0, 12)

const geldig = c =>
  !!c && typeof c === 'object' && !!c.claudeAiOauth && typeof c.claudeAiOauth === 'object' &&
  typeof c.claudeAiOauth.refreshToken === 'string' && c.claudeAiOauth.refreshToken.length > 0 &&
  typeof c.claudeAiOauth.accessToken === 'string' && c.claudeAiOauth.accessToken.length > 0

const verloopt = c => (typeof c?.claudeAiOauth?.expiresAt === 'number' ? c.claudeAiOauth.expiresAt : 0)

function zonderGedeeld(cred) {
  const c = { ...cred }
  for (const k of GEDEELD) delete c[k]
  return c
}

const UUID = /^[A-Za-z0-9-]{1,80}$/
const uuidVan = sleutel => sleutel.split(':')[0]
const orgVan = sleutel => sleutel.split(':')[1] ?? ''
// Bestandsnaam voor een account-sleutel `<accountUuid>:<orgUuid>`.
const bestandsnaam = sleutel => `${uuidVan(sleutel)}_${orgVan(sleutel) || 'geen'}`

function schrijfAtomisch(pad, tekst, mode = 0o600) {
  fs.mkdirSync(path.dirname(pad), { recursive: true, mode: 0o700 })
  const tmp = `${pad}.${process.pid}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.tmp`
  try {
    fs.writeFileSync(tmp, tekst, { mode, flag: 'wx' })
    fs.chmodSync(tmp, mode)
    fs.renameSync(tmp, pad)
  } catch (err) {
    fs.rmSync(tmp, { force: true })
    throw new Fout(`${path.basename(pad)} niet geschreven (${err.code ?? err.message})`, 2)
  }
}

function zorgThuis() {
  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 })
  try { fs.chmodSync(HOME, 0o700) } catch {}
}

function logRegel(regel) {
  try {
    zorgThuis()
    fs.appendFileSync(LOG, JSON.stringify({ tijd: nu(), ...regel }) + '\n', { mode: 0o600 })
  } catch {}
}

// --- sleutelhanger ----------------------------------------------------------------------------

function security(args, invoer) {
  return spawnSync(SECURITY, args, { input: invoer, encoding: 'utf8', timeout: 15_000 })
}

// De waarde, of undefined als het item niet bestaat. Een waarde met niet-afdrukbare tekens geeft
// `security -w` als hex terug; JSON (begint met `{`) wordt dan teruggezet.
function keychainLees(svc, acct) {
  const r = security(['find-generic-password', '-a', acct, '-w', '-s', svc])
  if (r.error) throw new Fout(`sleutelhanger niet gelezen (${r.error.code ?? 'fout'})`, 5)
  if (r.status === NIET_GEVONDEN) return undefined
  if (r.status !== 0) throw new Fout(`sleutelhanger niet gelezen (exitcode ${r.status})`, 5)
  let w = (r.stdout ?? '').replace(/\n$/, '')
  if (/^(?:[0-9a-fA-F]{2})+$/.test(w) && w.slice(0, 2) === '7b') w = Buffer.from(w, 'hex').toString('utf8')
  return w
}

// `security -i` leest een regel van max. 4096 bytes; langer wordt stil afgekapt (claude-swap
// macos_keychain.py:43-47).
const STDIN_GRENS = 4096 - 64
const citeer = v => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

// Schrijft via `security -i` (opdracht op stdin, waarde als hex): nooit in argv. Alleen het live item
// van Claude Code mag via argv als het te groot is voor één stdin-regel (besluit Colin 10-11-2026,
// zoals Claude Code en claude-swap). Daarna terug lezen en vergelijken.
function keychainSchrijf(svc, acct, waarde) {
  const hex = Buffer.from(waarde, 'utf8').toString('hex')
  const regel = `add-generic-password -U -a ${citeer(acct)} -s ${citeer(svc)} -X ${hex}\n`
  let r
  if (Buffer.byteLength(regel) <= STDIN_GRENS) r = security(['-i'], regel)
  else if (svc === LIVE && path.isAbsolute(SECURITY)) r = security(['add-generic-password', '-U', '-a', acct, '-s', svc, '-X', hex])
  else throw new Fout(`te groot voor de sleutelhanger via stdin (${svc}); niets geschreven`, 5)
  if (r.error || r.status !== 0) throw new Fout(`niet bewaard in de sleutelhanger (${svc}; ${r.error?.code ?? `exitcode ${r.status}`})`, 5)
  if (keychainLees(svc, acct) !== waarde) throw new Fout(`niet terug te lezen uit de sleutelhanger (${svc})`, 5)
}

function keychainWis(svc, acct) {
  const r = security(['delete-generic-password', '-a', acct, '-s', svc])
  if (r.error) throw new Fout(`sleutelhanger niet bijgewerkt (${r.error.code ?? 'fout'})`, 5)
  if (r.status !== 0 && r.status !== NIET_GEVONDEN) throw new Fout(`niet gewist uit de sleutelhanger (${svc}; exitcode ${r.status})`, 5)
  return r.status === 0
}

function parse(tekst) {
  try {
    const d = JSON.parse(tekst)
    return d && typeof d === 'object' && !Array.isArray(d) ? d : undefined
  } catch {
    return undefined
  }
}

// Het live item van Claude Code: { tekst, cred } of undefined. Onleesbare JSON → exit 3.
function leesLive() {
  const tekst = keychainLees(LIVE, KEYCHAIN_USER)
  if (tekst === undefined) return undefined
  const cred = parse(tekst)
  if (!cred) throw new Fout('login in de sleutelhanger is onleesbaar; niets gewijzigd', 3)
  return { tekst, cred }
}

// Kopie van een account (object) of undefined; kapot → exit 5.
function leesKopie(sleutel, svc = KOPIE) {
  const tekst = keychainLees(svc, sleutel)
  if (tekst === undefined) return undefined
  const c = parse(tekst)
  if (!c) throw new Fout('kopie in de sleutelhanger is kapot; log opnieuw in met /login en voeg het account opnieuw toe', 5)
  return c
}

// Kopie schrijven: eerst de oude naar -vorige, dan schrijven, terug lezen en vergelijken; mislukt
// dat, de oude terugzetten. Altijd zonder de gedeelde velden (≈1 KB, past via stdin).
function schrijfKopie(sleutel, cred) {
  if (!geldig(cred)) throw new Fout('login zonder refresh-token; niets bewaard', 5)
  const nieuw = JSON.stringify(zonderGedeeld(cred))
  const oud = keychainLees(KOPIE, sleutel)
  if (oud === nieuw) return false
  if (oud !== undefined) keychainSchrijf(VORIGE, sleutel, oud)
  try {
    keychainSchrijf(KOPIE, sleutel, nieuw)
    if (!geldig(parse(keychainLees(KOPIE, sleutel)))) throw new Fout('kopie niet goed terug te lezen', 5)
  } catch (err) {
    if (oud !== undefined) {
      try { keychainSchrijf(KOPIE, sleutel, oud) } catch {}
    }
    throw new Fout(`kopie niet bewaard (${err.message}); de vorige staat er weer`, 5)
  }
  return true
}

// --- locks ------------------------------------------------------------------------------------

function leeft(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM'
  }
}

// Een dode lock weghalen, onder `<lock>.takeover` met hercontrole: twee wachters die dezelfde dode
// houder zien, halen anders elkaars nieuwe lock weg (claude-swap claude_locks.py:94-125).
function neemOver(pad, isDood, weg) {
  const over = pad + '.takeover'
  try {
    fs.mkdirSync(over)
  } catch {
    try { if (Date.now() - fs.statSync(over).mtimeMs > 5_000) fs.rmdirSync(over) } catch {}
    return false
  }
  try {
    if (!isDood()) return false
    weg()
    return true
  } catch {
    return false
  } finally {
    try { fs.rmdirSync(over) } catch {}
  }
}

// Map-lock zoals proper-lockfile (Claude Code): mkdir; stale na `stale` ms (mtime); vasthouden =
// mtime elke 3 s aanraken; max LOCK_WACHT wachten met pauzes van 250-500 ms.
async function mapLock(pad, stale) {
  fs.mkdirSync(path.dirname(pad), { recursive: true })
  const start = Date.now()
  for (;;) {
    try {
      fs.mkdirSync(pad)
      break
    } catch (err) {
      if (err.code !== 'EEXIST') throw new Fout(`${path.basename(pad)} niet genomen (${err.code})`, 7)
    }
    if (Date.now() - start > LOCK_WACHT) throw new Fout(`${path.basename(pad)} is bezet (Claude Code ververst zijn login?); probeer het zo opnieuw`, 7)
    let m
    try { m = fs.statSync(pad).mtimeMs } catch { continue }
    if (Date.now() - m > stale) {
      const dood = () => Date.now() - fs.statSync(pad).mtimeMs > stale
      if (!neemOver(pad, dood, () => fs.rmdirSync(pad))) await slaap(50)
      continue
    }
    await slaap(250 + Math.random() * 250)
  }
  const t = setInterval(() => {
    try { const d = new Date(); fs.utimesSync(pad, d, d) } catch {}
  }, AANRAKEN)
  t.unref?.()
  return () => {
    clearInterval(t)
    try { fs.rmdirSync(pad) } catch {}
  }
}

// Bestands-lock (O_EXCL) voor futureflow zelf: inhoud pid + tijd; stale als de pid dood is of na
// `stale` ms. `wacht` = max wachten (ms).
async function bestandLock(pad, stale, wacht = LOCK_WACHT) {
  zorgThuis()
  const start = Date.now()
  for (;;) {
    try {
      const fd = fs.openSync(pad, 'wx', 0o600)
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, tijd: Date.now() }))
      fs.closeSync(fd)
      break
    } catch (err) {
      if (err.code !== 'EEXIST') throw new Fout(`${path.basename(pad)} niet genomen (${err.code})`, 7)
    }
    const dood = () => {
      const st = fs.statSync(pad)
      const d = parse(fs.readFileSync(pad, 'utf8'))
      if (!d) return Date.now() - st.mtimeMs > 2_000
      return !leeft(d.pid) || Date.now() - (Number(d.tijd) || 0) > stale
    }
    let isDood = false
    try { isDood = dood() } catch { continue }
    if (isDood) {
      if (!neemOver(pad, dood, () => fs.unlinkSync(pad))) await slaap(50)
      continue
    }
    if (Date.now() - start > wacht) throw new Fout(`${path.basename(pad)} is bezet; probeer het zo opnieuw`, 7)
    await slaap(100 + Math.random() * 150)
  }
  return () => {
    try {
      const d = parse(fs.readFileSync(pad, 'utf8'))
      if (d?.pid === process.pid) fs.unlinkSync(pad)
    } catch {}
  }
}

// Locks in vaste volgorde nemen, `fn` draaien, in omgekeerde volgorde loslaten.
// Namen: 'wissel' (eigen), 'cred' (.oauth_refresh.lock + ~/.claude.lock), 'config' (~/.claude.json.lock).
async function metLocks(namen, fn) {
  const vrij = []
  try {
    if (namen.includes('wissel')) vrij.push(await bestandLock(path.join(HOME, 'wissel.lock'), 120_000))
    if (namen.includes('cred')) {
      vrij.push(await mapLock(OAUTH_LOCK, STALE_CRED))
      vrij.push(await mapLock(CLAUDE_LOCK, STALE_CRED))
    }
    if (namen.includes('config')) vrij.push(await mapLock(CONFIG_LOCK, STALE_CONFIG))
    return await fn()
  } finally {
    for (const v of vrij.reverse()) v()
  }
}

// --- eigen opslag -----------------------------------------------------------------------------

function leesJson(pad, standaard) {
  let tekst
  try {
    tekst = fs.readFileSync(pad, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return standaard()
    throw new Fout(`${path.basename(pad)} niet gelezen (${err.code ?? err.message}); niets gewijzigd`, 2)
  }
  const d = parse(tekst)
  if (!d) throw new Fout(`${path.basename(pad)} is kapot; niets gewijzigd`, 2)
  return d
}

const ACCOUNT_STATUS = new Set(['ok', 'opnieuw-inloggen', 'onbekend'])

function leesStaat() {
  const d = leesJson(ACCOUNTS_JSON, () => ({}))
  const accounts = (Array.isArray(d.accounts) ? d.accounts : []).filter(
    a => a && Number.isInteger(a.id) && a.id > 0 && typeof a.sleutel === 'string' && a.sleutel.includes(':'),
  ).map(a => ({ ...a, inRotatie: a.inRotatie !== false, status: ACCOUNT_STATUS.has(a.status) ? a.status : 'onbekend' }))
  return {
    ...d,
    accounts,
    actief: Number.isInteger(d.actief) ? d.actief : null,
    instellingen: instellingenVan(d.instellingen),
    profielOk: d.profielOk && typeof d.profielOk === 'object' && !Array.isArray(d.profielOk) ? d.profielOk : {},
  }
}

function leesGebruik() {
  return leesJson(GEBRUIK_JSON, () => ({}))
}

// Staat bijwerken onder staat.lock (kort, binnenste lock): opnieuw lezen, fn past aan, beide schrijven.
async function werkBij(fn) {
  const vrij = await bestandLock(path.join(HOME, 'staat.lock'), 30_000, 5_000)
  try {
    const staat = leesStaat()
    const gebruik = leesGebruik()
    const uit = await fn(staat, gebruik)
    const ok = Object.entries(staat.profielOk)
    if (ok.length > 50) staat.profielOk = Object.fromEntries(ok.slice(-50))
    schrijfAtomisch(ACCOUNTS_JSON, JSON.stringify(staat, null, 2) + '\n')
    schrijfAtomisch(GEBRUIK_JSON, JSON.stringify(gebruik, null, 2) + '\n')
    return uit
  } finally {
    vrij()
  }
}

function zoek(staat, id) {
  const n = Number(id)
  const a = staat.accounts.find(x => x.id === n)
  if (!a) throw new Fout(`onbekend account: ${id}`, 4)
  return a
}

const configPad = sleutel => path.join(HOME, 'config', `${bestandsnaam(sleutel)}.json`)

// --- ~/.claude.json ---------------------------------------------------------------------------

// { tekst, data, stat } of undefined als het bestand ontbreekt; kapot → exit 2.
function leesClaudeJson() {
  let tekst, stat
  try {
    stat = fs.statSync(CLAUDE_JSON)
    tekst = fs.readFileSync(CLAUDE_JSON, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return undefined
    throw new Fout(`~/.claude.json niet gelezen (${err.code ?? err.message}); niets gewijzigd`, 2)
  }
  const data = parse(tekst)
  if (!data) throw new Fout('~/.claude.json is geen geldige JSON; niets gewijzigd', 2)
  return { tekst, data, stat }
}

// Identiteit van de login volgens ~/.claude.json: { sleutel, oauthAccount } of undefined.
function identiteit(data) {
  const o = data?.oauthAccount
  if (!o || typeof o !== 'object' || typeof o.accountUuid !== 'string' || !UUID.test(o.accountUuid)) return undefined
  const org = typeof o.organizationUuid === 'string' && UUID.test(o.organizationUuid) ? o.organizationUuid : ''
  return { sleutel: `${o.accountUuid}:${org}`, oauthAccount: o }
}

function identiteitNu() {
  return identiteit(leesClaudeJson()?.data)
}

// --- netwerk ----------------------------------------------------------------------------------

async function haal(url, opties = {}) {
  return fetch(url, { ...opties, headers: { 'User-Agent': UA, ...(opties.headers ?? {}) }, signal: AbortSignal.timeout(5_000) })
}

// Van wie is dit token? GET /api/oauth/profile → { uuid, org? } of { fout }.
async function profiel(accessToken) {
  try {
    const r = await haal(`${API}/api/oauth/profile`, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } })
    if (!r.ok) return { fout: `http-${r.status}` }
    const d = await r.json()
    const uuid = d?.account?.uuid
    if (typeof uuid !== 'string' || !uuid.trim()) return { fout: 'antwoord zonder account' }
    const org = d?.organization?.uuid
    return { uuid: uuid.trim(), ...(typeof org === 'string' && org ? { org } : {}) }
  } catch (err) {
    return { fout: err?.name === 'TimeoutError' ? 'timeout' : 'netwerk' }
  }
}

const hoortBij = (p, sleutel) => p.uuid === uuidVan(sleutel) && (!p.org || !orgVan(sleutel) || p.org === orgVan(sleutel))

// --- opdrachten -------------------------------------------------------------------------------

function opties(args, bekend) {
  const o = { _: [] }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (!a.startsWith('--')) { o._.push(a); continue }
    const naam = a.slice(2)
    if (!(naam in bekend)) throw new Fout(`onbekend argument: ${a}`, 1)
    if (bekend[naam] === 'vlag') o[naam] = true
    else {
      if (i + 1 >= args.length) throw new Fout(`${a} mist een waarde`, 1)
      o[naam] = args[++i]
    }
  }
  return o
}

async function add(o) {
  eisStandaard()
  const c = leesClaudeJson()
  const id = identiteit(c?.data)
  if (!id) throw new Fout('niet ingelogd: geen account in ~/.claude.json; log in met /login', 3)
  const live = leesLive()
  if (!live) throw new Fout('niet ingelogd: geen login in de sleutelhanger; log in met /login', 3)
  if (!geldig(live.cred)) throw new Fout('geen abonnement-login (API-key of onvolledig); niets bewaard', 3)
  const v1 = vinger(live.cred.claudeAiOauth.refreshToken)

  // Buiten elke lock: is het token echt van dit account?
  const p = await profiel(live.cred.claudeAiOauth.accessToken)
  if (!p.uuid) throw new Fout(`identiteit niet te controleren (${p.fout}); stuur eerst een bericht in Claude Code en probeer het opnieuw`, 3)
  if (!hoortBij(p, id.sleutel)) throw new Fout('de login in de sleutelhanger hoort niet bij het account in ~/.claude.json; niets bewaard', 3)

  const cred = await metLocks(['cred'], () => {
    const l2 = leesLive()
    if (!l2 || !geldig(l2.cred) || vinger(l2.cred.claudeAiOauth.refreshToken) !== v1 || identiteitNu()?.sleutel !== id.sleutel) {
      throw new Fout('login veranderde tijdens het toevoegen; probeer het opnieuw', 3)
    }
    schrijfKopie(id.sleutel, l2.cred)
    return l2.cred
  })
  schrijfAtomisch(configPad(id.sleutel), JSON.stringify(id.oauthAccount, null, 2) + '\n')

  const plan = planLabel(cred.claudeAiOauth)
  const email = maskEmail(id.oauthAccount.emailAddress)
  const uit = await werkBij(staat => {
    staat.profielOk[v1] = id.sleutel
    const oud = staat.accounts.find(a => a.sleutel === id.sleutel)
    if (oud) {
      Object.assign(oud, { email, plan, planOp: nu(), status: 'ok' })
      delete oud.statusUitleg
      if (o.label !== undefined) oud.label = String(o.label).slice(0, 40)
      return { id: oud.id, email, plan, nieuw: false }
    }
    const nieuwId = Math.max(0, ...staat.accounts.map(a => a.id)) + 1
    staat.accounts.push({
      id: nieuwId, sleutel: id.sleutel, email, plan, planOp: nu(), inRotatie: true, status: 'ok', toegevoegd: nu(),
      ...(o.label !== undefined ? { label: String(o.label).slice(0, 40) } : {}),
    })
    return { id: nieuwId, email, plan, nieuw: true }
  })
  logRegel({ soort: 'add', id: uit.id, email, nieuw: uit.nieuw })
  return uit
}

function vensterUit(m, label) {
  const v = Array.isArray(m?.vensters) ? m.vensters.find(x => x?.label === label) : undefined
  if (!v) return undefined
  return { ...(typeof v.pct === 'number' ? { pct: v.pct } : {}), ...(typeof v.resetsAt === 'number' ? { resetsAt: v.resetsAt } : {}) }
}

// Lijst zonder netwerk en zonder sleutelhanger. Actief = het account van ~/.claude.json nu.
function status() {
  const staat = leesStaat()
  const gebruik = leesGebruik()
  const profiel = eigenProfiel() ? 'eigen' : 'standaard'
  let actief = null
  let fout
  if (profiel === 'standaard') {
    try {
      const s = identiteitNu()?.sleutel
      actief = staat.accounts.find(a => a.sleutel === s)?.id ?? null
    } catch (err) {
      fout = err.message
    }
  }
  const t = nu()
  const accounts = staat.accounts.map(a => {
    const m = gebruik[a.id]
    const g = {}
    for (const label of ['5u', '7d']) {
      const v = vensterUit(m, label)
      if (v) g[label] = v
    }
    return {
      id: a.id,
      email: a.email,
      plan: a.plan ?? '?',
      inRotatie: a.inRotatie,
      status: a.status,
      ...(a.statusUitleg ? { statusUitleg: a.statusUitleg } : {}),
      ...(a.label ? { label: a.label } : {}),
      gebruik: g,
      ...(typeof m?.gemetenOp === 'number' ? { gemetenOp: m.gemetenOp, leeftijdS: Math.max(0, Math.round((t - m.gemetenOp) / 1000)) } : {}),
      ...(m?.fout ? { fout: m.fout } : {}),
    }
  })
  return {
    actief,
    profiel,
    accounts,
    instellingen: staat.instellingen,
    ...(staat.laatsteWissel ? { laatsteWissel: staat.laatsteWissel } : {}),
    ...(staat.wacht ? { wacht: staat.wacht } : {}),
    ...(fout ? { fout } : {}),
  }
}

async function remove(idArg) {
  const actiefSleutel = eigenProfiel() ? undefined : identiteitNu()?.sleutel
  const a = zoek(leesStaat(), idArg)
  keychainWis(KOPIE, a.sleutel)
  keychainWis(VORIGE, a.sleutel)
  fs.rmSync(configPad(a.sleutel), { force: true })
  await werkBij((staat, gebruik) => {
    staat.accounts = staat.accounts.filter(x => x.id !== a.id)
    if (staat.actief === a.id) staat.actief = null
    delete gebruik[a.id]
  })
  const actief = a.sleutel === actiefSleutel
  logRegel({ soort: 'remove', id: a.id, email: a.email })
  return { verwijderd: a.id, actief, ...(actief ? { uitleg: 'blijft ingelogd; futureflow beheert het niet meer' } : {}) }
}

async function zet(idArg, wat, waarde) {
  if (wat !== 'rotatie' || (waarde !== 'aan' && waarde !== 'uit')) throw new Fout('kies: zet <id> rotatie aan|uit', 1)
  zoek(leesStaat(), idArg)
  return werkBij(staat => {
    const a = zoek(staat, idArg)
    a.inRotatie = waarde === 'aan'
    return { id: a.id, inRotatie: a.inRotatie }
  })
}

async function instellingen(json) {
  const nieuw = parse(json ?? '')
  if (!nieuw) throw new Fout("instellingen verwacht een JSON-object, bv. '{\"auto\":true}'", 1)
  return werkBij(staat => {
    staat.instellingen = instellingenVan({ ...staat.instellingen, ...nieuw })
    return { instellingen: staat.instellingen }
  })
}

// Kopie van het actieve account bijwerken als Claude Code zijn token roteerde: alleen als de live
// login bij een bekend account hoort (identiteit uit ~/.claude.json én een profielcheck per
// vingerafdruk), het refresh-token anders is en de live login niet ouder is dan de kopie.
async function sync() {
  eisStandaard()
  const staat = leesStaat()
  const id = identiteitNu()
  const acc = staat.accounts.find(a => a.sleutel === id?.sleutel)
  if (!acc) return { gesynct: false, reden: 'de huidige login is geen bekend account' }
  const live = leesLive()
  if (!live || !geldig(live.cred)) return { gesynct: false, id: acc.id, reden: 'geen abonnement-login in de sleutelhanger' }
  const vl = vinger(live.cred.claudeAiOauth.refreshToken)
  const kopie = leesKopie(acc.sleutel)
  if (kopie && geldig(kopie) && vinger(kopie.claudeAiOauth.refreshToken) === vl) return { gesynct: false, id: acc.id, reden: 'al gelijk' }
  if (kopie && verloopt(live.cred) < verloopt(kopie)) return { gesynct: false, id: acc.id, reden: 'de kopie is nieuwer' }

  if (staat.profielOk[vl] !== acc.sleutel) {
    const p = await profiel(live.cred.claudeAiOauth.accessToken)
    if (!p.uuid) return { gesynct: false, id: acc.id, reden: `identiteit niet gecontroleerd (${p.fout})` }
    if (!hoortBij(p, acc.sleutel)) throw new Fout('de login in de sleutelhanger hoort niet bij het account in ~/.claude.json; kopie niet bijgewerkt', 3)
    await werkBij(s => { s.profielOk[vl] = acc.sleutel })
  }

  const gelukt = await metLocks(['cred'], () => {
    const l2 = leesLive()
    if (!l2 || !geldig(l2.cred) || vinger(l2.cred.claudeAiOauth.refreshToken) !== vl || identiteitNu()?.sleutel !== acc.sleutel) return false
    schrijfKopie(acc.sleutel, l2.cred)
    return true
  })
  if (!gelukt) return { gesynct: false, id: acc.id, reden: 'login veranderde; volgende keer opnieuw' }
  await werkBij(s => {
    const a = s.accounts.find(x => x.id === acc.id)
    if (!a) return
    if (a.status !== 'ok') { a.status = 'ok'; delete a.statusUitleg }
    if (nu() - (a.planOp ?? 0) > 6 * UUR) { a.plan = planLabel(live.cred.claudeAiOauth); a.planOp = nu() }
  })
  logRegel({ soort: 'sync', id: acc.id })
  return { gesynct: true, id: acc.id }
}

const GEBRUIK =
  'Gebruik: accounts add [--label <tekst>] | list | status [--json] | remove <id> | zet <id> rotatie aan|uit | ' +
  "instellingen '<json>' | sync"

export async function main(args) {
  const [cmd, ...rest] = args
  let uit
  try {
    if (cmd === 'add') {
      const o = opties(rest, { label: 'waarde' })
      if (o._.length) throw new Fout(GEBRUIK, 1)
      uit = await add(o)
    } else if (cmd === 'list' || cmd === 'status') {
      const o = opties(rest, { json: 'vlag' })
      if (o._.length) throw new Fout(GEBRUIK, 1)
      uit = status()
    } else if (cmd === 'remove' && rest.length === 1) uit = await remove(rest[0])
    else if (cmd === 'zet' && rest.length === 3) uit = await zet(rest[0], rest[1], rest[2])
    else if (cmd === 'instellingen' && rest.length === 1) uit = await instellingen(rest[0])
    else if (cmd === 'sync' && rest.length === 0) uit = await sync()
    else throw new Fout(GEBRUIK, 1)
    console.log(JSON.stringify(uit))
    return 0
  } catch (err) {
    if (err instanceof Fout) {
      console.error(`[accounts] ${err.message}`)
      console.log(JSON.stringify({ fout: err.message, code: err.code, ...err.extra }))
      return err.code
    }
    throw err
  }
}

// Hoofdscript? Via realpath vergelijken: bij een symlink (dev-mods) wijst argv[1]
// naar de link en import.meta.url naar het echte bestand.
const isMain = (() => {
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)) } catch { return false }
})()

if (isMain) {
  main(process.argv.slice(2)).then(
    code => { process.exitCode = code },
    err => {
      // Geen stack met mogelijke invoer: alleen de melding.
      console.error(`[accounts] ${err?.message ?? err}`)
      console.log(JSON.stringify({ fout: 'onverwachte fout', code: 1 }))
      process.exitCode = 1
    },
  )
}
