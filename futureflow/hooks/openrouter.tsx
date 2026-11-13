import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, RenderElement } from 'claude-code'

import type { ApiStatus, OrModel, OrModellen } from '../types'

import { cli, foutVan, handmatig, laatsteJson, leesStatus, orKeuze, verversApi, volgKeuze, wissel } from './api'
import type { OrKeuze } from './api'
import type { Slot } from '../lib/openrouter.mjs'
import { failOpen } from './ctx'
import { herstartOpOr } from './herstart'
import { kaart, knop, knoppen, leeg, paneelVan, uitleg } from './paneel-ui'

import { kostenOverzicht, usd } from '../lib/api.mjs'
import { CACHE_ZWAK_TEKST, cacheMetingen, cacheStand, contextTekst, geldigeOrKey, geldigModel, isClaude, modelIdVoor, modellenVan, POORT_REDEN, poortOordeel, prijsTekst, SLOT_UITLEG, SLOTS, sorteer, START, teKlein, TOON } from '../lib/openrouter.mjs'

// Tab OpenRouter: Claude Code op een ander model via OpenRouter, alleen in sessies die met `claude-or`
// starten (eigen settings-bestand; ~/.claude/settings.json blijft van het abonnement, sinds 0.9.0).
// Key in de macOS-sleutelhanger (alleen via stdin naar cli/api.mjs), modellen kiezen uit de lijst
// van OpenRouter en klaarzetten. De ketting (wissel-kaart.tsx) wisselt nooit naar OpenRouter: hij meldt
// alleen dat je met `claude-or` verder kunt.
// Alles buiten de plugin gaat via cli/api.mjs; de key komt nooit in state, store, log of toast.

// Dezelfde atom als in hooks/api.tsx (de hooks-module leest ze statisch per bestand).
const statusAtom = atom({ plugin: 'futureflow', key: 'api.status' } as const, null as ApiStatus | null)
const modellenAtom = atom({ plugin: 'futureflow', key: 'openrouter.modellen' } as const, null as OrModellen | null)
const zoekAtom = atom({ plugin: 'futureflow', key: 'openrouter.zoek' } as const, '')
// Welke pagina van de modellenlijst open staat (0 = eerste).
const paginaAtom = atom({ plugin: 'futureflow', key: 'openrouter.pagina' } as const, 0)
const versieAtom = atom({ plugin: 'futureflow', key: 'openrouter.versie' } as const, 0)
// Voor welke rij (Model 1-5) de modellenlijst open staat; null = dicht.
const kiesAtom = atom({ plugin: 'futureflow', key: 'openrouter.kiesVoor' } as const, null as Slot | null)
const testAtom = atom({ plugin: 'futureflow', key: 'openrouter.test' } as const, null as string | null)
// Meet cache: voortgang of de laatste fout; de uitslagen zelf staan in store `openrouter.cache`.
const cacheAtom = atom({ plugin: 'futureflow', key: 'openrouter.cacheStand' } as const, null as string | null)
const CACHE_UITLEG = 'Meet cache stuurt per gekozen model zes kleine aanvragen (ongeveer 50k tokens, enkele centen tot een dubbeltje) en telt in hoeveel rondes de cache raakte. Een nieuw gekozen model wordt één keer vanzelf gemeten. Aanbieders missen soms een ronde, dus een uitslag kan per meting iets verschillen.'

type Kleuren = { accent: string; mut: string; fg: string; ok: string; warn: string; err: string }

const WAARSCHUWINGEN = [
  'Niet-Claude-modellen werken niet gegarandeerd in Claude Code: tools, denken en caching verschillen per model.',
  'Webzoeken werkt niet via OpenRouter.',
  `Start een OpenRouter-sessie met ${START}; andere sessies en de desktop-app blijven op je abonnement.`,
  'Modellen met minder dan 200k context zijn te klein voor Claude Code: de context loopt dan snel vol en /compact faalt.',
  'Op OpenRouter laadt Claude Code de claude.ai-connectors niet.',
]
const INVOER_UITLEG = 'Wat je typt is zichtbaar tot je op Enter drukt; daarna bewaart futureflow alleen de laatste 4 tekens in beeld.'
const FOUTE_KEY = 'Dat is geen OpenRouter-key (die begint met sk-or-); niets opgeslagen.'

