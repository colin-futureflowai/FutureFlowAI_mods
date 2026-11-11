#!/usr/bin/env node
// api — API-key in de macOS-sleutelhanger en wisselen tussen abonnement en API via
// `apiKeyHelper` in ~/.claude/settings.json. Alleen Node-builtins (plus de pure lib/api.mjs).
//
//   api zet-key                 key via stdin → sleutelhanger           → JSON { ok, staart }
//   api wis-key                 item uit de sleutelhanger               → JSON { gewist }
//   api status                                                          → JSON { heeftKey, staart, modus, vreemdeHelper, fout? }
//   api modus api|abonnement    zet of verwijdert alleen onze helper    → JSON { modus, gewijzigd }
//   api modus openrouter --m1 <id> [--m2 <id>] [--m3 <id>] [--m4 <id>] [--m5 <id>]
//                               (oude flags als alias: --model/--opus = 1, --sonnet = 2, --fable = 3, --snel = 4)
//                               zet OpenRouter klaar voor `claude-or`: eigen settings-bestand
//                               <OPENROUTER_DIR>/settings.json en de shim <SHIM_DIR>/claude-or
//                               → JSON { modus, gewijzigd, settings, shim, start, opPad }
//   api openrouter opruimen     oude OpenRouter-regels (van futureflow < 0.9) uit settings.json → JSON { gewijzigd }
//   api takenlijst aan|uit|status  env.CLAUDE_CODE_ENABLE_TODO_TOOLS = "true" → JSON { aan } (aan/uit ook { gewijzigd })
//   api openrouter zet-key      OpenRouter-key via stdin → sleutelhanger → JSON { ok, staart }
//   api openrouter wis-key                                              → JSON { gewist }
//   api openrouter modellen [--ververs]  lijst met tools-ondersteuning, cache 6 u → JSON { modellen, opgehaald, uitCache, fout? }
//   api openrouter test --model <id>     één POST /v1/messages met max_tokens 1 → JSON { ok, status?, fout? }
//
// OpenRouter komt sinds 0.9.0 nooit meer in ~/.claude/settings.json: Claude Code leest dat bestand live
// in alle lopende sessies, ook de desktop-app. Alleen `claude-or` (claude --settings <eigen bestand>)
// gebruikt OpenRouter. Oude regels (futureflow < 0.9): de marker (<OPENROUTER_DIR>/marker.json) zegt
// welke sleutels futureflow toen zette; `openrouter opruimen`, `modus api` en `modus abonnement` halen
// precies die weg, en alleen als de waarde nog gelijk is. Een bestaande claude-or die niet van
// futureflow is: exit 3.
//
// De key staat nooit in argv (ook niet van `security`: die krijgt de opdracht via stdin van
// `security -i`) en nooit op stdout of stderr; alleen de laatste 4 tekens.
// Exitcodes: 1 gebruik of ongeldige key, 2 settings onleesbaar of geen geldige JSON (niets geschreven),
// 3 er staat een andere apiKeyHelper of andere waarde (blijft staan), 4 geen key in de sleutelhanger,
// 5 sleutelhanger-fout, 6 modellijst niet op te halen (en geen cache).
// SETTINGS_JSON, SECURITY_BIN, OPENROUTER_DIR, OPENROUTER_URL en SHIM_DIR overschrijven paden,
// programma en adres (tests).

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ACCOUNT, geldigeKey, HELPER, MODI, modusVan, SERVICE } from '../lib/api.mjs'
import {
  CACHE_MS, eigenBasis, geldigeOrKey, geldigModel, haalWeg, modellenVan, OR_ACCOUNT, OR_SERVICE, OR_URL, orInstellingen,
  SHIM_MERK, shimTekst, SLOTS, START,
} from '../lib/openrouter.mjs'

