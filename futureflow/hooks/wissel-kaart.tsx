import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, RenderElement } from 'claude-code'

import type { AccountsStatus, ApiStatus, ApiToestand } from '../types'

import { zetAccountsInstellingen } from './accounts'
import { apiMeet, bewaarApiToestand, orKeuze, zetApiAuto } from './api'
import { failOpen, leesAccountsStaat } from './ctx'
import { kaart, knop, paneelVan, uitleg, vinkje } from './paneel-ui'
import type { PaneelKleuren } from './paneel-ui'

import { statusVan } from '../lib/accounts.mjs'
import { limietenVan, toestandVan } from '../lib/api.mjs'
import type { Stap } from '../lib/api.mjs'
import { grensVan, wisselOverzicht } from '../lib/wissel.mjs'

// Kaart Automatisch wisselen: één kaart, gelijk in de tabs API, Accounts en OpenRouter. Eén schakelaar
// voor API-auto en accounts-auto samen, de ketting als genummerde lijst met de stand van nu, per stap
// aan/uit, en één paar grenzen. Tekent alleen; schrijven gebeurt in onPress/onSubmit. Tekenen start
// geen CLI: de status komt uit de atoms van de tabs, anders uit accounts.json en $.store.

// Dezelfde atoms als in hooks/api.tsx en hooks/accounts.tsx.
const apiStatusAtom = atom({ plugin: 'futureflow', key: 'api.status' } as const, null as ApiStatus | null)
const toestandAtom = atom({ plugin: 'futureflow', key: 'api.toestand' } as const, null as ApiToestand | null)
const accStatusAtom = atom({ plugin: 'futureflow', key: 'accounts.status' } as const, null as AccountsStatus | null)
const versieAtom = atom({ plugin: 'futureflow', key: 'wissel.versie' } as const, 0)

const AUTO_UITLEG =
  'Automatisch wisselen staat aan. Bij de grens gaan nieuwe terminal-sessies naar de volgende stap in de lijst; de Anthropic API en OpenRouter kosten geld per token (geschat in hun tab). Terug naar je abonnement na de reset. Deze sessie en de desktop-app houden hun eigen login.'

async function hertekenen($: Engine): Promise<void> {
  await update($, versieAtom, n => (n ?? 0) + 1)
}

async function leesToestand($: Engine): Promise<ApiToestand> {
  return toestandVan(await $.store.get('api.toestand'))
}

// De accounts zoals de tab ze het laatst las, anders uit accounts.json (zonder verbruik).
async function leesAccounts($: Engine): Promise<AccountsStatus> {
  return (await read($, accStatusAtom)) ?? (statusVan(await leesAccountsStaat($), await $.clock.now()) as AccountsStatus)
}

// ---- acties (alleen in onPress/onSubmit) ----

// De ene schakelaar: API-auto en accounts-auto samen aan of uit.
async function zetAuto($: Engine): Promise<void> {
  try {
    const t = await leesToestand($)
    const acc = await leesAccounts($)
    const aan = !(t.auto || acc.instellingen.auto)
    const fout = await zetApiAuto($, aan)
    if (fout) {
      $.ui.toast(fout)
      return
    }
    const accFout = await zetAccountsInstellingen($, { auto: aan })
    const extra = accFout ? ` Wisselen tussen accounts niet aangepast: ${accFout}.` : ''
    if (aan && !(await $.store.get('api.autoUitgelegd'))) {
      await $.store.set('api.autoUitgelegd', true)
      $.ui.toast(AUTO_UITLEG + extra)
    } else {
      $.ui.toast((aan ? 'Automatisch wisselen staat aan.' : 'Automatisch wisselen staat uit.') + extra)
    }
    // Meteen kijken: staat een venster al boven de grens, dan nu wisselen (na de wachttijd).
    if (aan) await apiMeet($)
  } catch (err) {
    failOpen($, err)
  } finally {
    await hertekenen($).catch(() => undefined)
  }
}

