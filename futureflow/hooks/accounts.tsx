import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register, RenderElement } from 'claude-code'

import type { AccountsAccount, AccountsMelding, AccountsStatus, AccountsVraag, AccountsWacht, DashboardTab } from '../types'

import { apiToestand, wissel as apiWissel } from './api'
import { accountsDir, failOpen, leesAccountsStaat } from './ctx'
import { openDashboard, PANE } from './paneel'

import { handmatigTotVan, ketting, kettingAan, kettingInvoerVan, maskEmail, statusVan, VERS } from '../lib/accounts.mjs'
import type { KettingBesluit } from '../lib/accounts.mjs'
import { dagSleutel, limietenVan } from '../lib/api.mjs'

// Tab Accounts: wisselen tussen Colins eigen, apart betaalde Claude-abonnementen in de terminal.
// Alles met de sleutelhanger, ~/.claude.json, de locks van Claude Code en het netwerk gaat via
// cli/accounts.mjs. De mod tekent de tab, schrijft zijn eigen sessiebestand (bezig/tussen/weg) en
// beslist na een beurt of meting of er gewisseld moet worden (`ketting`): eerst een ander abonnement
// met ruimte, pas als alle vol zitten de API (hooks/api.tsx), en terug zodra een abonnement weer ruimte heeft.
// Deze module heeft geen eigen ongematchte handler: register.tsx, de skin, minify.tsx en slots.tsx
// roepen de functies hieronder aan.

const statusAtom = atom({ plugin: 'futureflow', key: 'accounts.status' } as const, null as AccountsStatus | null)
const versieAtom = atom({ plugin: 'futureflow', key: 'accounts.versie' } as const, 0)
const vraagAtom = atom({ plugin: 'futureflow', key: 'accounts.vraag' } as const, null as AccountsVraag | null)
const wachtAtom = atom({ plugin: 'futureflow', key: 'accounts.wacht' } as const, null as AccountsWacht | null)
const meldingAtom = atom({ plugin: 'futureflow', key: 'accounts.melding' } as const, null as AccountsMelding | null)
// Tot wanneer auto een keuze met de hand laat staan (ms; null = geen); dezelfde waarde staat in $.store.
const handmatigAtom = atom({ plugin: 'futureflow', key: 'accounts.handmatigTot' } as const, null as number | null)
const desktopAtom = atom({ plugin: 'futureflow', key: 'accounts.desktop' } as const, false)
const wegAtom = atom({ plugin: 'futureflow', key: 'accounts.weg' } as const, null as number | null)
// Zelfde atom als in dashboard.tsx en paneel.ts: welke tab open staat.
const tabAtom = atom({ plugin: 'futureflow', key: 'dashboard.tab' } as const, null as DashboardTab | null)

export type Kleuren = { accent: string; mut: string; fg: string; ok: string; warn: string; err: string }

const DESKTOP_ZIN = 'De desktop-app regelt zijn eigen login; wisselen werkt alleen voor terminal-sessies.'
const EIGEN_ZIN = 'Deze sessie draait met een eigen profiel (CLAUDE_CONFIG_DIR); wisselen werkt alleen met het standaardprofiel.'
const OPNIEUW_ZIN = 'log in met /login en kies Huidige login toevoegen'
const UITLEG = [
  'Elk account is een apart betaald abonnement; futureflow wisselt alleen tussen accounts die je zelf toevoegde.',
  'Nooit /logout tussen accounts: log in met /login en kies daarna Huidige login toevoegen.',
  'Alleen terminal: nieuwe terminal-sessies gebruiken het nieuwe account, lopende binnen ongeveer 30 s. De desktop-app houdt zijn eigen login.',
  'Gewisseld wordt pas als geen terminal-sessie midden in een beurt zit; sessies zonder futureflow tellen mee via de sessiebestanden van Claude Code.',
]
const HULP = 'Gebruik: /accounts [lijst | toevoegen | wissel <n>]'

const MEET_MS = 60_000 // hoogstens één besluit per minuut per sessie
const VERS_MS = 30_000 // tab open: status opnieuw lezen
const HARTSLAG_MS = 30_000
const MELDING_MS = 10_000
const NIET_NU_MS = 30 * 60_000
const FOUT_PAUZE_MS = 30 * 60_000
const NIET_NU = 'accounts.nietNuTot'
const HANDMATIG = 'accounts.handmatigTot'
const AUTO_DOOR = 'accounts.autoDoor' // venster van de laatste automatische account-wissel
const SESSIE_ID = /^[A-Za-z0-9._-]{1,128}$/

// `env` van $.process.run komt bovenop die van de host: zo bereiken testvariabelen of een eigen
// SECURITY_BIN uit een settings-`env`-blok de CLI niet. Leeg = de standaard van de CLI.
const CLI_ENV = {
  SECURITY_BIN: '/usr/bin/security',
  ACCOUNTS_HOME: '',
  CLAUDE_JSON: '',
  CLAUDE_HOME: '',
  ACCOUNTS_API: '',
  KEYCHAIN_USER: '',
  ACCOUNTS_TEST_NU: '',
  ACCOUNTS_TEST_LOCK_WACHT: '',
}

