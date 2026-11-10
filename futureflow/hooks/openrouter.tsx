import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine } from 'claude-code'

import type { ApiStatus, ApiToestand, OrModel, OrModellen } from '../types'

import { cli, foutVan, handmatig, laatsteJson, leesStatus, orKeuze, verversApi, wissel } from './api'
import { failOpen } from './ctx'
import { kaart, knop, knoppen, leeg, paneelVan, uitleg, vinkje } from './paneel-ui'

import { kostenOverzicht, STAPPEN, toestandVan, usd } from '../lib/api.mjs'
import type { Stap } from '../lib/api.mjs'
import { contextTekst, geldigeOrKey, geldigModel, isClaude, modellenVan, prijsTekst, sorteer, TOON } from '../lib/openrouter.mjs'

// Tab OpenRouter: Claude Code zelf (nieuwe terminal-sessies) op een ander model via OpenRouter.
// Key in de macOS-sleutelhanger (alleen via stdin naar cli/api.mjs), modellen kiezen uit de lijst
// van OpenRouter, met de hand wisselen, en de volgorde van API en OpenRouter in de ketting.
// Alles buiten de plugin gaat via cli/api.mjs; de key komt nooit in state, store, log of toast.

// Dezelfde atoms als in hooks/api.tsx (de hooks-module leest ze statisch per bestand).
const statusAtom = atom({ plugin: 'futureflow', key: 'api.status' } as const, null as ApiStatus | null)
const toestandAtom = atom({ plugin: 'futureflow', key: 'api.toestand' } as const, null as ApiToestand | null)
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
  'Geldt voor nieuwe terminal-sessies; deze sessie en de desktop-app houden hun eigen login.',
  'Op OpenRouter laadt Claude Code de claude.ai-connectors niet.',
]
const INVOER_UITLEG = 'Wat je typt is zichtbaar tot je op Enter drukt; daarna bewaart futureflow alleen de laatste 4 tekens in beeld.'
const FOUTE_KEY = 'Dat is geen OpenRouter-key (die begint met sk-or-); niets opgeslagen.'
const NAMEN: Record<Stap, string> = { api: 'Anthropic API', openrouter: 'OpenRouter' }

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

async function toestand($: Engine): Promise<ApiToestand> {
  return toestandVan(await $.store.get('api.toestand'))
}

async function bewaarToestand($: Engine, t: ApiToestand): Promise<void> {
  await $.store.set('api.toestand', t)
  await update($, toestandAtom, () => t)
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
    // Eerst terug naar het abonnement: zonder key kan een nieuwe terminal-sessie anders niet inloggen.
    if (status.modus === 'openrouter' && !(await wissel($, 'abonnement', 'OpenRouter-key gewist'))) return
    const r = await cli($, ['openrouter', 'wis-key'])
    if (r.exitCode !== 0) $.ui.toast(`Key niet gewist: ${foutVan(r)}`)
    else $.ui.toast(laatsteJson(r.stdout).gewist ? 'OpenRouter-key gewist uit de sleutelhanger.' : 'Er stond geen OpenRouter-key in de sleutelhanger.')
    await verversApi($)
  } catch (err) {
    failOpen($, err)
  }
}

