import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine } from 'claude-code'

import type { ApiStatus, ApiToestand } from '../types'

import { failOpen, leesAccountsStaat } from './ctx'
import { kaart, knop, knoppen, paneelVan, uitleg, vinkje } from './paneel-ui'

import { beslis, dagSleutel, geldigeKey, houdTot, kosten, kostenOverzicht, limietenVan, modusVan, telOp, toestandVan, usd } from '../lib/api.mjs'
import type { Beschikbaar, Door, Modus } from '../lib/api.mjs'
import { kettingAan } from '../lib/accounts.mjs'
import { geldigModel, orKosten } from '../lib/openrouter.mjs'

// Tab API: de API-key in de macOS-sleutelhanger en wisselen tussen abonnement en API, met de hand
// of automatisch op de rate limits. Alles buiten de plugin (settings.json, sleutelhanger) gaat via
// cli/api.mjs. De key zelf komt nooit in state, store, log of toast: hij gaat van onSubmit direct
// naar de stdin van de CLI.

const statusAtom = atom({ plugin: 'futureflow', key: 'api.status' } as const, null as ApiStatus | null)
const toestandAtom = atom({ plugin: 'futureflow', key: 'api.toestand' } as const, null as ApiToestand | null)
const versieAtom = atom({ plugin: 'futureflow', key: 'api.versie' } as const, 0)

type Kleuren = { accent: string; mut: string; fg: string; ok: string; warn: string; err: string }

const UITLEG = [
  'Wisselen geldt voor nieuwe terminal-sessies; deze sessie houdt zijn login.',
  'De desktop-app regelt zijn eigen login en negeert deze wissel.',
  'In API-modus laadt Claude Code de claude.ai-connectors niet.',
]
const INVOER_UITLEG = 'Wat je typt is zichtbaar tot je op Enter drukt; daarna bewaart futureflow alleen de laatste 4 tekens in beeld.'
const FOUTE_KEY = 'Dat is geen Anthropic API-key (die begint met sk-ant-); niets opgeslagen.'
const AUTO_UITLEG =
  'Automatisch wisselen staat aan: vanaf de grens van je 5u- of 7d-venster gebruiken nieuwe terminal-sessies je API-key, en dat kost geld per token (geschat in de tab API). Terug na de reset. Deze sessie en de desktop-app houden hun eigen login.'

// Of deze sessie zelf op de API of OpenRouter draait: gestart terwijl onze helper aan stond. Per sessie (één module-instantie).
let sessieOpApi = false
let sessieOpOpenrouter = false
// Eén wissel tegelijk (turn.complete en session.measure kunnen kort na elkaar komen).
let wisselt = false

export function cliPath($: Engine): string {
  return `${$.plugin.root}/cli/api.mjs`
}

// Vaste waarden voor de CLI: `env` van $.process.run komt bovenop die van de host, dus zonder deze
// zouden SECURITY_BIN of SETTINGS_JSON uit een settings-`env`-blok de CLI bereiken (en SECURITY_BIN
// de key op stdin krijgen). Leeg = de standaard van de CLI.
const CLI_ENV = { SECURITY_BIN: '/usr/bin/security', SETTINGS_JSON: '', CLAUDE_JSON: '', OPENROUTER_DIR: '', OPENROUTER_URL: '' }

// Draait cli/api.mjs. De desktop-app heeft een kaal PATH en argv[0] wordt daarop gezocht,
// dus `node` via /usr/bin/env met een PATH waar Homebrew vooraan staat.
// Ook gebruikt door hooks/openrouter.tsx.
export async function cli($: Engine, args: string[], stdin?: string) {
  const init = { timeoutMs: 20_000, ...(stdin === undefined ? {} : { stdin }) }
  const isWin = (await $.env.get('OS')) === 'Windows_NT'
  if (isWin) return $.process.run(['node', cliPath($), ...args], { ...init, env: CLI_ENV })
  const hostPath = (await $.env.get('PATH')) ?? ''
  const PATH = `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${hostPath}`
  return $.process.run(['/usr/bin/env', 'node', cliPath($), ...args], { ...init, env: { ...CLI_ENV, PATH } })
}

