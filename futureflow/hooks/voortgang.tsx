import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register, RenderElement } from 'claude-code'

import type { Lijst } from '../types'

import { failOpen } from './ctx'

import { blokjes, doelVan, duur, huidige, pasToe, percentage, positie, telling } from '../lib/voortgang.mjs'

// Voortgangsbalk: de takenlijst van de hoofdsessie (TaskCreate/TaskUpdate, TodoWrite,
// mcp__ccd_turn__update_plan) als één regel boven de prompt, uit te klappen tot alle stappen.
// Tekenen schrijft nooit state; alles wat verandert gebeurt in tool.call, prompt.submit of een knop.

const lijstAtom = atom({ plugin: 'futureflow', key: 'voortgang.lijst' } as const, null as Lijst | null)
const openAtom = atom({ plugin: 'futureflow', key: 'voortgang.open' } as const, null as boolean | null)
const klaarAtom = atom({ plugin: 'futureflow', key: 'voortgang.klaarSinds' } as const, 0)
const opdrachtAtom = atom({ plugin: 'futureflow', key: 'voortgang.opdracht' } as const, '')
const tikAtom = atom({ plugin: 'futureflow', key: 'voortgang.tik' } as const, 0)

const MATCH = /^(TaskCreate|TaskUpdate|TodoWrite|mcp__ccd_turn__update_plan)$/
// Zo lang blijft de ✓-regel staan als alles klaar is.
const KLAAR_MS = 5000
const OPEN_STORE = 'voortgang.open'

export type Kleuren = { accent: string; mut: string; fg: string }

// Kleuren van FutureFlowAI, voor als de skin uit staat of faalt.
export const STANDAARD_KLEUREN: Kleuren = { accent: '#3fbf35', mut: '#8a8a8a', fg: '#f2f2f2' }

type Ui = ReturnType<Engine['ui']['resolve']>

// minify.tsx heeft de enige ongematchte prompt.submit en roept dit aan met de getypte tekst.
export async function onthoudOpdracht($: Engine, tekst: string): Promise<void> {
  const doel = doelVan(tekst)
  if (doel === '' || (await read($, opdrachtAtom)) === doel) return
  await update($, opdrachtAtom, () => doel)
}

// De lijst voor het dashboard (tab Overzicht).
export async function voortgangLijst($: Engine): Promise<Lijst | null> {
  return await read($, lijstAtom)
}

async function isOpen($: Engine): Promise<boolean> {
  const open = await read($, openAtom)
  if (open !== null) return open
  return (await $.store.get(OPEN_STORE)) === true
}

// Klapt de balk in of uit en onthoudt dat ook voor volgende sessies. Geeft de nieuwe stand terug.
export async function wisselOpen($: Engine): Promise<boolean> {
  const open = !(await isOpen($))
  await update($, openAtom, () => open)
  await $.store.set(OPEN_STORE, open)
  return open
}

// /futureflow balk: één regel terug.
export async function balkCommando($: Engine): Promise<{ text: string }> {
  const open = await wisselOpen($)
  const lijst = await read($, lijstAtom)
  const nog = lijst === null ? ' Er loopt nu geen takenlijst.' : ''
  return { text: open ? `Voortgangsbalk uitgeklapt: alle stappen.${nog}` : `Voortgangsbalk ingeklapt: één regel.${nog}` }
}

// Verwerkt een tool-aanroep in de lijst; bij 100% de klaar-tijd en één timer die de ✓-regel weghaalt.
async function verwerk($: Engine, tool: string, input: unknown, result: unknown): Promise<void> {
  const oud = await read($, lijstAtom)
  const nu = await $.clock.now()
  const nieuw = pasToe(oud, tool, input, result, nu, await read($, opdrachtAtom))
  if (nieuw === oud) return
  await update($, lijstAtom, () => nieuw)
  const klaar = nieuw !== null && percentage(nieuw) === 100
  const wasKlaar = oud !== null && percentage(oud) === 100
  if (klaar && !wasKlaar) {
    await update($, klaarAtom, () => nu)
    $.clock.after(KLAAR_MS, () => {
      void update($, tikAtom, t => t + 1).catch(err => failOpen($, err))
    })
  } else if (!klaar && (await read($, klaarAtom)) !== 0) {
    await update($, klaarAtom, () => 0)
  }
}

