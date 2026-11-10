import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, RenderElement } from 'claude-code'

import type { ApiStatus, OrModel, OrModellen } from '../types'

import { cli, foutVan, handmatig, laatsteJson, leesStatus, orKeuze, verversApi, wissel } from './api'
import { failOpen } from './ctx'
import { herstartOpOr } from './herstart'
import { kaart, knop, knoppen, leeg, paneelVan, uitleg } from './paneel-ui'

import { kostenOverzicht, usd } from '../lib/api.mjs'
import { contextTekst, geldigeOrKey, geldigModel, isClaude, modelIdVoor, modellenVan, prijsTekst, sorteer, START, teKlein, TOON } from '../lib/openrouter.mjs'

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
const testAtom = atom({ plugin: 'futureflow', key: 'openrouter.test' } as const, null as string | null)

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
  await verversApi($)
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

// Kiest het hoofd- of snelle model (met `[1m]` bij ≥ 1M context) en bewaart zijn prijzen (voor de
// kostenschatting). Staat claude-or al klaar, dan meteen de nieuwe modellen in het eigen bestand.
async function kies($: Engine, rol: 'model' | 'snel', m: OrModel): Promise<void> {
  try {
    const id = modelIdVoor(m)
    if (!id || !geldigModel(id)) return
    if (teKlein(m)) $.ui.toast(`Let op: ${m.id} heeft ${contextTekst(m.context)} context; dat is te klein voor Claude Code.`)
    const oud = await orKeuze($)
    await $.store.set('openrouter.keuze', { ...oud, [rol]: id })
    const prijzen = ((await $.store.get('openrouter.prijzen')) ?? {}) as Record<string, { in?: number; uit?: number }>
    const prijs = { ...(m.in !== undefined ? { in: m.in } : {}), ...(m.uit !== undefined ? { uit: m.uit } : {}), ...(m.context !== undefined ? { ctx: m.context } : {}) }
    await $.store.set('openrouter.prijzen', { ...prijzen, [m.id]: prijs, [id]: prijs })
    const status = (await read($, statusAtom)) ?? (await leesStatus($))
    const nu = await orKeuze($)
    if (status.orKlaar && nu.model && nu.snel) await wissel($, 'openrouter', 'nieuw model')
  } catch (err) {
    failOpen($, err)
  } finally {
    await hertekenen($).catch(() => undefined)
  }
}