// Eén lading tegelijk.
let laadt = false

async function hertekenen($: Engine): Promise<void> {
  await update($, versieAtom, n => (n ?? 0) + 1)
}

// Leest de modellijst via de CLI (cache 6 u; `ververs` = de knop) en zet hem in de atom.
async function laadModellen($: Engine, ververs: boolean): Promise<void> {
  if (laadt) return
  laadt = true
  try {
    const r = await cli($, ['openrouter', 'modellen', ...(ververs ? ['--ververs'] : [])])
    if (r.exitCode !== 0) {
      const oud = await read($, modellenAtom)
      await update($, modellenAtom, () => ({ modellen: oud?.modellen ?? [], fout: foutVan(r) }))
      return
    }
    const d = laatsteJson(r.stdout)
    await update($, modellenAtom, () => ({
      modellen: modellenVan(d.modellen),
      ...(typeof d.opgehaald === 'number' ? { opgehaald: d.opgehaald } : {}),
      uitCache: d.uitCache === true,
      ...(typeof d.fout === 'string' ? { fout: d.fout.slice(0, 200) } : {}),
    }))
  } catch (err) {
    failOpen($, err)
  } finally {
    laadt = false
  }
}

// Bij openen van de tab: status opnieuw en de lijst (los, zodat het commando niet wacht).
export async function openOpenrouter($: Engine): Promise<void> {
  const status = await verversApi($)
  // 0.17.0: keuze gelijk aan het settings-bestand (de proxy-pagina kiest ook), niet midden in een meting.
  if (!((await read($, cacheAtom)) ?? '').startsWith('Cache meten')) await volgKeuze($, status)
  void laadModellen($, false).catch(err => failOpen($, err))
}

// ---- acties (alleen in onPress/onSubmit) ----

async function bewaarKey($: Engine, invoer: string): Promise<void> {
  try {
    const key = invoer.trim()
    if (!geldigeOrKey(key)) {
      $.ui.toast(FOUTE_KEY)
      return
    }
    const r = await cli($, ['openrouter', 'zet-key'], key)
    if (r.exitCode !== 0) $.ui.toast(`Key niet bewaard: ${foutVan(r)}`)
    else $.ui.toast('OpenRouter-key bewaard in de sleutelhanger.')
    await verversApi($)
  } catch (err) {
    failOpen($, err)
  } finally {
    await hertekenen($).catch(() => undefined)
  }
}

async function wisKey($: Engine): Promise<void> {
  try {
    const status = (await read($, statusAtom)) ?? (await leesStatus($))
    const r = await cli($, ['openrouter', 'wis-key'])
    if (r.exitCode !== 0) $.ui.toast(`Key niet gewist: ${foutVan(r)}`)
    else $.ui.toast(laatsteJson(r.stdout).gewist ? 'OpenRouter-key gewist uit de sleutelhanger.' : 'Er stond geen OpenRouter-key in de sleutelhanger.')
    await verversApi($)
  } catch (err) {
    failOpen($, err)
  }
}

