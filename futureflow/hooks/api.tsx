import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, RenderElement } from 'claude-code'

import type { ApiStatus, ApiToestand } from '../types'

import { failOpen, leesAccountsStaat } from './ctx'
import { vraagHerstart } from './herstart'
import { kaart, knop, knoppen, paneelVan, uitleg } from './paneel-ui'

import { beslis, dagSleutel, geldigeKey, houdTot, kosten, kostenOverzicht, limietenVan, modusVan, telOp, toestandVan, usd } from '../lib/api.mjs'
import type { Beschikbaar, Door, Modus } from '../lib/api.mjs'
import { instellingenVan, kettingAan } from '../lib/accounts.mjs'
import { geldigModel, orKosten, OR_URL, START } from '../lib/openrouter.mjs'

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
  'De desktop-app regelt zijn eigen login en negeert deze wissel (gemeten 10-11-2026).',
  'In API-modus laadt Claude Code de claude.ai-connectors niet.',
]
const INVOER_UITLEG = 'Wat je typt is zichtbaar tot je op Enter drukt; daarna bewaart futureflow alleen de laatste 4 tekens in beeld.'
const FOUTE_KEY = 'Dat is geen Anthropic API-key (die begint met sk-ant-); niets opgeslagen.'

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
const CLI_ENV = { SECURITY_BIN: '/usr/bin/security', SETTINGS_JSON: '', CLAUDE_JSON: '', OPENROUTER_DIR: '', OPENROUTER_URL: '', SHIM_DIR: '' }

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

// Takenlijst in de terminal (tab Instellingen): env CLAUDE_CODE_ENABLE_TODO_TOOLS in settings.json via
// `cli/api.mjs takenlijst`. null = nog niet gelezen. Lezen gebeurt bij het openen van de tab
// (`leesTakenlijst`, vanuit een handler) en na een klik; tekenen leest alleen de atom.
const takenAtom = atom({ plugin: 'futureflow', key: 'stijl.takenlijst' } as const, null as boolean | null)

export async function takenlijstStand($: Engine): Promise<boolean> {
  return (await read($, takenAtom)) === true
}

