// Kaart Automatisch wisselen (hooks/wissel-kaart.tsx): wat er in de kaart staat, uit de instellingen
// en de laatste metingen. Pure functies, zonder Node-API's. Beslist niets: dat doen `beslis` en `ketting`.

import { kettingInvoerVan, maskEmail, ruimte } from './accounts.mjs'
import { STAPPEN } from './api.mjs'

const NAMEN = { abonnement: 'Je abonnement', account: 'Ander abonnement', api: 'Anthropic API', openrouter: 'OpenRouter' }
const getal = v => typeof v === 'number' && Number.isFinite(v)

// "5u 42% · 7d 18%" uit de eigen rate limits van de sessie, anders uit de laatste meting van het
// actieve account; null als er niets gemeten is.
function vensterTekst(limieten, actief, nu) {
  const uitSessie = {}
  for (const l of Array.isArray(limieten) ? limieten : []) {
    if (l && (l.label === '5u' || l.label === '7d') && getal(l.percent)) uitSessie[l.label] = l.percent
  }
  const pct = {}
  if (Object.keys(uitSessie).length) Object.assign(pct, uitSessie)
  else if (actief) {
    for (const label of ['5u', '7d']) {
      const v = actief.gebruik?.[label]
      if (v && getal(v.pct)) pct[label] = getal(v.resetsAt) && v.resetsAt <= nu ? 0 : v.pct
    }
  }
  if (!Object.keys(pct).length) return null
  return ['5u', '7d'].map(label => `${label} ${getal(pct[label]) ? `${Math.round(pct[label])}%` : '–'}`).join(' · ')
}

// Alles voor de kaart. `s`: { modus, apiAuto, stappen, hoog, laag, accounts (nagekeken status of
// null), limieten (limietenVan van de sessie), apiKey, orKey, orModel, orSnel, orNu (model in
// settings.json), nu }.
export function wisselOverzicht(s) {
  const acc = s.accounts && Array.isArray(s.accounts.accounts) ? s.accounts : null
  const accAuto = acc?.instellingen?.auto === true
  const actief = acc ? acc.accounts.find(a => a.id === acc.actief) : undefined
  const stappen = Array.isArray(s.stappen) ? s.stappen.filter(x => STAPPEN.includes(x)) : ['api']

  const nuOp =
    s.modus === 'api' ? 'Anthropic API'
    : s.modus === 'openrouter' ? `OpenRouter (${s.orNu ?? s.orModel ?? 'model onbekend'})`
    : actief ? `Abonnement (account ${actief.id}, ${maskEmail(actief.email)})`
    : 'Abonnement'

  const lijst = []
  lijst.push({ sleutel: 'abonnement', detail: vensterTekst(s.limieten, actief, s.nu) ?? 'nog niet gemeten', uit: false })

  // Ander abonnement: het account in de rotatie (status ok) met de meeste ruimte onder de marge.
  const rotatie = acc ? acc.accounts.filter(a => a.inRotatie) : []
  const andere = rotatie.filter(a => a.id !== acc?.actief && a.status === 'ok')
  let account
  if (rotatie.length < 2 || !andere.length) {
    account = { sleutel: 'account', kanNiet: rotatie.length < 2 ? 'geen tweede account' : 'geen tweede account dat kan', uit: !accAuto }
  } else {
    const metingen = kettingInvoerVan(acc).metingen
    let best = null
    for (const a of andere) {
      const r = ruimte(metingen[a.id], acc.instellingen, s.nu)
      if (r !== null && (!best || r > best.r)) best = { id: a.id, r }
    }
    const detail = best ? `account ${best.id}, ruimte ${Math.max(0, Math.round(best.r))}%` : `account ${andere[0].id}, nog niet gemeten`
    account = { sleutel: 'account', detail, uit: !accAuto }
  }
  lijst.push(account)

  const stap = x =>
    x === 'api'
      ? { sleutel: 'api', ...(s.apiKey ? { detail: 'key ✓' } : { kanNiet: 'geen key' }), uit: !stappen.includes('api') }
      : {
          sleutel: 'openrouter',
          ...(!s.orKey ? { kanNiet: 'geen key' } : !s.orModel || !s.orSnel ? { kanNiet: 'geen model gekozen' } : { detail: s.orModel }),
          uit: !stappen.includes('openrouter'),
        }
  for (const x of stappen) lijst.push(stap(x))
  for (const x of STAPPEN) if (!stappen.includes(x)) lijst.push(stap(x))

  const nuSleutel = s.modus === 'api' ? 'api' : s.modus === 'openrouter' ? 'openrouter' : 'abonnement'
  const regels = lijst.map((r, i) => {
    const tekst = `${i + 1}. ${NAMEN[r.sleutel]} — ${r.kanNiet ?? r.detail}${r.uit ? ' (uit)' : ''}`
    return { sleutel: r.sleutel, tekst, nu: r.sleutel === nuSleutel, dim: r.uit || r.kanNiet !== undefined }
  })

  return {
    aan: s.apiAuto === true || accAuto,
    accAuto,
    nuOp,
    regels,
    zinnen: [
      `Haalt je huidige abonnement ${s.hoog}% van het 5u- of 7d-venster, dan gaat futureflow naar de volgende stap in de lijst die ruimte heeft.`,
      `Terug naar je abonnement zodra het weer onder ${s.laag}% zit of gereset is.`,
    ],
    noot: 'Geldt voor nieuwe terminal-sessies. Kies je zelf, dan blijft futureflow eraf tot de reset.',
  }
}

// Invoer van "Wissel vanaf %" en "Terug onder %": een heel getal binnen de grenzen en aan de goede
// kant van de andere grens. { n } of { fout } (één zin voor een toast).
export function grensVan(welke, invoer, andere) {
  const n = Number(String(invoer).trim().replace(/%$/, ''))
  const [min, max] = welke === 'hoog' ? [50, 99] : [0, 90]
  if (!Number.isInteger(n) || n < min || n > max) return { fout: `Niet veranderd: kies een heel getal van ${min} tot ${max}.` }
  if (welke === 'hoog' ? n <= andere : n >= andere) {
    const [vanaf, terug] = welke === 'hoog' ? [n, andere] : [andere, n]
    return { fout: `Niet veranderd: "wissel vanaf" (${vanaf}%) moet hoger zijn dan "terug onder" (${terug}%).` }
  }
  return { n }
}