// Stap 2 (ander abonnement) = accounts-auto.
async function zetStapAccount($: Engine): Promise<void> {
  try {
    const t = await leesToestand($)
    const acc = await leesAccounts($)
    if (!t.auto && !acc.instellingen.auto) {
      $.ui.toast('Zet eerst Automatisch wisselen aan.')
      return
    }
    const aan = !acc.instellingen.auto
    const fout = await zetAccountsInstellingen($, { auto: aan })
    if (fout) $.ui.toast(`Niet aangepast: ${fout}.`)
    else if (aan && acc.accounts.filter(a => a.inRotatie).length < 2) $.ui.toast('Ander abonnement staat aan; dat werkt vanaf twee accounts in de rotatie (tab Accounts).')
  } catch (err) {
    failOpen($, err)
  } finally {
    await hertekenen($).catch(() => undefined)
  }
}

// Stap API of OpenRouter in of uit de ketting. OpenRouter aanzetten mag zonder key of model, maar dan
// zegt een toast dat de ketting hem overslaat tot die er zijn.
async function zetStap($: Engine, stap: Stap): Promise<void> {
  try {
    const t = await leesToestand($)
    const aan = t.stappen.includes(stap)
    await bewaarApiToestand($, { ...t, stappen: aan ? t.stappen.filter(x => x !== stap) : [...t.stappen, stap] })
    if (!aan && stap === 'openrouter') {
      const k = await orKeuze($)
      const status = await read($, apiStatusAtom)
      const key = status ? status.orHeeftKey === true : (await $.store.get('openrouter.heeftKey')) === true
      if (!key || !k.model || !k.snel) $.ui.toast('OpenRouter staat in de lijst, maar wordt overgeslagen tot er een key en beide modellen zijn.')
      else $.ui.toast('OpenRouter wisselt nooit vanzelf: zit je abonnement vol, dan zegt futureflow dat je een sessie met claude-or kunt starten.')
    }
  } catch (err) {
    failOpen($, err)
  } finally {
    await hertekenen($).catch(() => undefined)
  }
}

async function draaiVolgorde($: Engine): Promise<void> {
  try {
    const t = await leesToestand($)
    await bewaarApiToestand($, { ...t, stappen: t.stappen.slice().reverse() })
  } catch (err) {
    failOpen($, err)
  } finally {
    await hertekenen($).catch(() => undefined)
  }
}

// "Wissel vanaf %": de grens van de API (`hoog`) én de marges 5u en 7d van de accounts.
async function zetVanaf($: Engine, invoer: string): Promise<void> {
  try {
    const t = await leesToestand($)
    const g = grensVan('hoog', invoer, t.laag)
    if (g.fout !== undefined) {
      $.ui.toast(g.fout)
      return
    }
    await bewaarApiToestand($, { ...t, hoog: g.n })
    const fout = await zetAccountsInstellingen($, { marge5u: g.n, marge7d: g.n })
    if (fout) $.ui.toast(`Grens voor de API gezet; voor de accounts niet: ${fout}.`)
  } catch (err) {
    failOpen($, err)
  } finally {
    await hertekenen($).catch(() => undefined)
  }
}

// "Terug onder %": de grens van de API om terug te gaan (`laag`).
async function zetTerug($: Engine, invoer: string): Promise<void> {
  try {
    const t = await leesToestand($)
    const g = grensVan('laag', invoer, t.hoog)
    if (g.fout !== undefined) $.ui.toast(g.fout)
    else await bewaarApiToestand($, { ...t, laag: g.n })
  } catch (err) {
    failOpen($, err)
  } finally {
    await hertekenen($).catch(() => undefined)
  }
}

// ---- tekenen ----

