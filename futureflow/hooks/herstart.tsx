import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, RenderElement } from 'claude-code'

import type { OrHerstart } from '../types'

import { failOpen } from './ctx'
import { openDashboard } from './paneel'

import { contextTeGroot, herstartCommando, herstartScript, keuzeVan, START } from '../lib/openrouter.mjs'

// Herstart op OpenRouter (0.11.0): de huidige sessie gaat verder in een nieuw Terminal-venster met
// `claude-or --resume <sessie>` in dezelfde map. Alleen die sessie draait dan op OpenRouter;
// ~/.claude/settings.json blijft onaangeraakt. Een sessie kan zichzelf niet opnieuw starten, daarom
// een nieuw venster (osascript), daarna probeert futureflow de oude sessie te sluiten (/exit); lukt
// dat niet, dan staat er een regel dat je hem kunt sluiten.
// Eén klik = één venster: `bezig` tijdens de klik, en daarna stand `geopend` voor deze sessie.

const herstartAtom = atom({ plugin: 'futureflow', key: 'openrouter.herstart' } as const, null as OrHerstart | null)

type Kleuren = { accent: string; mut: string; fg: string; ok: string; warn: string; err: string }

// Hoe lang de vraag boven de prompt blijft staan.
const VRAAG_MS = 30 * 60_000

let bezig = false

async function home($: Engine): Promise<string | undefined> {
  return (await $.env.get('HOME')) ?? undefined
}

// Welke terminal de sessie draait: iTerm alleen als TERM_PROGRAM dat zegt, anders Terminal.app.
async function terminalApp($: Engine): Promise<'terminal' | 'iterm'> {
  return (await $.env.get('TERM_PROGRAM')) === 'iTerm.app' ? 'iterm' : 'terminal'
}

async function opDesktop($: Engine): Promise<boolean> {
  try {
    return !(await $.session.surfaces()).includes('terminal')
  } catch {
    return false
  }
}

// Wat er nodig is: de shim en beide modellen. Reden als tekst als het niet kan.
async function klaar($: Engine): Promise<{ shim: string; model: string } | { reden: string }> {
  const h = await home($)
  const shim = h ? `${h}/.local/bin/${START}` : ''
  const k = keuzeVan(await $.store.get('openrouter.keuze'))
  if (!k.m1) return { reden: 'kies eerst Model 1' }
  if (!shim || !(await $.fs.exists(shim).catch(() => false))) return { reden: `${START} staat nog niet klaar` }
  return { shim, model: k.m1 }
}

// Contextvenster van het gekozen model (bewaard bij het kiezen), en de huidige vulling.
async function contextWaarschuwing($: Engine, model: string): Promise<string | undefined> {
  const prijzen = ((await $.store.get('openrouter.prijzen')) ?? {}) as Record<string, { ctx?: number }>
  const ctx = prijzen[model]?.ctx
  const tokens = await $.session.usage().then(u => u.context.tokens, () => undefined)
  if (!contextTeGroot(tokens, ctx)) return undefined
  return `Let op: dit gesprek (${Math.round(tokens! / 1000)}k tokens) is groter dan het venster van ${model} (${Math.round(ctx! / 1000)}k). Doe eerst /compact.`
}

// Zet de vraag met de knop boven de prompt. Aangeroepen bij elke wissel naar OpenRouter (ketting,
// Gebruik nu, Zet klaar). Staat het venster al open voor deze sessie, dan niets.
export async function vraagHerstart($: Engine, reden: string): Promise<void> {
  try {
    const oud = await read($, herstartAtom)
    if (oud?.stand === 'geopend') return
    const nu = await $.clock.now()
    await update($, herstartAtom, () => ({ stand: 'vraag', reden: reden.slice(0, 160), tot: nu + VRAAG_MS }))
  } catch (err) {
    failOpen($, err)
  }
}

