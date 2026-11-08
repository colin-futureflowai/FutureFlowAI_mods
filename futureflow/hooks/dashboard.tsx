import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { DashboardTab, MinifyTeller, SlotsSnapshot } from '../types'

import { failOpen } from './ctx'
import { minifyTab, niveauLezen } from './minify'
import { openDashboard, PANE, TABS } from './paneel'
import { huidigeModus, leesStijl, zetStijl } from './skin'
import { diffKaart, toolRegel } from './skin-kaarten'
import { slotsTab, startSlotsTicker } from './slots'

import { kpis } from '../lib/overzicht.mjs'
import type { Kpi } from '../lib/overzicht.mjs'
import { icoonVoor } from '../lib/skin.mjs'
import { balkTekst, palet, woordmerkSvg } from '../lib/thema.mjs'

export { openDashboard }

const tabAtom = atom({ plugin: 'futureflow', key: 'dashboard.tab' } as const, null as DashboardTab | null)

const tellerAtom = atom({ plugin: 'futureflow', key: 'minify.teller' } as const, null as MinifyTeller | null)
const snapshotAtom = atom({ plugin: 'futureflow', key: 'slots.snapshot' } as const, null as SlotsSnapshot | null)

const NAMEN: Record<DashboardTab, string> = { overzicht: 'Overzicht', slots: 'Slots', minify: 'Minify', stijl: 'Stijl' }

