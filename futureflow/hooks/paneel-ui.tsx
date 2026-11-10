import type { EngineInterface as Engine, RenderElement } from 'claude-code'

import { binnenBreedte, kaartBreedte, LANG, SCHEIDING, tabNamen } from '../lib/paneel-ui.mjs'

// Bouwstenen van het dashboard /futureflow, gedeeld door alle tabs: tabs, kaart, meter,
// knoppen, vinkje en lege staat. Alleen tekenen; geen `$`, geen state. Breedtes komen uit
// lib/paneel-ui.mjs, zodat niets buiten een smal terminalpaneel (44 kolommen) valt.
// Let op: noem niets `h` in dit bestand; dat is de globale JSX-functie.

type Ui = ReturnType<Engine['ui']['resolve']>

export type PaneelKleuren = { accent: string; mut: string; fg: string; ok: string; warn: string; err: string }

// Alles wat een tab nodig heeft om te tekenen: elementen, kleuren en de breedte die er is.
export type Paneel = {
  el: Ui
  k: PaneelKleuren
  /** Kolommen binnen het paneel (zonder de paddingX van het paneel). */
  breedte: number
  /** Kolommen binnen een kaart. */
  binnen: number
  /** Kolommen van het paneel zoals gemeten, of undefined. */
  kolommen: number | undefined
  terminal: boolean
}

export function paneelVan(el: Ui, e: any, k: PaneelKleuren): Paneel {
  const kolommen = typeof e?.viewport?.columns === 'number' ? e.viewport.columns : undefined
  const breedte = binnenBreedte(kolommen)
  return { el, k, breedte, binnen: kaartBreedte(breedte), kolommen, terminal: e?.surface === 'terminal' }
}

// Tabs als plain knoppen "1: Naam" (hotkey 1-7), gescheiden door " · ". In de terminal verdeeld
// over rijen die passen, met ▔ onder de gekozen tab en een lijn eronder; smal = korte namen.
export function tabs(p: Paneel, sleutels: readonly string[], gekozen: number, kies: (i: number) => () => Promise<void> | void): RenderElement {
  const { Box, Text, Button } = p.el
  const namen = p.terminal ? tabNamen(p.kolommen) : LANG.slice()
  const knop = (i: number) => (
    <Button
      key={`tab-${sleutels[i]}`}
      hotkey={String(i + 1)}
      plain
      variant={i === gekozen ? 'primary' : 'secondary'}
      onPress={kies(i)}
    >
      {i === gekozen ? <Text color={p.k.accent} bold>{namen[i]}</Text> : <Text color={p.k.fg}>{namen[i]}</Text>}
    </Button>
  )
  if (!p.terminal) {
    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        {sleutels.map((_, i) => knop(i))}
      </Box>
    )
  }
  // De gemeten kolommen zijn die van de hele terminal, niet van het paneel: niet zelf rekenen,
  // de rij breekt zelf af. De gekozen tab: ● en vet in accent (een streep eronder raakt verschoven).
  return (
    <Box flexDirection="row" flexWrap="wrap" marginBottom={1}>
      {sleutels.map((_, i) => (
        <Box key={`tabvak-${sleutels[i]}`} flexDirection="row">
          {i === 0 ? '' : <Text color={p.k.mut}>{SCHEIDING}</Text>}
          {i === gekozen ? <Text color={p.k.accent}>● </Text> : ''}
          {knop(i)}
        </Box>
      ))}
    </Box>
  )
}

// Kaart met ronde rand (zoals de kaarten van de skin): titel in accent, eventueel iets dims
// rechts ervan, de inhoud, en knoppen onderaan.
export function kaart(
  p: Paneel,
  titel: string,
  inhoud: unknown,
  extra: { rechts?: string; knoppen?: RenderElement | null } = {},
): RenderElement {
  const { Box, Text } = p.el
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={p.k.mut} paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
        <Text bold color={p.k.accent} wrap="truncate-end">{titel}</Text>
        {extra.rechts ? <Text color={p.k.mut} wrap="truncate-end">{extra.rechts}</Text> : ''}
      </Box>
      {inhoud as any}
      {extra.knoppen ?? ''}
    </Box>
  )
}