// Per sessie (één module-instantie).
let opDesktop = false
let sessie: string | undefined
let beurtBezig = false
let sessieStatus: 'bezig' | 'tussen' | 'weg' | undefined
let sessieSinds = 0
let laatsteHartslag = 0
let schrijfRij: Promise<void> = Promise.resolve()
let laatsteMeting: number | undefined
let meetLoopt = false
let wisselt = false
let pauzeTotBeurt = false
let foutPauzeTot = 0
let wachtSinds: number | undefined
let goedgekeurd: number | undefined
let gezienWissel: number | undefined
let ticker: { cancel(): void } | undefined

function cliPath($: Engine): string {
  return `${$.plugin.root}/cli/accounts.mjs`
}

// Draait cli/accounts.mjs. De desktop-app heeft een kaal PATH en argv[0] wordt daarop gezocht,
// dus `node` via /usr/bin/env met een PATH waar Homebrew vooraan staat.
async function cli($: Engine, args: string[]) {
  // Een wissel kan per lock tot 9 s wachten en een refresh 5 s duren. Een switch krijgt 120 s: de CLI
  // stopt zelf vóór het schrijven als hij na 30 s nog niet zover is, en schrijven + terugdraaien moet
  // daarna nog passen (een afgebroken wissel laat anders een half gewisselde login achter).
  const init = { timeoutMs: args[0] === 'switch' ? 120_000 : 60_000 }
  if ((await $.env.get('OS')) === 'Windows_NT') return $.process.run(['node', cliPath($), ...args], { ...init, env: CLI_ENV })
  const hostPath = (await $.env.get('PATH')) ?? ''
  const PATH = `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${hostPath}`
  return $.process.run(['/usr/bin/env', 'node', cliPath($), ...args], { ...init, env: { ...CLI_ENV, PATH } })
}

type Uitkomst = { code: number; data: any; fout: string }

// De CLI print altijd één JSON-regel, ook bij een fout (`{ fout, code, … }`).
async function draai($: Engine, args: string[]): Promise<Uitkomst> {
  const r = await cli($, args)
  let data: any = {}
  try {
    data = JSON.parse(r.stdout.trim().split('\n').pop() || '{}') ?? {}
  } catch {
    data = {}
  }
  const fout = (typeof data.fout === 'string' ? data.fout : r.stderr.trim().replace(/^\[accounts\] /, '')).slice(0, 200)
  return { code: r.exitCode, data, fout: fout || (r.exitCode === 0 ? '' : `exitcode ${r.exitCode}`) }
}

// Voor losse taken (na de beurt, timers): failOpen mag daar zelf niet meer gooien, ook niet als de
// sessie intussen voorbij is.
function losFout($: Engine, err: unknown): void {
  try {
    failOpen($, err)
  } catch {
    // sessie voorbij
  }
}

const melding = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 200)

// Status uit de CLI (geen netwerk, geen sleutelhanger); een fout komt terug in `fout`.
async function leesStatus($: Engine): Promise<AccountsStatus> {
  const nu = await $.clock.now()
  try {
    const u = await draai($, ['status', '--json'])
    if (u.code !== 0) return { ...statusVan({}, nu), fout: u.fout }
    return statusVan(u.data, nu)
  } catch (err) {
    return { ...statusVan({}, nu), fout: melding(err) }
  }
}

async function ververs($: Engine): Promise<AccountsStatus> {
  const s = await leesStatus($)
  await update($, statusAtom, () => s)
  const tot = await leesHandmatig($)
  await update($, handmatigAtom, () => tot)
  return s
}

async function leesHandmatig($: Engine): Promise<number | null> {
  const tot = Number(await $.store.get(HANDMATIG)) || 0
  return tot > 0 ? tot : null
}

async function zetHandmatig($: Engine, tot: number | null): Promise<void> {
  await $.store.set(HANDMATIG, tot ?? 0)
  await update($, handmatigAtom, () => tot)
}

async function hertekenen($: Engine): Promise<void> {
  await update($, versieAtom, n => (n ?? 0) + 1)
}

// ---- sessiebestand (alleen terminal) ----

// Schrijft ~/.claude/futureflow/accounts/sessies/<sessie>.json in de vorm van de CLI. Schrijfacties
// gaan na elkaar, zodat een late `bezig` nooit een `tussen` overschrijft.
async function schrijfSessie($: Engine, status: 'bezig' | 'tussen' | 'weg'): Promise<void> {
  if (opDesktop || sessie === undefined) return
  const dir = await accountsDir($)
  if (!dir) return
  const nu = await $.clock.now()
  if (status !== sessieStatus) sessieSinds = nu
  sessieStatus = status
  laatsteHartslag = nu
  const pad = `${dir}/sessies/${sessie}.json`
  const tekst = JSON.stringify({ sessie, status, sinds: sessieSinds, hartslag: nu, terminal: true }) + '\n'
  schrijfRij = schrijfRij.then(() => $.fs.write(pad, tekst).then(() => undefined)).catch(err => losFout($, err))
  await schrijfRij
}

const wisselTijd = (staat: any): number => (typeof staat?.laatsteWissel?.tijd === 'number' ? staat.laatsteWissel.tijd : 0)