// Model 1 t/m 5 (0.13.0): "Kies" bij een rij opent de modellenlijst voor die rij (atom
// `openrouter.kiesVoor`); een model kiezen zet het (met `[1m]` bij ≥ 1M context) in die rij, bewaart
// zijn prijzen en context (kosten, waarschuwing) en sluit de lijst. Staat claude-or al klaar, dan meteen
// in het eigen bestand.
async function kies($: Engine, slot: Slot, m: OrModel): Promise<void> {
  try {
    const id = modelIdVoor(m)
    if (!id || !geldigModel(id)) return
    if (teKlein(m)) $.ui.toast(`Let op: ${m.id} heeft ${contextTekst(m.context)} context; dat is te klein voor Claude Code.`)
    const cache = cacheStand(m, cacheMetingen(await $.store.get('openrouter.cache')))
    if (cache?.oordeel === 'zwak') $.ui.toast(`Let op: ${m.id} ${cache.tekst}. ${START} start niet met dit model.`)
    await $.store.set('openrouter.keuze', { ...(await orKeuze($)), [slot]: id })
    // Nog geen meting: eerst meten; claude-or krijgt het model pas na een goede uitslag (zie meetModellen).
    void meetBijKiezen($, m.id).catch(err => failOpen($, err))
    const prijzen = ((await $.store.get('openrouter.prijzen')) ?? {}) as Record<string, { in?: number; uit?: number }>
    const prijs = { ...(m.in !== undefined ? { in: m.in } : {}), ...(m.uit !== undefined ? { uit: m.uit } : {}), ...(m.context !== undefined ? { ctx: m.context } : {}) }
    await $.store.set('openrouter.prijzen', { ...prijzen, [m.id]: prijs, [id]: prijs })
    await update($, kiesAtom, () => null)
    await zetOpnieuw($)
  } catch (err) {
    failOpen($, err)
  } finally {
    await hertekenen($).catch(() => undefined)
  }
}

// Een rij leeg maken (niet Model 1): 2-4 vallen dan terug op 1, 5 verdwijnt uit /model.
async function maakLeeg($: Engine, slot: Slot): Promise<void> {
  try {
    const nieuw: OrKeuze = { ...(await orKeuze($)) }
    delete nieuw[slot]
    await $.store.set('openrouter.keuze', nieuw)
    await update($, kiesAtom, () => null)
    await zetOpnieuw($)
  } catch (err) {
    failOpen($, err)
  } finally {
    await hertekenen($).catch(() => undefined)
  }
}

// Startcheck (0.15.0): mag claude-or starten met de gekozen modellen? Elk model moet gemeten zijn en cachen.
async function poortVan($: Engine) {
  const k = await orKeuze($)
  return poortOordeel(SLOTS.map(s => k[s]), cacheMetingen(await $.store.get('openrouter.cache')))
}

// Staat claude-or al klaar, dan de nieuwe keuze meteen in het eigen bestand; niet zolang de startcheck
// een model weigert (de CLI zou weigeren; de kaart zegt waarom).
async function zetOpnieuw($: Engine): Promise<void> {
  const status = (await read($, statusAtom)) ?? (await leesStatus($))
  if (status.orKlaar && (await orKeuze($)).m1 && (await poortVan($)).ok) await wissel($, 'openrouter', 'nieuw model')
}

async function openKies($: Engine, slot: Slot | null): Promise<void> {
  await update($, kiesAtom, v => (v === slot ? null : slot))
  if (slot !== null) void laadModellen($, false).catch(err => failOpen($, err))
}

async function testVerbinding($: Engine): Promise<void> {
  try {
    const k = await orKeuze($)
    const model = k.m4 ?? k.m1
    if (!model) {
      $.ui.toast('Kies eerst een model; de test stuurt één kleine aanvraag naar dat model.')
      return
    }
    await update($, testAtom, () => 'Bezig met testen…')
    const r = await cli($, ['openrouter', 'test', '--model', model])
    let regel: string
    if (r.exitCode !== 0) regel = `Test niet gelukt: ${foutVan(r)}`
    else {
      const d = laatsteJson(r.stdout)
      regel = d.ok === true
        ? `Verbinding werkt (${model}).`
        : `Verbinding werkt niet${typeof d.status === 'number' ? ` (HTTP ${d.status})` : ''}: ${String(d.fout ?? 'onbekende fout').slice(0, 160)}`
    }
    await update($, testAtom, () => regel)
  } catch (err) {
    failOpen($, err)
  }
}