// Kiest het hoofd- of snelle model en bewaart zijn prijzen (voor de kostenschatting). Staan nieuwe
// sessies al op OpenRouter, dan meteen de nieuwe modellen in settings.json zetten.
async function kies($: Engine, rol: 'model' | 'snel', m: OrModel): Promise<void> {
  try {
    if (!geldigModel(m.id)) return
    const oud = await orKeuze($)
    await $.store.set('openrouter.keuze', { ...oud, [rol]: m.id })
    const prijzen = ((await $.store.get('openrouter.prijzen')) ?? {}) as Record<string, { in?: number; uit?: number }>
    await $.store.set('openrouter.prijzen', { ...prijzen, [m.id]: { ...(m.in !== undefined ? { in: m.in } : {}), ...(m.uit !== undefined ? { uit: m.uit } : {}) } })
    const status = (await read($, statusAtom)) ?? (await leesStatus($))
    const nu = await orKeuze($)
    if (status.modus === 'openrouter' && nu.model && nu.snel) await wissel($, 'openrouter', 'nieuw model')
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

// Zet een stap in of uit de ketting. OpenRouter aanzetten mag zonder key of model, maar dan zegt een
// toast dat de ketting hem overslaat tot die er zijn.
async function zetStap($: Engine, stap: Stap): Promise<void> {
  try {
    const t = await toestand($)
    const aan = t.stappen.includes(stap)
    const stappen = aan ? t.stappen.filter(x => x !== stap) : [...t.stappen, stap]
    await bewaarToestand($, { ...t, stappen })
    if (!aan && stap === 'openrouter') {
      const k = await orKeuze($)
      const status = (await read($, statusAtom)) ?? (await leesStatus($))
      if (!status.orHeeftKey || !k.model || !k.snel) $.ui.toast('OpenRouter staat in de ketting, maar wordt overgeslagen tot er een key en beide modellen zijn.')
    }
  } catch (err) {
    failOpen($, err)
  }
}

async function draaiVolgorde($: Engine): Promise<void> {
  try {
    const t = await toestand($)
    await bewaarToestand($, { ...t, stappen: t.stappen.slice().reverse() })
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

function regelVan(ui: ReturnType<typeof paneelVan>, $: Engine, m: OrModel, i: number, keuze: { model?: string; snel?: string }) {
  const { Box, Text } = ui.el
  const hoofd = keuze.model === m.id
  const snel = keuze.snel === m.id
  return (
    <Box key={`or-regel-${i}`} flexDirection="row" flexWrap="wrap" columnGap={1}>
      <Text bold={hoofd || snel} color={hoofd || snel ? ui.k.accent : ui.k.fg} wrap="wrap">{m.id}</Text>
      <Text color={ui.k.mut} wrap="wrap">{`${contextTekst(m.context)} · ${prijsTekst(m.in)} in / ${prijsTekst(m.uit)} uit per Mtok`}</Text>
      {knop(ui, `or-hoofd-${i}`, hoofd ? '● Hoofd' : 'Hoofd', () => kies($, 'model', m), { primary: hoofd })}
      {knop(ui, `or-snel-${i}`, snel ? '● Snel' : 'Snel', () => kies($, 'snel', m), { primary: snel })}
    </Box>
  )
}

// Inhoud van de tab OpenRouter. Tekent alleen; schrijven gebeurt in onPress/onSubmit.
export async function openrouterTab($: Engine, e: any, k: Kleuren) {
  const el = $.ui.resolve(e)
  const { Box, Text, Input } = el
  try {
    await read($, versieAtom) // opnieuw tekenen na een actie
    const ui = paneelVan(el, e, k)
    const status = (await read($, statusAtom)) ?? (await leesStatus($))
    // Een toestand uit een sessie van vóór 0.7 heeft nog geen `stappen`: dan de standaard.
    const t0 = (await read($, toestandAtom)) ?? (await toestand($))
    const t = { ...t0, stappen: Array.isArray(t0.stappen) ? t0.stappen : ['api'] }
    const lijst = await read($, modellenAtom)
    const zoekTekst = await read($, zoekAtom)
    const test = await read($, testAtom)
    const keuze = await orKeuze($)
    const geld = kostenOverzicht((await $.store.get('openrouter.kosten')) as Record<string, number> | undefined, await $.clock.now())
    const opOr = status.modus === 'openrouter'

    const gevonden = sorteer(lijst?.modellen ?? [], zoekTekst)
    const paginas = Math.max(1, Math.ceil(gevonden.length / TOON))
    const pagina = Math.min(paginas - 1, Math.max(0, await read($, paginaAtom)))
    const getoond = gevonden.slice(pagina * TOON, (pagina + 1) * TOON)
    const claude = getoond.filter(m => isClaude(m.id))
    const andere = getoond.filter(m => !isClaude(m.id))
    const index = (m: OrModel) => getoond.indexOf(m)

    // Volgorde: eerst de stappen die aan staan (in hun volgorde), daarna de rest.
    const uit = STAPPEN.filter(x => !t.stappen.includes(x))

    return (
      <Box flexDirection="column" gap={1}>
        {kaart(ui, 'OpenRouter', [
          <Text>
            <Text color={k.mut}>Nieuwe terminal-sessies: </Text>
            <Text bold color={status.modus === 'abonnement' ? k.ok : k.warn}>{opOr ? 'OpenRouter' : status.modus === 'api' ? 'API-key' : 'abonnement'}</Text>
          </Text>,
          <Text>
            <Text color={k.mut}>{'Key: '}</Text>
            {status.orHeeftKey ? <Text>{`sk-or-…${status.orStaart ?? ''}`}</Text> : <Text color={k.mut}>geen key</Text>}
          </Text>,
          <Text wrap="wrap">
            <Text color={k.mut}>{'Hoofdmodel: '}</Text>
            {keuze.model ? <Text>{keuze.model}</Text> : <Text color={k.mut}>nog niet gekozen</Text>}
          </Text>,
          <Text wrap="wrap">
            <Text color={k.mut}>{'Snel model: '}</Text>
            {keuze.snel ? <Text>{keuze.snel}</Text> : <Text color={k.mut}>nog niet gekozen</Text>}
          </Text>,
          opOr && status.orModel && status.orModel !== keuze.model ? (
            <Text color={k.warn} wrap="wrap">In settings.json staat nog {status.orModel}; klik OpenRouter om de keuze te zetten.</Text>
          ) : '',
          test ? <Text color={test.startsWith('Verbinding werkt (') ? k.ok : test.startsWith('Bezig') ? k.mut : k.err} wrap="wrap">{test}</Text> : '',
          status.vreemdeHelper ? <Text color={k.err} wrap="wrap">In ~/.claude/settings.json staat al een andere apiKeyHelper. futureflow laat die staan en wisselt niet.</Text> : '',
          status.vreemdeBasis ? <Text color={k.err} wrap="wrap">In ~/.claude/settings.json staat al een andere ANTHROPIC_BASE_URL. futureflow laat die staan en wisselt niet.</Text> : '',
          status.fout ? <Text color={k.err} wrap="truncate-end">Status niet volledig gelezen: {status.fout}</Text> : '',
        ], {
          rechts: opOr ? 'aan' : 'uit',
          knoppen: knoppen(ui, [
            knop(ui, 'or-naar', opOr ? '● OpenRouter' : 'OpenRouter', () => handmatig($, 'openrouter'), { primary: opOr }),
            knop(ui, 'or-abonnement', status.modus === 'abonnement' ? '● Abonnement' : 'Abonnement', () => handmatig($, 'abonnement'), { primary: status.modus === 'abonnement' }),
            status.orHeeftKey ? knop(ui, 'or-test', 'Test verbinding', () => testVerbinding($)) : null,
          ]),
        })}

        {kaart(ui, 'Key', [
          <Input key="or-key" label="Key " placeholder="sk-or-…" value="" submitLabel="bewaar" onSubmit={(waarde: string) => bewaarKey($, waarde)} />,
          uitleg(ui, INVOER_UITLEG),
        ], {
          knoppen: status.orHeeftKey ? knoppen(ui, [knop(ui, 'or-wis', 'Key wissen', () => wisKey($))]) : null,
        })}

        {kaart(ui, 'Modellen', [
          <Input key="or-zoek" label="Zoek " placeholder="naam of id" value={zoekTekst} submitLabel="zoek" onSubmit={(waarde: string) => zoek($, waarde)} />,
          lijst === null ? leeg(ui, 'Lijst laden…') : '',
          lijst?.fout ? <Text color={k.err} wrap="wrap">{lijst.fout}</Text> : '',
          lijst !== null && !gevonden.length && !lijst.fout ? leeg(ui, 'Geen model gevonden.') : '',
          claude.length ? <Text key="or-groep-claude" bold color={k.mut}>Claude via OpenRouter</Text> : '',
          ...claude.map(m => regelVan(ui, $, m, index(m), keuze)),
          andere.length ? <Text key="or-groep-andere" bold color={k.mut}>Andere modellen</Text> : '',
          ...andere.map(m => regelVan(ui, $, m, index(m), keuze)),
          paginas > 1 ? uitleg(ui, `Pagina ${pagina + 1} van ${paginas} · ${gevonden.length} modellen`, 'or-meer') : '',
          paginas > 1 ? knoppen(ui, [
            pagina > 0 ? knop(ui, 'or-vorige', '◂ Vorige', () => blader($, -1, paginas - 1), { hotkey: 'p' }) : null,
            pagina < paginas - 1 ? knop(ui, 'or-volgende', 'Volgende ▸', () => blader($, 1, paginas - 1), { hotkey: 'n' }) : null,
          ]) : '',
          uitleg(ui, 'Hoofd = het model waarmee Claude Code met je praat en het werk doet. Snel = het goedkopere model voor bijtaken: samenvattingen, titels, achtergrondwerk en subagents. Alleen modellen die tools kunnen gebruiken.', 'or-rollen'),
        ], {
          rechts: lijst?.modellen.length ? `${lijst.modellen.length} met tools` : '',
          knoppen: knoppen(ui, [knop(ui, 'or-ververs', 'Lijst verversen', () => laadModellen($, true))]),
        })}

        {kaart(ui, 'Ketting', [
          uitleg(ui, 'Als alle abonnementen vol zitten (tab Accounts), in deze volgorde:'),
          <Text key="or-ketting-0"><Text color={k.mut}>1. </Text>ander abonnement met ruimte</Text>,
          ...t.stappen.map((x, i) => <Text key={`or-ketting-${x}`}><Text color={k.mut}>{`${i + 2}. `}</Text>{NAMEN[x]}</Text>),
          ...uit.map(x => <Text key={`or-ketting-uit-${x}`} color={k.mut}>{`– ${NAMEN[x]} (uit)`}</Text>),
          vinkje(ui, 'or-stap-api', t.stappen.includes('api'), 'API in de ketting', () => zetStap($, 'api')),
          vinkje(ui, 'or-stap-openrouter', t.stappen.includes('openrouter'), 'OpenRouter in de ketting', () => zetStap($, 'openrouter')),
          uitleg(ui, `Automatisch wisselen zet je aan in de tab API (nu ${t.auto ? 'aan' : 'uit'}). Terug naar een abonnement zodra dat weer ruimte heeft; een keuze met de hand gaat voor.`),
        ], {
          knoppen: t.stappen.length === 2
            ? knoppen(ui, [knop(ui, 'or-volgorde', t.stappen[0] === 'api' ? 'OpenRouter vóór API' : 'API vóór OpenRouter', () => draaiVolgorde($))])
            : null,
        })}

        {kaart(ui, 'Geschatte kosten', [
          <Text>
            <Text color={k.mut}>vandaag </Text>
            <Text bold>{usd(geld.vandaag)}</Text>
            <Text color={k.mut}>  ·  deze maand </Text>
            <Text bold>{usd(geld.maand)}</Text>
          </Text>,
          uitleg(ui, 'Schatting met de prijzen van het gekozen model; cache telt als gewone input. Geen harde stop.'),
        ])}

        <Box flexDirection="column">
          {WAARSCHUWINGEN.map((regel, i) => uitleg(ui, regel, `or-uitleg-${i}`))}
        </Box>
      </Box>
    )
  } catch (err) {
    failOpen($, err)
    return <Text dimColor>OpenRouter laden lukte niet; de fout staat in het logboek van de mod.</Text>
  }
}