// Meter van blokjes: ▰ in de kleur, ▱ gedimd. De fractie wordt geklemd op 0..1.
export function meter(p: Paneel, fractie: number, cellen: number, kleur: string): RenderElement {
  const { Text } = p.el
  const f = Number.isFinite(fractie) ? Math.min(1, Math.max(0, fractie)) : 0
  const n = Math.max(1, Math.floor(cellen))
  const vol = Math.round(f * n)
  return (
    <Text>
      <Text color={kleur}>{'▰'.repeat(vol)}</Text>
      <Text color={p.k.mut}>{'▱'.repeat(n - vol)}</Text>
    </Text>
  )
}

// Eén knop: secondary, of primary voor de hoofdactie (of de huidige keuze).
export function knop(
  p: Paneel,
  key: string,
  label: unknown,
  onPress: () => unknown,
  o: { primary?: boolean; hotkey?: string } = {},
): RenderElement {
  const { Button } = p.el
  return (
    <Button key={key} variant={o.primary ? 'primary' : 'secondary'} onPress={onPress as any} {...(o.hotkey ? { hotkey: o.hotkey } : {})}>
      {label as any}
    </Button>
  )
}

// Rij knoppen onderaan een kaart; loopt door op de volgende regel als hij niet past.
export function knoppen(p: Paneel, lijst: readonly (RenderElement | null | false | '')[]): RenderElement | null {
  const { Box } = p.el
  const echte = lijst.filter(Boolean)
  if (!echte.length) return null
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
      {echte as any}
    </Box>
  )
}

// Aan/uit als plain knop "☑ label" (met hotkey: "a: ☑ label"). Houd het label kort: een knop
// breekt niet af; uitleg hoort in een dimme regel eronder.
export function vinkje(p: Paneel, key: string, aan: boolean, label: string, onPress: () => unknown, hotkey?: string): RenderElement {
  const { Button, Text } = p.el
  return (
    <Button key={key} plain onPress={onPress as any} {...(hotkey ? { hotkey } : {})}>
      <Text color={p.k.fg}>{`${aan ? '☑' : '☐'} ${label}`}</Text>
    </Button>
  )
}

// Vriendelijke lege staat, gedimd.
export function leeg(p: Paneel, tekst: string): RenderElement {
  const { Text } = p.el
  return <Text color={p.k.mut}>{tekst}</Text>
}

// Dimme uitlegregel.
export function uitleg(p: Paneel, tekst: string, key?: string): RenderElement {
  const { Text } = p.el
  return <Text key={key} color={p.k.mut}>{tekst}</Text>
}

// Kerncijfer als kleine kaart: label dim, waarde groot, regel eronder, eventueel een meter.
export function stat(
  p: Paneel,
  titel: string,
  waarde: string,
  onder: string,
  o: { kleur?: string; fractie?: number; breed?: number } = {},
): RenderElement {
  const { Box, Text } = p.el
  // Vult de beschikbare breedte: twee naast elkaar als het past, anders één over de hele breedte.
  const breed = o.breed ?? 24
  return (
    <Box key={`stat-${titel}`} flexDirection="column" borderStyle="round" borderColor={p.k.mut} paddingX={1} flexGrow={1} minWidth={breed}>
      <Text color={p.k.mut} size="caption" wrap="truncate-end">{titel}</Text>
      <Text color={o.kleur ?? p.k.fg} bold size="title" weight="bold" tabular>{waarde}</Text>
      <Text color={p.k.mut} size="footnote" wrap="truncate-end">{onder}</Text>
      {o.fractie === undefined ? '' : meter(p, o.fractie, Math.min(20, breed - 4), o.kleur ?? p.k.accent)}
    </Box>
  )
}

// Kerncijfers in een raster: twee naast elkaar als het past, anders onder elkaar.
export function raster(p: Paneel, kaarten: readonly RenderElement[]): RenderElement {
  const { Box } = p.el
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      {kaarten as any}
    </Box>
  )
}