// Takenlijst in de terminal (tab Stijl): env CLAUDE_CODE_ENABLE_TODO_TOOLS in settings.json via
// `cli/api.mjs takenlijst`. null = nog niet gelezen; de stand wordt één keer gelezen en daarna
// alleen bij een klik bijgewerkt, nooit per tekenbeurt.
const takenAtom = atom({ plugin: 'futureflow', key: 'stijl.takenlijst' } as const, null as boolean | null)
let takenLeest = false

export async function takenlijstStand($: Engine): Promise<boolean> {
  const stand = await read($, takenAtom)
  if (stand !== null) return stand
  if (!takenLeest) {
    takenLeest = true
    void (async () => {
      let aan = false
      try {
        const r = await cli($, ['takenlijst', 'status'])
        if (r.exitCode === 0) aan = JSON.parse(r.stdout.trim().split('\n').pop() ?? '{}').aan === true
      } catch (err) {
        failOpen($, err)
      }
      await update($, takenAtom, () => aan)
    })().catch(err => failOpen($, err)).finally(() => { takenLeest = false })
  }
  return false
}

// Zet de takenlijst aan of uit en meldt het resultaat in één toast.
export async function zetTakenlijst($: Engine, aan: boolean): Promise<void> {
  try {
    const r = await cli($, ['takenlijst', aan ? 'aan' : 'uit'])
    if (r.exitCode !== 0) {
      $.ui.toast(`Takenlijst niet omgezet: ${foutVan(r)}`)
      return
    }
    await update($, takenAtom, () => aan)
    $.ui.toast(aan ? 'Takenlijst in de terminal staat aan vanaf de volgende sessie.' : 'Takenlijst in de terminal staat uit vanaf de volgende sessie.')
  } catch (err) {
    failOpen($, err)
  }
}

export function foutVan(r: { exitCode: number; stderr: string }): string {
  return r.stderr.trim().replace(/^\[api\] /, '').slice(0, 200) || `exitcode ${r.exitCode}`
}

export function laatsteJson(stdout: string): any {
  return JSON.parse(stdout.trim().split('\n').pop() ?? '{}')
}

const MODI_SET = new Set(['abonnement', 'api', 'openrouter'])

// Status uit de CLI (alleen lezen); een fout komt terug in `fout`.
export async function leesStatus($: Engine): Promise<ApiStatus> {
  try {
    const r = await cli($, ['status'])
    if (r.exitCode !== 0) return { heeftKey: false, staart: '', modus: 'abonnement', vreemdeHelper: false, fout: foutVan(r) }
    const d = laatsteJson(r.stdout)
    return {
      heeftKey: d.heeftKey === true,
      staart: typeof d.staart === 'string' ? d.staart.slice(-4) : '',
      modus: MODI_SET.has(d.modus) ? d.modus : 'abonnement',
      vreemdeHelper: d.vreemdeHelper === true,
      vreemdeBasis: d.vreemdeBasis === true,
      orHeeftKey: d.orHeeftKey === true,
      orStaart: typeof d.orStaart === 'string' ? d.orStaart.slice(-4) : '',
      ...(geldigModel(d.orModel) ? { orModel: d.orModel } : {}),
      ...(geldigModel(d.orSnel) ? { orSnel: d.orSnel } : {}),
      ...(typeof d.fout === 'string' ? { fout: d.fout.slice(0, 200) } : {}),
    }
  } catch (err) {
    return { heeftKey: false, staart: '', modus: 'abonnement', vreemdeHelper: false, fout: err instanceof Error ? err.message : String(err) }
  }
}

async function leesToestand($: Engine): Promise<ApiToestand> {
  return toestandVan(await $.store.get('api.toestand'))
}

// Voor de ketting in hooks/accounts.tsx: de bewaarde API-toestand (alleen lezen).
export async function apiToestand($: Engine): Promise<ApiToestand> {
  return leesToestand($)
}

async function bewaarToestand($: Engine, t: ApiToestand): Promise<void> {
  await $.store.set('api.toestand', t)
  await update($, toestandAtom, () => t)
}

async function hertekenen($: Engine): Promise<void> {
  await update($, versieAtom, n => (n ?? 0) + 1)
}

