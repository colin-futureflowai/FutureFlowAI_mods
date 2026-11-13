#!/usr/bin/env node
// or-proxy — lokale proxy tussen claude-or en OpenRouter (futureflow 0.16.0, 0.17.0). Alleen Node-builtins.
//
// Luistert alleen op 127.0.0.1:<OR_PROXY_POORT, standaard 20817>. Elke aanvraag gaat ongewijzigd door
// naar <OPENROUTER_URL, standaard https://openrouter.ai/api> + pad en query; het antwoord komt ongewijzigd
// terug. Onderweg leest de proxy het verbruik mee en schrijft per aanvraag één regel metadata in
// <OPENROUTER_DIR>/log.jsonl (geen headers, geen prompts, geen antwoorden; de key nooit).
//
//   GET  /_ff/stand   { versie, sinds, poort, sessies } (ook de levenscheck van de shim)
//   GET  /_ff/log     logregels als JSON-array (?na=<ms>&max=<n>)
//   POST /_ff/stop    stoppen zodra lopende aanvragen klaar zijn (niet met een Origin-header)
//   GET  /            de pagina (logboek.html naast dit script): tabs Modellen en Logboek
//   GET  /_ff/instellingen   Model 1-5, uitleg, metingen, startcheck, key ja/nee, aanbieders, gestopt
//   GET  /_ff/modellen       modellenlijst van de CLI met teKlein, zwak, kiesId en meting (?ververs=1)
//   GET  /_ff/meet, POST /_ff/meet {model}   cache-metingen, één tegelijk
//   POST /_ff/kies {rij, model|null, meet?}  Model N kiezen of leegmaken via `modus openrouter`
// POST-paden (behalve /_ff/stop) eisen x-ff: 1, content-type application/json en geen vreemde Origin.
//
// De eigen paden antwoorden alleen met Host 127.0.0.1:<poort> of localhost:<poort>.
//
// 0.17.0, alleen voor POST /v1/messages met een JSON-body:
// - modelwissel: een id dat niet meer gekozen is maar eerder in rij N stond (<OPENROUTER_DIR>/rijen.json, door
//   de CLI geschreven) wordt het huidige model van rij N;
// - een model dat <OPENROUTER_DIR>/cache.json `zwak` noemt, wordt geweigerd (geen aanvraag naar OpenRouter);
// - vaste aanbieder per sessie en model (`provider.order`), één nieuwe poging zonder hem bij 429/404/5xx;
// - twee missers op rij in één baan: aanbieder 24 u slecht en wisselen; daarna nog twee: het model `zwak` in
//   cache.json en de CLI (`openrouter poort`) werkt de startcheck bij. Stand per aanbieder in aanbieders.json.
// De proxy schrijft nooit settings.json, de shim of de sleutelhanger; dat doet alleen de CLI (pad in
// <OPENROUTER_DIR>/proxy/cli.json).
// Stopt vanzelf na OR_PROXY_STIL_MS (standaard 30 min) zonder aanvraag. Exitcodes: 0 gestopt,
// 1 interne fout, 2 poort bezet.
//
// Wordt los gekopieerd naar ~/.claude/futureflow/openrouter/proxy/bridge/, met lib/proxy.mjs ernaast in
// ../lib/ (zelfde ligging als in de plugin).

import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { fileURLToPath } from 'node:url'

import { spawn } from 'node:child_process'

import {
  aanvraagInfo, besluit, doorHeaders, foutAntwoord, gebruikUitJson, geldigeHost, isEigenPad, isZwak, kiesAanbieder, LOG_MAX_BYTES,
  geldigeSchrijf, logRegel, maakSseLezer, metAanbieder, probeerOpnieuw, PROXY_POORT, PROXY_STIL_MS, PROXY_VERSIE, slechte, stopBericht,
  TELT_VENSTER_MS, werkAanbiederBij, werkStandBij, wisselModel, zwakMeting,
} from '../lib/proxy.mjs'

// Geen inhoud van aanvragen op stderr: alleen de naam of code van de fout.
process.on('uncaughtException', err => {
  process.stderr.write(`or-proxy: interne fout (${err?.code ?? err?.name ?? 'onbekend'})\n`)
  process.exit(1)
})

const getal = (v, standaard) => {
  const n = Number(v)
  return v !== undefined && v !== '' && Number.isFinite(n) && n > 0 ? n : standaard
}

