import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { DashboardTab, MinifyTeller, SlotsSnapshot } from '../types'

import { accountsTab, openAccounts } from './accounts'
import { apiTab, takenlijstStand, verversApi, zetTakenlijst } from './api'
import { connectorsTab, openConnectors } from './connectors'
import { failOpen, oud } from './ctx'
import { minifyTab, niveauLezen } from './minify'
import { openOpenrouter, openrouterTab } from './openrouter'
import { openDashboard, PANE, TABS } from './paneel'
import { kaart, knop, knoppen, leeg, paneelVan, raster, stat, tabs, uitleg, vinkje } from './paneel-ui'
import type { Paneel } from './paneel-ui'
import { actieveKleuren, openSkinSettings, setSkinPrefs, skinPrefs } from './skins/register'
import { slotsTab, startSlotsTicker } from './slots'
import { balkCommando, stappenRijen, voortgangLijst } from './voortgang'

import { kpis } from '../lib/overzicht.mjs'
import type { Kpi } from '../lib/overzicht.mjs'
import { palet } from '../lib/thema.mjs'

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
  api: 'API',
  accounts: 'Accounts',
  openrouter: 'OpenRouter',
}

// Start van het dashboard; register.tsx roept dit aan vanuit zijn ene session.start.
export async function startDashboard($: Engine): Promise<void> {
  try {
    await $.command.register({ name: 'futureflow', description: 'Dashboard van FutureFlowAI: overzicht, slots, minify, stijl, connectors, api, accounts, openrouter' })
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

// Inhoud van de tab Overzicht: vier kerncijfers (desktop: Svg-kaarten) en de voortgang.
async function overzichtTab($: Engine, e: any, p: ReturnType<typeof palet>, ui: Paneel) {
  const el = ui.el
  const { Box } = el
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
  const kleur = (k: Kpi) => (k.toon === 'oranje' ? ui.k.warn : k.toon === 'mut' ? ui.k.mut : ui.k.accent)
  return (
    <Box flexDirection="column" gap={1}>
      {Svg ? (
        <Svg source={kaartenSvg(lijst, p)} alt={lijst.map(k => `${k.titel}: ${k.waarde} ${k.sub}`).join('. ')} />
      ) : (
        raster(ui, lijst.map(k => stat(ui, k.titel, k.waarde, k.sub, { kleur: kleur(k), ...(k.fractie === undefined ? {} : { fractie: k.fractie }) })))
      )}
      {voortgang === null
        ? leeg(ui, 'Nog geen takenlijst — de voortgang verschijnt zodra Claude een plan maakt.')
        : kaart(ui, 'Voortgang', stappenRijen(el, voortgang, { accent: ui.k.accent, mut: ui.k.mut, fg: ui.k.fg }, await $.clock.now()))}
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
async function stijlTab($: Engine, ui: Paneel) {
  const { Box, Text } = ui.el
  const { prefs, names } = await skinPrefs($)
  const zet = (deel: Parameters<typeof setSkinPrefs>[1]) => async () => {
    await setSkinPrefs($, deel)
    $.ui.invalidate('ui.render')
  }
  const aan = prefs.skin !== 'off'
  const snel = SNEL.filter(n => names.includes(n))
  const taken = await takenlijstStand($)
  const anders = aan && !(snel as readonly string[]).includes(prefs.skin)
  return (
    <Box flexDirection="column" gap={1}>
      {kaart(ui, 'Skin', [
        vinkje(ui, 'stijl-aan', aan, 'Skin aan', zet({ skin: aan ? 'off' : 'futureflow' }), 's'),
        uitleg(ui, "Uit = Claude Code's eigen weergave. Licht of donker volgt het thema van Claude Code (/theme)."),
        anders ? <Text color={ui.k.mut}>{'Nu: '}<Text color={ui.k.accent} bold>{prefs.skin}</Text></Text> : '',
      ], {
        rechts: aan ? prefs.skin : 'uit',
        knoppen: knoppen(ui, snel.map(n => knop(ui, `stijl-skin-${n}`, n === prefs.skin ? `● ${n}` : n, zet({ skin: n }), { primary: n === prefs.skin }))),
      })}
      {kaart(ui, 'Onderdelen', ONDERDELEN.map(([sleutel, naam]) => vinkje(ui, `stijl-${sleutel}`, prefs[sleutel], naam, zet({ [sleutel]: !prefs[sleutel] }))))}
      {kaart(ui, 'Terminal', [
        vinkje(ui, 'stijl-takenlijst', taken, 'Takenlijst in de terminal', async () => { await zetTakenlijst($, !taken) }),
        uitleg(ui, 'Nodig voor de voortgangsbalk. Geldt voor nieuwe sessies; zet CLAUDE_CODE_ENABLE_TODO_TOOLS in ~/.claude/settings.json.'),
      ])}
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} alignItems="center">
        {knop(ui, 'stijl-alles', 'Alle instellingen', () => openSkinSettings($), { hotkey: 'a' })}
        {uitleg(ui, 'of /skin, /skin gallery')}
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
      if (tab === 'api') await verversApi($)
      if (tab === 'connectors') await openConnectors($)
      if (tab === 'accounts') await openAccounts($)
      if (tab === 'openrouter') await openOpenrouter($)
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
    const { Box } = el
    const tab = (await read($, tabAtom)) ?? 'overzicht'
    const modus = (await skinPrefs($)).isLight ? 'licht' : 'donker'
    const p = palet(modus)
    const k = await actieveKleuren($)
    const ui = paneelVan(el, e, k)
    // Geen woordmerk bovenaan: de titel van het paneel zegt al FutureFlowAI. Het paneel begint met de tabs.
    const inhoud =
      tab === 'slots' ? await slotsTab($, e)
      : tab === 'minify' ? await minifyTab($, e)
      : tab === 'overzicht' ? await overzichtTab($, e, p, ui)
      : tab === 'connectors' ? await connectorsTab($, e)
      : tab === 'api' ? await apiTab($, e, k)
      : tab === 'accounts' ? await accountsTab($, e, k)
      : tab === 'openrouter' ? await openrouterTab($, e, k)
      : await stijlTab($, ui)

    const kies = (i: number) => async () => {
      const t = TABS[i]!
      await update($, tabAtom, () => t)
      if ((t === 'slots' || t === 'overzicht') && !(await oud($)).slots) await startSlotsTicker($)
      if (t === 'api') await verversApi($)
      if (t === 'connectors') await openConnectors($)
      if (t === 'accounts') await openAccounts($)
      if (t === 'openrouter') await openOpenrouter($)
    }

    return (
      <Box flexDirection="column" gap={1} paddingX={1}>
        {tabs(ui, TABS, TABS.indexOf(tab), kies)}
        {inhoud}
      </Box>
    )
    } catch (err) {
      failOpen($, err)
      return next(e)
    }
  })
}
