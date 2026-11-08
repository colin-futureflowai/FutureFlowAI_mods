import type { EngineInterface as Engine } from 'claude-code'

import { oudePlugins } from '../lib/oud.mjs'
import type { OudePlugins } from '../lib/oud.mjs'

// Let op: de hooks-module weigert `$` als argument van een methode (`ctx.oud($)`);
// alleen aan gewone functies. Daarom losse, geëxporteerde functies met state op module-niveau
// (één module-instantie per sessie). `Ctx`/`maakCtx` blijven voor wie een bundel wil doorgeven.
export type Ctx = {
  // Welke oude plugins (agent-slots, minify) nog aan staan; één keer per sessie gelezen.
  oud($: Engine): Promise<OudePlugins>
  failOpen($: Engine, err: unknown): void
  log($: Engine, regel: string): Promise<void>
}

// Map met eigen state van futureflow; FUTUREFLOW_HOME overschrijft de standaard.
export async function stateDir($: Engine): Promise<string | undefined> {
  const eigen = await $.env.get('FUTUREFLOW_HOME')
  if (eigen) return eigen
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  return home ? `${home}/.claude/futureflow` : undefined
}

async function leesJson($: Engine, pad: string): Promise<unknown> {
  try {
    const tekst = await $.fs.read(pad)
    return tekst ? JSON.parse(tekst) : undefined
  } catch {
    return undefined
  }
}

const notes: string[] = []
let warned = false
let gelezen: Promise<OudePlugins> | undefined

export async function log($: Engine, regel: string): Promise<void> {
  notes.push(`${new Date().toISOString()} ${regel}`)
  const dir = await stateDir($)
  if (dir) await $.fs.write(`${dir}/mod.log`, notes.slice(-50).join('\n') + '\n').catch(() => undefined)
}

// Alleen voor tests: vergeet wat oud() las.
export function vergeetOud(): void {
  gelezen = undefined
}

export function oud($: Engine): Promise<OudePlugins> {
  return (gelezen ??= (async () => {
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
    if (!home) return { slots: false, minify: false }
    const installed = await leesJson($, `${home}/.claude/plugins/installed_plugins.json`)
    const settings = await leesJson($, `${home}/.claude/settings.json`)
    return oudePlugins(installed, settings)
  })())
}

// Eén toast per sessie; de rest alleen in mod.log.
export function failOpen($: Engine, err: unknown): void {
  const tekst = err instanceof Error ? err.message : String(err)
  void log($, `fout: ${tekst}`)
  if (warned) return
  warned = true
  $.ui.toast(`futureflow werkt niet (alles gaat door): ${tekst}`)
}

export function maakCtx(): Ctx {
  return { oud, failOpen, log }
}
