// FFAI-skin: tool-regels met icoon en tijd, diff-kaart, shell-kaart en een groene spinner.
// Vorm van de render-events (ToolUse/ToolResult/Spinner/TurnDuration), het openklappen met ▸,
// tijd per aanroep via tool.call en het volgen van het thema via config.set naar claude-skins
// (MIT, hellosverre, commit cf0d39f); de code is eigen werk.

import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { Stijl } from '../types'

import { failOpen, log } from './ctx'
import { diffKaart, shellKaart, toolRegel } from './skin-kaarten'

import { unwrapCommand } from '../lib/classify.mjs'
import {
  beurtDuur, duurTekst, icoonVoor, invoerVelden, korteInvoer, resultaatTekst, schoonTekst, shellStatus, shellUitvoer, telling, toolLabel, wijzigRegels,
} from '../lib/skin.mjs'
import { modusVoor, palet } from '../lib/thema.mjs'
import type { Modus } from '../lib/thema.mjs'

export type { Stijl }

export const STANDAARD_STIJL: Stijl = { aan: true, modus: 'auto', regels: true, diff: true, shell: true, spinner: true }

const stijlAtom = atom({ plugin: 'futureflow', key: 'skin.stijl' } as const, null as Stijl | null)
const themaAtom = atom({ plugin: 'futureflow', key: 'skin.theme' } as const, null as string | null)
const duurAtom = atom({ plugin: 'futureflow', key: 'skin.duur' } as const, -1)
const commandoAtom = atom({ plugin: 'futureflow', key: 'skin.commando' } as const, '')
const openAtom = atom({ plugin: 'futureflow', key: 'skin.open' } as const, false)
// Begin van de lopende beurt (clock-ms, 0 = onbekend) en een tik per seconde voor de spinner.
const startAtom = atom({ plugin: 'futureflow', key: 'skin.start' } as const, 0)
const tikAtom = atom({ plugin: 'futureflow', key: 'skin.tik' } as const, 0)

// De tikker loopt zolang de spinner getekend wordt; drie seconden zonder spinner en hij stopt.
let tikker: { cancel(): void } | undefined
let laatsteSpinner = 0

async function tik($: Engine): Promise<void> {
  const nu = await $.clock.now()
  if (nu - laatsteSpinner > 3000) {
    tikker?.cancel()
    tikker = undefined
    return
  }
  await update($, tikAtom, t => t + 1)
}

function startTikker($: Engine, nu: number): void {
  laatsteSpinner = nu
  tikker?.cancel()
  tikker = $.clock.every(1000, () => {
    void tik($).catch(() => undefined)
  })
}

// Tools die een eigen regel krijgen. Agents, taken, plannen en vragen houden die van Claude Code:
// die tonen live voortgang of dialogen.
const GESKIND = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'Grep', 'Glob', 'WebFetch', 'WebSearch'])
const EDITS = new Set(['Edit', 'Write', 'MultiEdit'])

const geskind = (tool: string) => GESKIND.has(tool) || tool.startsWith('mcp__')

function geldigeStijl(v: unknown): Partial<Stijl> {
  if (typeof v !== 'object' || v === null) return {}
  const s = v as Record<string, unknown>
  const uit: Partial<Stijl> = {}
  for (const k of ['aan', 'regels', 'diff', 'shell', 'spinner'] as const) if (typeof s[k] === 'boolean') uit[k] = s[k] as boolean
  if (s.modus === 'auto' || s.modus === 'licht' || s.modus === 'donker') uit.modus = s.modus
  return uit
}

// Stijl uit deze sessie (atom) of de store, aangevuld met de standaard. Schrijft niets (veilig in render).
export async function leesStijl($: Engine): Promise<Stijl> {
  const live = await read($, stijlAtom)
  if (live) return live
  let opgeslagen: unknown
  try {
    opgeslagen = await $.store.get('stijl')
  } catch {
    opgeslagen = undefined
  }
  return { ...STANDAARD_STIJL, ...geldigeStijl(opgeslagen) }
}

export async function zetStijl($: Engine, deel: Partial<Stijl>): Promise<void> {
  const nieuw = { ...(await leesStijl($)), ...geldigeStijl(deel) }
  await $.store.set('stijl', nieuw)
  await update($, stijlAtom, () => nieuw)
}

async function themaNu($: Engine): Promise<string | null> {
  const gezet = await read($, themaAtom)
  if (gezet) return gezet
  try {
    const rij = (await $.config.list()).find(r => r.key === 'theme')
    return typeof rij?.value === 'string' ? rij.value : null
  } catch {
    return null
  }
}

// De modus uit de stijl, of bij `auto` die bij Claude Code's thema.
export async function huidigeModus($: Engine): Promise<Modus> {
  const s = await leesStijl($)
  if (s.modus === 'licht' || s.modus === 'donker') return s.modus
  return modusVoor(await themaNu($))
}

