import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { DashboardTab, MinifyTeller, SlotsSnapshot } from '../types'

import { connectorsTab } from './connectors'
import { failOpen, oud } from './ctx'
import { minifyTab, niveauLezen } from './minify'
import { openDashboard, PANE, TABS } from './paneel'
import { openSkinSettings, setSkinPrefs, skinPrefs } from './skins/register'
import { slotsTab, startSlotsTicker } from './slots'
import { balkCommando, stappenRijen, voortgangLijst } from './voortgang'

import { kpis } from '../lib/overzicht.mjs'
import type { Kpi } from '../lib/overzicht.mjs'
import { balkTekst, palet, woordmerkSvg } from '../lib/thema.mjs'

export { openDashboard }

const tabAtom = atom({ plugin: 'futureflow', key: 'dashboard.tab' } as const, null as DashboardTab | null)

const tellerAtom = atom({ plugin: 'futureflow', key: 'minify.teller' } as const, null as MinifyTeller | null)
const snapshotAtom = atom({ plugin: 'futureflow', key: 'slots.snapshot' } as const, null as SlotsSnapshot | null)

const NAMEN: Record<DashboardTab, string> = {
  overzicht: 'Overzicht',
  slots: 'Slots',
  minify: 'Minify',
  stijl: 'Stijl',
  connectors: 'Connectors',
}

// Start van het dashboard; register.tsx roept dit aan vanuit zijn ene session.start.
export async function startDashboard($: Engine): Promise<void> {
  try {
    await $.command.register({ name: 'futureflow', description: 'Dashboard van FutureFlowAI: overzicht, slots, minify, stijl, connectors' })
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
  const voortgang = await voortgangLijst($)
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
      {voortgang === null ? '' : stappenRijen(el, voortgang, { accent: p.groen, mut: p.mut, fg: p.inkt }, await $.clock.now())}
      <Box flexDirection="row" gap={2}>
        {(['slots', 'minify', 'stijl'] as const).map(snelkoppeling)}
      </Box>
    </Box>
  )
}

// Skins die het dashboard als knop toont; de rest staat in /skin.
const SNEL = ['futureflow', 'noir', 'github', 'mono'] as const

// Onderdelen van de skin die je hier aan- of uitzet (sleutel in Prefs, naam in het dashboard).
const ONDERDELEN = [
  ['band', 'Verbruiksbalk boven de prompt'],
  ['shell', 'Shell-kaart'],
  ['markdown', 'Antwoorden opmaken'],
  ['highlight', 'Code kleuren'],
  ['rail', 'Rail langs tool-aanroepen'],
  ['shimmer', 'Glans op de spinner'],
] as const

// Inhoud van de tab Stijl: welke skin, aan/uit, losse onderdelen en de volledige instellingen.
// Tekent alleen; schrijven gebeurt in de onPress van de knoppen.
async function stijlTab($: Engine, e: any, p: ReturnType<typeof palet>) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const { prefs, names } = await skinPrefs($)
  const zet = (deel: Parameters<typeof setSkinPrefs>[1]) => async () => {
    await setSkinPrefs($, deel)
    $.ui.invalidate('ui.render')
  }
  const aan = prefs.skin !== 'off'
  const snel = SNEL.filter(n => names.includes(n))
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Button key="stijl-aan" hotkey="s" onPress={zet({ skin: aan ? 'off' : 'futureflow' })}>
          <Text>{`${aan ? '☑' : '☐'} Skin aan`}</Text>
        </Button>
        <Text dimColor>Uit = Claude Code's eigen weergave. Licht of donker volgt het thema van Claude Code (/theme).</Text>
      </Box>
      <Box flexDirection="row" gap={2}>
        <Text dimColor>Skin</Text>
        {snel.map(n => (
          <Button key={`stijl-skin-${n}`} onPress={zet({ skin: n })}>
            {n === prefs.skin ? <Text color={p.groen} bold>{n}</Text> : n}
          </Button>
        ))}
        {aan && !(snel as readonly string[]).includes(prefs.skin) ? <Text color={p.groen} bold>{prefs.skin}</Text> : ''}
      </Box>
      <Box flexDirection="column">
        {ONDERDELEN.map(([sleutel, naam]) => (
          <Button key={`stijl-${sleutel}`} onPress={zet({ [sleutel]: !prefs[sleutel] })}>
            <Text>{`${prefs[sleutel] ? '☑' : '☐'} ${naam}`}</Text>
          </Button>
        ))}
      </Box>
      <Box flexDirection="row" gap={2}>
        <Button key="stijl-alles" hotkey="a" onPress={() => openSkinSettings($)}>
          Alle instellingen
        </Button>
        <Text dimColor>of /skin, /skin gallery</Text>
      </Box>
    </Box>
  )
}

const STIJL_HULP = 'Gebruik: /futureflow stijl aan|uit|<skin>, bv. futureflow of noir. Meer: /skin'

// Past de stijl aan vanuit een commando; één regel tekst terug.
async function stijlCommando($: Engine, keuze: string): Promise<{ text: string }> {
  const { names } = await skinPrefs($)
  const skin = keuze === 'aan' ? 'futureflow' : keuze === 'uit' ? 'off' : keuze
  if (skin !== 'off' && !names.includes(skin)) return { text: `Onbekende stijl "${keuze}". ${STIJL_HULP}` }
  await setSkinPrefs($, { skin })
  $.ui.invalidate('ui.render')
  return { text: skin === 'off' ? 'Skin uit: Claude Code\'s eigen weergave.' : `Skin: ${skin}.` }
}

export const registerDashboard = (on: Parameters<Register>[0]): void => {
  on('command.run', { command: 'futureflow' }, async ($, e) => {
    try {
      const woorden = (e.args ?? '').trim().toLowerCase().split(/\s+/)
      const woord = woorden[0] ?? ''
      if (woord === 'stijl' && woorden[1]) return await stijlCommando($, woorden[1])
      if (woord === 'balk') return await balkCommando($)
      if (woord && !(TABS as readonly string[]).includes(woord)) {
        return { text: `Onbekende tab "${woord}". Gebruik: /futureflow ${TABS.join('|')}` }
      }
      const tab = (woord || undefined) as DashboardTab | undefined
      await openDashboard($, tab)
      if (!(await oud($)).slots) await startSlotsTicker($)
      return { text: `Dashboard geopend${tab ? ` op de tab ${NAMEN[tab]}` : ''}.` }
    } catch (err) {
      failOpen($, err)
      return { text: 'Dat lukte niet; de fout staat in het logboek van de mod.' }
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    try {
    const el = $.ui.resolve(e)
    const { Box, Text, Button } = el
    const tab = (await read($, tabAtom)) ?? 'overzicht'
    const modus = (await skinPrefs($)).isLight ? 'licht' : 'donker'
    const p = palet(modus)
    // Alleen de terminal tekent geen Svg. Niet `'Svg' in el` gebruiken: de tabel antwoordt daar ook in de terminal ja.
    const Svg = e.surface !== 'terminal' && 'Svg' in el ? el.Svg : undefined

    const inhoud =
      tab === 'slots' ? await slotsTab($, e)
      : tab === 'minify' ? await minifyTab($, e)
      : tab === 'overzicht' ? await overzichtTab($, e, p)
      : tab === 'connectors' ? await connectorsTab($, e)
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
                  if ((t === 'slots' || t === 'overzicht') && !(await oud($)).slots) await startSlotsTicker($)
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