export async function wisselKaart($: Engine, e: any, k: PaneelKleuren): Promise<RenderElement> {
  const el = $.ui.resolve(e)
  const { Box, Text, Input } = el
  try {
    await read($, versieAtom) // opnieuw tekenen na een actie
    const ui = paneelVan(el, e, k)
    const t = toestandVan((await read($, toestandAtom)) ?? (await $.store.get('api.toestand')))
    const status = await read($, apiStatusAtom)
    const acc = await leesAccounts($)
    const nu = await $.clock.now()
    const limieten = await $.session.usage().then(u => limietenVan(u.rateLimits), () => [])
    const keuze = await orKeuze($)
    const o = wisselOverzicht({
      modus: status && !status.fout ? status.modus : t.modus,
      apiAuto: t.auto,
      stappen: t.stappen,
      hoog: t.hoog,
      laag: t.laag,
      accounts: acc as any,
      limieten,
      // Onbekend telt als wel, zoals in de ketting (`beschikbaarheid`).
      apiKey: status ? status.heeftKey : (await $.store.get('api.heeftKey')) !== false,
      orKey: status ? status.orHeeftKey === true : (await $.store.get('openrouter.heeftKey')) === true,
      ...(keuze.model ? { orModel: keuze.model } : {}),
      ...(keuze.snel ? { orSnel: keuze.snel } : {}),
      ...(status?.orModel ? { orNu: status.orModel } : {}),
    } as any)
    const stapAan = (x: Stap) => t.stappen.includes(x)

    return kaart(ui, 'Automatisch wisselen', [
      <Text key="wissel-nu" wrap="wrap">
        <Text color={k.mut}>{'Je werkt nu op: '}</Text>
        <Text bold>{o.nuOp}</Text>
      </Text>,
      <Box key="wissel-lijst" flexDirection="column" marginTop={1}>
        {o.regels.map(r => (
          <Text key={`wissel-stap-regel-${r.sleutel}`} wrap="wrap">
            <Text color={r.dim ? k.mut : k.fg}>{r.tekst}</Text>
            {r.nu ? <Text bold color={k.accent}>{'  ← nu'}</Text> : ''}
          </Text>
        ))}
      </Box>,
      <Box key="wissel-uitleg" flexDirection="column" marginTop={1}>
        <Text wrap="wrap">{o.zinnen[0]}</Text>
        <Text wrap="wrap">{o.zinnen[1]}</Text>
        {uitleg(ui, o.noot, 'wissel-noot')}
      </Box>,
      <Box key="wissel-schakelaar" marginTop={1}>
        {vinkje(ui, 'wissel-auto', o.aan, 'Automatisch wisselen', () => zetAuto($))}
      </Box>,
      uitleg(ui, 'Stappen in de lijst:', 'wissel-stappen-kop'),
      <Box key="wissel-stappen" flexDirection="row" flexWrap="wrap" columnGap={2}>
        {vinkje(ui, 'wissel-stap-account', o.accAuto, 'Ander abonnement', () => zetStapAccount($))}
        {vinkje(ui, 'wissel-stap-api', stapAan('api'), 'Anthropic API', () => zetStap($, 'api'))}
        {vinkje(ui, 'wissel-stap-openrouter', stapAan('openrouter'), 'OpenRouter (melding)', () => zetStap($, 'openrouter'))}
      </Box>,
      <Input key="wissel-hoog" label="Wissel vanaf % " value={String(t.hoog)} submitLabel="zet" onSubmit={(waarde: string) => zetVanaf($, waarde)} />,
      <Input key="wissel-laag" label="Terug onder %  " value={String(t.laag)} submitLabel="zet" onSubmit={(waarde: string) => zetTerug($, waarde)} />,
    ], {
      rechts: o.aan ? 'aan' : 'uit',
      knoppen: t.stappen.length === 2
        ? <Box marginTop={1}>{knop(ui, 'wissel-volgorde', t.stappen[0] === 'api' ? 'OpenRouter vóór API' : 'API vóór OpenRouter', () => draaiVolgorde($))}</Box>
        : null,
    })
  } catch (err) {
    failOpen($, err)
    return <Text dimColor>Automatisch wisselen laden lukte niet; de fout staat in het logboek van de mod.</Text>
  }
}