const POORT = getal(process.env.OR_PROXY_POORT, PROXY_POORT)
const BASIS = new URL((process.env.OPENROUTER_URL || 'https://openrouter.ai/api').replace(/\/+$/, ''))
const BASIS_PAD = BASIS.pathname.replace(/\/+$/, '')
const DIR = process.env.OPENROUTER_DIR || path.join(os.homedir(), '.claude', 'futureflow', 'openrouter')
const STIL_MS = getal(process.env.OR_PROXY_STIL_MS, PROXY_STIL_MS)
const LOG = path.join(DIR, 'log.jsonl')
const LOG_OUD = path.join(DIR, 'log.1.jsonl')
const LOGBOEK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'logboek.html')
const VENSTER_MS = getal(process.env.OR_PROXY_VENSTER_MS, TELT_VENSTER_MS)
const AANBIEDERS = path.join(DIR, 'aanbieders.json')
const RIJEN = path.join(DIR, 'rijen.json')
const CACHE = path.join(DIR, 'cache.json')
const CLI_JSON = path.join(DIR, 'proxy', 'cli.json')
// Status waarmee een gestopt model geweigerd wordt (gemeten tegen Claude Code, zie CLAUDE.md).
const WEIGER_STATUS = 400
// aanbieders.json hoogstens zo vaak schrijven.
const AANBIEDERS_MS = 2000
// Meelezen van een JSON-antwoord: hoogstens zoveel bytes bufferen (groter = geen usage).
const JSON_MAX = 5 * 1024 * 1024
// Laatste 2xx-regel per sessie|model|baan, voor de telling; de oudste valt weg.
const VORIGE_MAX = 2000
const LOG_STANDAARD = 500
const LOG_GRENS = 2000

const sinds = Date.now()
const stand = {}
const vorige = new Map()
// Vaste aanbieder per `sessie|model`, missertelling per `sessie|model|baan`, gestopte modellen in deze run.
const vast = new Map()
const banen = new Map()
const gestopt = new Set()
let aanbieders = leesJson(AANBIEDERS) ?? {}
let aanbiedersTimer
let aanbiedersLaatst = 0
let lopend = 0
let stoppen = false
let stilTimer

const server = http.createServer(behandel)
// Lange stromen: geen time-out van de server op aanvragen.
server.requestTimeout = 0
server.headersTimeout = 60_000

function stop() {
  clearTimeout(stilTimer)
  if (aanbiedersTimer) {
    clearTimeout(aanbiedersTimer)
    schrijfAanbieders()
  }
  server.close()
  server.closeAllConnections?.()
  process.exit(0)
}

function planStil() {
  clearTimeout(stilTimer)
  stilTimer = setTimeout(() => {
    // Ook niet midden in een meting of keuze van de pagina.
    if (lopend === 0 && meetBezig === null && meetRij.length === 0 && !kiesBezig) stop()
    else planStil()
  }, STIL_MS)
}

function stuurJson(res, status, data, extra = {}) {
  const tekst = JSON.stringify(data)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(tekst), ...extra })
  res.end(tekst)
}

function schrijfLog(regel) {
  try {
    fs.mkdirSync(DIR, { recursive: true, mode: 0o700 })
    try {
      if (fs.statSync(LOG).size >= LOG_MAX_BYTES) fs.renameSync(LOG, LOG_OUD)
    } catch {
      // Nog geen log: niets te roteren.
    }
    fs.appendFileSync(LOG, JSON.stringify(regel) + '\n', { mode: 0o600 })
  } catch (err) {
    process.stderr.write(`or-proxy: log niet geschreven (${err?.code ?? err?.name})\n`)
  }
}

// ---- kleine JSON-bestanden ----

function leesJson(pad) {
  try {
    const d = JSON.parse(fs.readFileSync(pad, 'utf8'))
    return d && typeof d === 'object' && !Array.isArray(d) ? d : undefined
  } catch {
    return undefined
  }
}

// Atomisch (tmp + rename); een fout komt alleen als code op stderr.
function schrijfJson(pad, data) {
  const tmp = `${pad}.${process.pid}-${Date.now()}.tmp`
  try {
    fs.mkdirSync(path.dirname(pad), { recursive: true, mode: 0o700 })
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    fs.renameSync(tmp, pad)
    return true
  } catch (err) {
    fs.rmSync(tmp, { force: true })
    process.stderr.write(`or-proxy: ${path.basename(pad)} niet geschreven (${err?.code ?? err?.name})\n`)
    return false
  }
}

