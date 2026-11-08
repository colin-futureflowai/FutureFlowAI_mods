// De vier kerncijfers van de tab Overzicht. Pure functie, zonder Node-API's.

const GEEN = (titel) => ({ titel, waarde: '–', sub: 'nog geen gegevens', toon: 'mut' })

function kort(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

const gemiddelde = (p) => p.output / p.beurten

function bespaardIn(teller) {
  const titel = 'Tokens bespaard (in)'
  if (!teller) return GEEN(titel)
  const tokens = Math.round((teller.uitvoerVoor - teller.uitvoerNa) / 4)
  return { titel, waarde: kort(tokens), sub: `${teller.ingekort}× uitvoer ingekort`, toon: 'groen' }
}

function bespaardUit(teller, perNiveau, niveau) {
  const titel = 'Tokens bespaard (uit)'
  const uit = perNiveau?.uit
  const nu = niveau ? perNiveau?.[niveau] : undefined
  let tokens
  if (uit && uit.beurten >= 5 && nu && nu.beurten > 0 && niveau !== 'uit') {
    tokens = Math.round(nu.beurten * (gemiddelde(uit) - gemiddelde(nu)))
  } else if (teller && teller.beurten > 0) {
    tokens = Math.round(teller.beurten * (teller.output / teller.beurten) * 0.35)
  } else {
    return GEEN(titel)
  }
  return { titel, waarde: `≈${tokens}`, sub: 'schatting', toon: 'groen' }
}

function context(c) {
  const titel = 'Contextvenster'
  if (!c || !(c.max > 0)) return GEEN(titel)
  const fractie = c.gebruikt / c.max
  const pct = Math.round(fractie * 100)
  return { titel, waarde: `${pct}%`, sub: 'van het venster', toon: pct > 70 ? 'oranje' : 'groen', fractie }
}

function geheugen(s) {
  const titel = 'Vrij geheugen'
  if (!s?.memory) return GEEN(titel)
  const { freePercent, totalGB } = s.memory
  return { titel, waarde: `${freePercent}%`, sub: `van ${totalGB} GB`, toon: freePercent < 25 ? 'oranje' : 'groen' }
}

export function kpis(invoer) {
  const { teller, perNiveau, niveau, snapshot, context: c } = invoer ?? {}
  return [bespaardIn(teller), bespaardUit(teller, perNiveau, niveau), context(c), geheugen(snapshot)]
}