// Start van het dashboard; register.tsx roept dit aan vanuit zijn ene session.start.
export async function startDashboard($: Engine): Promise<void> {
  try {
    await $.command.register({ name: 'futureflow', description: 'Dashboard van FutureFlowAI: overzicht, slots, minify, stijl' })
  } catch (err) {
    failOpen($, err)
  }
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')

// Vier kaarten naast elkaar als één Svg (desktop).
function kaartenSvg(lijst: Kpi[], p: ReturnType<typeof palet>): string {
  const b = 190, h = 104, gat = 12
  const kleur = (k: Kpi) => (k.toon === 'oranje' ? p.oranje : k.toon === 'mut' ? p.mut : p.groen)
  const kaart = (k: Kpi, i: number) => {
    const x = i * (b + gat)
    const balk = k.fractie === undefined ? '' :
      `<rect x="${x + 14}" y="${h - 14}" width="${b - 28}" height="4" rx="2" fill="${p.lijn}"/><rect x="${x + 14}" y="${h - 14}" width="${Math.max(0, Math.min(1, k.fractie)) * (b - 28)}" height="4" rx="2" fill="${kleur(k)}"/>`
    return `<rect x="${x}" y="0" width="${b}" height="${h}" rx="10" fill="${p.vlak}" stroke="${p.lijn}"/>` +
      `<text x="${x + 14}" y="24" font-size="11" fill="${p.mut}">${esc(k.titel)}</text>` +
      `<text x="${x + 14}" y="55" font-size="28" font-weight="600" fill="${k.toon === 'mut' ? p.mut : k.toon === 'oranje' ? p.oranje : p.inkt}">${esc(k.waarde)}</text>` +
      `<text x="${x + 14}" y="76" font-size="11" fill="${p.mut}">${esc(k.sub)}</text>${balk}`
  }
  const breed = lijst.length * b + (lijst.length - 1) * gat
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${breed}" height="${h}" viewBox="0 0 ${breed} ${h}" font-family="-apple-system, 'Segoe UI', sans-serif">${lijst.map(kaart).join('')}</svg>`
}

// Inhoud van de tab Overzicht: vier kerncijfers en snelkoppelingen naar de andere tabs.
async function overzichtTab($: Engine, e: any, p: ReturnType<typeof palet>) {
  const el = $.ui.resolve(e)
  const { Box, Text, Button } = el
  const Svg = e.surface !== 'terminal' && 'Svg' in el ? el.Svg : undefined
  const teller = await read($, tellerAtom)
  const snapshot = await read($, snapshotAtom)
  const perNiveau = ((await $.store.get('minify.perNiveau')) ?? {}) as Record<string, { beurten: number; output: number }>
  const niveau = await niveauLezen($)
  let context: { gebruikt: number; max: number } | null = null
  try {
    const gebruik = await $.session.usage()
    if (gebruik.context.tokens && gebruik.context.window) context = { gebruikt: gebruik.context.tokens, max: gebruik.context.window }
  } catch {
    context = null
  }
  const lijst = kpis({ teller, perNiveau, niveau, snapshot, context })
  const kleur = (k: Kpi) => (k.toon === 'oranje' ? p.oranje : k.toon === 'mut' ? p.mut : p.groen)
  const snelkoppeling = (t: DashboardTab) => (
    <Button
      key={`snel-${t}`}
      onPress={async () => {
        await update($, tabAtom, () => t)
        if (t === 'slots') await startSlotsTicker($)
      }}
    >
      {NAMEN[t]}
    </Button>
  )
  return (
    <Box flexDirection="column" gap={1}>
      {Svg ? (
        <Svg source={kaartenSvg(lijst, p)} alt={lijst.map(k => `${k.titel}: ${k.waarde} ${k.sub}`).join('. ')} />
      ) : (
        <Box flexDirection="column">
          {lijst.map(k => (
            <Text key={`kpi-${k.titel}`}>
              <Text dimColor>{k.titel}  </Text>
              <Text color={kleur(k)} bold>{k.waarde}</Text>
              <Text dimColor>  {k.sub}{k.fractie === undefined ? '' : `  ${balkTekst(k.fractie, 10)}`}</Text>
            </Text>
          ))}
        </Box>
      )}
      <Box flexDirection="row" gap={2}>
        {(['slots', 'minify', 'stijl'] as const).map(snelkoppeling)}
      </Box>
    </Box>
  )
}

const MODI = ['auto', 'licht', 'donker'] as const

// Inhoud van de tab Stijl: skin aan/uit, thema, losse onderdelen en (desktop) een voorbeeld.
// Tekent alleen; schrijven gebeurt in de onPress van de knoppen.
async function stijlTab($: Engine, e: any, p: ReturnType<typeof palet>) {
  const el = $.ui.resolve(e)
  const { Box, Text, Button } = el
  const desktop = e.surface !== 'terminal' && 'Svg' in el
  const stijl = await leesStijl($)
  const zet = (deel: Parameters<typeof zetStijl>[1]) => async () => {
    await zetStijl($, deel)
    $.ui.invalidate('ui.render')
  }
  const vinkje = (sleutel: 'regels' | 'diff' | 'shell' | 'spinner', naam: string) => (
    <Button key={`stijl-${sleutel}`} onPress={zet({ [sleutel]: !stijl[sleutel] })}>
      <Text>{`${stijl[sleutel] ? '☑' : '☐'} ${naam}`}</Text>
    </Button>
  )
  const voorbeeld = desktop ? (
    <Box flexDirection="column" gap={1}>
      {toolRegel(el, p, {
        icoon: icoonVoor('Edit'), label: 'Edit', kort: 'src/app.ts', fout: false, duur: '0,4s', tel: { plus: 1, min: 1 },
        open: false, velden: [], resultaat: '', wissel: () => undefined,
      })}
      {diffKaart(el, true, p, 'src/app.ts', [
        { soort: ' ', tekst: 'const naam = leesNaam()', nr: 11 },
        { soort: '-', tekst: 'console.log(naam)', nr: 12 },
        { soort: '+', tekst: 'toon(naam)', nr: 12 },
      ], { plus: 1, min: 1 })}
    </Box>
  ) : ''
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Button key="stijl-aan" hotkey="s" onPress={zet({ aan: !stijl.aan })}>
          <Text>{`${stijl.aan ? '☑' : '☐'} Skin aan`}</Text>
        </Button>
        <Text dimColor>Uit = Claude Code's eigen weergave.</Text>
      </Box>
      <Box flexDirection="row" gap={2}>
        <Text dimColor>Thema</Text>
        {MODI.map(m => (
          <Button key={`stijl-modus-${m}`} onPress={zet({ modus: m })}>
            {m === stijl.modus ? <Text color={p.groen} bold>{m}</Text> : m}
          </Button>
        ))}
      </Box>
      <Box flexDirection="column">
        {vinkje('regels', 'Tool-regels')}
        {vinkje('diff', 'Diff-kaart')}
        {vinkje('shell', 'Shell-kaart')}
        {vinkje('spinner', 'Groene spinner')}
      </Box>
      {voorbeeld}
    </Box>
  )
}