// Leest de status opnieuw en houdt de bewaarde modus gelijk aan wat in settings.json staat
// (iemand kan die met de hand hebben veranderd).
export async function verversApi($: Engine): Promise<ApiStatus> {
  const status = await leesStatus($)
  await update($, statusAtom, () => status)
  // Voor de ketting (zonder CLI): staat er een OpenRouter-key.
  if (!status.fout) await $.store.set('openrouter.heeftKey', status.orHeeftKey === true)
  if (!status.fout) await $.store.set('api.heeftKey', status.heeftKey === true)
  if (!status.fout && !status.vreemdeHelper) {
    const t = await leesToestand($)
    if (t.modus !== status.modus) {
      const { overgeschakeldDoor: _weg, ...rest } = t
      await bewaarToestand($, { ...rest, modus: status.modus })
    } else {
      await update($, toestandAtom, () => t)
    }
  }
  return status
}

// De modus uit ~/.claude/settings.json, zonder de CLI (die start een Node-proces); undefined als
// het bestand ontbreekt of onleesbaar is.
async function modusUitSettings($: Engine): Promise<{ modus: Modus; vreemdeHelper: boolean } | undefined> {
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  if (!home) return undefined
  try {
    const tekst = await $.fs.read(`${home}/.claude/settings.json`)
    const { modus, vreemdeHelper } = modusVan(tekst ? JSON.parse(tekst) : {})
    return { modus, vreemdeHelper }
  } catch {
    return undefined
  }
}

// Start van de tab API; register.tsx roept dit aan vanuit zijn ene session.start. Leest alleen
// settings.json (geen CLI, zodat de sessie snel start): draait deze sessie op onze helper, en
// klopt de bewaarde modus nog met het bestand. De key-status leest de tab pas bij openen.
export async function startApi($: Engine): Promise<void> {
  try {
    const gelezen = await modusUitSettings($)
    sessieOpApi = gelezen?.modus === 'api'
    sessieOpOpenrouter = gelezen?.modus === 'openrouter'
    if (!gelezen || gelezen.vreemdeHelper) return
    const t = await leesToestand($)
    if (t.modus !== gelezen.modus) {
      const { overgeschakeldDoor: _weg, ...rest } = t
      await bewaarToestand($, { ...rest, modus: gelezen.modus })
    }
  } catch (err) {
    failOpen($, err)
  }
}

// De gekozen OpenRouter-modellen (store `openrouter.keuze`); alleen geldige ids.
export async function orKeuze($: Engine): Promise<{ model?: string; snel?: string }> {
  const k = (await $.store.get('openrouter.keuze')) as { model?: unknown; snel?: unknown } | undefined
  return {
    ...(geldigModel(k?.model) ? { model: k!.model as string } : {}),
    ...(geldigModel(k?.snel) ? { snel: k!.snel as string } : {}),
  }
}

// Welke stappen van de ketting kunnen (zonder CLI): de API tenzij de laatste status zei dat er geen
// key is (dan door naar de volgende stap in plaats van auto uit), OpenRouter alleen met een key en
// beide modellen gekozen.
export async function beschikbaarheid($: Engine): Promise<Beschikbaar> {
  const k = await orKeuze($)
  return { api: (await $.store.get('api.heeftKey')) !== false, openrouter: (await $.store.get('openrouter.heeftKey')) === true && !!k.model && !!k.snel }
}

const NAAM: Record<Modus, string> = { abonnement: 'het abonnement', api: 'API', openrouter: 'OpenRouter' }