// Start van de tab Accounts; register.tsx roept dit aan vanuit zijn ene session.start. Geen CLI.
export async function startAccounts($: Engine): Promise<void> {
  opDesktop = Boolean(await $.env.get('CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH'))
  await update($, desktopAtom, () => opDesktop)
  beurtBezig = false
  pauzeTotBeurt = false
  wachtSinds = undefined
  goedgekeurd = undefined
  laatsteMeting = undefined
  sessieStatus = undefined
  await $.command.register({
    name: 'accounts',
    description: 'Wisselen tussen je eigen Claude-abonnementen in de terminal (tab Accounts van /futureflow)',
    argumentHint: '[lijst | toevoegen | wissel <n>]',
  })
  const id = await $.session.id()
  sessie = typeof id === 'string' && SESSIE_ID.test(id) ? id : undefined
  // Wissels van vóór deze sessie niet melden.
  gezienWissel = opDesktop ? undefined : wisselTijd(await leesAccountsStaat($))
  await schrijfSessie($, 'tussen')
}

// turn.start (via de skin): deze sessie is bezig. Alleen de hoofdlus.
export async function accountsBeurtStart($: Engine, e: { agentId?: string }): Promise<void> {
  try {
    if (e.agentId !== undefined) return
    beurtBezig = true
    pauzeTotBeurt = false
    await schrijfSessie($, 'bezig')
    await kijkWissel($)
  } catch (err) {
    failOpen($, err)
  }
}

// Tijdens een beurt: hartslag hoogstens elke 30 s, zodat een andere sessie ziet dat deze nog bezig is.
async function hartslag($: Engine): Promise<void> {
  if (!beurtBezig || opDesktop) return
  if ((await $.clock.now()) - laatsteHartslag < HARTSLAG_MS) return
  await schrijfSessie($, 'bezig')
}

// turn.complete (via minify.tsx, ná next(e)): tussen beurten, en dan kijken of er gewisseld moet worden.
export async function accountsBeurtKlaar($: Engine, e: { agentId?: string }): Promise<void> {
  if (e.agentId !== undefined) return
  beurtBezig = false
  try {
    await schrijfSessie($, 'tussen')
  } catch (err) {
    failOpen($, err)
  }
  accountsMeetLos($)
}

// session.end (via slots.tsx).
export async function accountsSessieEinde($: Engine): Promise<void> {
  beurtBezig = false
  ticker?.cancel()
  ticker = undefined
  try {
    await schrijfSessie($, 'weg')
  } catch (err) {
    failOpen($, err)
  }
}

// ---- melding na een wissel (ook uit een andere sessie) ----

async function toonMelding($: Engine, tekst: string): Promise<void> {
  const tot = (await $.clock.now()) + MELDING_MS
  await update($, meldingAtom, () => ({ tekst, tot }))
  $.clock.after(MELDING_MS, () => {
    void update($, meldingAtom, m => (m !== null && m.tot <= tot ? null : m)).catch(err => losFout($, err))
  })
}

// Leest accounts.json (geen CLI): is er gewisseld sinds deze sessie het laatst keek, dan 10 s een groene regel.
async function kijkWissel($: Engine): Promise<void> {
  if (opDesktop) return
  const staat = (await leesAccountsStaat($)) as any
  const tijd = wisselTijd(staat)
  if (gezienWissel === undefined) {
    gezienWissel = tijd
    return
  }
  if (tijd <= gezienWissel) return
  gezienWissel = tijd
  const naar = staat.laatsteWissel.naar
  const acc = Array.isArray(staat.accounts) ? staat.accounts.find((a: any) => a?.id === naar) : undefined
  await toonMelding($, `Gewisseld naar account ${naar} (${maskEmail(acc?.email)})`)
}

// ---- automatisch wisselen ----

// Na een beurt en na een meting, los van de beurt: de CLI kan seconden duren. Alleen in de terminal,
// alleen tussen beurten van deze sessie, hoogstens één keer per minuut, en alleen als de ketting
// beslist (accounts-auto aan, twee of meer accounts in de rotatie); anders doet hooks/api.tsx het.
export function accountsMeetLos($: Engine, rateLimits?: unknown): void {
  void (async () => {
    await kijkWissel($)
    await accountsMeet($, rateLimits)
  })().catch(err => losFout($, err))
}

async function accountsMeet($: Engine, rateLimits?: unknown): Promise<void> {
  if (opDesktop || beurtBezig || pauzeTotBeurt || meetLoopt || wisselt) return
  const nu = await $.clock.now()
  if (nu < foutPauzeTot) return
  if (laatsteMeting !== undefined && nu - laatsteMeting < MEET_MS) return
  if (!kettingAan(await leesAccountsStaat($))) {
    await wisVraagEnWacht($)
    return
  }
  laatsteMeting = nu
  meetLoopt = true
  try {
    // Kopie van het actieve account bijwerken (Claude Code roteert zijn token) en verbruik ophalen;
    // de CLI houdt zelf de poll-vloer per account aan. Een fout hier: beslissen op wat er is.
    await draai($, ['sync']).catch(() => undefined)
    await draai($, ['usage', '--refresh']).catch(() => undefined)
    const status = await ververs($)
    // Twijfel = niet wisselen.
    if (status.fout || status.profiel !== 'standaard') return
    const api = await apiToestand($)
    const ruw = rateLimits ?? (await $.session.usage().then(u => u.rateLimits, () => []))
    const handmatigTot = await leesHandmatig($)
    const besluit = ketting({
      ...kettingInvoerVan(status),
      nu: await $.clock.now(),
      api,
      sessieLimieten: limietenVan(ruw),
      ...(handmatigTot !== null ? { handmatigTot } : {}),
    })
    await voerUit($, besluit, status)
  } finally {
    meetLoopt = false
  }
}