const BESTAND = process.env.SETTINGS_JSON || path.join(os.homedir(), '.claude', 'settings.json')
const SECURITY = process.env.SECURITY_BIN || '/usr/bin/security'
const POGINGEN = 3
const TODO_VAR = 'CLAUDE_CODE_ENABLE_TODO_TOOLS'
const NIET_GEVONDEN = 44
const OR_DIR = process.env.OPENROUTER_DIR || path.join(os.homedir(), '.claude', 'futureflow', 'openrouter')
const OR_BASIS = (process.env.OPENROUTER_URL || OR_URL).replace(/\/+$/, '')
const MARKER = path.join(OR_DIR, 'marker.json')
const CACHE = path.join(OR_DIR, 'modellen.json')
const OR_SETTINGS = path.join(OR_DIR, 'settings.json')
const SHIM_DIR = process.env.SHIM_DIR || path.join(os.homedir(), '.local', 'bin')
const SHIM = path.join(SHIM_DIR, START)

class Fout extends Error {
  constructor(bericht, code) {
    super(bericht)
    this.code = code
  }
}

function security(args, invoer) {
  return spawnSync(SECURITY, args, { input: invoer, encoding: 'utf8', timeout: 15_000 })
}

// De key uit de sleutelhanger, alleen binnen dit proces; undefined als er geen is.
function leesKey(service = SERVICE, account = ACCOUNT) {
  const r = security(['find-generic-password', '-s', service, '-a', account, '-w'])
  if (r.error) throw new Fout(`sleutelhanger niet gelezen (${r.error.code ?? r.error.message})`, 5)
  if (r.status === NIET_GEVONDEN) return undefined
  if (r.status !== 0) throw new Fout(`sleutelhanger niet gelezen (exitcode ${r.status})`, 5)
  const key = (r.stdout ?? '').trim()
  return key || undefined
}