// Wisselt via de CLI en bewaart de toestand. `door` = het venster bij een automatische wissel naar API
// of OpenRouter; `handmatigTot` = tot wanneer auto een keuze met de hand laat staan.
// Faalt een automatische wissel (andere helper, geen key), dan gaat auto uit: geen melding elke 5 minuten.
// Ook gebruikt door de ketting in hooks/accounts.tsx (naar API of OpenRouter als alle accounts vol
// zitten, en terug) en door hooks/openrouter.tsx.
export async function wissel(
  $: Engine,
  naar: Modus,
  reden: string,
  opties: { door?: Door; auto?: boolean; handmatigTot?: number } = {},
): Promise<boolean> {
  if (wisselt) {
    if (!opties.auto) $.ui.toast('Er loopt al een wissel; probeer het zo opnieuw.')
    return false
  }
  wisselt = true
  try {
    let args = ['modus', naar]
    if (naar === 'openrouter') {
      const k = await orKeuze($)
      if (!k.model || !k.snel) {
        if (!opties.auto) $.ui.toast('Niet gewisseld: kies eerst een hoofdmodel en een snel model in de tab OpenRouter.')
        return false
      }
      args = [...args, '--model', k.model, '--snel', k.snel]
    }
    const r = await cli($, args)
    const t = await leesToestand($)
    const nu = await $.clock.now()
    const { overgeschakeldDoor: _oud, handmatigTot: _hand, ...rest } = t
    if (r.exitCode !== 0) {
      const uitleg =
        r.exitCode === 3 ? `${foutVan(r).replace(/^in \S+settings\.json/, 'in ~/.claude/settings.json')}.`
        : r.exitCode === 4 ? (naar === 'openrouter' ? 'er staat nog geen OpenRouter-key in de sleutelhanger.' : 'er staat nog geen key in de sleutelhanger.')
        : foutVan(r)
      if (opties.auto) {
        // Niet elke meting opnieuw proberen: auto uit en niets meer om terug te draaien.
        await bewaarToestand($, { ...rest, auto: false, laatsteWissel: nu })
        $.ui.toast(`Automatisch wisselen staat uit: ${uitleg}`)
      } else {
        $.ui.toast(`Niet gewisseld: ${uitleg}`)
      }
      await verversApi($)
      return false
    }
    if (laatsteJson(r.stdout).gewijzigd === false && !opties.auto) {
      $.ui.toast(
        naar === 'api' ? 'Nieuwe terminal-sessies gebruiken je API-key al.'
        : naar === 'openrouter' ? 'Nieuwe terminal-sessies gebruiken OpenRouter al met deze modellen.'
        : 'Nieuwe terminal-sessies gebruiken je abonnement al.',
      )
      await verversApi($)
      return true
    }
    await bewaarToestand($, {
      ...rest,
      modus: naar,
      laatsteWissel: nu,
      ...(naar !== 'abonnement' && opties.door ? { overgeschakeldDoor: opties.door } : {}),
      ...(opties.handmatigTot !== undefined ? { handmatigTot: opties.handmatigTot } : {}),
    })
    $.ui.toast(
      naar === 'api'
        ? `Naar API (${reden}). Nieuwe terminal-sessies gebruiken je API-key en dat kost geld per token; de claude.ai-connectors staan daar uit. Deze sessie en de desktop-app houden hun eigen login.`
        : naar === 'openrouter'
          ? `Naar OpenRouter (${reden}). Nieuwe terminal-sessies draaien op ${(await orKeuze($)).model} via je OpenRouter-key en dat kost geld per token; webzoeken en de claude.ai-connectors werken daar niet. Deze sessie en de desktop-app houden hun eigen login.`
          : `Terug naar het abonnement (${reden}). Nieuwe terminal-sessies gebruiken weer je abonnement. Deze sessie en de desktop-app houden hun eigen login.`,
    )
    await verversApi($)
    return true
  } finally {
    wisselt = false
  }
}

// Na een meting (session.measure, via de skin) en na een beurt: automatisch wisselen of niet.
// Zonder auto en zonder automatische wissel om terug te draaien gebeurt hier niets (ook geen CLI).
// Met accounts-auto aan en twee of meer accounts in de rotatie beslist de ketting in hooks/accounts.tsx
// (eerst een ander abonnement, dan de API, en terug); dan doet deze functie niets.
export async function apiMeet($: Engine, rateLimits?: unknown): Promise<void> {
  try {
    const t = await leesToestand($)
    if (!t.auto && !t.overgeschakeldDoor) return
    if (kettingAan(await leesAccountsStaat($))) return
    const ruw = rateLimits ?? (await $.session.usage()).rateLimits
    const besluit = beslis({ ...t, beschikbaar: await beschikbaarheid($), limieten: limietenVan(ruw), nu: await $.clock.now() })
    if (besluit) await wissel($, besluit.naar, besluit.reden, { door: besluit.door, auto: true })
  } catch (err) {
    failOpen($, err)
  }
}