async function wisVraagEnWacht($: Engine): Promise<void> {
  wachtSinds = undefined
  goedgekeurd = undefined
  if ((await read($, vraagAtom)) !== null) await update($, vraagAtom, () => null)
  if ((await read($, wachtAtom)) !== null) await update($, wachtAtom, () => null)
}

async function voerUit($: Engine, besluit: KettingBesluit | null, status: AccountsStatus): Promise<void> {
  if (!besluit) {
    await wisVraagEnWacht($)
    return
  }
  if (besluit.soort === 'api') {
    await apiWissel($, besluit.naar, besluit.reden, { ...(besluit.door ? { door: besluit.door } : {}), auto: true })
    return
  }
  const nu = await $.clock.now()
  const nietNuTot = Number(await $.store.get(NIET_NU)) || 0
  if (nu < nietNuTot) return
  const vraag: AccountsVraag = { soort: besluit.soort, naar: besluit.naar, van: status.actief, reden: besluit.reden }
  if (status.instellingen.stand === 'vragen' && goedgekeurd !== besluit.naar) {
    const oud = await read($, vraagAtom)
    if (oud === null || oud.naar !== vraag.naar || oud.soort !== vraag.soort) {
      await update($, vraagAtom, () => vraag)
      $.ui.toast(`futureflow stelt voor te wisselen naar account ${vraag.naar} (${vraag.reden}). Kies Wissel of Niet nu boven de prompt.`)
    }
    return
  }
  const gelukt = await voerWisselUit($, vraag, { auto: true, maxWacht: status.instellingen.maxWacht })
  if (gelukt && vraag.soort === 'account') await $.store.set(AUTO_DOOR, besluit.soort === 'account' && besluit.door ? besluit.door : null)
}

// De wissel zelf. `auto`: een besluit van de ketting (de CLI kijkt dan ook naar de wachttijd).
// Terug van de API naar het actieve account: alleen de modus terugzetten.
async function voerWisselUit($: Engine, vraag: AccountsVraag, o: { auto: boolean; maxWacht: number }): Promise<boolean> {
  if (wisselt) {
    if (!o.auto) $.ui.toast('Er loopt al een wissel; probeer het zo opnieuw.')
    return false
  }
  wisselt = true
  try {
    if (vraag.soort === 'terug' && vraag.naar === vraag.van) {
      await wisVraagEnWacht($)
      return await apiWissel($, 'abonnement', vraag.reden, { auto: true })
    }
    // Nooit midden in een eigen beurt (die kan begonnen zijn terwijl sync en usage liepen); de CLI
    // telt het eigen sessiebestand `bezig` ook. Na de beurt volgt een nieuw besluit.
    if (beurtBezig) {
      if (!o.auto) $.ui.toast('Deze sessie is midden in een beurt; wissel na de beurt.')
      return false
    }
    const args = [
      'switch',
      String(vraag.naar),
      ...(vraag.van !== null ? ['--van', String(vraag.van)] : []),
      ...(sessie !== undefined ? ['--ikzelf', sessie] : []),
      ...(o.auto ? ['--auto'] : []),
    ]
    const u = await draai($, args)
    const nu = await $.clock.now()
    if (u.code === 0) {
      await wisVraagEnWacht($)
      const plan = typeof u.data.plan === 'string' ? `, ${u.data.plan.slice(0, 40)}` : ''
      $.ui.toast(
        `Gewisseld naar account ${vraag.naar} (${maskEmail(u.data.email)}${plan}; ${o.auto ? vraag.reden : 'met de hand'}). Nieuwe terminal-sessies gebruiken dit account, lopende binnen ongeveer 30 s. De desktop-app houdt zijn eigen login.`,
      )
      const s = await ververs($)
      gezienWissel = Math.max(gezienWissel ?? 0, s.laatsteWissel?.tijd ?? nu)
      if (vraag.soort === 'terug') await apiWissel($, 'abonnement', vraag.reden, { auto: true })
      return true
    }
    if (u.code === 7 && !Array.isArray(u.data.wie)) {
      // Bezig zonder sessies (een lock, of de huidige login niet te controleren): niets gewijzigd;
      // het volgende besluit probeert het opnieuw.
      if (!o.auto) $.ui.toast(`Nog niet gewisseld: ${u.fout}.`)
      return false
    }
    if (u.code === 7) {
      wachtSinds ??= nu
      const wie = Array.isArray(u.data.wie) ? u.data.wie.filter((x: unknown): x is string => typeof x === 'string').slice(0, 10) : []
      if (nu - wachtSinds >= o.maxWacht) {
        // Niet blijven proberen: pas na de volgende beurt van deze sessie weer.
        wachtSinds = undefined
        pauzeTotBeurt = true
        await update($, wachtAtom, () => null)
        $.ui.toast('Wacht op een sessie die bezig is; nog niet gewisseld.')
      } else {
        const sinds = wachtSinds
        await update($, wachtAtom, () => ({ sinds, wie, naar: vraag.naar }))
        if (!o.auto) $.ui.toast(`Nog niet gewisseld: ${wie.length || 'een'} andere sessie(s) zitten midden in een beurt.`)
      }
      return false
    }
    await wisVraagEnWacht($)
    if (u.code === 6) {
      if (!o.auto) $.ui.toast(`Niet gewisseld: ${u.fout}.`)
    } else if (u.code === 9) {
      $.ui.toast(`Account ${vraag.naar} moet opnieuw inloggen: ${OPNIEUW_ZIN} (nooit /logout). Niet gewisseld.`)
    } else {
      $.ui.toast(`Niet gewisseld: ${u.fout}`)
      // Een automatische wissel die echt mislukt niet elke minuut opnieuw proberen.
      if (o.auto) foutPauzeTot = nu + FOUT_PAUZE_MS
    }
    await ververs($)
    return false
  } finally {
    wisselt = false
    await hertekenen($).catch(() => undefined)
  }
}