export async function leesTakenlijst($: Engine): Promise<void> {
  let aan = false
  try {
    const r = await cli($, ['takenlijst', 'status'])
    if (r.exitCode === 0) aan = JSON.parse(r.stdout.trim().split('\n').pop() ?? '{}').aan === true
  } catch (err) {
    failOpen($, err)
  }
  await update($, takenAtom, () => aan)
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
      orKlaar: d.orKlaar === true,
      orShim: d.orShim === true,
      orOpPad: d.orOpPad !== false,
      oudeOr: d.oudeOr === true,
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

// Ook gebruikt door de kaart Automatisch wisselen (hooks/wissel-kaart.tsx).
export async function bewaarApiToestand($: Engine, t: ApiToestand): Promise<void> {
  await bewaarToestand($, t)
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
// het bestand ontbreekt of onleesbaar is. `oudeOr`: er staan nog OpenRouter-regels van futureflow < 0.9.
async function modusUitSettings($: Engine): Promise<{ modus: Modus; vreemdeHelper: boolean; oudeOr: boolean } | undefined> {
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  if (!home) return undefined
  try {
    const tekst = await $.fs.read(`${home}/.claude/settings.json`)
    const data = tekst ? JSON.parse(tekst) : {}
    const { modus, vreemdeHelper } = modusVan(data)
    const oudeOr = modus === 'openrouter' || data?.env?.ANTHROPIC_BASE_URL === OR_URL
    return { modus: oudeOr ? 'abonnement' : modus, vreemdeHelper, oudeOr }
  } catch {
    return undefined
  }
}

// Oude OpenRouter-regels uit ~/.claude/settings.json halen (los van de sessiestart).
async function ruimOudeOrOp($: Engine): Promise<void> {
  const r = await cli($, ['openrouter', 'opruimen'])
  if (r.exitCode !== 0) {
    $.ui.toast(`Oude OpenRouter-regels niet uit ~/.claude/settings.json gehaald: ${foutVan(r)}`)
    return
  }
  if (laatsteJson(r.stdout).gewijzigd) {
    $.ui.toast(`Oude OpenRouter-regels uit ~/.claude/settings.json gehaald: alle sessies gebruiken weer je abonnement. OpenRouter start je voortaan met ${START}.`)
  }
}

// Start van de tab API; register.tsx roept dit aan vanuit zijn ene session.start. Leest alleen
// settings.json (geen CLI, zodat de sessie snel start): draait deze sessie op onze helper, en
// klopt de bewaarde modus nog met het bestand. De key-status leest de tab pas bij openen.
export async function startApi($: Engine): Promise<void> {
  try {
    const gelezen = await modusUitSettings($)
    sessieOpApi = gelezen?.modus === 'api'
    // Gestart met claude-or: de env uit het eigen settings-bestand staat in deze sessie.
    sessieOpOpenrouter = gelezen?.oudeOr === true || (await $.env.get('ANTHROPIC_BASE_URL')) === OR_URL
    if (gelezen?.oudeOr) void ruimOudeOrOp($).catch(err => failOpen($, err))
    // Sinds 0.8 één schakelaar voor API en accounts: stond alleen accounts-auto aan, dan ook die van de API.
    const t0 = await leesToestand($)
    if (!t0.auto) {
      const staat = (await leesAccountsStaat($)) as { instellingen?: unknown } | undefined
      if (staat && instellingenVan(staat.instellingen).auto) await bewaarToestand($, { ...t0, auto: true })
    }
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
    if (naar === 'openrouter') return await zetOrKlaar($, reden, opties)
    const r = await cli($, ['modus', naar])
    const t = await leesToestand($)
    const nu = await $.clock.now()
    const { overgeschakeldDoor: _oud, handmatigTot: _hand, ...rest } = t
    if (r.exitCode !== 0) {
      const uitleg =
        r.exitCode === 3 ? `${foutVan(r).replace(/^in \S+settings\.json/, 'in ~/.claude/settings.json')}.`
        : r.exitCode === 4 ? 'er staat nog geen key in de sleutelhanger.'
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
        naar === 'api' ? 'Nieuwe terminal-sessies gebruiken je API-key al.' : 'Nieuwe terminal-sessies gebruiken je abonnement al.',
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
        : `Terug naar het abonnement (${reden}). Nieuwe terminal-sessies gebruiken weer je abonnement. Deze sessie en de desktop-app houden hun eigen login.`,
    )
    await verversApi($)
    return true
  } finally {
    wisselt = false
  }
}

// OpenRouter wisselt nooit: futureflow zet `claude-or` klaar (eigen settings-bestand en shim, via de
// CLI) en zegt dat de gebruiker daar zelf een sessie mee start. Andere sessies en de desktop-app
// blijven op het abonnement. Automatisch (`opties.auto`): alleen een melding, hoogstens één per venster
// (store `api.orGemeldTot`). Geeft false: er is niet gewisseld.
async function zetOrKlaar($: Engine, reden: string, opties: { door?: Door; auto?: boolean }): Promise<boolean> {
  const nu = await $.clock.now()
  if (opties.auto) {
    const tot = Number(await $.store.get('api.orGemeldTot')) || 0
    if (nu < tot) return false
    await $.store.set('api.orGemeldTot', opties.door?.resetsAt ?? nu + 5 * 3_600_000)
  }
  const k = await orKeuze($)
  if (!k.model || !k.snel) {
    if (!opties.auto) $.ui.toast('Kies eerst een hoofdmodel en een snel model in de lijst.')
    return false
  }
  const r = await cli($, ['modus', 'openrouter', '--model', k.model, '--snel', k.snel])
  await verversApi($)
  if (r.exitCode !== 0) {
    const uitleg = r.exitCode === 4 ? 'er staat nog geen OpenRouter-key in de sleutelhanger.' : `${foutVan(r)}.`
    $.ui.toast(`${START} niet klaargezet: ${uitleg}`)
    return false
  }
  const d = laatsteJson(r.stdout)
  const start = d.opPad === false && typeof d.shim === 'string' ? d.shim.replace(/^\/Users\/[^/]+/, '~') : START
  $.ui.toast(
    opties.auto
      ? `Je abonnement zit vol (${reden}). Verder op OpenRouter? Klik Herstart op OpenRouter boven de prompt, of start een nieuwe sessie met ${start}; andere sessies en de desktop-app blijven op je abonnement.`
      : `Klaar. Klik Herstart op OpenRouter boven de prompt, of start een OpenRouter-sessie met ${start}; andere sessies en de desktop-app blijven op je abonnement.`,
  )
  // Bij elke wissel naar OpenRouter: de vraag met de knop Herstart op OpenRouter boven de prompt.
  await vraagHerstart($, opties.auto ? `Abonnement vol (${reden}).` : 'Deze sessie op OpenRouter voortzetten.')
  return false
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

// Voor de kaart Automatisch wisselen: auto van de API aan of uit. '' = gelukt, anders de reden.
// Aan- of uitzetten beëindigt ook een keuze met de hand. Een API-key is niet nodig: zonder key slaat
// de ketting de stap API over.
export async function zetApiAuto($: Engine, aan: boolean): Promise<string> {
  const t = await leesToestand($)
  if (aan) {
    const status = (await read($, statusAtom)) ?? (await leesStatus($))
    if (status.vreemdeHelper) return 'In ~/.claude/settings.json staat al een andere apiKeyHelper; futureflow laat die staan en wisselt niet.'
  }
  const { handmatigTot: _hand, ...rest } = t
  await bewaarToestand($, { ...rest, auto: aan })
  return ''
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

// Onderdelen van de lijst Bronnen in de tab Wisselen: de regel Abonnement (terug naar het abonnement)
// en Anthropic API. Tekent alleen; schrijven gebeurt in onPress/onSubmit.
// `meer`: ook Key wissen, de key-invoer als er al een key is, de kosten en de uitleg (Meer ▸).
export async function apiBron($: Engine, e: any, k: Kleuren, meer = true): Promise<{ abonnement: RenderElement[]; rijen: RenderElement[]; kaarten: RenderElement[] }> {
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
    const opAbo = !opApi
    const kop = (sleutel: string, naam: string, aan: boolean) => (
      <Text key={sleutel} wrap="truncate-end">
        <Text color={aan ? k.accent : k.fg}>{aan ? '● ' : '○ '}</Text>
        <Text bold color={aan ? k.accent : k.fg}>{naam}</Text>
        <Text color={k.mut}>{aan ? '  · in gebruik' : ''}</Text>
      </Text>
    )

    const abonnement: RenderElement[] = [
      <Box key="api-bron-abonnement" flexDirection="column">
        {kop('api-kop-abonnement', 'Abonnement', opAbo)}
        {t.overgeschakeldDoor && !opAbo ? (
          <Text color={k.warn} wrap="wrap">Automatisch naar API door het {t.overgeschakeldDoor.label}-venster; terug na de reset.</Text>
        ) : ''}
        {t.auto && t.handmatigTot !== undefined && t.handmatigTot > nu ? (
          <Text color={k.warn} wrap="wrap">Met de hand gekozen: automatisch wisselen wacht tot {wanneer(t.handmatigTot, nu)} (of tot je het uit- en aanzet).</Text>
        ) : ''}
        {t.auto && !opAbo && !t.overgeschakeldDoor ? (
          <Text color={k.warn} wrap="wrap">Met de hand op API: automatisch wisselen zet dit niet terug.</Text>
        ) : ''}
        {status.vreemdeHelper ? (
          <Text color={k.err} wrap="wrap">In ~/.claude/settings.json staat al een andere apiKeyHelper. futureflow laat die staan en wisselt niet.</Text>
        ) : ''}
        {status.vreemdeBasis ? (
          <Text color={k.err} wrap="wrap">In ~/.claude/settings.json staat al een andere ANTHROPIC_BASE_URL. futureflow laat die staan en wisselt niet naar API of OpenRouter.</Text>
        ) : ''}
        {status.fout ? <Text color={k.err} wrap="truncate-end">Status niet volledig gelezen: {status.fout}</Text> : ''}
        {opAbo ? '' : <Box paddingLeft={2}>{knop(ui, 'api-abonnement', 'Gebruik nu', () => handmatig($, 'abonnement'))}</Box>}
      </Box>,
    ]

    const rijen: RenderElement[] = [
      <Box key="api-bron-api" flexDirection="column" marginTop={1}>
        {kop('api-kop-api', 'Anthropic API', opApi)}
        <Text wrap="truncate-end">
          <Text color={k.mut}>{'  Key: '}</Text>
          {status.heeftKey ? <Text>{`sk-ant-…${status.staart}`}</Text> : <Text color={k.mut}>geen key</Text>}
        </Text>
        {!status.heeftKey || meer ? (
          <Input key="api-key" label="Key " placeholder="sk-ant-…" value="" submitLabel="bewaar" onSubmit={(waarde: string) => bewaarKey($, waarde)} />
        ) : ''}
        {!status.heeftKey || meer ? uitleg(ui, INVOER_UITLEG, 'api-invoer-uitleg') : ''}
        {opApi && !meer ? '' : (
          <Box flexDirection="row" flexWrap="wrap" columnGap={1} paddingLeft={2}>
            {opApi ? '' : knop(ui, 'api-api', 'Gebruik nu', () => handmatig($, 'api'))}
            {meer && status.heeftKey ? knop(ui, 'api-wis', 'Key wissen', () => wisKey($)) : ''}
          </Box>
        )}
      </Box>,
    ]

    const kaarten: RenderElement[] = meer ? [
      kaart(ui, 'Anthropic API: kosten en uitleg', [
        <Text key="api-kosten">
          <Text color={k.mut}>vandaag </Text>
          <Text bold>{usd(geld.vandaag)}</Text>
          <Text color={k.mut}>  ·  deze maand </Text>
          <Text bold>{usd(geld.maand)}</Text>
        </Text>,
        uitleg(ui, 'Schatting op basis van de prijslijst; geen harde stop.', 'api-kosten-uitleg'),
        <Box key="api-uitleg" flexDirection="column" marginTop={1}>
          {UITLEG.map((regel, i) => uitleg(ui, regel, `api-uitleg-${i}`))}
        </Box>,
      ]),
    ] : []

    return { abonnement, rijen, kaarten }
  } catch (err) {
    failOpen($, err)
    return { abonnement: [], rijen: [<Text key="api-kapot" dimColor>API laden lukte niet; de fout staat in het logboek van de mod.</Text>], kaarten: [] }
  }
}