// apiMeet los van de beurt of meting: een wissel start de CLI (en mogelijk een sleutelhanger-
// dialoog), dat mag de beurt niet ophouden. Aanroepen nadat `next(e)` klaar is.
export function apiMeetLos($: Engine, rateLimits?: unknown): void {
  void apiMeet($, rateLimits).catch(err => failOpen($, err))
}

// Telt de geschatte kosten van een beurt als deze sessie op de API of OpenRouter draait (gestart met
// onze helper en zonder abonnementslimieten). Wisselen doet apiMeetLos, na de beurt.
export async function apiTurnComplete($: Engine, e: { usage?: any }): Promise<void> {
  try {
    if (sessieOpOpenrouter && e.usage) {
      // Prijzen per model (per Mtok) bewaard bij het kiezen; onbekend model → het hoofdmodel.
      const prijzen = ((await $.store.get('openrouter.prijzen')) ?? {}) as Record<string, { in?: number; uit?: number }>
      const model = typeof e.usage.model === 'string' ? e.usage.model : ''
      const prijs = prijzen[model] ?? prijzen[(await orKeuze($)).model ?? '']
      const bedrag = orKosten(e.usage, prijs)
      if (bedrag > 0) {
        const dag = dagSleutel(await $.clock.now())
        await $.store.set('openrouter.kosten', telOp((await $.store.get('openrouter.kosten')) as Record<string, number> | undefined, dag, bedrag))
        await hertekenen($)
      }
      return
    }
    if (sessieOpApi && e.usage) {
      const opAbonnement = await $.session.usage().then(u => u.rateLimits.length > 0, () => false)
      if (!opAbonnement) {
        const bedrag = kosten(e.usage)
        if (bedrag > 0) {
          const dag = dagSleutel(await $.clock.now())
          await $.store.set('api.kosten', telOp((await $.store.get('api.kosten')) as Record<string, number> | undefined, dag, bedrag))
          await hertekenen($)
        }
      }
    }
  } catch (err) {
    failOpen($, err)
  }
}

// ---- acties uit de tab (alleen in onPress/onSubmit, nooit tijdens het tekenen) ----

// De key gaat rechtstreeks naar de stdin van de CLI; daarna wordt het veld leeg getekend.
async function bewaarKey($: Engine, invoer: string): Promise<void> {
  try {
    const key = invoer.trim()
    if (!geldigeKey(key)) {
      $.ui.toast(FOUTE_KEY)
      return
    }
    const r = await cli($, ['zet-key'], key)
    if (r.exitCode !== 0) $.ui.toast(`Key niet bewaard: ${foutVan(r)}`)
    else $.ui.toast('Key bewaard in de sleutelhanger.')
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
    if (status.modus === 'api' && !(await wissel($, 'abonnement', 'key gewist'))) return
    const r = await cli($, ['wis-key'])
    if (r.exitCode !== 0) {
      $.ui.toast(`Key niet gewist: ${foutVan(r)}`)
    } else {
      const t = await leesToestand($)
      if (t.auto) await bewaarToestand($, { ...t, auto: false })
      $.ui.toast(laatsteJson(r.stdout).gewist ? 'Key gewist uit de sleutelhanger.' : 'Er stond geen key in de sleutelhanger.')
    }
    await verversApi($)
  } catch (err) {
    failOpen($, err)
  }
}

// Met de hand gekozen gaat voor: terug naar het abonnement terwijl een venster boven de grens staat,
// dan wisselt auto pas weer na de reset van dat venster. Met de hand naar API heeft geen
// `overgeschakeldDoor`, dus auto zet dat nooit terug.
export async function handmatig($: Engine, naar: Modus): Promise<void> {
  try {
    let tot: number | undefined
    if (naar === 'abonnement') {
      const t = await leesToestand($)
      const ruw = await $.session.usage().then(u => u.rateLimits, () => [])
      tot = houdTot({ ...t, limieten: limietenVan(ruw), nu: await $.clock.now() })
    }
    await wissel($, naar, 'met de hand', tot === undefined ? {} : { handmatigTot: tot })
  } catch (err) {
    failOpen($, err)
  }
}