function leesStdin() {
  try {
    return fs.readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

function zetKey(or = false) {
  const key = leesStdin().trim()
  if (or ? !geldigeOrKey(key) : !geldigeKey(key)) {
    throw new Fout(or ? 'geen geldige OpenRouter-key (die begint met sk-or-); niets opgeslagen' : 'geen geldige Anthropic API-key (die begint met sk-ant-); niets opgeslagen', 1)
  }
  const [service, account] = or ? [OR_SERVICE, OR_ACCOUNT] : [SERVICE, ACCOUNT]
  // -U werkt een bestaand item bij. De opdracht gaat via stdin, zodat de key niet in argv staat.
  const r = security(['-i'], `add-generic-password -U -s ${service} -a ${account} -w ${key}\n`)
  if (r.error || r.status !== 0) throw new Fout(`key niet bewaard in de sleutelhanger (${r.error?.code ?? `exitcode ${r.status}`})`, 5)
  // Terug lezen: pas als hij er echt staat is het gelukt.
  if (leesKey(service, account) !== key) throw new Fout('key niet terug te lezen uit de sleutelhanger; controleer Sleutelhangertoegang', 5)
  return { ok: true, staart: key.slice(-4) }
}

function wisKey(or = false) {
  const r = security(['delete-generic-password', '-s', or ? OR_SERVICE : SERVICE, '-a', or ? OR_ACCOUNT : ACCOUNT])
  if (r.error) throw new Fout(`sleutelhanger niet bijgewerkt (${r.error.code ?? r.error.message})`, 5)
  if (r.status === NIET_GEVONDEN) return { gewist: false }
  if (r.status !== 0) throw new Fout(`key niet gewist (exitcode ${r.status})`, 5)
  return { gewist: true }
}

// Leest settings.json: undefined als hij niet bestaat; Fout(2) als hij onleesbaar of geen object is.
function lees(doel) {
  let tekst, stat
  try {
    stat = fs.statSync(doel)
    tekst = fs.readFileSync(doel, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return undefined
    throw new Fout(`${BESTAND} niet gelezen (${err.code ?? err.message}); niets gewijzigd`, 2)
  }
  let data
  try {
    data = JSON.parse(tekst)
  } catch (err) {
    throw new Fout(`${BESTAND} is geen geldige JSON (${err.message}); niets gewijzigd`, 2)
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Fout(`${BESTAND} heeft geen object bovenaan; niets gewijzigd`, 2)
  return { tekst, data, stat }
}

// Een symlink blijft een symlink: het echte bestand. Bestaat het niet, dan het pad zelf.
function doelPad() {
  try {
    return fs.realpathSync(BESTAND)
  } catch (err) {
    if (err.code === 'ENOENT') return BESTAND
    throw new Fout(`${BESTAND} niet gelezen (${err.code ?? err.message}); niets gewijzigd`, 2)
  }
}

// Zelfde opmaak als het origineel: inspringing van de tweede regel, eind-newline alleen als die er was.
function opmaak(tekst, data) {
  const m = /^\{\r?\n([ \t]+)/.exec(tekst)
  const inspring = m ? m[1] : tekst.includes('\n') ? 2 : 0
  return JSON.stringify(data, null, inspring) + (/\n$/.test(tekst) ? '\n' : '')
}

const zelfde = (a, b) => a.mtimeMs === b.mtimeMs && a.size === b.size && a.ino === b.ino

// ---- marker en cache van OpenRouter ----

function leesJson(pad) {
  try {
    return JSON.parse(fs.readFileSync(pad, 'utf8'))
  } catch {
    return undefined
  }
}

// Atomisch schrijven (tmp + rename), alleen voor de eigen bestanden van futureflow.
function schrijfJson(pad, data) {
  fs.mkdirSync(path.dirname(pad), { recursive: true, mode: 0o700 })
  const tmp = `${pad}.${process.pid}-${Date.now()}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    fs.renameSync(tmp, pad)
  } catch (err) {
    fs.rmSync(tmp, { force: true })
    throw new Fout(`${pad} niet geschreven (${err.code ?? err.message}); niets gewijzigd`, 2)
  }
}

const leesMarker = () => leesJson(MARKER)

function zetMarker(marker) {
  if (marker) schrijfJson(MARKER, marker)
  else fs.rmSync(MARKER, { force: true })
}

// ---- claude-or: eigen settings-bestand en shim ----

const gelijk = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// De shim: alleen schrijven als hij er niet is of van futureflow is (merkregel); anders exit 3.
function zetShim() {
  let oud
  try {
    oud = fs.readFileSync(SHIM, 'utf8')
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Fout(`${SHIM} niet gelezen (${err.code ?? err.message})`, 2)
  }
  if (oud !== undefined && !oud.split('\n').includes(SHIM_MERK)) {
    throw new Fout(`${SHIM} bestaat al en is niet van futureflow; futureflow laat die staan`, 3)
  }
  const tekst = shimTekst(OR_SETTINGS)
  if (oud === tekst) return false
  fs.mkdirSync(SHIM_DIR, { recursive: true })
  const tmp = `${SHIM}.${process.pid}-${Date.now()}.tmp`
  try {
    fs.writeFileSync(tmp, tekst, { mode: 0o755, flag: 'wx' })
    fs.chmodSync(tmp, 0o755)
    fs.renameSync(tmp, SHIM)
  } catch (err) {
    fs.rmSync(tmp, { force: true })
    throw new Fout(`${SHIM} niet geschreven (${err.code ?? err.message})`, 2)
  }
  return true
}

const opPad = () => (process.env.PATH ?? '').split(path.delimiter).some(d => d && path.resolve(d) === path.resolve(SHIM_DIR))

// Zet OpenRouter klaar voor `claude-or`. Raakt ~/.claude/settings.json nooit aan.
function zetOpenrouter(opties) {
  // --m1 … --m5; oude flags als alias: --model en --opus → 1, --sonnet → 2, --fable → 3, --snel → 4.
  const k = {
    m1: opties.m1 ?? opties.opus ?? opties.model,
    m2: opties.m2 ?? opties.sonnet,
    m3: opties.m3 ?? opties.fable,
    m4: opties.m4 ?? opties.snel,
    m5: opties.m5,
  }
  if (!geldigModel(k.m1)) throw new Fout('kies minstens model 1 (--m1 <id>)', 1)
  for (const s of SLOTS) if (k[s] !== undefined && !geldigModel(k[s])) throw new Fout(`ongeldig model voor --${s}`, 1)
  if (leesKey(OR_SERVICE, OR_ACCOUNT) === undefined) throw new Fout('geen OpenRouter-key in de sleutelhanger; bewaar eerst een key', 4)
  const gewenst = orInstellingen(k)
  let gewijzigd = false
  if (!gelijk(leesJson(OR_SETTINGS), gewenst)) {
    schrijfJson(OR_SETTINGS, gewenst)
    gewijzigd = true
  }
  if (zetShim()) gewijzigd = true
  return { modus: 'openrouter', gewijzigd, settings: OR_SETTINGS, shim: SHIM, start: START, opPad: opPad() }
}

// Wat er voor claude-or klaarstaat: modellen uit het eigen bestand, en of de shim van ons is.
function orKlaar() {
  const d = leesJson(OR_SETTINGS)
  const env = isObject(d?.env) ? d.env : {}
  const uit = {}
  const m1 = env.ANTHROPIC_MODEL ?? env.ANTHROPIC_DEFAULT_OPUS_MODEL
  if (d?.apiKeyHelper === orInstellingen({ m1: 'a/b' }).apiKeyHelper && env.ANTHROPIC_BASE_URL === OR_URL && geldigModel(m1)) {
    uit.orKlaar = true
    // Wat claude-or nu per model gebruikt (2-4 al met terugval op 1; 5 alleen als gezet).
    uit.orM1 = m1
    for (const [slot, sleutel] of [['orM2', 'ANTHROPIC_DEFAULT_SONNET_MODEL'], ['orM3', 'ANTHROPIC_DEFAULT_FABLE_MODEL'], ['orM4', 'ANTHROPIC_DEFAULT_HAIKU_MODEL'], ['orM5', 'ANTHROPIC_CUSTOM_MODEL_OPTION']]) {
      if (geldigModel(env[sleutel])) uit[slot] = env[sleutel]
    }
    // Oude namen (kaart Automatisch wisselen, tests): hoofd = 1, snel = 4.
    uit.orModel = m1
    uit.orSnel = uit.orM4 ?? m1
  } else {
    uit.orKlaar = false
  }
  try {
    uit.orShim = fs.readFileSync(SHIM, 'utf8').split('\n').includes(SHIM_MERK)
  } catch {
    uit.orShim = false
  }
  uit.orOpPad = opPad()
  return uit
}

// Sporen van OpenRouter in ~/.claude/settings.json (futureflow < 0.9): onze helper, de base-URL van
// OpenRouter of een marker.
function heeftOudeOr(data, marker) {
  const env = isObject(data?.env) ? data.env : {}
  return modusVan(data, eigenBasis(marker)).modus === 'openrouter' || env.ANTHROPIC_BASE_URL === OR_URL || marker !== undefined
}

// Haalt oude OpenRouter-regels uit settings.json (exact de waarden van futureflow, volgens de marker;
// zonder marker de vaste waarden) en daarna de marker. Een eigen apiKeyHelper (API) blijft.
function ruimOp() {
  const doel = doelPad()
  for (let poging = 1; poging <= POGINGEN; poging++) {
    const gelezen = lees(doel)
    const marker = leesMarker()
    if (!gelezen) {
      if (marker !== undefined) zetMarker(undefined)
      return { gewijzigd: false }
    }
    if (!heeftOudeOr(gelezen.data, marker)) return { gewijzigd: false }
    const nieuw = haalWeg(gelezen.data, marker)
    if (gelijk(nieuw, gelezen.data)) {
      zetMarker(undefined)
      return { gewijzigd: false }
    }
    if (!schrijfSettings(doel, gelezen, nieuw)) continue
    zetMarker(undefined)
    return { gewijzigd: true }
  }
  throw new Fout(`${BESTAND} veranderde steeds tijdens het schrijven; niets gewijzigd, probeer het opnieuw`, 2)
}

// Schrijft settings.json atomisch. false = het bestand veranderde of ontstond intussen: opnieuw lezen.
function schrijfSettings(doel, gelezen, data) {
  const tmp = path.join(path.dirname(doel), `.${path.basename(doel)}.futureflow-${process.pid}-${Date.now()}.tmp`)
  if (!gelezen) {
    fs.mkdirSync(path.dirname(doel), { recursive: true })
    try {
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
      // link faalt als het bestand intussen wel bestaat; dan opnieuw lezen.
      fs.linkSync(tmp, doel)
      fs.rmSync(tmp, { force: true })
      return true
    } catch (err) {
      fs.rmSync(tmp, { force: true })
      if (err.code === 'EEXIST') return false
      throw new Fout(`${BESTAND} niet geschreven (${err.code ?? err.message}); niets gewijzigd`, 2)
    }
  }
  const { tekst, stat } = gelezen
  const mode = stat.mode & 0o777
  try {
    fs.writeFileSync(tmp, opmaak(tekst, data), { mode, flag: 'wx' })
    fs.chmodSync(tmp, mode)
    // Tussendoor door Claude Code geschreven? Dan niet overschrijven maar opnieuw lezen.
    let nu
    try { nu = fs.statSync(doel) } catch { nu = undefined }
    if (!nu || !zelfde(nu, stat)) {
      fs.rmSync(tmp, { force: true })
      if (!nu) throw new Fout(`${BESTAND} verdween tijdens het schrijven; niets gewijzigd`, 2)
      return false
    }
    fs.renameSync(tmp, doel)
    return true
  } catch (err) {
    fs.rmSync(tmp, { force: true })
    if (err instanceof Fout) throw err
    throw new Fout(`${BESTAND} niet geschreven (${err.code ?? err.message}); niets gewijzigd`, 2)
  }
}

const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v)

function vlagen(rest) {
  const uit = {}
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === '--ververs') uit.ververs = true
    else if (['--model', '--snel', '--opus', '--sonnet', '--fable', '--m1', '--m2', '--m3', '--m4', '--m5'].includes(a) && i + 1 < rest.length) uit[a.slice(2)] = rest[++i]
    else throw new Fout(`onbekend argument ${a.slice(0, 40)}`, 1)
  }
  return uit
}

function zetModus(naar, opties = {}) {
  if (!MODI.includes(naar)) throw new Fout('kies: modus api|abonnement|openrouter', 1)
  if (naar === 'openrouter') return zetOpenrouter(opties)
  const doel = doelPad()
  for (let poging = 1; poging <= POGINGEN; poging++) {
    const gelezen = lees(doel)
    const data = gelezen?.data ?? {}
    const oudeMarker = leesMarker()
    const huidig = modusVan(data, eigenBasis(oudeMarker))
    if (huidig.vreemdeHelper) {
      throw new Fout(`in ${BESTAND} staat al een andere apiKeyHelper; futureflow laat die staan en wisselt niet`, 3)
    }
    if (huidig.vreemdeBasis && naar !== 'abonnement') {
      throw new Fout(`in ${BESTAND} staat al een andere ANTHROPIC_BASE_URL; futureflow laat die staan en wisselt niet`, 3)
    }
    if (huidig.modus === naar && !heeftOudeOr(data, oudeMarker)) return { modus: naar, gewijzigd: false }
    // Alleen met een key, anders kan een nieuwe terminal-sessie niet inloggen.
    if (naar === 'api' && leesKey() === undefined) throw new Fout('geen key in de sleutelhanger; bewaar eerst een key', 4)

    // Eerst alles van ons weg (oude OpenRouter-regels volgens de marker, onze API-helper), dan het nieuwe erbij.
    const nieuw = haalWeg(data, oudeMarker)
    if (nieuw.apiKeyHelper === HELPER) delete nieuw.apiKeyHelper
    if (naar === 'api') nieuw.apiKeyHelper = HELPER
    if (!schrijfSettings(doel, gelezen, nieuw)) continue
    if (oudeMarker !== undefined) zetMarker(undefined)
    return { modus: naar, gewijzigd: true }
  }
  throw new Fout(`${BESTAND} veranderde steeds tijdens het schrijven; niets gewijzigd, probeer het opnieuw`, 2)
}

// ---- modellijst en verbindingstest van OpenRouter ----

async function modellen(opties) {
  const cache = leesJson(CACHE)
  const geldigeCache = isObject(cache) && Array.isArray(cache.modellen) && typeof cache.opgehaald === 'number'
  const nu = Date.now()
  if (geldigeCache && !opties.ververs && nu - cache.opgehaald < CACHE_MS && nu >= cache.opgehaald) {
    return { modellen: cache.modellen, opgehaald: cache.opgehaald, uitCache: true }
  }
  let fout
  try {
    const r = await fetch(`${OR_BASIS}/v1/models?supported_parameters=tools`, { signal: AbortSignal.timeout(20_000), headers: { accept: 'application/json' } })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const lijst = modellenVan(await r.json())
    if (!lijst.length) throw new Error('lege lijst')
    schrijfJson(CACHE, { opgehaald: nu, modellen: lijst })
    return { modellen: lijst, opgehaald: nu, uitCache: false }
  } catch (err) {
    fout = `lijst niet opgehaald (${String(err?.message ?? err).slice(0, 120)})`
  }
  if (geldigeCache) return { modellen: cache.modellen, opgehaald: cache.opgehaald, uitCache: true, fout }
  throw new Fout(fout, 6)
}

// Eén kleine aanvraag met de key uit de sleutelhanger; alleen ok of een foutmelding terug, nooit de key.
async function test(opties) {
  if (!geldigModel(opties.model)) throw new Fout('kies een model (--model <id>)', 1)
  const key = leesKey(OR_SERVICE, OR_ACCOUNT)
  if (key === undefined) throw new Fout('geen OpenRouter-key in de sleutelhanger; bewaar eerst een key', 4)
  const schoon = t => String(t ?? '').split(key).join('…').slice(0, 200)
  try {
    const r = await fetch(`${OR_BASIS}/v1/messages`, {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: opties.model.replace(/\[1m\]$/, ''), max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
    })
    if (r.ok) return { ok: true, status: r.status }
    let bericht = ''
    try {
      const d = await r.json()
      bericht = d?.error?.message ?? d?.message ?? ''
    } catch {
      bericht = ''
    }
    return { ok: false, status: r.status, fout: schoon(bericht) || `HTTP ${r.status}` }
  } catch (err) {
    return { ok: false, fout: `geen verbinding (${schoon(err?.cause?.code ?? err?.message ?? err)})` }
  }
}

const takenlijstAan = data => !!data?.env && typeof data.env === 'object' && data.env[TODO_VAR] === 'true'

// Zet of haalt alleen env.CLAUDE_CODE_ENABLE_TODO_TOOLS weg; alle andere sleutels en env-regels blijven.
function zetTakenlijst(naar) {
  const doel = doelPad()
  for (let poging = 1; poging <= POGINGEN; poging++) {
    const gelezen = lees(doel)
    if (takenlijstAan(gelezen?.data) === naar) return { aan: naar, gewijzigd: false }
    if (!gelezen) {
      // Geen settings.json (alleen bij aan): aanmaken, nooit over een intussen ontstaan bestand heen.
      const tekst = JSON.stringify({ env: { [TODO_VAR]: 'true' } }, null, 2) + '\n'
      fs.mkdirSync(path.dirname(doel), { recursive: true })
      const tmp = path.join(path.dirname(doel), `.${path.basename(doel)}.futureflow-${process.pid}-${Date.now()}.tmp`)
      try {
        fs.writeFileSync(tmp, tekst, { mode: 0o600, flag: 'wx' })
        fs.linkSync(tmp, doel)
        fs.rmSync(tmp, { force: true })
        return { aan: true, gewijzigd: true }
      } catch (err) {
        fs.rmSync(tmp, { force: true })
        if (err.code === 'EEXIST') continue
        throw new Fout(`${BESTAND} niet geschreven (${err.code ?? err.message}); niets gewijzigd`, 2)
      }
    }
    const { tekst, data, stat } = gelezen
    if (naar) {
      if (!data.env || typeof data.env !== 'object' || Array.isArray(data.env)) {
        if (data.env !== undefined) throw new Fout(`env in ${BESTAND} is geen object; niets gewijzigd`, 2)
        data.env = {}
      }
      data.env[TODO_VAR] = 'true'
    } else {
      delete data.env[TODO_VAR]
      if (Object.keys(data.env).length === 0) delete data.env
    }
    const mode = stat.mode & 0o777
    const tmp = path.join(path.dirname(doel), `.${path.basename(doel)}.futureflow-${process.pid}-${Date.now()}.tmp`)
    try {
      fs.writeFileSync(tmp, opmaak(tekst, data), { mode, flag: 'wx' })
      fs.chmodSync(tmp, mode)
      let nu
      try { nu = fs.statSync(doel) } catch { nu = undefined }
      if (!nu || !zelfde(nu, stat)) {
        fs.rmSync(tmp, { force: true })
        if (!nu) throw new Fout(`${BESTAND} verdween tijdens het schrijven; niets gewijzigd`, 2)
        continue
      }
      fs.renameSync(tmp, doel)
    } catch (err) {
      fs.rmSync(tmp, { force: true })
      if (err instanceof Fout) throw err
      throw new Fout(`${BESTAND} niet geschreven (${err.code ?? err.message}); niets gewijzigd`, 2)
    }
    return { aan: naar, gewijzigd: true }
  }
  throw new Fout(`${BESTAND} veranderde steeds tijdens het schrijven; niets gewijzigd, probeer het opnieuw`, 2)
}

function takenlijst(actie) {
  if (actie === 'status') return { aan: takenlijstAan(lees(doelPad())?.data) }
  if (actie !== 'aan' && actie !== 'uit') throw new Fout('kies: takenlijst aan|uit|status', 1)
  return zetTakenlijst(actie === 'aan')
}

// Status zonder te falen op één onderdeel: een fout komt in `fout`.
function status() {
  const uit = { heeftKey: false, staart: '', modus: 'abonnement', vreemdeHelper: false, vreemdeBasis: false, orHeeftKey: false, orStaart: '' }
  const fouten = []
  try {
    const key = leesKey()
    if (key) {
      uit.heeftKey = true
      uit.staart = key.slice(-4)
    }
  } catch (err) {
    fouten.push(err.message)
  }
  try {
    const key = leesKey(OR_SERVICE, OR_ACCOUNT)
    if (key) {
      uit.orHeeftKey = true
      uit.orStaart = key.slice(-4)
    }
  } catch (err) {
    fouten.push(err.message)
  }
  try {
    const data = lees(doelPad())?.data
    const marker = leesMarker()
    Object.assign(uit, modusVan(data, eigenBasis(marker)))
    // OpenRouter is geen modus van settings.json meer; oude regels zijn op te ruimen.
    uit.oudeOr = heeftOudeOr(data, marker)
    if (uit.modus === 'openrouter') uit.modus = 'abonnement'
  } catch (err) {
    fouten.push(err.message)
  }
  Object.assign(uit, orKlaar())
  return fouten.length ? { ...uit, fout: fouten.join('; ') } : uit
}

export async function main(args) {
  const [cmd, ...rest] = args
  const [sub, ...vlag] = rest
  try {
    if (cmd === 'zet-key' && rest.length === 0) console.log(JSON.stringify(zetKey()))
    else if (cmd === 'wis-key' && rest.length === 0) console.log(JSON.stringify(wisKey()))
    else if (cmd === 'status' && rest.length === 0) console.log(JSON.stringify(status()))
    else if (cmd === 'modus' && rest.length >= 1) console.log(JSON.stringify(zetModus(sub, vlagen(vlag))))
    else if (cmd === 'takenlijst' && rest.length === 1) console.log(JSON.stringify(takenlijst(rest[0])))
    else if (cmd === 'openrouter' && sub === 'zet-key' && vlag.length === 0) console.log(JSON.stringify(zetKey(true)))
    else if (cmd === 'openrouter' && sub === 'wis-key' && vlag.length === 0) console.log(JSON.stringify(wisKey(true)))
    else if (cmd === 'openrouter' && sub === 'modellen') console.log(JSON.stringify(await modellen(vlagen(vlag))))
    else if (cmd === 'openrouter' && sub === 'test') console.log(JSON.stringify(await test(vlagen(vlag))))
    else if (cmd === 'openrouter' && sub === 'opruimen' && vlag.length === 0) console.log(JSON.stringify(ruimOp()))
    else {
      console.error(
        'Gebruik: api zet-key (key via stdin) | api wis-key | api status | api modus api|abonnement | api modus openrouter --m1 <id> [--m2|--m3|--m4|--m5 <id>]' +
          ' | api takenlijst aan|uit|status | api openrouter zet-key|wis-key|opruimen | api openrouter modellen [--ververs] | api openrouter test --model <id>',
      )
      return 1
    }
    return 0
  } catch (err) {
    if (err instanceof Fout) {
      console.error(`[api] ${err.message}`)
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
      console.error(`[api] ${err?.message ?? err}`)
      process.exitCode = 1
    },
  )
}