// ---- acties (alleen in onPress/onSubmit en commando's, nooit tijdens het tekenen) ----

async function keurGoed($: Engine): Promise<void> {
  try {
    const vraag = await read($, vraagAtom)
    if (vraag === null) return
    if (beurtBezig) {
      $.ui.toast('Deze sessie is midden in een beurt; kies Wissel na de beurt.')
      return
    }
    goedgekeurd = vraag.naar
    const s = (await read($, statusAtom)) ?? (await ververs($))
    await voerWisselUit($, vraag, { auto: true, maxWacht: s.instellingen.maxWacht })
  } catch (err) {
    failOpen($, err)
  }
}

async function nietNu($: Engine): Promise<void> {
  try {
    await $.store.set(NIET_NU, (await $.clock.now()) + NIET_NU_MS)
    await wisVraagEnWacht($)
    $.ui.toast('Goed; futureflow vraagt het 30 minuten niet opnieuw.')
  } catch (err) {
    failOpen($, err)
  }
}

async function wisselMetDeHand($: Engine, id: number): Promise<boolean> {
  const s = (await read($, statusAtom)) ?? (await ververs($))
  const gelukt = await voerWisselUit($, { soort: 'account', naar: id, van: s.actief, reden: 'met de hand' }, { auto: false, maxWacht: s.instellingen.maxWacht })
  if (gelukt && s.instellingen.auto) {
    // Een keuze met de hand geldt tot de reset van het venster dat de laatste wissel veroorzaakte, anders
    // van het hoogste venster van het gekozen account (zelfde regel als bij de API-wissel).
    const nu = await $.clock.now()
    const na = (await read($, statusAtom)) ?? s
    const door = await $.store.get(AUTO_DOOR)
    await zetHandmatig(
      $,
      handmatigTotVan({
        nu,
        ...(door && typeof door === 'object' ? { door: door as { label: string; resetsAt?: number } } : {}),
        meting: kettingInvoerVan(na).metingen[id],
      }),
    )
    await $.store.set(AUTO_DOOR, null)
    await hertekenen($).catch(() => undefined)
  }
  return gelukt
}

async function voegToe($: Engine): Promise<string> {
  const u = await draai($, ['add'])
  let tekst: string
  if (u.code === 0) {
    const d = u.data
    tekst = `${d.nieuw === false ? 'Bijgewerkt' : 'Toegevoegd'}: account ${d.id} (${maskEmail(d.email)}, ${typeof d.plan === 'string' ? d.plan.slice(0, 40) : '?'}).`
  } else if (u.code === 8) {
    tekst = EIGEN_ZIN
  } else {
    tekst = `Niet toegevoegd: ${u.fout}`
  }
  await ververs($)
  return tekst
}

// Eén actie uit de tab: CLI, één toast, daarna de status opnieuw lezen en hertekenen.
async function actie($: Engine, args: string[], gelukt: (d: any) => string): Promise<void> {
  try {
    const u = await draai($, args)
    $.ui.toast(u.code === 0 ? gelukt(u.data) : `Niet gelukt: ${u.fout}`)
    await ververs($)
  } catch (err) {
    failOpen($, err)
  } finally {
    await hertekenen($).catch(() => undefined)
  }
}

async function zetInstelling($: Engine, deel: Record<string, unknown>, gelukt: string): Promise<void> {
  await actie($, ['instellingen', JSON.stringify(deel)], () => gelukt)
}

async function zetAuto($: Engine): Promise<void> {
  const s = (await read($, statusAtom)) ?? (await ververs($))
  const aan = !s.instellingen.auto
  // Aan- of uitzetten beëindigt ook een keuze met de hand.
  await zetHandmatig($, null)
  const inRotatie = s.accounts.filter(a => a.inRotatie).length
  const extra = aan && inRotatie < 2 ? ' Dat werkt vanaf twee accounts in de rotatie; tot dan geldt alleen de tab API.' : ''
  await zetInstelling(
    $,
    { auto: aan },
    aan ? `Automatisch wisselen tussen accounts staat aan.${extra}` : 'Automatisch wisselen tussen accounts staat uit.',
  )
}

async function zetMarge($: Engine, welke: 'marge5u' | 'marge7d', invoer: string): Promise<void> {
  const n = Number(invoer.trim().replace(/%$/, ''))
  if (!Number.isInteger(n) || n < 50 || n > 99) {
    $.ui.toast('Marge niet veranderd: kies een heel getal van 50 tot 99.')
    await hertekenen($).catch(() => undefined)
    return
  }
  await zetInstelling($, { [welke]: n }, `Marge ${welke === 'marge5u' ? '5u' : '7d'}: ${n}%.`)
}

async function weg($: Engine, id: number): Promise<void> {
  try {
    if ((await read($, wegAtom)) !== id) {
      await update($, wegAtom, () => id)
      return
    }
    await update($, wegAtom, () => null)
    await actie($, ['remove', String(id)], d => `Account ${id} verwijderd uit futureflow.${d.uitleg ? ` Het ${d.uitleg}.` : ''}`)
  } catch (err) {
    failOpen($, err)
  }
}