async function testVerbinding($: Engine): Promise<void> {
  try {
    const k = await orKeuze($)
    const model = k.snel ?? k.model
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

async function zoek($: Engine, tekst: string): Promise<void> {
  await update($, zoekAtom, () => tekst.trim().slice(0, 60))
  await update($, paginaAtom, () => 0)
}

async function blader($: Engine, stap: number, laatste: number): Promise<void> {
  await update($, paginaAtom, p => Math.min(laatste, Math.max(0, p + stap)))
}

// ---- tekenen ----

const kaal = (id: string | undefined) => (id ?? '').replace(/\[1m\]$/, '')

function regelVan(ui: ReturnType<typeof paneelVan>, $: Engine, m: OrModel, i: number, keuze: { model?: string; snel?: string }) {
  const { Box, Text } = ui.el
  const hoofd = kaal(keuze.model) === m.id
  const snel = kaal(keuze.snel) === m.id
  return (
    <Box key={`or-regel-${i}`} flexDirection="row" flexWrap="wrap" columnGap={1}>
      <Text bold={hoofd || snel} color={hoofd || snel ? ui.k.accent : ui.k.fg} wrap="wrap">{m.id}</Text>
      <Text color={ui.k.mut} wrap="wrap">{`${contextTekst(m.context)} · ${prijsTekst(m.in)} in / ${prijsTekst(m.uit)} uit per Mtok`}</Text>
      {teKlein(m) ? <Text color={ui.k.err} wrap="wrap">te klein voor Claude Code</Text> : ''}
      {knop(ui, `or-hoofd-${i}`, hoofd ? '● Hoofd' : 'Hoofd', () => kies($, 'model', m), { primary: hoofd })}
      {knop(ui, `or-snel-${i}`, snel ? '● Snel' : 'Snel', () => kies($, 'snel', m), { primary: snel })}
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
    const zoekTekst = meer ? await read($, zoekAtom) : ''
    const test = await read($, testAtom)
    const keuze = await orKeuze($)
    const geld = kostenOverzicht((await $.store.get('openrouter.kosten')) as Record<string, number> | undefined, await $.clock.now())
    const klaar = status.orKlaar === true
    const gekozen = (lijst?.modellen ?? []).filter(m => m.id === kaal(keuze.model) || m.id === kaal(keuze.snel))
    const anders = klaar && !!status.orModel && (status.orModel !== keuze.model || status.orSnel !== keuze.snel)

    const gevonden = sorteer(lijst?.modellen ?? [], zoekTekst)
    const paginas = Math.max(1, Math.ceil(gevonden.length / TOON))
    const pagina = meer ? Math.min(paginas - 1, Math.max(0, await read($, paginaAtom))) : 0
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
        <Text wrap="truncate-end">
          <Text color={k.mut}>{'  Key: '}</Text>
          {status.orHeeftKey ? <Text>{`sk-or-…${status.orStaart ?? ''}`}</Text> : <Text color={k.mut}>geen key</Text>}
        </Text>
        <Text wrap="wrap">
          <Text color={k.mut}>{'  Hoofdmodel: '}</Text>
          {keuze.model ? <Text>{keuze.model}</Text> : <Text color={k.mut}>nog niet gekozen</Text>}
        </Text>
        <Text wrap="wrap">
          <Text color={k.mut}>{'  Snel model: '}</Text>
          {keuze.snel ? <Text>{keuze.snel}</Text> : <Text color={k.mut}>nog niet gekozen</Text>}
        </Text>
        {anders ? (
          <Text color={k.warn} wrap="wrap">{START} start nog met {status.orModel}; klik Gebruik nu om je keuze te gebruiken.</Text>
        ) : ''}
        {klaar && !status.orOpPad ? (
          <Text color={k.warn} wrap="wrap">~/.local/bin staat niet op je PATH: start met ~/.local/bin/{START}.</Text>
        ) : ''}
        {gekozen.filter(m => teKlein(m)).map(m => (
          <Text key={`or-klein-${m.id}`} color={k.err} wrap="wrap">{m.id} heeft {contextTekst(m.context)} context: te klein voor Claude Code.</Text>
        ))}
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
            {meer && status.orHeeftKey ? knop(ui, 'or-wis', 'Key wissen', () => wisKey($)) : ''}
          </Box>
        )}
      </Box>,
    ]

    const kaarten: RenderElement[] = []
    if (status.orHeeftKey || meer) {
      kaarten.push(kaart(ui, 'OpenRouter-modellen', [
        meer ? <Input key="or-zoek" label="Zoek " placeholder="naam of id" value={zoekTekst} submitLabel="zoek" onSubmit={(waarde: string) => zoek($, waarde)} /> : '',
        lijst === null ? leeg(ui, 'Lijst laden…') : '',
        lijst?.fout ? <Text color={k.err} wrap="wrap">{lijst.fout}</Text> : '',
        lijst !== null && !gevonden.length && !lijst.fout ? leeg(ui, 'Geen model gevonden.') : '',
        claude.length ? <Text key="or-groep-claude" bold color={k.mut}>Claude via OpenRouter</Text> : '',
        ...claude.map(m => regelVan(ui, $, m, index(m), keuze)),
        andere.length ? <Text key="or-groep-andere" bold color={k.mut}>Andere modellen</Text> : '',
        ...andere.map(m => regelVan(ui, $, m, index(m), keuze)),
        paginas > 1 ? uitleg(ui, meer ? `Pagina ${pagina + 1} van ${paginas} · ${gevonden.length} modellen` : `${gevonden.length} modellen; zoeken en bladeren onder Meer ▸`, 'or-meer') : '',
        meer && paginas > 1 ? knoppen(ui, [
          pagina > 0 ? knop(ui, 'or-vorige', '◂ Vorige', () => blader($, -1, paginas - 1), { hotkey: 'p' }) : null,
          pagina < paginas - 1 ? knop(ui, 'or-volgende', 'Volgende ▸', () => blader($, 1, paginas - 1), { hotkey: 'n' }) : null,
        ]) : '',
        uitleg(ui, 'Hoofd = het model waarmee Claude Code met je praat en het werk doet. Snel = het goedkopere model voor bijtaken: samenvattingen, titels, achtergrondwerk en subagents. Alleen modellen die tools kunnen gebruiken.', 'or-rollen'),
      ], {
        rechts: lijst?.modellen.length ? `${lijst.modellen.length} met tools` : '',
        knoppen: meer ? knoppen(ui, [knop(ui, 'or-ververs', 'Lijst verversen', () => laadModellen($, true))]) : null,
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
