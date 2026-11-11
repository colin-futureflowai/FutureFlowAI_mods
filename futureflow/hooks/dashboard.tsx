import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register, RenderElement } from 'claude-code'

import type { DashboardTab, MinifyTeller, SlotsSnapshot } from '../types'

import { accountsBron, openAccounts } from './accounts'
import { apiBron, leesTakenlijst, takenlijstStand, verversApi, zetTakenlijst } from './api'
import { controleerStandaardModel } from './herstart'
import { connectorsTab, openConnectors } from './connectors'
import { failOpen, oud } from './ctx'
import { minifyTab, niveauLezen } from './minify'
import { openOpenrouter, orBron } from './openrouter'
import { openDashboard, PANE, TABS, tabVan } from './paneel'
import { kaart, knop, knoppen, leeg, meerKnop, paneelVan, raster, stat, tabs, uitleg, vinkje } from './paneel-ui'
import type { Paneel, PaneelKleuren } from './paneel-ui'
import { actieveKleuren, openSkinSettings, setSkinPrefs, skinPrefs } from './skins/register'
import { slotsTab, startSlotsTicker } from './slots'
import { nuOpTekst, wisselKaart } from './wissel-kaart'
import { balkCommando, stappenRijen, voortgangLijst } from './voortgang'

import { limietenVan } from '../lib/api.mjs'
import { kpis } from '../lib/overzicht.mjs'
import type { Kpi } from '../lib/overzicht.mjs'
import { palet } from '../lib/thema.mjs'

export { openDashboard }

const tabAtom = atom({ plugin: 'futureflow', key: 'dashboard.tab' } as const, null as DashboardTab | null)

const tellerAtom = atom({ plugin: 'futureflow', key: 'minify.teller' } as const, null as MinifyTeller | null)
const snapshotAtom = atom({ plugin: 'futureflow', key: 'slots.snapshot' } as const, null as SlotsSnapshot | null)
// Per tab of Meer ▸ open staat; ingeklapt is de standaard.
const meerAtom = atom({ plugin: 'futureflow', key: 'dashboard.meer' } as const, null as Record<string, boolean> | null)

const NAMEN: Record<DashboardTab, string> = {
  overzicht: 'Overzicht',
  wisselen: 'Wisselen',
  zuinig: 'Zuinig',
  instellingen: 'Instellingen',
}