async function zetAuto($: Engine): Promise<void> {
  try {
    const t = await leesToestand($)
    if (!t.auto) {
      const status = (await read($, statusAtom)) ?? (await leesStatus($))
      if (!status.heeftKey) {
        $.ui.toast('Bewaar eerst een API-key; zonder key kan futureflow niet naar de API wisselen.')
        return
      }
      if (status.vreemdeHelper) {
        $.ui.toast('In ~/.claude/settings.json staat al een andere apiKeyHelper; futureflow laat die staan en wisselt niet.')
        return
      }
    }
    // Aan- of uitzetten beëindigt ook een keuze met de hand.
    const { handmatigTot: _hand, ...rest } = t
    await bewaarToestand($, { ...rest, auto: !t.auto })
    if (!t.auto && !(await $.store.get('api.autoUitgelegd'))) {
      await $.store.set('api.autoUitgelegd', true)
      $.ui.toast(AUTO_UITLEG)
    }
    // Meteen kijken: staat een venster al boven de grens, dan nu wisselen (na de wachttijd).
    if (!t.auto) await apiMeet($)
  } catch (err) {
    failOpen($, err)
  }
}

async function zetGrens($: Engine, welke: 'hoog' | 'laag', invoer: string): Promise<void> {
  try {
    const t = await leesToestand($)
    const n = Number(invoer.trim().replace(/%$/, ''))
    const [min, max] = welke === 'hoog' ? [50, 100] : [0, 90]
    if (!Number.isInteger(n) || n < min || n > max) {
      $.ui.toast(`Grens niet veranderd: kies een heel getal van ${min} tot ${max}.`)
    } else if (welke === 'hoog' ? n <= t.laag : n >= t.hoog) {
      $.ui.toast(`Grens niet veranderd: "naar API" (${welke === 'hoog' ? n : t.hoog}%) moet hoger zijn dan "terug" (${welke === 'laag' ? n : t.laag}%).`)
    } else {
      await bewaarToestand($, { ...t, [welke]: n })
    }
  } catch (err) {
    failOpen($, err)
  } finally {
    await hertekenen($).catch(() => undefined)
  }
}

const twee = (n: number) => String(n).padStart(2, '0')
// Lokale tijd kort: "14:05", of "di 10-11 14:05" als het niet vandaag is.
function wanneer(ms: number, nu: number): string {
  const d = new Date(ms)
  const tijd = `${twee(d.getHours())}:${twee(d.getMinutes())}`
  if (dagSleutel(ms) === dagSleutel(nu)) return tijd
  const dag = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'][d.getDay()]
  return `${dag} ${twee(d.getDate())}-${twee(d.getMonth() + 1)} ${tijd}`
}