const STIJL_HULP = 'Gebruik: /futureflow stijl uit|aan|licht|donker|auto'

// Past de stijl aan vanuit een commando; één regel tekst terug.
async function stijlCommando($: Engine, keuze: string): Promise<{ text: string } | null> {
  const deel: Record<string, Parameters<typeof zetStijl>[1]> = {
    uit: { aan: false },
    aan: { aan: true },
    licht: { modus: 'licht' },
    donker: { modus: 'donker' },
    auto: { modus: 'auto' },
  }
  const gekozen = deel[keuze]
  if (!gekozen) return { text: `Onbekende stijl "${keuze}". ${STIJL_HULP}` }
  await zetStijl($, gekozen)
  $.ui.invalidate('ui.render')
  return { text: keuze === 'uit' ? 'Skin uit: Claude Code\'s eigen weergave.' : keuze === 'aan' ? 'Skin aan.' : `Thema van de skin: ${keuze}.` }
}

export const registerDashboard = (on: Parameters<Register>[0]): void => {
  on('command.run', { command: 'futureflow' }, async ($, e) => {
    const woorden = (e.args ?? '').trim().toLowerCase().split(/\s+/)
    const woord = woorden[0] ?? ''
    if (woord === 'stijl' && woorden[1]) return stijlCommando($, woorden[1])
    if (woord && !(TABS as readonly string[]).includes(woord)) {
      return { text: `Onbekende tab "${woord}". Gebruik: /futureflow ${TABS.join('|')}` }
    }
    const tab = (woord || undefined) as DashboardTab | undefined
    await openDashboard($, tab)
    await startSlotsTicker($)
    return { text: `Dashboard geopend${tab ? ` op de tab ${NAMEN[tab]}` : ''}.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    try {
    const el = $.ui.resolve(e)
    const { Box, Text, Button } = el
    const tab = (await read($, tabAtom)) ?? 'overzicht'
    const modus = await huidigeModus($)
    const p = palet(modus)
    // Alleen de terminal tekent geen Svg. Niet `'Svg' in el` gebruiken: de tabel antwoordt daar ook in de terminal ja.
    const Svg = e.surface !== 'terminal' && 'Svg' in el ? el.Svg : undefined

    const inhoud =
      tab === 'slots' ? await slotsTab($, e)
      : tab === 'minify' ? await minifyTab($, e)
      : tab === 'overzicht' ? await overzichtTab($, e, p)
      : await stijlTab($, e, p)

    return (
      <Box flexDirection="column" gap={1} padding={1}>
        <Box flexDirection="column">
          {Svg ? (
            <Svg source={woordmerkSvg(modus, 220)} alt="FutureFlowAI" />
          ) : (
            <Text bold>
              <Text>FutureFlow</Text>
              <Text color={p.groen}>AI</Text>
            </Text>
          )}
          <Box flexDirection="row" gap={2}>
            {TABS.map((t, i) => (
              <Button
                key={`tab-${t}`}
                hotkey={String(i + 1)}
                onPress={async () => {
                  await update($, tabAtom, () => t)
                  if (t === 'slots' || t === 'overzicht') await startSlotsTicker($)
                }}
              >
                {t === tab ? <Text color={p.groen} bold>{NAMEN[t]}</Text> : NAMEN[t]}
              </Button>
            ))}
          </Box>
        </Box>
        {inhoud}
      </Box>
    )
    } catch (err) {
      failOpen($, err)
      return next(e)
    }
  })
}
