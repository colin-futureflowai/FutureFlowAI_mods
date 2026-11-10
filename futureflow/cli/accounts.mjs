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
//   accounts sessie <sessionId> bezig|tussen|weg                          → { sessie, status }
//   accounts bezig [--ikzelf <sessionId>]      andere terminal-sessies midden in een beurt → { bezig, wie }
//   accounts switch <id> [--van <id>] [--ikzelf <sessionId>] [--auto]  → { gewisseld, van, naar, email, plan }
//                                              exit 7 → { fout, code, wie, sinds }
//   accounts freshen <id>                      kopie vers maken (niet-actief) → { id, ververst, reden? }
//   accounts usage --refresh [--id <n>] [--nu] verbruik ophalen (aan de beurt; --nu: alleen de vloer)
//                                              → { opgehaald: id[], overgeslagen: id[], fouten: { id: tekst } }
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

import { GEDEELD, instellingenVan, KOPIE, LIVE, maskEmail, planLabel, POLL, pollPlan, REDDING, ruimte, telBezig, VORIGE } from '../lib/accounts.mjs'

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

// --- sessies tussen beurten -----------------------------------------------------------------

const SESSIES = path.join(HOME, 'sessies')
const SESSIE_ID = /^[A-Za-z0-9._-]{1,128}$/
const DAG = 24 * UUR
const VERS_BESTAND = 10 * 60_000

// Eigen sessiebestand (de mod schrijft het zelf met $.fs.write; dit is voor tests en de tekstversie).
function sessie(sid, st) {
  if (!SESSIE_ID.test(sid ?? '') || !['bezig', 'tussen', 'weg'].includes(st)) throw new Fout('kies: sessie <sessionId> bezig|tussen|weg', 1)
  const pad = path.join(SESSIES, `${sid}.json`)
  let oud
  try { oud = parse(fs.readFileSync(pad, 'utf8')) } catch {}
  const t = nu()
  schrijfAtomisch(pad, JSON.stringify({ sessie: sid, status: st, sinds: oud?.status === st && typeof oud.sinds === 'number' ? oud.sinds : t, hartslag: t, terminal: true }) + '\n')
  return { sessie: sid, status: st }
}

// Eigen sessiebestanden; ruimt `weg` en hartslag > 24 u op. Een half geschreven bestand telt als bezig
// zolang het vers is; een onleesbare map als bezig.
function eigenSessies() {
  let namen
  try {
    namen = fs.readdirSync(SESSIES)
  } catch (err) {
    return err.code === 'ENOENT' ? [] : [{ sessie: '(sessies onleesbaar)', status: 'bezig', hartslag: nu() }]
  }
  const t = nu()
  const uit = []
  for (const n of namen) {
    if (!n.endsWith('.json')) continue
    const pad = path.join(SESSIES, n)
    let d
    try { d = parse(fs.readFileSync(pad, 'utf8')) } catch { continue }
    if (!d || typeof d.sessie !== 'string') {
      try { if (Date.now() - fs.statSync(pad).mtimeMs < VERS_BESTAND) uit.push({ sessie: n.slice(0, -5), status: 'bezig', hartslag: t }) } catch {}
      continue
    }
    const hartslag = Number(d.hartslag) || 0
    if (d.status === 'weg' || t - hartslag > DAG) {
      fs.rmSync(pad, { force: true })
      continue
    }
    uit.push({ sessie: d.sessie, status: d.status, hartslag })
  }
  return uit
}

const MAANDEN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// `Tue Nov 10 10:27:32 2026` (ps -o lstart onder LC_ALL=C TZ=UTC) → epoch-seconden.
function lstart(tekst) {
  const d = String(tekst).trim().split(/\s+/)
  if (d.length !== 5 || !MAANDEN.includes(d[1])) return undefined
  const [u, m, s] = d[3].split(':').map(Number)
  const t = Date.UTC(Number(d[4]), MAANDEN.indexOf(d[1]), Number(d[2]), u, m, s) / 1000
  return Number.isFinite(t) ? t : undefined
}