// Inhoud van de tab API. Tekent alleen; schrijven gebeurt in onPress/onSubmit.
export async function apiTab($: Engine, e: any, k: Kleuren) {
  const el = $.ui.resolve(e)
  const { Box, Text, Input } = el
  try {
    await read($, versieAtom) // opnieuw tekenen na een actie
    const ui = paneelVan(el, e, k)
    const status = (await read($, statusAtom)) ?? (await leesStatus($))
    const t = (await read($, toestandAtom)) ?? (await leesToestand($))
    const nu = await $.clock.now()
    const geld = kostenOverzicht((await $.store.get('api.kosten')) as Record<string, number> | undefined, nu)
    const opApi = status.modus === 'api'
    const opOr = status.modus === 'openrouter'

    return (
      <Box flexDirection="column" gap={1}>
        {kaart(ui, 'API', [
          <Text>
            <Text color={k.mut}>Nieuwe terminal-sessies: </Text>
            <Text bold color={opApi || opOr ? k.warn : k.ok}>{opApi ? 'API-key' : opOr ? 'OpenRouter' : 'abonnement'}</Text>
          </Text>,
          <Text>
            <Text color={k.mut}>{'Key: '}</Text>
            {status.heeftKey ? <Text>{`sk-ant-…${status.staart}`}</Text> : <Text color={k.mut}>geen key</Text>}
          </Text>,
          t.overgeschakeldDoor && (opApi || opOr) ? (
            <Text color={k.warn}>Automatisch naar {NAAM[status.modus]} door het {t.overgeschakeldDoor.label}-venster; terug na de reset.</Text>
          ) : '',
          t.auto && t.handmatigTot !== undefined && t.handmatigTot > nu ? (
            <Text color={k.warn}>Met de hand gekozen: automatisch wisselen wacht tot {wanneer(t.handmatigTot, nu)} (of tot je het uit- en aanzet).</Text>
          ) : '',
          t.auto && (opApi || opOr) && !t.overgeschakeldDoor ? (
            <Text color={k.warn}>Met de hand op {NAAM[status.modus]}: automatisch wisselen zet dit niet terug.</Text>
          ) : '',
          status.vreemdeHelper ? (
            <Text color={k.err}>In ~/.claude/settings.json staat al een andere apiKeyHelper. futureflow laat die staan en wisselt niet.</Text>
          ) : '',
          status.vreemdeBasis ? (
            <Text color={k.err}>In ~/.claude/settings.json staat al een andere ANTHROPIC_BASE_URL. futureflow laat die staan en wisselt niet naar API of OpenRouter.</Text>
          ) : '',
          status.fout ? <Text color={k.err} wrap="truncate-end">Status niet volledig gelezen: {status.fout}</Text> : '',
        ], {
          rechts: opApi ? 'API' : opOr ? 'OpenRouter' : 'abonnement',
          knoppen: knoppen(ui, [
            knop(ui, 'api-abonnement', opApi || opOr ? 'Abonnement' : '● Abonnement', () => handmatig($, 'abonnement'), { primary: !opApi && !opOr }),
            knop(ui, 'api-api', opApi ? '● API' : 'API', () => handmatig($, 'api'), { primary: opApi }),
            knop(ui, 'api-openrouter', opOr ? '● OpenRouter' : 'OpenRouter', () => handmatig($, 'openrouter'), { primary: opOr }),
          ]),
        })}

        {kaart(ui, 'Key', [
          <Input key="api-key" label="Key " placeholder="sk-ant-…" value="" submitLabel="bewaar" onSubmit={(waarde: string) => bewaarKey($, waarde)} />,
          uitleg(ui, INVOER_UITLEG),
        ], {
          knoppen: status.heeftKey ? knoppen(ui, [knop(ui, 'api-wis', 'Key wissen', () => wisKey($))]) : null,
        })}

        {kaart(ui, 'Automatisch wisselen', [
          vinkje(ui, 'api-auto', t.auto, 'Automatisch wisselen', () => zetAuto($)),
          uitleg(ui, 'Op de 5u- en 7d-vensters van je abonnement. Volgorde van API en OpenRouter: tab OpenRouter.'),
          <Input key="api-hoog" label="Naar API vanaf % " value={String(t.hoog)} submitLabel="zet" onSubmit={(waarde: string) => zetGrens($, 'hoog', waarde)} />,
          <Input key="api-laag" label="Terug onder %     " value={String(t.laag)} submitLabel="zet" onSubmit={(waarde: string) => zetGrens($, 'laag', waarde)} />,
        ], { rechts: t.auto ? 'aan' : 'uit' })}

        {kaart(ui, 'Geschatte kosten', [
          <Text>
            <Text color={k.mut}>vandaag </Text>
            <Text bold>{usd(geld.vandaag)}</Text>
            <Text color={k.mut}>  ·  deze maand </Text>
            <Text bold>{usd(geld.maand)}</Text>
          </Text>,
          uitleg(ui, 'Schatting op basis van de prijslijst; geen harde stop.'),
        ])}

        <Box flexDirection="column">
          {UITLEG.map((regel, i) => uitleg(ui, regel, `api-uitleg-${i}`))}
        </Box>
      </Box>
    )
  } catch (err) {
    failOpen($, err)
    return <Text dimColor>API laden lukte niet; de fout staat in het logboek van de mod.</Text>
  }
}