function schrijfAanbieders() {
  aanbiedersTimer = undefined
  aanbiedersLaatst = Date.now()
  schrijfJson(AANBIEDERS, aanbieders)
}

// Hoogstens eens per AANBIEDERS_MS; bij stoppen meteen.
function bewaarAanbieders() {
  if (aanbiedersTimer) return
  aanbiedersTimer = setTimeout(schrijfAanbieders, Math.max(0, aanbiedersLaatst + AANBIEDERS_MS - Date.now()))
}

// Leest een bestand opnieuw als de mtime veranderde.
function volger(pad) {
  let mtime
  let data
  return () => {
    let m
    try {
      m = fs.statSync(pad).mtimeMs
    } catch {
      m = undefined
    }
    if (m !== mtime) {
      mtime = m
      data = m === undefined ? undefined : leesJson(pad)
    }
    return data
  }
}
const rijen = volger(RIJEN)
const cacheVolger = volger(CACHE)
const zonder1m = x => String(x ?? '').replace(/\[1m\]$/, '')

// cache.json; een model dat niet meer zwak is, verliest zijn missertelling (een nieuwe meting heft de stop op).
function cache() {
  const c = cacheVolger()
  for (const m of gestopt) {
    if (isZwak(c, m)) continue
    gestopt.delete(m)
    for (const k of banen.keys()) if (k.split('|')[1] === m) banen.delete(k)
  }
  return c
}

// Zet `zwak` voor één model in cache.json; de rest blijft.
function schrijfZwak(model, aandeel) {
  const c = leesJson(CACHE) ?? {}
  c[zonder1m(model)] = zwakMeting(aandeel, Date.now())
  schrijfJson(CACHE, c)
}

// ---- de CLI (alleen via proxy/cli.json; argv zonder key, uitvoer JSON) ----

function cliPad() {
  const d = leesJson(CLI_JSON)
  if (typeof d?.cli !== 'string' || !path.isAbsolute(d.cli)) return undefined
  try {
    return fs.statSync(d.cli).isFile() ? d.cli : undefined
  } catch {
    return undefined
  }
}