function ps(pid, kolommen) {
  const r = spawnSync('/bin/ps', ['-o', kolommen, '-p', String(pid)], { encoding: 'utf8', timeout: 5_000, env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } })
  const tekst = (r.stdout ?? '').trim()
  return r.status === 0 && tekst ? tekst : undefined
}

// Is de levende pid nog de Claude Code die het record schreef? Een hergebruikte pid hoort bij een
// proces dat later startte (> 120 s) en geen claude is (claude-swap process_detection.py). Niet te
// bepalen = ja.
function pidKlopt(pid, procStart) {
  if (typeof procStart !== 'string' || !procStart || /^\d+$/.test(procStart)) return true
  const opgenomen = lstart(procStart)
  if (opgenomen === undefined) return true
  const s = ps(pid, 'lstart=')
  const gestart = s === undefined ? undefined : lstart(s)
  if (gestart === undefined || gestart <= opgenomen + 120) return true
  const c = ps(pid, 'comm=,args=')
  return c === undefined || c.toLowerCase().includes('claude')
}

// Records van Claude Code zelf (~/.claude/sessions/<pid>.json), zonder de ouder van deze CLI (de
// sessie die hem startte). Onleesbaar met een levende pid telt als bezig.
function claudeRecords() {
  const map = path.join(CLAUDE_HOME, 'sessions')
  let namen
  try {
    namen = fs.readdirSync(map)
  } catch (err) {
    return err.code === 'ENOENT' ? [] : [{ pid: 0, levend: true, onleesbaar: true }]
  }
  const uit = []
  for (const n of namen) {
    if (!n.endsWith('.json')) continue
    const naamPid = Number(n.slice(0, -5))
    let d
    try { d = parse(fs.readFileSync(path.join(map, n), 'utf8')) } catch {}
    const pid = Number.isInteger(d?.pid) ? d.pid : naamPid
    if (pid === process.ppid || pid === process.pid) continue
    if (!d || !Number.isInteger(d.pid)) {
      if (Number.isInteger(naamPid) && leeft(naamPid)) uit.push({ pid: naamPid, levend: true, onleesbaar: true })
      continue
    }
    const telt = d.entrypoint !== 'claude-desktop' && d.status !== 'idle'
    uit.push({
      pid,
      levend: leeft(pid) && (!telt || pidKlopt(pid, d.procStart)),
      ...(typeof d.sessionId === 'string' ? { sessionId: d.sessionId } : {}),
      ...(typeof d.entrypoint === 'string' ? { entrypoint: d.entrypoint } : {}),
      ...(typeof d.status === 'string' ? { status: d.status } : {}),
      ...(typeof d.statusUpdatedAt === 'number' ? { statusUpdatedAt: d.statusUpdatedAt } : {}),
    })
  }
  return uit
}

function bezig(ikzelf) {
  return telBezig({ eigen: eigenSessies(), claude: claudeRecords(), ikzelf: ikzelf ?? '', nu: nu() })
}

// --- refresh van een niet-actief account --------------------------------------------------------

// Publieke OAuth-client-id van Claude Code (bron: claude-swap oauth.py:21).
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'

