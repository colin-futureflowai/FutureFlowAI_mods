#!/usr/bin/env node
// connectors — MCP-servers per projectmap uit- of aanzetten, in dezelfde lijst als /mcp:
// `projects[<map>].disabledMcpServers` in ~/.claude.json. Alleen Node-builtins.
//
//   connectors list --cwd <map>                          → JSON { uit: string[] }
//   connectors zet --cwd <map> --server <naam> --uit|--aan → JSON { uit: string[], gewijzigd: boolean }
//
// Claude Code schrijft hetzelfde bestand. Daarom: lezen, alleen die ene lijst wijzigen,
// naar een tijdelijk bestand in dezelfde map schrijven (zelfde rechten) en dan rename.
// Is het bestand tussen lezen en rename veranderd, dan opnieuw. Ontbreekt het bestand of
// is het geen geldige JSON: exit 2 en niets geschreven. CLAUDE_JSON overschrijft het pad (tests).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BESTAND = process.env.CLAUDE_JSON || path.join(os.homedir(), '.claude.json')
const POGINGEN = 3

class Fout extends Error {
  constructor(bericht, code) {
    super(bericht)
    this.code = code
  }
}

function opties(args) {
  const o = { cwd: undefined, server: undefined, uit: false, aan: false }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--cwd') o.cwd = args[++i]
    else if (a === '--server') o.server = args[++i]
    else if (a === '--uit') o.uit = true
    else if (a === '--aan') o.aan = true
    else throw new Fout(`onbekend argument: ${a}`, 1)
  }
  if (!o.cwd || !path.isAbsolute(o.cwd)) throw new Fout('--cwd <absolute map> is verplicht', 1)
  return o
}

// Leest het bestand: tekst, geparste inhoud en stat (voor de controle vóór rename).
function lees(doel) {
  let tekst, stat
  try {
    stat = fs.statSync(doel)
    tekst = fs.readFileSync(doel, 'utf8')
  } catch (err) {
    throw new Fout(`${BESTAND} niet gelezen (${err.code ?? err.message}); niets gewijzigd`, 2)
  }
  let data
  try {
    data = JSON.parse(tekst)
  } catch (err) {
    throw new Fout(`${BESTAND} is geen geldige JSON (${err.message}); niets gewijzigd`, 2)
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Fout(`${BESTAND} heeft geen object bovenaan; niets gewijzigd`, 2)
  if (data.projects !== undefined && (!data.projects || typeof data.projects !== 'object' || Array.isArray(data.projects))) {
    throw new Fout(`${BESTAND}: "projects" is geen object; niets gewijzigd`, 2)
  }
  return { tekst, data, stat }
}

const lijstVan = project => (Array.isArray(project?.disabledMcpServers) ? project.disabledMcpServers.filter(s => typeof s === 'string') : [])

// Zelfde opmaak als het origineel: inspringing van de tweede regel, eind-newline alleen als die er was.
function opmaak(tekst, data) {
  const m = /^\{\r?\n([ \t]+)/.exec(tekst)
  const inspring = m ? m[1] : tekst.includes('\n') ? 2 : 0
  return JSON.stringify(data, null, inspring) + (/\n$/.test(tekst) ? '\n' : '')
}

const zelfde = (a, b) => a.mtimeMs === b.mtimeMs && a.size === b.size && a.ino === b.ino

function zet(o) {
  if (!o.server) throw new Fout('--server <naam> is verplicht', 1)
  if (o.uit === o.aan) throw new Fout('kies --uit of --aan', 1)
  // Een symlink blijft een symlink: schrijf naar het echte bestand.
  let doel
  try {
    doel = fs.realpathSync(BESTAND)
  } catch (err) {
    throw new Fout(`${BESTAND} niet gelezen (${err.code ?? err.message}); niets gewijzigd`, 2)
  }
  for (let poging = 1; poging <= POGINGEN; poging++) {
    const { tekst, data, stat } = lees(doel)
    const project = data.projects?.[o.cwd]
    if (project !== undefined && (!project || typeof project !== 'object' || Array.isArray(project))) {
      throw new Fout(`${BESTAND}: projects[${o.cwd}] is geen object; niets gewijzigd`, 2)
    }
    // De lijst zoals hij staat (ook onverwachte items blijven); alleen o.server erbij of eraf.
    const ruw = Array.isArray(project?.disabledMcpServers) ? project.disabledMcpServers : []
    const staatUit = ruw.includes(o.server)
    if (o.uit === staatUit) return { uit: lijstVan(project), gewijzigd: false }
    const nieuw = o.uit ? [...ruw, o.server] : ruw.filter(s => s !== o.server)

    // Alleen deze ene lijst; een ontbrekend project krijgt alleen disabledMcpServers.
    if (data.projects === undefined) data.projects = {}
    if (project === undefined) data.projects[o.cwd] = { disabledMcpServers: nieuw }
    else project.disabledMcpServers = nieuw

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
    return { uit: nieuw.filter(s => typeof s === 'string'), gewijzigd: true }
  }
  throw new Fout(`${BESTAND} veranderde steeds tijdens het schrijven; niets gewijzigd, probeer het opnieuw`, 2)
}

export function main(args) {
  const [cmd, ...rest] = args
  try {
    if (cmd === 'list') {
      const o = opties(rest)
      let doel
      try { doel = fs.realpathSync(BESTAND) } catch (err) { throw new Fout(`${BESTAND} niet gelezen (${err.code ?? err.message})`, 2) }
      const { data } = lees(doel)
      console.log(JSON.stringify({ uit: lijstVan(data.projects?.[o.cwd]) }))
      return 0
    }
    if (cmd === 'zet') {
      console.log(JSON.stringify(zet(opties(rest))))
      return 0
    }
    console.error('Gebruik: connectors list --cwd <map> | connectors zet --cwd <map> --server <naam> --uit|--aan')
    return 1
  } catch (err) {
    if (err instanceof Fout) {
      console.error(`[connectors] ${err.message}`)
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
    console.error(`[connectors] ${err.stack ?? err}`)
    process.exitCode = 1
  }
}