// De knop. Opent één nieuw venster met claude-or --resume, en sluit dan deze sessie (of zegt dat je dat kunt).
export async function herstartOpOr($: Engine): Promise<void> {
  if (bezig) return
  bezig = true
  try {
    const stand = await read($, herstartAtom)
    if (stand?.stand === 'geopend') {
      $.ui.toast('Deze sessie loopt al verder in een nieuw venster; deze kun je sluiten.')
      return
    }
    const k = await klaar($)
    if ('reden' in k) {
      $.ui.toast(`Herstart op OpenRouter kan nog niet: ${k.reden}. Zie /futureflow, tab 2 Wisselen.`)
      await openDashboard($, 'wisselen')
      return
    }
    const commando = herstartCommando({ cwd: await $.session.cwd(), sessie: await $.session.id(), shim: k.shim })
    if (!commando) {
      $.ui.toast('Herstart op OpenRouter kan niet: sessie-id of map onbekend.')
      return
    }
    if (await opDesktop($)) {
      // De desktop-app kan geen terminalvenster openen: het commando om te kopiëren.
      await update($, herstartAtom, () => ({ stand: 'kopieer', reden: '', tot: 0, commando }))
      $.ui.toast(`Plak dit in een terminal om deze sessie op OpenRouter voort te zetten: ${commando}`)
      return
    }
    const r = await $.process.run(['/usr/bin/osascript', '-e', herstartScript(await terminalApp($), commando)], { timeoutMs: 20_000 })
    if (r.exitCode !== 0) {
      $.ui.toast(`Nieuw venster niet geopend (${r.stderr.trim().slice(0, 120) || `exitcode ${r.exitCode}`}). Start zelf: ${commando}`)
      return
    }
    await update($, herstartAtom, () => ({ stand: 'geopend', reden: '', tot: 0, commando }))
    // Netjes afsluiten: /exit als die er is; anders blijft de regel "deze kun je sluiten" staan.
    try {
      await $.command.run({ command: 'exit' } as any)
    } catch {
      $.ui.toast('Deze sessie loopt verder in een nieuw venster op OpenRouter; deze kun je sluiten.')
    }
  } catch (err) {
    failOpen($, err)
  } finally {
    bezig = false
  }
}

async function nietNu($: Engine): Promise<void> {
  await update($, herstartAtom, () => null)
}

// De regel boven de prompt (via de skin): vraag met knop, of na het openen de sluit-regel. Leest alleen.
export async function herstartRij($: Engine, e: any, k: Kleuren): Promise<RenderElement | null> {
  try {
    const v = await read($, herstartAtom)
    if (v === null) return null
    const { Box, Text, Button } = $.ui.resolve(e)
    if (v.stand === 'geopend') {
      return <Text key="or-herstart-klaar" color={k.ok} wrap="truncate-end">Verder in nieuw venster op OpenRouter; deze sessie kun je sluiten.</Text>
    }
    if (v.stand === 'kopieer') {
      return (
        <Box key="or-herstart-kopieer" flexDirection="column">
          <Text color={k.warn} wrap="wrap">Verder op OpenRouter: plak dit in een terminal.</Text>
          <Text color={k.fg} wrap="wrap">{v.commando ?? ''}</Text>
        </Box>
      )
    }
    if (v.tot <= (await $.clock.now())) return null
    const m1 = keuzeVan(await $.store.get('openrouter.keuze')).m1
    const waarschuwing = m1 ? await contextWaarschuwing($, m1) : undefined
    return (
      <Box key="or-herstart" flexDirection="column">
        <Box flexDirection="row" columnGap={2}>
          <Box flexGrow={1} flexShrink={1}>
            <Text color={k.warn} wrap="truncate-end">{`Verder op OpenRouter? ${v.reden}`}</Text>
          </Box>
          <Button key="or-herstart-ja" onPress={() => herstartOpOr($)}>Herstart op OpenRouter</Button>
          <Button key="or-herstart-nee" onPress={() => nietNu($)}>Niet nu</Button>
        </Box>
        {waarschuwing ? <Text key="or-herstart-ctx" color={k.err} wrap="wrap">{waarschuwing}</Text> : null}
      </Box>
    )
  } catch (err) {
    failOpen($, err)
    return null
  }
}