// POST /v1/oauth/token. Nooit de body van een fout tonen of loggen.
async function tokenPost(refreshToken) {
  let r
  try {
    r = await haal(`${PLATFORM}/v1/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: CLIENT_ID }),
    })
  } catch (err) {
    return { soort: 'tijdelijk', fout: err?.name === 'TimeoutError' ? 'timeout' : 'netwerk' }
  }
  let d
  try { d = await r.json() } catch {}
  if (!r.ok) {
    // Alleen een expliciete invalid_grant is definitief (claude-swap oauth.py:297-322).
    if ([400, 401, 403].includes(r.status) && d?.error === 'invalid_grant') return { soort: 'invalid_grant', fout: 'login ongeldig' }
    return { soort: 'tijdelijk', fout: `http-${r.status}` }
  }
  if (typeof d?.access_token !== 'string' || !d.access_token || typeof d?.expires_in !== 'number') return { soort: 'tijdelijk', fout: 'onverwacht antwoord' }
  return { soort: 'ok', d }
}

async function zetStatus(id, st, uitleg) {
  await werkBij(s => {
    const a = s.accounts.find(x => x.id === id)
    if (!a) return
    a.status = st
    if (uitleg) a.statusUitleg = uitleg
    else delete a.statusUitleg
  })
}

const OPNIEUW = 'login verlopen of ingetrokken; log in met /login en kies Toevoegen'

// Kopie van een niet-actief account vers maken als zijn access-token binnen `marge` ms verloopt.
// Onder refresh-<account>.lock: kopie opnieuw lezen (een ander proces kan net ververst hebben), POST,
// en de opvolger **eerst** bewaren (elk refresh-token werkt één keer). Mislukt dat bewaren, dan de
// opvolger in futureflow-accounts-redding en status `onbekend`.
// → { soort: 'ok', cred, ververst } | { soort: 'invalid_grant' | 'tijdelijk' | 'kapot', fout }
async function ververs(acc, marge) {
  const vrij = await bestandLock(path.join(HOME, `refresh-${bestandsnaam(acc.sleutel)}.lock`), 60_000)
  try {
    const kopie = leesKopie(acc.sleutel)
    if (!geldig(kopie)) return { soort: 'kapot', fout: 'kopie ontbreekt of is kapot; log in met /login en kies Toevoegen' }
    if (verloopt(kopie) - nu() > marge) return { soort: 'ok', cred: kopie, ververst: false }
    const r = await tokenPost(kopie.claudeAiOauth.refreshToken)
    if (r.soort === 'invalid_grant') {
      await zetStatus(acc.id, 'opnieuw-inloggen', OPNIEUW)
      logRegel({ soort: 'refresh', id: acc.id, uitkomst: 'opnieuw-inloggen' })
      return r
    }
    if (r.soort !== 'ok') return r
    const d = r.d
    const nieuw = {
      ...kopie,
      claudeAiOauth: {
        ...kopie.claudeAiOauth,
        accessToken: d.access_token,
        expiresAt: nu() + d.expires_in * 1000,
        ...(typeof d.refresh_token === 'string' && d.refresh_token ? { refreshToken: d.refresh_token } : {}),
        ...(typeof d.scope === 'string' && d.scope ? { scopes: d.scope.split(/\s+/) } : {}),
      },
    }
    const ander = typeof d.account?.uuid === 'string' && d.account.uuid !== uuidVan(acc.sleutel)
    let fout
    if (ander) fout = 'de ververste login hoort bij een ander account'
    else {
      try { schrijfKopie(acc.sleutel, nieuw) } catch (err) { fout = err.message }
    }
    if (fout) {
      let gered = false
      try {
        keychainSchrijf(REDDING, ander ? `uuid:${String(d.account.uuid).slice(0, 80)}` : acc.sleutel, JSON.stringify(zonderGedeeld(nieuw)))
        gered = true
      } catch {}
      await zetStatus(acc.id, 'onbekend', `nieuwe login niet bewaard${gered ? ' (staat in futureflow-accounts-redding)' : ''}; log in met /login en kies Toevoegen`)
      logRegel({ soort: 'refresh', id: acc.id, uitkomst: 'niet bewaard', gered })
      return { soort: 'kapot', fout }
    }
    logRegel({ soort: 'refresh', id: acc.id, uitkomst: 'ok' })
    return { soort: 'ok', cred: nieuw, ververst: true }
  } finally {
    vrij()
  }
}

async function freshen(idArg) {
  eisStandaard()
  const a = zoek(leesStaat(), idArg)
  if (identiteitNu()?.sleutel === a.sleutel) return { id: a.id, ververst: false, reden: 'actief; Claude Code ververst deze login zelf' }
  const f = await ververs(a, 10 * 60_000)
  if (f.soort === 'invalid_grant') throw new Fout(`account ${a.id}: ${OPNIEUW}`, 9)
  if (f.soort === 'kapot') throw new Fout(`account ${a.id}: ${f.fout}`, 5)
  if (f.soort === 'tijdelijk') return { id: a.id, ververst: false, reden: `tijdelijk niet gelukt (${f.fout})` }
  if (a.status !== 'ok') await zetStatus(a.id, 'ok')
  return { id: a.id, ververst: f.ververst }
}

// --- wisselen -------------------------------------------------------------------------------

// Kopie van oauthAccount van een account (voor ~/.claude.json).
function leesConfig(sleutel) {
  let d
  try { d = parse(fs.readFileSync(configPad(sleutel), 'utf8')) } catch {}
  if (!d || d.accountUuid !== uuidVan(sleutel)) throw new Fout('accountgegevens (config) ontbreken of zijn kapot; voeg het account opnieuw toe', 2)
  return d
}

// Zelfde opmaak als het origineel: inspringing van de tweede regel, eind-newline alleen als die er was.
function opmaak(tekst, data) {
  const m = /^\{\r?\n([ \t]+)/.exec(tekst)
  const inspring = m ? m[1] : tekst.includes('\n') ? 2 : 0
  return JSON.stringify(data, null, inspring) + (/\n$/.test(tekst) ? '\n' : '')
}

const zelfde = (a, b) => a.mtimeMs === b.mtimeMs && a.size === b.size && a.ino === b.ino

// Alleen oauthAccount vervangen; tmp met dezelfde rechten, stat vergelijken, rename (zoals
// cli/connectors.mjs). Een symlink blijft een symlink.
function schrijfOauthAccount(eerst, oauthAccount) {
  let doel
  try { doel = fs.realpathSync(CLAUDE_JSON) } catch (err) { throw new Fout(`~/.claude.json niet gelezen (${err.code})`, 2) }
  let gelezen = eerst
  for (let poging = 1; poging <= 3; poging++) {
    if (!gelezen) gelezen = leesClaudeJson()
    if (!gelezen) throw new Fout('~/.claude.json verdween tijdens het wisselen', 2)
    const { tekst, data, stat } = gelezen
    data.oauthAccount = oauthAccount
    const mode = stat.mode & 0o777
    const tmp = path.join(path.dirname(doel), `.${path.basename(doel)}.futureflow-${process.pid}-${Date.now()}.tmp`)
    try {
      fs.writeFileSync(tmp, opmaak(tekst, data), { mode, flag: 'wx' })
      fs.chmodSync(tmp, mode)
      let st
      try { st = fs.statSync(doel) } catch { st = undefined }
      if (!st || !zelfde(st, stat)) {
        fs.rmSync(tmp, { force: true })
        gelezen = undefined
        continue
      }
      fs.renameSync(tmp, doel)
      return
    } catch (err) {
      fs.rmSync(tmp, { force: true })
      if (err instanceof Fout) throw err
      throw new Fout(`~/.claude.json niet geschreven (${err.code ?? err.message})`, 2)
    }
  }
  throw new Fout('~/.claude.json veranderde steeds tijdens het schrijven', 2)
}

// Stap 3-6, onder de credential-locks en de config-lock: alleen lokale I/O.
function wisselOnderLocks({ doel, config, id1, vinger1, uitgaand }) {
  const S = leesLive()
  if (!S) throw new Fout('niet ingelogd: geen login in de sleutelhanger', 3)
  const C = leesClaudeJson()
  if (!C) throw new Fout('~/.claude.json ontbreekt; niets gewijzigd', 2)
  const nuId = identiteit(C.data)
  const vS = geldig(S.cred) ? vinger(S.cred.claudeAiOauth.refreshToken) : undefined
  if (nuId?.sleutel !== id1?.sleutel || vS !== vinger1) throw new Fout('login veranderde tijdens het wisselen; probeer het opnieuw', 3)

  // Uitgaande login terug in zijn kopie; hoort hij bij geen (gecontroleerd) bekend account, dan redding.
  if (uitgaand && vS) {
    const k = leesKopie(uitgaand.sleutel)
    if (!geldig(k) || verloopt(S.cred) >= verloopt(k)) schrijfKopie(uitgaand.sleutel, S.cred)
  } else if (vS) {
    keychainSchrijf(REDDING, nuId?.sleutel ?? 'live', JSON.stringify(zonderGedeeld(S.cred)))
  }

  // Doel = kopie + de gedeelde velden van de live login.
  const kopie = leesKopie(doel.sleutel)
  if (!geldig(kopie)) throw new Fout(`kopie van account ${doel.id} ontbreekt of is kapot; niets gewijzigd`, 5)
  const T = zonderGedeeld(kopie)
  for (const k of GEDEELD) if (S.cred[k] !== undefined) T[k] = S.cred[k]
  const Ttekst = JSON.stringify(T)

  const herstelLive = () => {
    try { keychainSchrijf(LIVE, KEYCHAIN_USER, S.tekst) } catch { logRegel({ soort: 'switch', fout: 'live login niet teruggezet' }) }
  }
  try {
    keychainSchrijf(LIVE, KEYCHAIN_USER, Ttekst)
  } catch (err) {
    herstelLive()
    throw new Fout(`niet gewisseld (${err.message}); je oude login staat er weer`, 5)
  }

  // Lopende sessies: bestaat ~/.claude/.credentials.json, dan herschrijven (nooit aanmaken).
  const credBestand = path.join(CLAUDE_HOME, '.credentials.json')
  let credOud, credMode = 0o600
  try {
    credMode = fs.statSync(credBestand).mode & 0o777
    credOud = fs.readFileSync(credBestand, 'utf8')
  } catch (err) {
    if (err.code !== 'ENOENT') {
      herstelLive()
      throw new Fout(`.credentials.json niet gelezen (${err.code}); niet gewisseld`, 2)
    }
  }
  if (credOud !== undefined) {
    try {
      schrijfAtomisch(credBestand, Ttekst, credMode)
    } catch {
      herstelLive()
      throw new Fout('.credentials.json niet geschreven; niet gewisseld, je oude login staat er weer', 5)
    }
  }

  try {
    schrijfOauthAccount(C, config)
  } catch (err) {
    herstelLive()
    if (credOud !== undefined) try { schrijfAtomisch(credBestand, credOud, credMode) } catch {}
    throw new Fout(`${err.message}; niet gewisseld, je oude login staat er weer`, 2)
  }
}

async function wissel(o) {
  eisStandaard()
  if (o._.length !== 1) throw new Fout(GEBRUIK, 1)
  const van = o.van === undefined ? undefined : Number(o.van)
  if (o.van !== undefined && !Number.isInteger(van)) throw new Fout('--van verwacht een account-nummer', 1)
  if (o.ikzelf !== undefined && !SESSIE_ID.test(o.ikzelf)) throw new Fout('--ikzelf verwacht een sessie-id', 1)

  // 1. Buiten de locks (netwerk mag): doel controleren en vers maken, live login vaststellen.
  let staat = leesStaat()
  const doel = zoek(staat, o._[0])
  if (doel.status === 'opnieuw-inloggen') throw new Fout(`account ${doel.id}: ${OPNIEUW}`, 9)
  if (doel.status !== 'ok') throw new Fout(`account ${doel.id}: ${doel.statusUitleg ?? 'status onbekend; voeg het opnieuw toe'}`, 9)
  const id1 = identiteitNu()
  if (id1?.sleutel === doel.sleutel) throw new Fout(`account ${doel.id} is al actief`, 6)
  if (van !== undefined && staat.accounts.find(a => a.sleutel === id1?.sleutel)?.id !== van) throw new Fout(`account ${van} is niet meer actief; niets gedaan`, 6)
  const config = leesConfig(doel.sleutel)
  const f = await ververs(doel, 10 * 60_000)
  if (f.soort === 'invalid_grant') throw new Fout(`account ${doel.id}: ${OPNIEUW}; niet gewisseld`, 9)
  if (f.soort === 'kapot') throw new Fout(`account ${doel.id}: ${f.fout}; niet gewisseld`, 5)
  // Tijdelijk mislukt: toch wisselen; Claude Code ververst een verlopen token zelf bij het volgende bericht.

  const live1 = leesLive()
  if (!live1) throw new Fout('niet ingelogd: geen login in de sleutelhanger', 3)
  const vinger1 = geldig(live1.cred) ? vinger(live1.cred.claudeAiOauth.refreshToken) : undefined
  let uitgaand
  const accUit = staat.accounts.find(a => a.sleutel === id1?.sleutel)
  if (accUit && vinger1) {
    const k = leesKopie(accUit.sleutel)
    if ((geldig(k) && vinger(k.claudeAiOauth.refreshToken) === vinger1) || staat.profielOk[vinger1] === accUit.sleutel) uitgaand = accUit
    else {
      const p = await profiel(live1.cred.claudeAiOauth.accessToken)
      if (p.uuid && hoortBij(p, accUit.sleutel)) {
        uitgaand = accUit
        await werkBij(s => { s.profielOk[vinger1] = accUit.sleutel })
      }
    }
  }

  // 2. wissel.lock: opnieuw kijken of het nog moet en mag.
  return metLocks(['wissel'], async () => {
    staat = leesStaat()
    const nuSleutel = identiteitNu()?.sleutel
    const actief = staat.accounts.find(a => a.sleutel === nuSleutel)?.id ?? null
    if (nuSleutel === doel.sleutel) throw new Fout(`account ${doel.id} is al actief`, 6)
    if (van !== undefined && actief !== van) throw new Fout(`account ${van} is niet meer actief; niets gedaan`, 6)
    if (o.auto) {
      if (!staat.instellingen.auto) throw new Fout('automatisch wisselen staat uit', 6)
      if (nu() - (staat.laatsteWissel?.tijd ?? 0) < staat.instellingen.wachttijd) throw new Fout('net gewisseld; eerst de wachttijd afwachten', 6)
    }
    const b = bezig(o.ikzelf)
    if (b.bezig > 0) {
      const w = await werkBij(s => {
        s.wacht = { sinds: s.wacht?.sinds ?? nu(), wie: b.wie }
        return s.wacht
      })
      throw new Fout(`${b.bezig} sessie(s) midden in een beurt; nog niet gewisseld`, 7, { wie: b.wie, sinds: w.sinds })
    }

    // 3-6. Claude Code's locks.
    await metLocks(['cred', 'config'], () => wisselOnderLocks({ doel, config, id1, vinger1, uitgaand }))

    // 7. Eigen staat en log.
    const tijd = nu()
    await werkBij(s => {
      s.actief = doel.id
      s.laatsteWissel = { tijd, van: actief, naar: doel.id, auto: !!o.auto }
      delete s.wacht
    })
    logRegel({ soort: 'switch', van: actief, naar: doel.id, email: doel.email, auto: !!o.auto, ...(uitgaand ? {} : { redding: true }) })
    return { gewisseld: true, van: actief, naar: doel.id, email: doel.email, plan: doel.plan ?? '?' }
  })
}

// --- verbruik -------------------------------------------------------------------------------

const BASIS_VENSTERS = new Set(['5u', '7d'])
// Staat het actieve account binnen zoveel punten van zijn marge, dan worden kandidaten in de rotatie
// bijgehaald als hun meting ouder is dan KANDIDAAT_VERS, zodat de keuze op verse metingen kan
// (de vloer en een 429 gelden dan nog steeds).
const ESCALATIE = 15
const KANDIDAAT_VERS = 10 * 60_000

function vensterLabel(k) {
  if (k === 'five_hour') return '5u'
  if (k === 'seven_day') return '7d'
  if (k.startsWith('seven_day_')) return `7d ${k.slice('seven_day_'.length).replace(/_/g, ' ')}`
  return undefined
}

// five_hour → 5u, seven_day → 7d, seven_day_opus → 7d opus. `utilization: null` = venster zonder pct.
function vensters(d) {
  const uit = []
  if (!d || typeof d !== 'object') return uit
  for (const [k, v] of Object.entries(d)) {
    const label = vensterLabel(k)
    if (!label || !v || typeof v !== 'object' || Array.isArray(v) || !('utilization' in v)) continue
    const pct = typeof v.utilization === 'number' && Number.isFinite(v.utilization) && v.utilization >= 0 ? v.utilization : undefined
    const r = typeof v.resets_at === 'string' ? Date.parse(v.resets_at) : NaN
    uit.push({ label, ...(pct !== undefined ? { pct } : {}), ...(Number.isNaN(r) ? {} : { resetsAt: r }) })
  }
  return uit
}

async function haalUsage(accessToken) {
  let r
  try {
    r = await haal(`${API}/api/oauth/usage`, { headers: { Authorization: `Bearer ${accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' } })
  } catch (err) {
    return { fout: err?.name === 'TimeoutError' ? 'timeout' : 'netwerk' }
  }
  if (r.status === 429) {
    const ra = Number(r.headers.get('retry-after'))
    return { fout: 'te veel verzoeken (429)', is429: true, ...(Number.isFinite(ra) && ra >= 0 ? { retryAfter: ra * 1000 } : {}) }
  }
  if (!r.ok) return { fout: `http-${r.status}` }
  let d
  try { d = await r.json() } catch { return { fout: 'onleesbaar antwoord' } }
  const v = vensters(d)
  if (!v.length) return { fout: 'antwoord zonder vensters' }
  return { vensters: v }
}

const basisPct = vs => {
  let m
  for (const v of vs) if (BASIS_VENSTERS.has(v.label) && typeof v.pct === 'number') m = m === undefined ? v.pct : Math.max(m, v.pct)
  return m
}

// Eén account meten. Actief: access-token uit het live item (nooit verversen). Niet-actief: kopie,
// eerst vers gemaakt als hij binnen 5 min verloopt.
async function meetEen(a, isActief, t) {
  let cred
  if (isActief) {
    const live = leesLive()
    if (!live || !geldig(live.cred)) return { fout: 'geen login in de sleutelhanger', overslaan: true }
    if (verloopt(live.cred) <= t) return { fout: 'token verlopen, ververst bij het volgende bericht', overslaan: true }
    cred = live.cred
  } else {
    const f = await ververs(a, 5 * 60_000)
    if (f.soort === 'invalid_grant') return { fout: 'opnieuw inloggen nodig', overslaan: true }
    if (f.soort === 'kapot') return { fout: f.fout, overslaan: true }
    if (f.soort !== 'ok') return { fout: `login niet ververst (${f.fout})` }
    cred = f.cred
  }
  return { ...(await haalUsage(cred.claudeAiOauth.accessToken)), planBron: cred.claudeAiOauth }
}

// Uitkomst van een meting in gebruik.json: metingen + poll-plan. Mislukt: de laatste goede meting
// blijft, alleen fout en backoff veranderen.
function verwerk(x, r, isActief, t) {
  const recent429 = !!r.is429 || (typeof x.laatste429 === 'number' && t - x.laatste429 < POLL.recent429)
  const vorig = typeof x.interval === 'number' ? { interval: x.interval, ...(typeof x.pct === 'number' ? { pct: x.pct } : {}) } : undefined
  if (r.vensters) {
    const pct = basisPct(r.vensters)
    const basis = r.vensters.filter(v => BASIS_VENSTERS.has(v.label) && typeof v.pct === 'number')
    const vol = basis.filter(v => v.pct >= 100 && !(typeof v.resetsAt === 'number' && v.resetsAt <= t))
    const resets = (vol.length ? vol : basis).map(v => v.resetsAt).filter(tijd => typeof tijd === 'number' && tijd > t)
    const resetsAt = resets.length ? (vol.length ? Math.max(...resets) : Math.min(...resets)) : undefined
    const plan = pollPlan({ vorig, nieuwPct: pct, actief: isActief, uitgeput: vol.length > 0, recent429, resetsAt, nu: t, rnd: Math.random })
    return {
      vensters: r.vensters, gemetenOp: t, poging: t, volgende: plan.volgende, interval: plan.interval,
      ...(pct !== undefined ? { pct } : {}),
      ...(typeof x.laatste429 === 'number' ? { laatste429: x.laatste429 } : {}),
    }
  }
  if (r.overslaan) return { ...x, fout: r.fout, foutOp: t, poging: t, volgende: Math.max(Number(x.volgende) || 0, t + POLL.vloer) }
  const plan = pollPlan({ vorig, actief: isActief, uitgeput: false, recent429, mislukt: true, ...(r.retryAfter !== undefined ? { retryAfter: r.retryAfter } : {}), nu: t, rnd: Math.random })
  return {
    ...x, fout: r.fout, foutOp: t, poging: t, volgende: plan.volgende, interval: plan.interval,
    ...(r.is429 ? { laatste429: t, nietVoor: t + Math.max(POLL.na429Min, (r.retryAfter ?? 0) + POLL.retryMarge) } : {}),
  }
}

// Verbruik ophalen voor de accounts die aan de beurt zijn (`volgende` uit gebruik.json), met --nu
// alleen de vloer. Een 429 (`nietVoor`) en de vloer gelden altijd. Netwerk nooit onder een lock; een
// account wordt eerst geclaimd onder staat.lock, zodat twee processen niet allebei ophalen.
async function usage(o) {
  eisStandaard()
  if (!o.refresh || o._.length) throw new Fout(GEBRUIK, 1)
  const staat = leesStaat()
  const gebruik = leesGebruik()
  const t = nu()
  const actiefSleutel = identiteitNu()?.sleutel
  const actief = staat.accounts.find(a => a.sleutel === actiefSleutel)
  const doelen = o.id !== undefined ? [zoek(staat, o.id)] : staat.accounts
  const rAct = actief ? ruimte(gebruik[actief.id], staat.instellingen, t) : null
  const uit = { opgehaald: [], overgeslagen: [], fouten: {} }
  for (const a of doelen) {
    const isActief = a.id === actief?.id
    const g = gebruik[a.id] ?? {}
    const poging = Number(g.poging) || 0
    const mag = t >= (Number(g.nietVoor) || 0) && t - poging >= POLL.vloer && (isActief || a.status === 'ok')
    let aanDeBeurt = mag && (o.nu || t >= (Number(g.volgende) || 0))
    if (mag && !aanDeBeurt && !isActief && a.inRotatie && rAct !== null && rAct <= ESCALATIE && !(t - (Number(g.gemetenOp) || 0) < KANDIDAAT_VERS)) aanDeBeurt = true
    if (!aanDeBeurt) {
      uit.overgeslagen.push(a.id)
      continue
    }
    const geclaimd = await werkBij((_s, gb) => {
      const x = gb[a.id] ?? {}
      if ((Number(x.poging) || 0) !== poging) return false
      gb[a.id] = { ...x, poging: t }
      return true
    })
    if (!geclaimd) {
      uit.overgeslagen.push(a.id)
      continue
    }
    const r = await meetEen(a, isActief, t)
    await werkBij((s, gb) => {
      gb[a.id] = verwerk(gb[a.id] ?? {}, r, isActief, t)
      const acc = s.accounts.find(x => x.id === a.id)
      if (acc && r.planBron && t - (acc.planOp ?? 0) > 6 * UUR) {
        acc.plan = planLabel(r.planBron)
        acc.planOp = t
      }
    })
    if (r.vensters) uit.opgehaald.push(a.id)
    else uit.fouten[a.id] = r.fout
  }
  return uit
}

const GEBRUIK =
  'Gebruik: accounts usage --refresh [--id <n>] [--nu] | accounts add [--label <tekst>] | list | status [--json] | remove <id> | zet <id> rotatie aan|uit | ' +
  "instellingen '<json>' | sync | sessie <sessionId> bezig|tussen|weg | bezig [--ikzelf <sessionId>] | " +
  'switch <id> [--van <id>] [--ikzelf <sessionId>] [--auto] | freshen <id>'

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
    else if (cmd === 'sessie' && rest.length === 2) uit = sessie(rest[0], rest[1])
    else if (cmd === 'bezig') {
      const o = opties(rest, { ikzelf: 'waarde' })
      if (o._.length) throw new Fout(GEBRUIK, 1)
      uit = bezig(o.ikzelf)
    } else if (cmd === 'switch') uit = await wissel(opties(rest, { van: 'waarde', ikzelf: 'waarde', auto: 'vlag' }))
    else if (cmd === 'freshen' && rest.length === 1) uit = await freshen(rest[0])
    else if (cmd === 'usage') uit = await usage(opties(rest, { refresh: 'vlag', id: 'waarde', nu: 'vlag' }))
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