// Alle stappen onder elkaar, met het doel erboven en de telling eronder. Ook voor het dashboard.
export function stappenRijen(ui: Ui, lijst: Lijst, kleuren: Kleuren, nu: number): RenderElement {
  const { Box, Text } = ui
  const t = telling(lijst)
  const teken = { klaar: '✓', bezig: '▸', open: '○' } as const
  const kleur = { klaar: kleuren.accent, bezig: kleuren.fg, open: kleuren.mut } as const
  return (
    <Box flexDirection="column">
      {lijst.doel ? <Text color={kleuren.fg} bold wrap="truncate-end">{lijst.doel}</Text> : ''}
      {lijst.stappen.map(s => (
        <Text key={`voortgang-stap-${s.id}`} wrap="truncate-end">
          <Text color={kleur[s.status]}>{`${teken[s.status]} `}</Text>
          <Text color={s.status === 'open' ? kleuren.mut : kleuren.fg} bold={s.status === 'bezig'}>{s.titel}</Text>
        </Text>
      ))}
      <Text color={kleuren.mut}>{`${t.klaar} klaar · ${t.bezig} bezig · ${t.open} te gaan · ${duur(nu - lijst.begin)} bezig`}</Text>
    </Box>
  )
}

// De voortgangsrij boven de prompt: ingeklapt één regel, uitgeklapt alle stappen; null zonder lijst
// of 5 s nadat alles klaar is. Leest alleen (ook de klok); schrijft nooit.
export async function voortgangRij($: Engine, e: any, kleuren: Kleuren): Promise<RenderElement | null> {
  try {
    const lijst = await read($, lijstAtom)
    if (lijst === null || lijst.stappen.length === 0) return null
    const ui = $.ui.resolve(e) as Ui
    const { Box, Text, Button } = ui
    const merk = [
      <Text key="voortgang-merk-1" color={kleuren.fg} bold>FutureFlow</Text>,
      <Text key="voortgang-merk-2" color={kleuren.accent} bold>AI</Text>,
    ]
    const pct = percentage(lijst)
    if (pct === 100) {
      // Lezen van tik: de timer uit verwerk() laat de balk zo opnieuw tekenen.
      await read($, tikAtom)
      const sinds = await read($, klaarAtom)
      if (sinds === 0 || (await $.clock.now()) - sinds >= KLAAR_MS) return null
      return (
        <Text wrap="truncate-end">
          {merk}
          <Text color={kleuren.accent}>{' ✓ '}</Text>
          <Text color={kleuren.fg}>{lijst.doel ? `${lijst.doel}: klaar` : 'Alle stappen klaar'}</Text>
        </Text>
      )
    }
    const open = await isOpen($)
    const { vol, leeg } = blokjes(lijst)
    const stap = huidige(lijst)
    const knop = (
      <Button key="voortgang-wissel" hotkey="v" plain dimColor label={open ? 'inklappen' : 'details'} onPress={() => wisselOpen($)} />
    )
    const regel = (
      <Box flexDirection="row" columnGap={2}>
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end">
            {merk}
            <Text color={kleuren.accent}>{` ${vol}`}</Text>
            <Text color={kleuren.mut}>{leeg}</Text>
            <Text color={kleuren.fg}>{` ${pct}%`}</Text>
            {open || stap === undefined ? '' : <Text color={kleuren.mut}>{`  ▸ ${positie(lijst)}/${lijst.stappen.length} `}</Text>}
            {open || stap === undefined ? '' : <Text color={kleuren.fg}>{stap.titel}</Text>}
          </Text>
        </Box>
        {knop}
      </Box>
    )
    if (!open) return regel
    return (
      <Box flexDirection="column">
        {regel}
        {stappenRijen(ui, lijst, kleuren, await $.clock.now())}
      </Box>
    )
  } catch (err) {
    failOpen($, err)
    return null
  }
}

function laatDoor($: Engine, e: any, next: any) {
  if (next.error?.kind !== 're-entry') failOpen($, next.error?.message ?? next.error?.kind)
  return next(e)
}

export const registerVoortgang = (on: Parameters<Register>[0]): void => {
  // Meten na de aanroep, alleen in de hoofdsessie; een fout hier raakt de aanroep nooit.
  on('tool.call', { tool: MATCH }, async ($, e, next) => {
    const r = await next(e)
    try {
      if (e.agentId === undefined && r.deny === undefined && !r.isError) await verwerk($, String(e.tool), e, r.result)
    } catch (err) {
      failOpen($, err)
    }
    return r
  }).catch(laatDoor as any)
}
