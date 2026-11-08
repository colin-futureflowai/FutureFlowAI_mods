import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { DashboardTab, MinifyTeller, SlotsSnapshot } from '../types'

import { failOpen } from './ctx'
import { minifyTab, niveauLezen } from './minify'
import { openDashboard, PANE, TABS } from './paneel'
import { slotsTab, startSlotsTicker } from './slots'

import { kpis } from '../lib/overzicht.mjs'
import type { Kpi } from '../lib/overzicht.mjs'
import { balkTekst, modusVoor, palet, woordmerkSvg } from '../lib/thema.mjs'
import type { Modus } from '../lib/thema.mjs'

export { openDashboard }

const tabAtom = atom({ plugin: 'futureflow', key: 'dashboard.tab' } as const, null as DashboardTab | null)
const themaAtom = atom({ plugin: 'futureflow', key: 'dashboard.theme' } as const, null as string | null)

const tellerAtom = atom({ plugin: 'futureflow', key: 'minify.teller' } as const, null as MinifyTeller | null)
const snapshotAtom = atom({ plugin: 'futureflow', key: 'slots.snapshot' } as const, null as SlotsSnapshot | null)

const NAMEN: Record<DashboardTab, string> = { overzicht: 'Overzicht', slots: 'Slots', minify: 'Minify', stijl: 'Stijl' }

// De stijl-instelling (licht/donker) komt in een latere stap; tot dan volgt de modus Claude Code's thema.
async function stijlModus($: Engine): Promise<Modus | undefined> {
  return undefined
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

async function modusNu($: Engine): Promise<Modus> {
  return (await stijlModus($)) ?? modusVoor(await themaNu($))
}

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

export const registerDashboard = (on: Parameters<Register>[0]): void => {
  on('command.run', { command: 'futureflow' }, async ($, e) => {
    const woord = (e.args ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? ''
    if (woord && !(TABS as readonly string[]).includes(woord)) {
      return { text: `Onbekende tab "${woord}". Gebruik: /futureflow ${TABS.join('|')}` }
    }
    const tab = (woord || undefined) as DashboardTab | undefined
    await openDashboard($, tab)
    await startSlotsTicker($)
    return { text: `Dashboard geopend${tab ? ` op de tab ${NAMEN[tab]}` : ''}.` }
  })

  // Thema van Claude Code gewijzigd: kop opnieuw tekenen in de juiste modus.
  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const r = await next(e)
    if (typeof e.value === 'string') await update($, themaAtom, () => e.value as string)
    return r
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    try {
    const el = $.ui.resolve(e)
    const { Box, Text, Button } = el
    const tab = (await read($, tabAtom)) ?? 'overzicht'
    const modus = await modusNu($)
    const p = palet(modus)
    // Alleen de terminal tekent geen Svg. Niet `'Svg' in el` gebruiken: de tabel antwoordt daar ook in de terminal ja.
    const Svg = e.surface !== 'terminal' && 'Svg' in el ? el.Svg : undefined

    const inhoud =
      tab === 'slots' ? await slotsTab($, e)
      : tab === 'minify' ? await minifyTab($, e)
      : tab === 'overzicht' ? await overzichtTab($, e, p)
      : <Text dimColor>Komt in de volgende stap.</Text>

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
