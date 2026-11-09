#!/usr/bin/env node
// api — API-key in de macOS-sleutelhanger en wisselen tussen abonnement en API via
// `apiKeyHelper` in ~/.claude/settings.json. Alleen Node-builtins (plus de pure lib/api.mjs).
//
//   api zet-key                 key via stdin → sleutelhanger           → JSON { ok, staart }
//   api wis-key                 item uit de sleutelhanger               → JSON { gewist }
//   api status                                                          → JSON { heeftKey, staart, modus, vreemdeHelper, fout? }
//   api modus api|abonnement    zet of verwijdert alleen onze helper    → JSON { modus, gewijzigd }
//   api takenlijst aan|uit|status  env.CLAUDE_CODE_ENABLE_TODO_TOOLS = "true" → JSON { aan } (aan/uit ook { gewijzigd })
//
// De key staat nooit in argv (ook niet van `security`: die krijgt de opdracht via stdin van
// `security -i`) en nooit op stdout of stderr; alleen de laatste 4 tekens.
// Exitcodes: 1 gebruik of ongeldige key, 2 settings onleesbaar of geen geldige JSON (niets geschreven),
// 3 er staat een andere apiKeyHelper (blijft staan), 4 geen key in de sleutelhanger, 5 sleutelhanger-fout.
// SETTINGS_JSON en SECURITY_BIN overschrijven pad en programma (tests).

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ACCOUNT, geldigeKey, HELPER, SERVICE } from '../lib/api.mjs'

const BESTAND = process.env.SETTINGS_JSON || path.join(os.homedir(), '.claude', 'settings.json')
const SECURITY = process.env.SECURITY_BIN || '/usr/bin/security'
const POGINGEN = 3
const TODO_VAR = 'CLAUDE_CODE_ENABLE_TODO_TOOLS'
const NIET_GEVONDEN = 44

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
function leesKey() {
  const r = security(['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w'])
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

function zetKey() {
  const key = leesStdin().trim()
  if (!geldigeKey(key)) throw new Fout('geen geldige Anthropic API-key (die begint met sk-ant-); niets opgeslagen', 1)
  // -U werkt een bestaand item bij. De opdracht gaat via stdin, zodat de key niet in argv staat.
  const r = security(['-i'], `add-generic-password -U -s ${SERVICE} -a ${ACCOUNT} -w ${key}\n`)
  if (r.error || r.status !== 0) throw new Fout(`key niet bewaard in de sleutelhanger (${r.error?.code ?? `exitcode ${r.status}`})`, 5)
  // Terug lezen: pas als hij er echt staat is het gelukt.
  if (leesKey() !== key) throw new Fout('key niet terug te lezen uit de sleutelhanger; controleer Sleutelhangertoegang', 5)
  return { ok: true, staart: key.slice(-4) }
}

function wisKey() {
  const r = security(['delete-generic-password', '-s', SERVICE, '-a', ACCOUNT])
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

function modusVan(data) {
  const helper = data?.apiKeyHelper
  return {
    modus: helper === HELPER ? 'api' : 'abonnement',
    vreemdeHelper: helper !== undefined && helper !== HELPER,
  }
}

function zetModus(naar) {
  if (naar !== 'api' && naar !== 'abonnement') throw new Fout('kies: modus api|abonnement', 1)
  const doel = doelPad()
  for (let poging = 1; poging <= POGINGEN; poging++) {
    const gelezen = lees(doel)
    const huidig = modusVan(gelezen?.data)
    if (huidig.vreemdeHelper) {
      throw new Fout(`in ${BESTAND} staat al een andere apiKeyHelper; futureflow laat die staan en wisselt niet`, 3)
    }
    if (huidig.modus === naar) return { modus: naar, gewijzigd: false }
    // Naar API alleen met een key, anders kan een nieuwe terminal-sessie niet inloggen.
    if (naar === 'api' && leesKey() === undefined) throw new Fout('geen key in de sleutelhanger; bewaar eerst een key', 4)

    if (!gelezen) {
      // Geen settings.json: aanmaken met alleen onze helper (alleen voor modus api, abonnement stopte hierboven).
      const tekst = JSON.stringify({ apiKeyHelper: HELPER }, null, 2) + '\n'
      fs.mkdirSync(path.dirname(doel), { recursive: true })
      const tmp = path.join(path.dirname(doel), `.${path.basename(doel)}.futureflow-${process.pid}-${Date.now()}.tmp`)
      try {
        fs.writeFileSync(tmp, tekst, { mode: 0o600, flag: 'wx' })
        // link faalt als het bestand intussen wel bestaat; dan opnieuw lezen.
        fs.linkSync(tmp, doel)
        fs.rmSync(tmp, { force: true })
        return { modus: naar, gewijzigd: true }
      } catch (err) {
        fs.rmSync(tmp, { force: true })
        if (err.code === 'EEXIST') continue
        throw new Fout(`${BESTAND} niet geschreven (${err.code ?? err.message}); niets gewijzigd`, 2)
      }
    }

    const { tekst, data, stat } = gelezen
    if (naar === 'api') data.apiKeyHelper = HELPER
    else delete data.apiKeyHelper
    const mode = stat.mode & 0o777
    const tmp = path.join(path.dirname(doel), `.${path.basename(doel)}.futureflow-${process.pid}-${Date.now()}.tmp`)
    try {
      fs.writeFileSync(tmp, opmaak(tekst, data), { mode, flag: 'wx' })
      fs.chmodSync(tmp, mode)
      // Tussendoor door Claude Code geschreven? Dan niet overschrijven maar opnieuw lezen.
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
    return { modus: naar, gewijzigd: true }
  }
  throw new Fout(`${BESTAND} veranderde steeds tijdens het schrijven; niets gewijzigd, probeer het opnieuw`, 2)
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
  const uit = { heeftKey: false, staart: '', modus: 'abonnement', vreemdeHelper: false }
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
    const gelezen = lees(doelPad())
    Object.assign(uit, modusVan(gelezen?.data))
  } catch (err) {
    fouten.push(err.message)
  }
  return fouten.length ? { ...uit, fout: fouten.join('; ') } : uit
}

export function main(args) {
  const [cmd, ...rest] = args
  try {
    if (cmd === 'zet-key' && rest.length === 0) console.log(JSON.stringify(zetKey()))
    else if (cmd === 'wis-key' && rest.length === 0) console.log(JSON.stringify(wisKey()))
    else if (cmd === 'status' && rest.length === 0) console.log(JSON.stringify(status()))
    else if (cmd === 'modus' && rest.length === 1) console.log(JSON.stringify(zetModus(rest[0])))
    else if (cmd === 'takenlijst' && rest.length === 1) console.log(JSON.stringify(takenlijst(rest[0])))
    else {
      console.error('Gebruik: api zet-key (key via stdin) | api wis-key | api status | api modus api|abonnement | api takenlijst aan|uit|status')
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
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (err) {
    // Geen stack met mogelijke invoer: alleen de melding.
    console.error(`[api] ${err?.message ?? err}`)
    process.exitCode = 1
  }
}