// Draait de CLI als kind: { code, uit (laatste JSON-regel of undefined), fout (laatste stderr-regel) }.
function cli(args, invoer = '', ms = 60_000) {
  const pad = cliPad()
  if (!pad) return Promise.resolve({ code: -1, fout: 'geen-cli' })
  return new Promise(resolve => {
    let stdout = ''
    let stderr = ''
    let p
    try {
      p = spawn(process.execPath, [pad, ...args], { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      return resolve({ code: -1, fout: err?.code ?? 'start mislukt' })
    }
    const timer = setTimeout(() => p.kill('SIGKILL'), ms)
    p.stdout.on('data', c => { stdout += c })
    p.stderr.on('data', c => { stderr += c })
    p.on('error', err => {
      clearTimeout(timer)
      resolve({ code: -1, fout: err?.code ?? 'start mislukt' })
    })
    p.on('close', code => {
      clearTimeout(timer)
      let uit
      try {
        uit = JSON.parse(stdout.trim().split('\n').pop())
      } catch {
        uit = undefined
      }
      const fout = stderr.trim().split('\n').pop()?.replace(/^\[api\] /, '').slice(0, 300) || undefined
      resolve({ code: code ?? -1, uit, fout: code === null ? 'time-out' : fout })
    })
    p.stdin.on('error', () => {})
    p.stdin.end(invoer)
  })
}

// Stop: de startcheck bijwerken; zonder CLI een logregel `geen-cli`.
function poortLos(sessie, model) {
  if (!cliPad()) {
    schrijfLog(logRegel({ t: Date.now(), sessie, pad: '/_ff/cli', info: { model, stream: false }, status: 0, gebruik: nul(), ms: 0, fout: 'geen-cli' }))
    return
  }
  cli(['openrouter', 'poort'], '{}').then(r => {
    if (r.code !== 0) process.stderr.write(`or-proxy: openrouter poort faalde (${r.code})\n`)
  })
}

// ---- eigen paden ----

function leesRegels(pad) {
  let tekst
  try {
    tekst = fs.readFileSync(pad, 'utf8')
  } catch {
    return []
  }
  const uit = []
  for (const l of tekst.split('\n')) {
    if (!l) continue
    try {
      const r = JSON.parse(l)
      if (r && typeof r === 'object' && typeof r.t === 'number') uit.push(r)
    } catch {
      // Kapotte regel: overslaan.
    }
  }
  return uit
}

function logPad(url) {
  const na = Number(url.searchParams.get('na'))
  const maxRuw = Number(url.searchParams.get('max'))
  const max = Number.isFinite(maxRuw) && maxRuw >= 1 ? Math.min(Math.floor(maxRuw), LOG_GRENS) : LOG_STANDAARD
  let regels = leesRegels(LOG)
  if (regels.length < max) regels = [...leesRegels(LOG_OUD), ...regels]
  if (Number.isFinite(na)) regels = regels.filter(r => r.t > na)
  return regels.slice(-max)
}

// ---- instellingen (0.17.0): alles via de CLI; de pagina schrijft nooit zelf ----

// lib/openrouter.mjs naast lib/proxy.mjs (de CLI kopieert hem); ontbreekt hij, dan geen modellenpaden.
let orLib
async function or() {
  orLib ??= import('../lib/openrouter.mjs').catch(() => null)
  return orLib
}

const SLOTS = ['m1', 'm2', 'm3', 'm4', 'm5']
const METEN_MS = 240_000

// Model 1-5 uit `status` (orM1-orM5); 2-4 gelijk aan Model 1 = leeg (die gebruiken dan Model 1).
function rijenUitStatus(st) {
  const uit = {}
  if (typeof st?.orM1 !== 'string') return uit
  uit.m1 = st.orM1
  for (const s of ['m2', 'm3', 'm4']) {
    const v = st[`or${s.toUpperCase()}`]
    if (typeof v === 'string' && v !== st.orM1) uit[s] = v
  }
  if (typeof st.orM5 === 'string') uit.m5 = st.orM5
  return uit
}

async function instellingen() {
  const lib = await or()
  const heeftCli = !!cliPad()
  const [st, pt] = heeftCli ? await Promise.all([cli(['status']), cli(['openrouter', 'poort'], '{}')]) : [{}, {}]
  const poort = pt.uit && typeof pt.uit === 'object' ? { ok: typeof pt.uit.ok === 'boolean' ? pt.uit.ok : null, redenen: Array.isArray(pt.uit.redenen) ? pt.uit.redenen : [] } : { ok: null, redenen: [] }
  return {
    rijen: rijenUitStatus(st.uit),
    uitleg: lib?.SLOT_UITLEG ?? {},
    metingen: lib ? lib.cacheMetingen(cache()) : {},
    poort,
    // Alleen of er een key is; nooit de staart of de key zelf.
    heeftKey: st.uit?.orHeeftKey === true,
    cli: heeftCli,
    aanbieders,
    gestopt: gestoptNu(),
  }
}

async function modellenPad(url) {
  const lib = await or()
  if (!lib || !cliPad()) return [503, { ok: false, fout: 'geen-cli' }]
  const r = await cli(['openrouter', 'modellen', ...(url.searchParams.get('ververs') === '1' ? ['--ververs'] : [])])
  if (r.code !== 0 || !Array.isArray(r.uit?.modellen)) return [502, { ok: false, fout: r.fout ?? 'lijst niet opgehaald' }]
  const metingen = lib.cacheMetingen(cache())
  const modellen = lib.modellenVan(r.uit.modellen).map(m => {
    const stand = lib.cacheStand(m, metingen)
    const meting = metingen[m.id] ?? null
    return { ...m, teKlein: lib.teKlein(m), zwak: stand?.oordeel === 'zwak', kiesId: lib.modelIdVoor(m), meting }
  })
  return [200, { modellen, opgehaald: r.uit.opgehaald, uitCache: r.uit.uitCache === true, ...(r.uit.fout ? { fout: String(r.uit.fout).slice(0, 200) } : {}) }]
}

// Metingen één voor één; wie wacht, krijgt de uitslag.
const meetRij = []
let meetBezig = null
let meetLaatste = null
const wachters = new Map()

function meet(model) {
  const id = zonder1m(model)
  const p = new Promise(resolve => (wachters.get(id) ?? wachters.set(id, []).get(id)).push(resolve))
  if (meetBezig !== id && !meetRij.includes(id)) meetRij.push(id)
  volgendeMeting()
  return p
}

async function volgendeMeting() {
  if (meetBezig !== null || meetRij.length === 0) return
  meetBezig = meetRij.shift()
  const id = meetBezig
  const r = await cli(['openrouter', 'cachetest', '--model', id], '', METEN_MS)
  const u = r.uit
  let uitslag
  if (r.code === 0 && u?.ok === true) uitslag = { model: id, ok: true, oordeel: u.oordeel, raak: u.raak, van: u.van }
  else uitslag = { model: id, ok: false, fout: String((r.code === 0 ? u?.fout : r.fout) ?? 'meting mislukt').slice(0, 200) }
  meetLaatste = uitslag
  meetBezig = null
  for (const w of wachters.get(id) ?? []) w(uitslag)
  wachters.delete(id)
  volgendeMeting()
}

let kiesBezig = false

async function kies(d) {
  const lib = await or()
  if (!lib || !cliPad()) return [503, { ok: false, fout: 'Open /futureflow één keer in een sessie; daarna kun je hier kiezen.' }]
  const rij = d?.rij
  if (!SLOTS.includes(rij)) return [400, { ok: false, fout: 'onbekende rij' }]
  const model = d.model
  if (model === null) {
    if (rij === 'm1') return [400, { ok: false, fout: 'Model 1 is verplicht' }]
  } else if (!lib.geldigModel(model)) return [400, { ok: false, fout: 'ongeldig model-id' }]
  if (kiesBezig) return [409, { ok: false, fout: 'er loopt al een keuze (bezig)' }]
  kiesBezig = true
  try {
    if (model !== null && d.meet === true && !lib.cacheMetingen(cache())[zonder1m(model)]) {
      const u = await meet(model)
      if (!u.ok) return [409, { ok: false, fout: `meting van ${u.model} mislukt: ${u.fout}; niets gekozen` }]
      if (u.oordeel === 'zwak') return [409, { ok: false, fout: `${u.model} cachet niet (${u.raak ?? 0} van ${u.van ?? 0} raak); niets gekozen` }]
    }
    const st = await cli(['status'])
    const nieuw = rijenUitStatus(st.uit)
    if (model === null) delete nieuw[rij]
    else nieuw[rij] = model
    if (!nieuw.m1) return [409, { ok: false, fout: 'kies eerst Model 1' }]
    const r = await cli(['modus', 'openrouter', ...SLOTS.flatMap(s => (nieuw[s] ? [`--${s}`, nieuw[s]] : []))])
    if (r.code === 0) return [200, { ok: true, rijen: nieuw }]
    return [r.code === 7 || r.code === 4 || r.code === 3 ? 409 : 500, { ok: false, fout: r.fout ?? `de CLI stopte met code ${r.code}` }]
  } finally {
    kiesBezig = false
  }
}

// Body van een POST naar /_ff/*: JSON, hoogstens 64 KB.
function leesBody(req) {
  return new Promise(resolve => {
    const delen = []
    let n = 0
    req.on('data', c => {
      n += c.length
      if (n <= 65_536) delen.push(c)
    })
    req.on('error', () => resolve(undefined))
    req.on('end', () => {
      if (n > 65_536) return resolve(undefined)
      try {
        resolve(JSON.parse(Buffer.concat(delen).toString('utf8')))
      } catch {
        resolve(undefined)
      }
    })
  })
}

async function schrijfPad(req, res, pad) {
  const ok = geldigeSchrijf({ host: req.headers.host, origin: req.headers.origin, xff: req.headers['x-ff'], contentType: req.headers['content-type'], poort: POORT })
  if (!ok) {
    req.resume()
    return stuurJson(res, 403, { ok: false, fout: 'verboden' })
  }
  const d = await leesBody(req)
  if (!d || typeof d !== 'object') return stuurJson(res, 400, { ok: false, fout: 'geen geldige JSON' })
  if (pad === '/_ff/meet') {
    const lib = await or()
    if (!lib || !cliPad()) return stuurJson(res, 503, { ok: false, fout: 'geen-cli' })
    if (!lib.geldigModel(d.model)) return stuurJson(res, 400, { ok: false, fout: 'ongeldig model-id' })
    meet(d.model)
    return stuurJson(res, 200, { ok: true })
  }
  const [status, data] = await kies(d)
  return stuurJson(res, status, data)
}

function eigen(req, res, url) {
  if (!geldigeHost(req.headers.host, POORT)) return stuurJson(res, 403, foutAntwoord('futureflow-proxy: verboden'))
  const pad = url.pathname
  const fout = () => { if (!res.headersSent) stuurJson(res, 500, { ok: false, fout: 'interne fout' }) }
  if (req.method === 'POST' && (pad === '/_ff/kies' || pad === '/_ff/meet')) return void schrijfPad(req, res, pad).catch(fout)
  if (req.method === 'GET' && pad === '/_ff/instellingen') return void instellingen().then(d => stuurJson(res, 200, d), fout)
  if (req.method === 'GET' && pad === '/_ff/modellen') return void modellenPad(url).then(([s, d]) => stuurJson(res, s, d), fout)
  if (req.method === 'GET' && pad === '/_ff/meet') return stuurJson(res, 200, { bezig: meetBezig, rij: [...meetRij], laatste: meetLaatste })
  if (req.method === 'GET' && pad === '/_ff/stand') return stuurJson(res, 200, { versie: PROXY_VERSIE, sinds, poort: POORT, sessies: stand, vast: vastStand(), gestopt: gestoptNu() })
  if (req.method === 'POST' && pad === '/_ff/stop') {
    if (req.headers.origin !== undefined) return stuurJson(res, 403, foutAntwoord('futureflow-proxy: verboden'))
    stoppen = true
    stuurJson(res, 200, { ok: true })
    res.on('finish', () => { if (lopend === 0) setImmediate(stop) })
    return
  }
  if (req.method === 'GET' && pad === '/_ff/log') return stuurJson(res, 200, logPad(url))
  if (req.method === 'GET' && pad === '/') {
    let html
    try {
      html = fs.readFileSync(LOGBOEK)
    } catch {
      return stuurJson(res, 404, foutAntwoord('futureflow-proxy: logboek ontbreekt'))
    }
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
      'content-length': html.length,
    })
    return res.end(html)
  }
  return stuurJson(res, 404, foutAntwoord('futureflow-proxy: onbekend pad'))
}