// Bij het openen van de tab: nu lezen en daarna elke 30 s, tot het paneel dicht is of een andere tab open staat.
export async function openAccounts($: Engine): Promise<void> {
  try {
    await ververs($)
    ticker?.cancel()
    ticker = $.clock.every(VERS_MS, () => {
      void (async () => {
        const open = (await $.ui.panes()).some(p => p.id === PANE) && (await read($, tabAtom)) === 'accounts'
        if (!open) {
          ticker?.cancel()
          ticker = undefined
          return
        }
        await ververs($)
      })().catch(err => losFout($, err))
    })
  } catch (err) {
    failOpen($, err)
  }
}

// ---- tekenen ----

const twee = (n: number) => String(n).padStart(2, '0')
const DAGEN = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za']

// 5u: "14:05" (of "di 11-11 02:05" als het niet vandaag is); 7d: "ma 17-11".
function resetTekst(label: string, ms: number, nu: number): string {
  const d = new Date(ms)
  const datum = `${DAGEN[d.getDay()]} ${twee(d.getDate())}-${twee(d.getMonth() + 1)}`
  if (label === '7d') return datum
  const tijd = `${twee(d.getHours())}:${twee(d.getMinutes())}`
  return dagSleutel(ms) === dagSleutel(nu) ? tijd : `${datum} ${tijd}`
}

function leeftijd(gemetenOp: number, nu: number): string {
  const s = Math.max(0, Math.round((nu - gemetenOp) / 1000))
  if (s < 60) return 'net gemeten'
  const m = Math.round(s / 60)
  return m < 120 ? `${m} min geleden` : `${Math.round(m / 60)} u geleden`
}

const blokjes = (pct: number) => {
  const n = Math.max(0, Math.min(5, Math.round(pct / 20)))
  return '▰'.repeat(n) + '▱'.repeat(5 - n)
}

function vensterTekst(a: AccountsAccount, label: '5u' | '7d', nu: number): string {
  const v = a.gebruik[label]
  if (!v || v.pct === undefined) return `${label} –`
  const voorbij = v.resetsAt !== undefined && v.resetsAt <= nu
  const pct = voorbij ? 0 : Math.round(v.pct)
  const reset = v.resetsAt !== undefined && !voorbij ? ` (${label === '5u' ? 'reset ' : ''}${resetTekst(label, v.resetsAt, nu)})` : ''
  return `${label} ${blokjes(pct)} ${pct}%${reset}`
}

const vinkje = (aan: boolean) => (aan ? '☑' : '☐')