// Eén meting tegelijk; wat erbij komt wacht in de rij.
let meet = false
const rij: string[] = []

// Meet de cache van de modellen in `ids` (zonder [1m]): per model `openrouter cachetest` (zes kleine
// aanvragen als agent-lus), na elkaar. Loopt los van de klik (tot ~1 min per model); elke uitslag gaat
// naar store `openrouter.cache` en de kaart tekent opnieuw. Loopt er al een meting, dan sluiten de
// modellen achteraan in de rij.
async function meetModellen($: Engine, ids: string[]): Promise<void> {
  for (const id of ids) if (!rij.includes(id)) rij.push(id)
  if (meet || !rij.length) return
  meet = true
  await update($, cacheAtom, () => `Cache meten: ${rij[0]}…`)
  void (async () => {
    const fouten: string[] = []
    try {
      while (rij.length) {
        const id = rij[0]
        await update($, cacheAtom, () => `Cache meten: ${id}${rij.length > 1 ? ` (nog ${rij.length - 1} daarna)` : ''}…`)
        const r = await cli($, ['openrouter', 'cachetest', '--model', id], undefined, 240_000)
        rij.shift()
        const d = r.exitCode === 0 ? laatsteJson(r.stdout) : undefined
        if (d?.ok === true && ['goed', 'wisselend', 'zwak'].includes(d.oordeel)) {
          const oud = cacheMetingen(await $.store.get('openrouter.cache'))
          await $.store.set('openrouter.cache', { ...oud, [id]: { oordeel: d.oordeel, aandeel: Number(d.aandeel) || 0, raak: Number(d.raak) || 0, van: Number(d.van) || 0, gemeten: await $.clock.now() } })
          if (d.oordeel === 'zwak') $.ui.toast(`Let op: ${id} ${CACHE_ZWAK_TEKST}. ${START} start niet met dit model.`)
          // Nu gemeten: een klaarstaande claude-or krijgt de keuze alsnog (als de startcheck het toelaat).
          else await zetOpnieuw($)
          await hertekenen($)
        } else {
          fouten.push(`${id}: ${r.exitCode !== 0 ? foutVan(r) : String(d?.fout ?? 'geen uitslag').slice(0, 120)}`)
        }
      }
    } finally {
      meet = false
      rij.length = 0
      await update($, cacheAtom, () => (fouten.length ? `Cache niet gemeten: ${fouten.join('; ')}` : null))
    }
  })().catch(err => failOpen($, err))
}

// Knop Logboek (0.16.0): de pagina van de proxy in de browser; zonder terminal of bij een fout een toast
// met het adres. Het adres komt uit de status-atom (tekenen start geen CLI).
async function openLogboek($: Engine): Promise<void> {
  try {
    const status = (await read($, statusAtom)) ?? (await leesStatus($))
    const url = status.orLogboek
    if (!url) {
      $.ui.toast('Geen logboek: claude-or loopt nog niet via de proxy. Klik Gebruik nu.')
      return
    }
    let terminal = false
    try {
      terminal = (await $.session.surfaces()).includes('terminal')
    } catch {
      terminal = false
    }
    if (!terminal) {
      $.ui.toast(`Logboek: ${url}`)
      return
    }
    const r = await $.process.run(['/usr/bin/open', url], { timeoutMs: 10_000 }).catch(() => null)
    if (!r || r.exitCode !== 0) $.ui.toast(`Logboek: ${url}`)
  } catch (err) {
    failOpen($, err)
  }
}

// Knop Meet cache: alle gekozen modellen opnieuw.
async function meetCache($: Engine): Promise<void> {
  try {
    const k = await orKeuze($)
    const ids = [...new Set(SLOTS.map(s => kaal(k[s])).filter(Boolean))]
    if (!ids.length) {
      $.ui.toast('Kies eerst een model; de meting stuurt zes kleine aanvragen per gekozen model.')
      return
    }
    await meetModellen($, ids)
  } catch (err) {
    failOpen($, err)
  }
}