function vastStand() {
  const uit = {}
  for (const [k, a] of vast) {
    const i = k.indexOf('|')
    ;(uit[k.slice(0, i)] ??= {})[k.slice(i + 1)] = a
  }
  return uit
}

// Gestopt of geweigerd in deze run, en nog steeds zwak in cache.json.
function gestoptNu() {
  const c = cache()
  return [...gestopt].filter(m => isZwak(c, m))
}

// ---- doorgeven ----

const eerste = v => (Array.isArray(v) ? v[0] : v)

function behandel(req, res) {
  let url
  try {
    url = new URL(req.url, 'http://127.0.0.1')
  } catch {
    return stuurJson(res, 400, foutAntwoord('futureflow-proxy: ongeldig pad'))
  }
  if (isEigenPad(url.pathname)) return eigen(req, res, url)
  // De browser vraagt bij het logboek een icoon: niet doorsturen en niet loggen.
  if (url.pathname === '/favicon.ico' && geldigeHost(req.headers.host, POORT)) {
    res.writeHead(204, { 'cache-control': 'max-age=86400' })
    return res.end()
  }
  doorgeven(req, res, url)
}

function doorgeven(req, res, url) {
  lopend += 1
  planStil()
  const t0 = Date.now()
  const delen = []
  let info = { stream: false }
  let upRes
  let up
  let klaar = false
  const sessie = String(eerste(req.headers['x-session-id']) ?? '').slice(0, 100)
  // Vaste of gekozen aanbieder in de body (undefined = los), tweede poging, oud model-id.
  let aanbieder
  let opnieuw = false
  let van
  const sm = () => `${sessie}|${info.model ?? ''}`

  const afronden = (status, gebruik, fout) => {
    if (klaar) return
    klaar = true
    const t = Date.now()
    const sleutel = `${sm()}|${info.baan ?? ''}`
    const regel = logRegel({ t, sessie, pad: url.pathname, info, status, gebruik, ms: t - t0, fout, vorige: vorige.get(sleutel), gewisseld: opnieuw, vast: !!aanbieder, venster: VENSTER_MS })
    if (van) regel.van = van
    if (status >= 200 && status < 300 && !fout) {
      vorige.delete(sleutel)
      vorige.set(sleutel, regel)
      if (vorige.size > VORIGE_MAX) vorige.delete(vorige.keys().next().value)
      if (typeof info.model === 'string' && url.pathname === '/v1/messages') beoordeel(regel, sleutel)
    }
    if (url.pathname !== '/api/hello') {
      schrijfLog(regel)
      werkStandBij(stand, regel)
    }
    lopend -= 1
    planStil()
    if (stoppen && lopend === 0) setImmediate(stop)
  }

  // Na een geslaagde aanvraag: vaste aanbieder, telling per aanbieder en het besluit voor de baan.
  function beoordeel(regel, sleutel) {
    const model = info.model
    const nu = regel.t
    const a = regel.aanbieder ?? aanbieder
    if (sessie && regel.aanbieder && !vast.has(sm())) vast.set(sm(), regel.aanbieder)
    if (a && (regel.telling === 'raak' || regel.telling === 'mis')) {
      aanbieders = werkAanbiederBij(aanbieders, model, a, regel.telling, nu)
      bewaarAanbieders()
    }
    const b = besluit(banen.get(sleutel), regel.telling)
    banen.set(sleutel, b.baan)
    if (b.actie === 'wissel') {
      if (a) {
        aanbieders = werkAanbiederBij(aanbieders, model, a, 'slecht', nu)
        bewaarAanbieders()
      }
      vast.delete(sm())
      // De volgende aanvraag in elke baan van dit model gaat naar een andere aanbieder: koud, telt niet.
      for (const k of [...vorige.keys()]) if (k.startsWith(`${sm()}|`)) vorige.delete(k)
      regel.actie = 'wissel'
    } else if (b.actie === 'stop') {
      schrijfZwak(model, regel.aandeel)
      gestopt.add(zonder1m(model))
      regel.actie = 'stop'
      poortLos(sessie, model)
    }
  }

  // De client sluit voortijdig (Esc in Claude Code): upstream afbreken, één logregel.
  res.on('close', () => {
    if (res.writableFinished) return
    up?.destroy()
    upRes?.destroy()
    afronden(upRes?.statusCode ?? 0, nul(), 'afgebroken')
  })

  req.on('data', c => delen.push(c))
  req.on('error', () => {})
  req.on('end', () => {
    if (klaar) return
    let body = Buffer.concat(delen)
    const tekst = body.toString('utf8')
    info = aanvraagInfo(tekst)
    let obj
    if (req.method === 'POST' && url.pathname === '/v1/messages' && typeof info.model === 'string') {
      try {
        obj = JSON.parse(tekst)
      } catch {
        obj = undefined
      }
    }
    if (obj) {
      const r = rijen()
      const nieuw = wisselModel(obj.model, r?.nu, r?.historie)
      let gewijzigd = false
      if (nieuw !== obj.model) {
        van = obj.model
        obj = { ...obj, model: nieuw }
        info = { ...info, model: nieuw }
        gewijzigd = true
      }
      if (isZwak(cache(), info.model)) {
        gestopt.add(zonder1m(info.model))
        stuurJson(res, WEIGER_STATUS, weigering(info.model))
        return afronden(WEIGER_STATUS, nul(), 'gestopt')
      }
      if (obj.provider === undefined) {
        const nu = Date.now()
        aanbieder = (sessie && vast.get(sm())) || kiesAanbieder(aanbieders, info.model, nu)
        const met = metAanbieder(obj, aanbieder, slechte(aanbieders, info.model, nu))
        if (met !== obj) {
          obj = met
          gewijzigd = true
        }
      }
      if (gewijzigd) body = Buffer.from(JSON.stringify(obj))
    }
    stuur(body)

    // Eén poging naar upstream; bij 429/404/5xx van een vaste aanbieder één keer opnieuw zonder hem.
    function stuur(inhoud) {
      const doel = new URL(`${BASIS.origin}${BASIS_PAD}${url.pathname}${url.search}`)
      const headers = doorHeaders(req.headers)
      headers.host = doel.host
      if (inhoud.length > 0 || !['GET', 'HEAD', 'DELETE', 'OPTIONS'].includes(req.method)) headers['content-length'] = String(inhoud.length)
      const mod = doel.protocol === 'https:' ? https : http
      const dit = mod.request(doel, { method: req.method, headers }, r => {
        if (!opnieuw && aanbieder && obj && probeerOpnieuw(r.statusCode ?? 0)) return terugval(r)
        antwoord(r)
      })
      up = dit
      dit.on('error', err => {
        if (klaar || up !== dit) return
        if (!res.headersSent) {
          stuurJson(res, 502, foutAntwoord('futureflow-proxy: OpenRouter is niet bereikbaar'))
          afronden(502, nul(), err?.code ?? 'netwerkfout')
        } else {
          afronden(upRes?.statusCode ?? 502, nul(), err?.code ?? 'upstream-afgebroken')
          res.destroy()
        }
      })
      dit.end(inhoud)
    }

    // Nog niets naar de client: het foute antwoord weggooien en een andere aanbieder vragen.
    function terugval(r) {
      r.resume()
      r.on('error', () => {})
      const nu = Date.now()
      const fout = aanbieder
      aanbieders = werkAanbiederBij(aanbieders, info.model, fout, 'fout', nu)
      bewaarAanbieders()
      vast.delete(sm())
      opnieuw = true
      const ander = kiesAanbieder(aanbieders, info.model, nu, [fout])
      const { provider: _weg, ...kaal } = obj
      const negeer = [...new Set([...slechte(aanbieders, info.model, nu), fout])]
      obj = metAanbieder(kaal, ander, ander ? [] : negeer)
      aanbieder = ander
      if (klaar) return
      stuur(Buffer.from(JSON.stringify(obj)))
    }
  })

  function antwoord(r) {
    upRes = r
    const status = r.statusCode ?? 502
    const ct = String(r.headers['content-type'] ?? '')
    const sse = ct.startsWith('text/event-stream')
    const kop = { ...r.headers }
    for (const k of ['connection', 'keep-alive', 'transfer-encoding']) delete kop[k]
    if (sse) delete kop['content-length']
    res.writeHead(status, kop)
    const lezer = sse ? maakSseLezer() : undefined
    const decoder = sse ? new StringDecoder('utf8') : undefined
    const json = []
    let grootte = 0
    let teGroot = false
    r.on('data', c => {
      if (lezer) lezer.voeg(decoder.write(c))
      else if (!teGroot) {
        grootte += c.length
        if (grootte > JSON_MAX) {
          teGroot = true
          json.length = 0
        } else json.push(c)
      }
      if (!res.write(c)) {
        r.pause()
        res.once('drain', () => r.resume())
      }
    })
    r.on('end', () => {
      let gebruik = nul()
      let fout
      if (lezer) {
        lezer.voeg(decoder.end())
        gebruik = lezer.uit()
      } else if (!teGroot && json.length) {
        let d
        try {
          d = JSON.parse(Buffer.concat(json).toString('utf8'))
        } catch {
          d = undefined
        }
        gebruik = gebruikUitJson(d)
        if ((status < 200 || status >= 300) && typeof d?.error?.type === 'string') fout = d.error.type
      }
      if ((status < 200 || status >= 300) && !fout) fout = `http-${status}`
      // Eerst de logregel, dan het einde van het antwoord: wie het antwoord heeft, vindt de regel.
      afronden(status, gebruik, fout)
      res.end()
    })
    r.on('error', () => {
      if (klaar) return
      afronden(status, nul(), 'upstream-afgebroken')
      res.destroy()
    })
  }
}

// De weigering van een gestopt model, in de vorm van de Anthropic-API.
function weigering(model) {
  return { type: 'error', error: { type: 'invalid_request_error', message: stopBericht(model, POORT) } }
}

const nul = () => ({ in: 0, uit: 0, read: 0, write: 0 })

server.on('error', err => {
  if (err?.code === 'EADDRINUSE') {
    process.stderr.write(`or-proxy: poort ${POORT} is al in gebruik\n`)
    process.exit(2)
  }
  process.stderr.write(`or-proxy: server-fout (${err?.code ?? err?.name})\n`)
  process.exit(1)
})

server.listen(POORT, '127.0.0.1', () => planStil())