// Inhoud van de tab Accounts. Tekent alleen; schrijven gebeurt in onPress/onSubmit. Zonder gelezen
// status (paneel hersteld zonder openen) leest hij hem één keer zelf, zonder iets te bewaren.
export async function accountsTab($: Engine, e: any, k: Kleuren) {
  const { Box, Text, Button, Input } = $.ui.resolve(e)
  try {
    await read($, versieAtom) // opnieuw tekenen na een actie
    const desktop = await read($, desktopAtom)
    const s = (await read($, statusAtom)) ?? (await leesStatus($))
    const wegId = await read($, wegAtom)
    const wacht = await read($, wachtAtom)
    const handmatig = await read($, handmatigAtom)
    const nu = await $.clock.now()
    const i = s.instellingen
    const kan = !desktop && s.profiel === 'standaard'
    const actief = s.accounts.find(a => a.id === s.actief)

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold color={k.accent}>Accounts</Text>
          <Text>
            <Text color={k.mut}>Nu in de terminal: </Text>
            {actief ? (
              <Text bold color={k.accent}>{`account ${actief.id} (${actief.email})`}</Text>
            ) : (
              <Text color={k.mut}>{s.accounts.length ? 'een login die futureflow niet beheert' : 'nog geen accounts toegevoegd'}</Text>
            )}
          </Text>
          {i.auto && handmatig !== null && handmatig > nu ? (
            <Text color={k.warn}>{`Jouw keuze geldt tot ${resetTekst('5u', handmatig, nu)}; automatisch wisselen wacht tot dan (of tot je het uit- en aanzet).`}</Text>
          ) : null}
          {s.laatsteWissel ? (
            <Text color={k.mut}>{`Laatste wissel: ${resetTekst('5u', s.laatsteWissel.tijd, nu)} naar account ${s.laatsteWissel.naar}${s.laatsteWissel.auto ? ' (automatisch)' : ''}`}</Text>
          ) : null}
          {wacht ? (
            <Text color={k.warn}>{`Wissel naar account ${wacht.naar} wacht op ${wacht.wie.length || 'een'} sessie(s) die midden in een beurt zitten.`}</Text>
          ) : null}
          {desktop ? <Text color={k.warn}>{DESKTOP_ZIN}</Text> : null}
          {!desktop && s.profiel === 'eigen' ? <Text color={k.warn}>{EIGEN_ZIN}</Text> : null}
          {s.fout ? <Text color={k.err} wrap="truncate-end">Status niet volledig gelezen: {s.fout}</Text> : null}
        </Box>

        {kan ? (
          <Box flexDirection="row" gap={2}>
            <Button key="acc-toevoegen" onPress={async () => { try { $.ui.toast(await voegToe($)) } catch (err) { failOpen($, err) } finally { await hertekenen($).catch(() => undefined) } }}>
              Huidige login toevoegen
            </Button>
            {s.accounts.length ? (
              <Button key="acc-ververs" onPress={() => actie($, ['usage', '--refresh', '--nu'], d => {
                const fouten = d.fouten && typeof d.fouten === 'object' ? Object.keys(d.fouten).length : 0
                return fouten ? `Verbruik opgehaald; ${fouten} account(s) gaven een fout (zie de tab).` : 'Verbruik opgehaald.'
              })}>
                Verbruik ophalen
              </Button>
            ) : null}
          </Box>
        ) : null}

        <Box flexDirection="column">
          {s.accounts.map(a => {
            const isActief = a.id === s.actief
            const kleur = a.status === 'opnieuw-inloggen' ? k.err : isActief ? k.accent : k.fg
            const oud = a.gemetenOp !== undefined && nu - a.gemetenOp > VERS
            return (
              <Box key={`acc-rij-${a.id}`} flexDirection="column">
                <Text wrap="truncate-end">
                  <Text color={kleur}>{isActief ? '● ' : '○ '}</Text>
                  <Text bold color={kleur}>{`${a.id}  ${a.email}`}</Text>
                  {a.label ? <Text color={k.mut}>{`  ${a.label}`}</Text> : null}
                  <Text color={k.mut}>{`  ${a.plan}`}</Text>
                  {a.inRotatie ? null : <Text color={k.mut}>{'  (niet in de rotatie)'}</Text>}
                </Text>
                {a.status === 'opnieuw-inloggen' ? (
                  <Text color={k.err}>{`   Opnieuw inloggen nodig: ${OPNIEUW_ZIN}.`}</Text>
                ) : a.status === 'onbekend' ? (
                  <Text color={k.warn} wrap="truncate-end">{`   Status onbekend${a.statusUitleg ? `: ${a.statusUitleg}` : ''}; voeg het opnieuw toe.`}</Text>
                ) : null}
                <Text wrap="truncate-end">
                  <Text>{`   ${vensterTekst(a, '5u', nu)}  ${vensterTekst(a, '7d', nu)}`}</Text>
                  <Text color={oud ? k.warn : k.mut}>
                    {a.gemetenOp === undefined ? '  · nog niet gemeten' : `  · ${leeftijd(a.gemetenOp, nu)}${oud ? ' (te oud voor automatisch wisselen)' : ''}`}
                  </Text>
                </Text>
                {a.fout ? <Text color={k.warn} wrap="truncate-end">{`   Laatste meting mislukt: ${a.fout}`}</Text> : null}
                {kan ? (
                  <Box flexDirection="row" gap={2}>
                    <Text>{'  '}</Text>
                    {isActief ? null : (
                      <Button key={`acc-wissel-${a.id}`} onPress={async () => { try { await wisselMetDeHand($, a.id) } catch (err) { failOpen($, err) } }}>
                        Wissel hierheen
                      </Button>
                    )}
                    <Button key={`acc-rotatie-${a.id}`} onPress={() => actie($, ['zet', String(a.id), 'rotatie', a.inRotatie ? 'uit' : 'aan'], () => (a.inRotatie ? `Account ${a.id} uit de rotatie.` : `Account ${a.id} weer in de rotatie.`))}>
                      <Text>{`${vinkje(a.inRotatie)} In de rotatie`}</Text>
                    </Button>
                    <Button key={`acc-weg-${a.id}`} onPress={() => weg($, a.id)}>
                      {wegId === a.id ? <Text color={k.err}>Zeker? Klik nog eens</Text> : 'Verwijderen'}
                    </Button>
                  </Box>
                ) : null}
              </Box>
            )
          })}
        </Box>

        <Box flexDirection="column">
          {kan ? (
            <Button key="acc-auto" onPress={async () => { try { await zetAuto($) } catch (err) { failOpen($, err) } }}>
              <Text>{`${vinkje(i.auto)} Automatisch wisselen vóór een limiet: eerst een ander abonnement, pas als alle vol zitten de API`}</Text>
            </Button>
          ) : (
            <Text color={k.mut}>{`Automatisch wisselen: ${i.auto ? 'aan' : 'uit'}`}</Text>
          )}
          {kan ? (
            <Input key="acc-marge5u" label="Marge 5u %  " value={String(i.marge5u)} submitLabel="zet" onSubmit={(waarde: string) => zetMarge($, 'marge5u', waarde)} />
          ) : null}
          {kan ? (
            <Input key="acc-marge7d" label="Marge 7d %  " value={String(i.marge7d)} submitLabel="zet" onSubmit={(waarde: string) => zetMarge($, 'marge7d', waarde)} />
          ) : (
            <Text color={k.mut}>{`Marges: 5u ${i.marge5u}%, 7d ${i.marge7d}%`}</Text>
          )}
          <Text color={k.mut}>{`Strategie: meeste ruimte · wachttijd tussen wissels ${Math.round(i.wachttijd / 60_000)} min · alleen metingen jonger dan 15 min`}</Text>
          {kan ? (
            <Box flexDirection="row" gap={2}>
              <Text color={k.mut}>Stand</Text>
              <Button key="acc-stil" onPress={() => zetInstelling($, { stand: 'stil' }, 'Stand stil: futureflow wisselt tussen beurten en meldt het.')}>
                {i.stand === 'stil' ? <Text color={k.ok} bold>Stil</Text> : 'Stil'}
              </Button>
              <Button key="acc-vragen" onPress={() => zetInstelling($, { stand: 'vragen' }, 'Stand eerst vragen: futureflow vraagt boven de prompt voor het wisselt.')}>
                {i.stand === 'vragen' ? <Text color={k.ok} bold>Eerst vragen</Text> : 'Eerst vragen'}
              </Button>
            </Box>
          ) : (
            <Text color={k.mut}>{`Stand: ${i.stand === 'vragen' ? 'eerst vragen' : 'stil'}`}</Text>
          )}
        </Box>

        <Box flexDirection="column">
          {UITLEG.map((regel, n) => (
            <Text key={`acc-uitleg-${n}`} color={k.mut}>{regel}</Text>
          ))}
        </Box>
      </Box>
    )
  } catch (err) {
    failOpen($, err)
    return <Text dimColor>Accounts laden lukte niet; de fout staat in het logboek van de mod.</Text>
  }
}