// Bij het kiezen van een model: meteen meten als er een key is en dit model nog geen meting heeft.
// Eén keer per model, want het kost tokens; opnieuw meten kan met de knop.
async function meetBijKiezen($: Engine, id: string): Promise<void> {
  const status = await read($, statusAtom)
  if (!status?.orHeeftKey) return
  if (cacheMetingen(await $.store.get('openrouter.cache'))[id]) return
  await meetModellen($, [id])
}

async function zoek($: Engine, tekst: string): Promise<void> {
  await update($, zoekAtom, () => tekst.trim().slice(0, 60))
  await update($, paginaAtom, () => 0)
}

async function blader($: Engine, stap: number, laatste: number): Promise<void> {
  await update($, paginaAtom, p => Math.min(laatste, Math.max(0, p + stap)))
}

// ---- tekenen ----

const kaal = (id: string | undefined) => (id ?? '').replace(/\[1m\]$/, '')

function regelVan(ui: ReturnType<typeof paneelVan>, $: Engine, m: OrModel, i: number, keuze: OrKeuze, slot: Slot, metingen: ReturnType<typeof cacheMetingen>) {
  const { Box, Text } = ui.el
  const hier = kaal(keuze[slot]) === m.id
  const elders = SLOTS.filter(s => s !== slot && kaal(keuze[s]) === m.id).map(s => s.slice(1))
  return (
    <Box key={`or-regel-${i}`} flexDirection="row" flexWrap="wrap" columnGap={1}>
      <Text bold={hier} color={hier ? ui.k.accent : ui.k.fg} wrap="truncate-end">{m.id}</Text>
      <Text color={ui.k.mut} wrap="wrap">{`${contextTekst(m.context)} · ${prijsTekst(m.in)} in / ${prijsTekst(m.uit)} uit per Mtok${elders.length ? ` · nu model ${elders.join(', ')}` : ''}`}</Text>
      {teKlein(m) ? <Text color={ui.k.err} wrap="wrap">te klein voor Claude Code</Text> : ''}
      {cacheStand(m, metingen)?.oordeel === 'zwak' ? <Text color={ui.k.warn} wrap="wrap">{cacheStand(m, metingen)?.tekst}</Text> : ''}
      {knop(ui, `or-kies-${i}`, hier ? '● Gekozen' : 'Kies', () => kies($, slot, m), { primary: hier })}
    </Box>
  )
}