// Start van het dashboard; register.tsx roept dit aan vanuit zijn ene session.start.
export async function startDashboard($: Engine): Promise<void> {
  try {
    await $.command.register({ name: 'futureflow', description: 'Dashboard van FutureFlowAI: overzicht, wisselen, zuinig, instellingen' })
  } catch (err) {
    failOpen($, err)
  }
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')

// Kerncijfers als één Svg (desktop), drie per rij.
function kaartenSvg(lijst: Kpi[], p: ReturnType<typeof palet>): string {
  const b = 190, h = 104, gat = 12, per = 3
  const kleur = (k: Kpi) => (k.toon === 'oranje' ? p.oranje : k.toon === 'mut' ? p.mut : p.groen)
  const kaart = (k: Kpi, n: number) => {
    const x = (n % per) * (b + gat)
    const y = Math.floor(n / per) * (h + gat)
    const balk = k.fractie === undefined ? '' :
      `<rect x="${x + 14}" y="${y + h - 14}" width="${b - 28}" height="4" rx="2" fill="${p.lijn}"/><rect x="${x + 14}" y="${y + h - 14}" width="${Math.max(0, Math.min(1, k.fractie)) * (b - 28)}" height="4" rx="2" fill="${kleur(k)}"/>`
    return `<rect x="${x}" y="${y}" width="${b}" height="${h}" rx="10" fill="${p.vlak}" stroke="${p.lijn}"/>` +
      `<text x="${x + 14}" y="${y + 24}" font-size="11" fill="${p.mut}">${esc(k.titel)}</text>` +
      `<text x="${x + 14}" y="${y + 55}" font-size="28" font-weight="600" fill="${k.toon === 'mut' ? p.mut : k.toon === 'oranje' ? p.oranje : p.inkt}">${esc(k.waarde)}</text>` +
      `<text x="${x + 14}" y="${y + 76}" font-size="11" fill="${p.mut}">${esc(k.sub)}</text>${balk}`
  }
  const kol = Math.min(per, lijst.length)
  const rijen = Math.ceil(lijst.length / per)
  const breed = kol * b + (kol - 1) * gat
  const hoog = rijen * h + (rijen - 1) * gat
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${breed}" height="${hoog}" viewBox="0 0 ${breed} ${hoog}" font-family="-apple-system, 'Segoe UI', sans-serif">${lijst.map(kaart).join('')}</svg>`
}

// Verbruik van een venster (5u of 7d) als kerncijfer; zonder meting gedimd.
function verbruikKpi(label: '5u' | '7d', limieten: Array<{ label: string; percent: number }>): Kpi {
  const l = limieten.find(x => x.label.startsWith(label))
  const titel = `Verbruik ${label}`
  if (!l) return { titel, waarde: '–', sub: 'nog niet gemeten', toon: 'mut' }
  const pct = Math.round(l.percent)
  return { titel, waarde: `${pct}%`, sub: 'van dit venster', toon: pct >= 80 ? 'oranje' : 'groen', fractie: pct / 100 }
}

// Tab Overzicht: "Hoe staat het ervoor?" Alleen lezen, geen knoppen: waar je op werkt, verbruik,
// vrij geheugen, bespaarde tokens en de voortgang van de taak.
async function overzichtTab($: Engine, e: any, p: ReturnType<typeof palet>, ui: Paneel) {
  const el = ui.el
  const { Box, Text } = el
  const Svg = e.surface !== 'terminal' && 'Svg' in el ? el.Svg : undefined
  const teller = await read($, tellerAtom)
  const snapshot = await read($, snapshotAtom)
  const perNiveau = ((await $.store.get('minify.perNiveau')) ?? {}) as Record<string, { beurten: number; output: number }>
  const niveau = await niveauLezen($)
  let context: { gebruikt: number; max: number } | null = null
  let limieten: Array<{ label: string; percent: number }> = []
  try {
    const gebruik = await $.session.usage()
    if (gebruik.context.tokens && gebruik.context.window) context = { gebruikt: gebruik.context.tokens, max: gebruik.context.window }
    limieten = limietenVan(gebruik.rateLimits)
  } catch {
    context = null
  }
  const lijst = [verbruikKpi('5u', limieten), verbruikKpi('7d', limieten), ...kpis({ teller, perNiveau, niveau, snapshot, context })]
  const voortgang = await voortgangLijst($)
  let nuOp = ''
  try {
    nuOp = await nuOpTekst($)
  } catch {
    nuOp = ''
  }
  const kleur = (k: Kpi) => (k.toon === 'oranje' ? ui.k.warn : k.toon === 'mut' ? ui.k.mut : ui.k.accent)
  return (
    <Box flexDirection="column" gap={1}>
      {kaart(ui, 'Je werkt nu op', [
        <Text key="over-nu" bold color={ui.k.accent} wrap="wrap">{nuOp || 'onbekend'}</Text>,
        uitleg(ui, 'Kiezen en wisselen doe je in tab 2.', 'over-nu-uitleg'),
      ])}
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

// Eén onderdeel van een tab tekenen; faalt het, dan alleen dat onderdeel een regel (de rest blijft staan).
async function deel<T>($: Engine, ui: Paneel, naam: string, maak: () => Promise<T>, leegWaarde: T): Promise<T | RenderElement> {
  try {
    return await maak()
  } catch (err) {
    failOpen($, err)
    return leegWaarde ?? leeg(ui, `${naam} laden lukte niet; de fout staat in het logboek van de mod.`)
  }
}

// Tab Wisselen: "Waarop werk ik?" Bovenaan Automatisch wisselen, dan één lijst Bronnen met per bron
// de stand en één knop Gebruik nu; de rest onder Meer ▸.
async function wisselenTab($: Engine, e: any, k: PaneelKleuren, ui: Paneel, meer: boolean) {
  const { Box } = ui.el
  const wissel = await wisselKaart($, e, k, meer)
  const acc = await accountsBron($, e, k, meer)
  const api = await apiBron($, e, k, meer)
  const or = await orBron($, e, k, meer)
  return (
    <Box flexDirection="column" gap={1}>
      {wissel}
      {kaart(ui, 'Bronnen', [
        ...api.abonnement,
        ...acc.rijen,
        ...api.rijen,
        ...or.rijen,
      ], { knoppen: knoppen(ui, acc.knoppen) })}
      {[...or.kaarten, ...acc.kaarten, ...api.kaarten] as any}
    </Box>
  )
}

// Tab Zuinig: "Wat beschermt mijn Mac en tokens?" Slots en Minify; details onder Meer ▸.
async function zuinigTab($: Engine, e: any, meer: boolean) {
  const { Box } = $.ui.resolve(e)
  return (
    <Box flexDirection="column" gap={1}>
      {await deel($, paneelVan($.ui.resolve(e), e, await actieveKleuren($)), 'Slots', () => slotsTab($, e, meer), null)}
      {await deel($, paneelVan($.ui.resolve(e), e, await actieveKleuren($)), 'Minify', () => minifyTab($, e, meer), null)}
    </Box>
  )
}

// Tab Instellingen: stijl en connectors.
async function instellingenTab($: Engine, e: any, ui: Paneel) {
  const { Box } = ui.el
  return (
    <Box flexDirection="column" gap={1}>
      {await deel($, ui, 'Stijl', () => stijlTab($, ui), null)}
      {await deel($, ui, 'Connectors', () => connectorsTab($, e), null)}
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

// Wat er bij het kiezen van een tab gelezen of gestart moet worden (alleen vanuit onPress en commando's).
async function bijOpenen($: Engine, t: DashboardTab): Promise<void> {
  // Staat er een OpenRouter-model als standaard in ~/.claude/settings.json? (/model → Enter in claude-or)
  await controleerStandaardModel($)
  if ((t === 'zuinig' || t === 'overzicht') && !(await oud($)).slots) await startSlotsTicker($)
  if (t === 'wisselen') {
    await verversApi($)
    await openAccounts($)
    await openOpenrouter($)
  }
  if (t === 'instellingen') {
    await openConnectors($)
    await leesTakenlijst($)
  }
}

export const registerDashboard = (on: Parameters<Register>[0]): void => {
  on('command.run', { command: 'futureflow' }, async ($, e) => {
    try {
      const woorden = (e.args ?? '').trim().toLowerCase().split(/\s+/)
      const woord = woorden[0] ?? ''
      if (woord === 'stijl' && woorden[1]) return await stijlCommando($, woorden[1])
      if (woord === 'balk') return await balkCommando($)
      const tab = woord ? tabVan(woord) : null
      if (woord && !tab) {
        return { text: `Onbekende tab "${woord}". Gebruik: /futureflow ${TABS.join('|')}` }
      }
      // Ook zonder tabnaam: de tab die open komt (de laatst gekozen) leest wat hij nodig heeft.
      await bijOpenen($, tab ?? tabVan(await read($, tabAtom)) ?? 'overzicht')
      await openDashboard($, tab ?? undefined)
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
    // Een bewaarde oude tabnaam (tot 0.8) wijst naar de nieuwe tab.
    const tab = tabVan(await read($, tabAtom)) ?? 'overzicht'
    const meerStand = (await read($, meerAtom)) ?? {}
    const meer = meerStand[tab] === true
    const modus = (await skinPrefs($)).isLight ? 'licht' : 'donker'
    const p = palet(modus)
    const k = await actieveKleuren($)
    const ui = paneelVan(el, e, k)
    // Geen woordmerk bovenaan: de titel van het paneel zegt al FutureFlowAI. Het paneel begint met de tabs.
    const inhoud =
      tab === 'wisselen' ? await wisselenTab($, e, k, ui, meer)
      : tab === 'zuinig' ? await zuinigTab($, e, meer)
      : tab === 'instellingen' ? await instellingenTab($, e, ui)
      : await overzichtTab($, e, p, ui)

    const kies = (i: number) => async () => {
      const t = TABS[i]!
      await update($, tabAtom, () => t)
      await bijOpenen($, t)
    }
    const wisselMeer = async () => {
      await update($, meerAtom, m => ({ ...(m ?? {}), [tab]: !meer }))
    }
    const heeftMeer = tab === 'wisselen' || tab === 'zuinig'

    return (
      <Box flexDirection="column" gap={1} paddingX={1}>
        {tabs(ui, TABS, TABS.indexOf(tab), kies)}
        {inhoud}
        {heeftMeer ? meerKnop(ui, `meer-${tab}`, meer, wisselMeer) : ''}
      </Box>
    )
    } catch (err) {
      failOpen($, err)
      return next(e)
    }
  })
}