export const registerSkin = (on: Parameters<Register>[0]): void => {
  // Thema gewijzigd: binnen deze hook geeft $.config.list() nog de oude waarde, dus zelf onthouden.
  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const r = await next(e)
    if (r.deny === undefined && typeof e.value === 'string') await update($, themaAtom, () => e.value as string)
    return r
  })

  // Tijd per aanroep, en voor Bash het commando (zonder de slots-verpakking) voor de shell-kaart.
  // Alleen meten, nooit tegenhouden: een fout hier kost alleen de tijd in de regel.
  on('tool.call', { tool: /^/ }, async ($, e, next) => {
    const id = { requestId: e.tool_use_id }
    let begin: number | undefined
    try {
      if (e.tool === 'Bash') {
        const cmd = (e as { command?: unknown }).command
        if (typeof cmd === 'string') await update($, memberOf(commandoAtom, id), () => unwrapCommand(cmd) ?? cmd)
      }
      begin = await $.clock.now()
    } catch (err) {
      void log($, `skin: meten mislukt: ${String(err)}`).catch(() => undefined)
    }
    const r = await next(e)
    if (begin !== undefined) {
      try {
        const ms = (await $.clock.now()) - begin
        await update($, memberOf(duurAtom, id), () => ms)
      } catch (err) {
        void log($, `skin: meten mislukt: ${String(err)}`).catch(() => undefined)
      }
    }
    return r
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    try {
      const { tool, input, isErrored, isRunning, output } = e.props
      const stijl = await leesStijl($)
      if (!stijl.aan || !stijl.regels || !geskind(tool) || e.props.isExpanded === true) return next(e)
      if (typeof input !== 'object' || input === null) return next(e)
      const p = palet(await huidigeModus($))
      const ms = isRunning ? -1 : await read($, memberOf(duurAtom, e))
      const regels = EDITS.has(tool) && !isErrored ? wijzigRegels(output) : null
      const open = memberOf(openAtom, e)
      const isOpen = await read($, open)
      return toolRegel($.ui.resolve(e), p, {
        icoon: icoonVoor(tool),
        label: toolLabel(tool),
        kort: korteInvoer(tool, input),
        fout: isErrored,
        duur: ms >= 0 ? duurTekst(ms) : undefined,
        tel: regels ? telling(regels) : undefined,
        open: isOpen,
        velden: isOpen ? invoerVelden(input) : [],
        // Volledig, ook bij Bash en Edit: de kaart eronder is ingeklapt (8 + 4) of een diff.
        resultaat: isOpen ? resultaatTekst(output) : '',
        wissel: () => void update($, open, v => !v),
      })
    } catch (err) {
      failOpen($, err)
      return next(e)
    }
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    try {
      const { tool, output, isErrored } = e.props
      const stijl = await leesStijl($)
      if (!stijl.aan || e.props.isExpanded === true) return next(e)
      const desktop = e.surface !== 'terminal'
      if (EDITS.has(tool)) {
        if (!stijl.diff || isErrored) return next(e)
        const regels = wijzigRegels(output)
        const pad = (output as { filePath?: unknown } | null)?.filePath
        if (!regels || typeof pad !== 'string') return next(e)
        const p = palet(await huidigeModus($))
        return diffKaart($.ui.resolve(e), desktop, p, schoonTekst(pad), regels, telling(regels)) ?? next(e)
      }
      if (tool === 'Bash') {
        if (!stijl.shell) return next(e)
        // Naar de achtergrond gestuurd of een afbeelding: Claude Code's eigen regel zegt waar het heen ging.
        const rec = (typeof output === 'object' && output !== null ? output : {}) as Record<string, unknown>
        if (typeof rec.backgroundTaskId === 'string' || rec.isImage === true) return next(e)
        const sh = shellUitvoer(output, isErrored)
        if (!sh) return next(e)
        const p = palet(await huidigeModus($))
        const commando = await read($, memberOf(commandoAtom, e))
        return shellKaart($.ui.resolve(e), desktop, p, schoonTekst(commando), sh, shellStatus(sh, isErrored)) ?? next(e)
      }
      return next(e)
    } catch (err) {
      failOpen($, err)
      return next(e)
    }
  })

  // Begin van een beurt van de hoofdsessie: voor de verstreken tijd in de spinner.
  on('turn.start', async ($, e, next) => {
    try {
      if ((e as { agentId?: unknown }).agentId === undefined) {
        const nu = await $.clock.now()
        await update($, startAtom, () => nu)
        startTikker($, nu)
      }
    } catch (err) {
      void log($, `skin: beurtstart mislukt: ${String(err)}`).catch(() => undefined)
    }
    return next(e)
  })

  // Terminal: Claude Code's woord en de verstreken tijd, in groen. Desktop houdt zijn eigen
  // geanimeerde rij (zoals claude-skins). Tokens staan niet in de props: die laten we weg.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    try {
      const stijl = await leesStijl($)
      if (!stijl.aan || !stijl.spinner || e.surface !== 'terminal') return next(e)
      await read($, tikAtom) // opnieuw tekenen bij elke tik
      const start = await read($, startAtom)
      if (!start) return next(e)
      const nu = await $.clock.now()
      laatsteSpinner = nu
      const p = palet(await huidigeModus($))
      const { Text } = $.ui.resolve(e)
      return <Text color={p.groen}>{`✻ ${e.props.message ?? e.props.word}${e.props.suffix} (${beurtDuur(nu - start)})`}</Text>
    } catch (err) {
      failOpen($, err)
      return next(e)
    }
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    try {
      const stijl = await leesStijl($)
      // Wacht de regel op agents, dan tekent Claude Code hem zelf.
      if (!stijl.aan || !stijl.spinner || e.props.waitingFor !== undefined) return next(e)
      const p = palet(await huidigeModus($))
      const { Text } = $.ui.resolve(e)
      return <Text color={p.groen}>{`✻ ${e.props.word} for ${beurtDuur(e.props.durationMs)}`}</Text>
    } catch (err) {
      failOpen($, err)
      return next(e)
    }
  })
}