// De regel boven de prompt (via de skin): wisselmelding, vraag (stand vragen) of wacht; null = niets.
// Leest alleen (ook de klok); schrijft nooit.
export async function accountsRij($: Engine, e: any, k: Kleuren): Promise<RenderElement | null> {
  try {
    if (await read($, desktopAtom)) return null
    const melding = await read($, meldingAtom)
    const vraag = await read($, vraagAtom)
    const wacht = await read($, wachtAtom)
    const nu = await $.clock.now()
    const toonMelding = melding !== null && melding.tot > nu
    if (!toonMelding && vraag === null && wacht === null) return null
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {toonMelding ? <Text key="acc-melding" color={k.ok} wrap="truncate-end">{melding!.tekst}</Text> : null}
        {vraag !== null ? (
          <Box key="acc-vraag" flexDirection="row" columnGap={2}>
            <Box flexGrow={1} flexShrink={1}>
              <Text color={k.warn} wrap="truncate-end">{`Wisselen naar account ${vraag.naar}? ${vraag.reden}`}</Text>
            </Box>
            <Button key="acc-vraag-ja" onPress={() => keurGoed($)}>Wissel</Button>
            <Button key="acc-vraag-nee" onPress={() => nietNu($)}>Niet nu</Button>
          </Box>
        ) : null}
        {wacht !== null ? (
          <Text key="acc-wacht" color={k.warn} wrap="truncate-end">{`Wissel naar account ${wacht.naar} wacht op ${wacht.wie.length || 'een'} sessie(s) die midden in een beurt zitten.`}</Text>
        ) : null}
      </Box>
    )
  } catch (err) {
    failOpen($, err)
    return null
  }
}

// /accounts lijst: één regel per account.
function lijstTekst(s: AccountsStatus, nu: number): string {
  if (s.fout) return `Accounts niet gelezen: ${s.fout}`
  if (!s.accounts.length) return 'Nog geen accounts. Log in met /login en kies /accounts toevoegen (nooit /logout tussen accounts).'
  const regels = s.accounts.map(a => {
    const mark = a.id === s.actief ? '●' : '○'
    const status = a.status === 'opnieuw-inloggen' ? `  opnieuw inloggen: ${OPNIEUW_ZIN}` : a.status === 'onbekend' ? '  status onbekend' : ''
    const wanneer = a.gemetenOp === undefined ? 'nog niet gemeten' : leeftijd(a.gemetenOp, nu)
    return `${mark} ${a.id}  ${a.email}  ${a.plan}  ${vensterTekst(a, '5u', nu)}  ${vensterTekst(a, '7d', nu)}  · ${wanneer}${a.inRotatie ? '' : '  (niet in de rotatie)'}${status}`
  })
  return [...regels, `Automatisch wisselen: ${s.instellingen.auto ? 'aan' : 'uit'}.${opDesktop ? ` ${DESKTOP_ZIN}` : ''}`].join('\n')
}

export const registerAccounts = (on: Parameters<Register>[0]): void => {
  on('command.run', { command: 'accounts' }, async ($, e) => {
    try {
      const woorden = (e.args ?? '').trim().split(/\s+/).filter(Boolean)
      const woord = (woorden[0] ?? '').toLowerCase()
      if (!woord) {
        await openAccounts($)
        await openDashboard($, 'accounts')
        return { text: 'Dashboard geopend op de tab Accounts.' }
      }
      if (woord === 'lijst') return { text: lijstTekst(await ververs($), await $.clock.now()) }
      if (woord === 'toevoegen') {
        if (opDesktop) return { text: DESKTOP_ZIN }
        return { text: await voegToe($) }
      }
      if (woord === 'wissel') {
        if (opDesktop) return { text: DESKTOP_ZIN }
        const id = Number(woorden[1])
        if (!Number.isInteger(id) || id < 1) return { text: HULP }
        await ververs($)
        const ok = await wisselMetDeHand($, id)
        return { text: ok ? `Gewisseld naar account ${id}.` : `Niet gewisseld naar account ${id}; de reden staat in de melding.` }
      }
      return { text: HULP }
    } catch (err) {
      failOpen($, err)
      return { text: 'Dat lukte niet; de fout staat in het logboek van de mod.' }
    }
  })

  // Hartslag tijdens een beurt; alleen schrijven, nooit de aanroep zelf laten mislukken.
  on('tool.call', { tool: /^/ }, async ($, e, next) => {
    try {
      void hartslag($).catch(err => losFout($, err))
    } catch (err) {
      failOpen($, err)
    }
    return next(e)
  })
}