// Onderdeel van de lijst Bronnen in de tab Wisselen: OpenRouter, met daaronder de kaart Modellen.
// Tekent alleen; schrijven gebeurt in onPress/onSubmit.
// `meer`: ook zoeken, bladeren, verversen, Test verbinding, Key wissen, kosten en waarschuwingen (Meer ▸).
export async function orBron($: Engine, e: any, k: Kleuren, meer = true): Promise<{ rijen: RenderElement[]; kaarten: RenderElement[] }> {
  const el = $.ui.resolve(e)
  const { Box, Text, Input } = el
  try {
    await read($, versieAtom) // opnieuw tekenen na een actie
    const ui = paneelVan(el, e, k)
    const status = (await read($, statusAtom)) ?? (await leesStatus($))
    const lijst = await read($, modellenAtom)
    const test = await read($, testAtom)
    const cacheRegel = await read($, cacheAtom)
    const metingen = cacheMetingen(await $.store.get('openrouter.cache'))
    const keuze = await orKeuze($)
    const geld = kostenOverzicht((await $.store.get('openrouter.kosten')) as Record<string, number> | undefined, await $.clock.now())
    const klaar = status.orKlaar === true
    const kiesVoor = await read($, kiesAtom)
    // Alle gekozen modellen: de waarschuwingen gelden per rij.
    const ids = SLOTS.map(s => kaal(keuze[s])).filter(Boolean)
    const gekozen = (lijst?.modellen ?? []).filter(m => ids.includes(m.id))
    // Wat claude-or nu per rij gebruikt, tegen de keuze (lege 2-4 = Model 1, lege 5 = niets).
    const effectief = (s: Slot) => (s === 'm5' ? keuze.m5 : keuze[s] ?? keuze.m1)
    const nuIn: Record<Slot, string | undefined> = { m1: status.orM1, m2: status.orM2, m3: status.orM3, m4: status.orM4, m5: status.orM5 }
    const anders = klaar && SLOTS.some(s => nuIn[s] !== effectief(s))
    const toonLijst = kiesVoor !== null || meer
    const zoekTekst = toonLijst ? await read($, zoekAtom) : ''

    const gevonden = sorteer(lijst?.modellen ?? [], zoekTekst)
    const paginas = Math.max(1, Math.ceil(gevonden.length / TOON))
    const pagina = toonLijst ? Math.min(paginas - 1, Math.max(0, await read($, paginaAtom))) : 0
    const getoond = gevonden.slice(pagina * TOON, (pagina + 1) * TOON)
    const claude = getoond.filter(m => isClaude(m.id))
    const andere = getoond.filter(m => !isClaude(m.id))
    const index = (m: OrModel) => getoond.indexOf(m)

    const rijen: RenderElement[] = [
      <Box key="or-bron" flexDirection="column" marginTop={1}>
        <Text wrap="truncate-end">
          <Text color={klaar ? k.accent : k.fg}>{klaar ? '● ' : '○ '}</Text>
          <Text bold color={klaar ? k.accent : k.fg}>OpenRouter</Text>
          <Text color={k.mut}>{klaar ? `  · klaar: start met ${START}` : `  · alleen via ${START}`}</Text>
        </Text>
        {uitleg(ui, `Start een OpenRouter-sessie met ${START}; andere sessies en de desktop-app blijven op je abonnement.`, 'or-start-uitleg')}
        {uitleg(ui, `In ${START}: kies een model in /model met s (alleen deze sessie), niet Enter.`, 'or-model-tip')}
        <Text wrap="truncate-end">
          <Text color={k.mut}>{'  Key: '}</Text>
          {status.orHeeftKey ? <Text>{`sk-or-…${status.orStaart ?? ''}`}</Text> : <Text color={k.mut}>geen key</Text>}
        </Text>
        {SLOTS.map((s, n) => (
          <Box key={`or-rij-${s}`} flexDirection="column" paddingLeft={2}>
            <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
              <Text bold color={kiesVoor === s ? k.accent : k.fg}>{`Model ${n + 1}`}</Text>
              <Text color={keuze[s] ? k.fg : k.mut} wrap="truncate-end">{keuze[s] ?? '—'}</Text>
              {knop(ui, `or-model-${n + 1}`, kiesVoor === s ? '● Kies' : 'Kies', () => openKies($, s))}
            </Box>
            {uitleg(ui, `${n + 1} · ${SLOT_UITLEG[s]}${!keuze[s] && s !== 'm1' && s !== 'm5' && keuze.m1 ? ' (leeg: Model 1)' : ''}`, `or-rij-uitleg-${s}`)}
          </Box>
        ))}
        {anders ? (
          <Text color={k.warn} wrap="wrap">{START} gebruikt nog de vorige modellen; klik Gebruik nu om je keuze te gebruiken.</Text>
        ) : ''}
        {klaar && !status.orOpPad ? (
          <Text color={k.warn} wrap="wrap">~/.local/bin staat niet op je PATH: start met ~/.local/bin/{START}.</Text>
        ) : ''}
        {gekozen.filter(m => teKlein(m)).map(m => (
          <Text key={`or-klein-${m.id}`} color={k.err} wrap="truncate-end">{m.id} heeft {contextTekst(m.context)} context: te klein voor Claude Code.</Text>
        ))}
        {[...new Set(ids)].map(id => ({ id, s: cacheStand({ id }, metingen) })).map(({ id, s }) => (s ? (
          <Text key={`or-cache-${id}`} color={s.oordeel === 'goed' ? k.ok : s.oordeel === 'wisselend' || s.aandeel === undefined ? k.warn : k.err} wrap="wrap">
            {`${id} ${s.tekst}${s.aandeel === undefined ? '' : ` (gemeten: ${s.raak} van ${s.van} rondes raak, ${s.aandeel}% uit cache)`}.`}
          </Text>
        ) : ''))}
        {(() => {
          // Startcheck: waarom claude-or niet start met deze keuze.
          const p = poortOordeel(ids, metingen)
          if (p.ok) return ''
          const bezig = (cacheRegel ?? '').startsWith('Cache meten')
          return (
            <Text key="or-poort" color={k.err} wrap="wrap">
              {`${START} start niet met deze keuze: ${p.redenen.map(r => `${r.id} ${POORT_REDEN[r.reden]}`).join('; ')}. ${
                p.redenen.some(r => r.reden === 'zwak') ? 'Kies een ander model.' : bezig ? 'De meting loopt.' : status.orHeeftKey ? 'Klik Meet cache (onder Meer).' : 'Bewaar eerst een key; daarna meet futureflow het model.'
              }`}
            </Text>
          )
        })()}
        {(() => {
          // 0.17.0: de proxy stopte een model (cache.json zwak); niet als de startcheck-regel het al zegt.
          const alGezegd = new Set(poortOordeel(ids, metingen).redenen.filter(r => r.reden === 'zwak').map(r => r.id))
          const gestopt = (status.orGestopt ?? []).filter(id => !alGezegd.has(kaal(id) ?? id))
          return gestopt.length ? (
            <Text key="or-gestopt" color={k.err} wrap="wrap">{`${gestopt.join(', ')} cachet niet in ${START} en is gestopt om kosten te voorkomen. Kies een ander model of meet opnieuw.`}</Text>
          ) : ''
        })()}
        {cacheRegel ? <Text color={cacheRegel.startsWith('Cache meten') ? k.mut : k.err} wrap="wrap">{cacheRegel}</Text> : ''}
        {status.oudeOr ? <Text color={k.warn} wrap="wrap">In ~/.claude/settings.json staan nog oude OpenRouter-regels; futureflow haalt ze bij de volgende sessiestart weg.</Text> : ''}
        {test ? <Text color={test.startsWith('Verbinding werkt (') ? k.ok : test.startsWith('Bezig') ? k.mut : k.err} wrap="wrap">{test}</Text> : ''}
        {!status.orHeeftKey || meer ? (
          <Input key="or-key" label="Key " placeholder="sk-or-…" value="" submitLabel="bewaar" onSubmit={(waarde: string) => bewaarKey($, waarde)} />
        ) : ''}
        {!status.orHeeftKey || meer ? uitleg(ui, INVOER_UITLEG, 'or-invoer-uitleg') : ''}
        {(
          <Box flexDirection="row" flexWrap="wrap" columnGap={1} paddingLeft={2}>
            {klaar && !anders ? '' : knop(ui, 'or-naar', 'Gebruik nu', () => handmatig($, 'openrouter'))}
            {klaar && !anders ? knop(ui, 'or-herstart', 'Herstart op OpenRouter', () => herstartOpOr($)) : ''}
            {meer && status.orHeeftKey ? knop(ui, 'or-test', 'Test verbinding', () => testVerbinding($)) : ''}
            {meer && status.orHeeftKey ? knop(ui, 'or-cache', 'Meet cache', () => meetCache($)) : ''}
            {meer && status.orHeeftKey ? knop(ui, 'or-wis', 'Key wissen', () => wisKey($)) : ''}
            {meer && status.orProxy ? knop(ui, 'or-logboek', 'Proxy', () => openLogboek($)) : ''}
          </Box>
        )}
        {meer && status.orProxy ? uitleg(ui, 'Proxy: modellen kiezen, aanvragen en cache', 'or-logboek-uitleg') : ''}
        {meer && status.orHeeftKey ? uitleg(ui, CACHE_UITLEG, 'or-cache-uitleg') : ''}
      </Box>,
    ]

    const kaarten: RenderElement[] = []
    if (toonLijst) {
      const slot: Slot = kiesVoor ?? 'm1'
      const nr = SLOTS.indexOf(slot) + 1
      kaarten.push(kaart(ui, kiesVoor ? `Kies Model ${nr}` : 'OpenRouter-modellen', [
        <Input key="or-zoek" label="Zoek " placeholder="naam of id" value={zoekTekst} submitLabel="zoek" onSubmit={(waarde: string) => zoek($, waarde)} />,
        lijst === null ? leeg(ui, 'Lijst laden…') : '',
        lijst?.fout ? <Text color={k.err} wrap="wrap">{lijst.fout}</Text> : '',
        lijst !== null && !gevonden.length && !lijst.fout ? leeg(ui, 'Geen model gevonden.') : '',
        claude.length ? <Text key="or-groep-claude" bold color={k.mut}>Claude via OpenRouter</Text> : '',
        ...claude.map(m => regelVan(ui, $, m, index(m), keuze, slot, metingen)),
        andere.length ? <Text key="or-groep-andere" bold color={k.mut}>Andere modellen</Text> : '',
        ...andere.map(m => regelVan(ui, $, m, index(m), keuze, slot, metingen)),
        paginas > 1 ? uitleg(ui, `Pagina ${pagina + 1} van ${paginas} · ${gevonden.length} modellen`, 'or-meer') : '',
        paginas > 1 ? knoppen(ui, [
          pagina > 0 ? knop(ui, 'or-vorige', '◂ Vorige', () => blader($, -1, paginas - 1), { hotkey: 'p' }) : null,
          pagina < paginas - 1 ? knop(ui, 'or-volgende', 'Volgende ▸', () => blader($, 1, paginas - 1), { hotkey: 'n' }) : null,
        ]) : '',
        uitleg(ui, 'Model 1 is verplicht: daarmee start een claude-or-sessie. Lege 2, 3 en 4 gebruiken Model 1; een lege 5 staat niet in /model. Alleen modellen die tools kunnen gebruiken.', 'or-rollen'),
      ], {
        rechts: lijst?.modellen.length ? `${lijst.modellen.length} met tools` : '',
        knoppen: knoppen(ui, [
          kiesVoor && kiesVoor !== 'm1' && keuze[kiesVoor] ? knop(ui, 'or-leeg', `Model ${nr} leeg`, () => maakLeeg($, kiesVoor)) : null,
          kiesVoor ? knop(ui, 'or-sluit', 'Sluiten', () => openKies($, null)) : null,
          knop(ui, 'or-ververs', 'Lijst verversen', () => laadModellen($, true)),
        ]),
      }))
    }
    if (meer) {
      kaarten.push(kaart(ui, 'OpenRouter: kosten en uitleg', [
        <Text key="or-kosten">
          <Text color={k.mut}>vandaag </Text>
          <Text bold>{usd(geld.vandaag)}</Text>
          <Text color={k.mut}>  ·  deze maand </Text>
          <Text bold>{usd(geld.maand)}</Text>
        </Text>,
        uitleg(ui, 'Schatting met de prijzen van het gekozen model; cache telt als gewone input. Geen harde stop.', 'or-kosten-uitleg'),
        <Box key="or-uitleg" flexDirection="column" marginTop={1}>
          {WAARSCHUWINGEN.map((regel, i) => uitleg(ui, regel, `or-uitleg-${i}`))}
        </Box>,
      ]))
    }
    return { rijen, kaarten }
  } catch (err) {
    failOpen($, err)
    return { rijen: [<Text key="or-kapot" dimColor>OpenRouter laden lukte niet; de fout staat in het logboek van de mod.</Text>], kaarten: [] }
  }
}
