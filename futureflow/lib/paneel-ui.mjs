// Indeling van het dashboard /futureflow: breedtes, tabrijen en kolommen.
// Pure functies, zonder Node-API's, zodat hooks/paneel-ui.tsx en de tests ze delen.

export const LANG = ['Overzicht', 'Wisselen', 'Zuinig', 'Instellingen']
export const KORT = ['Over', 'Wissel', 'Zuinig', 'Instel']

// Onder deze breedte (kolommen van het paneel) krijgen de tabs korte namen.
export const KORT_ONDER = 50
// Vanaf deze binnenbreedte staan de kerncijfers van het Overzicht twee naast elkaar.
export const TWEE_KOLOMMEN_VANAF = 52
// Tussen twee tabs in één rij.
export const SCHEIDING = ' · '

// Breedte die het paneel zijn inhoud geeft: kolommen min de rand links en rechts (paddingX 1).
// Zonder meting 80 kolommen; nooit smaller dan 20.
export function binnenBreedte(kolommen) {
  const k = Number.isFinite(kolommen) && kolommen > 0 ? Math.floor(kolommen) : 80
  return Math.max(20, k - 2)
}

// Binnenbreedte van een kaart: rand (2) en paddingX 1 aan elke kant (2).
export function kaartBreedte(breedte) {
  return Math.max(10, breedte - 4)
}

// Zoals een plain Button met hotkey in de terminal staat: "1: Naam".
export function tabTekst(i, naam) {
  return `${i + 1}: ${naam}`
}

// Tabnamen voor deze breedte (kolommen van het paneel).
export function tabNamen(kolommen) {
  return (Number.isFinite(kolommen) && kolommen < KORT_ONDER ? KORT : LANG).slice()
}

// Verdeelt de tabs over rijen zodat geen rij breder is dan `breedte`; houdt de volgorde.
// Geeft per rij de indexen terug.
export function tabRijen(namen, breedte) {
  const rijen = []
  let rij = []
  let gebruikt = 0
  namen.forEach((naam, i) => {
    const w = tabTekst(i, naam).length
    const extra = rij.length ? SCHEIDING.length + w : w
    if (rij.length && gebruikt + extra > breedte) {
      rijen.push(rij)
      rij = []
      gebruikt = 0
    }
    gebruikt += rij.length ? SCHEIDING.length + w : w
    rij.push(i)
  })
  if (rij.length) rijen.push(rij)
  return rijen
}

// Breedte van een tabrij zoals de terminal hem tekent.
export function rijBreedte(namen, rij) {
  return rij.map(i => tabTekst(i, namen[i])).join(SCHEIDING).length
}

// De regel onder een tabrij: ▔ onder de naam van de gekozen tab, anders leeg ('').
export function onderstreping(namen, rij, gekozen) {
  if (!rij.includes(gekozen)) return ''
  let x = 0
  for (const i of rij) {
    const tekst = tabTekst(i, namen[i])
    if (i === gekozen) {
      const voor = x + tekst.length - namen[i].length
      return ' '.repeat(voor) + '▔'.repeat(namen[i].length)
    }
    x += tekst.length + SCHEIDING.length
  }
  return ''
}

// Hoeveel kerncijfers naast elkaar, en hoe breed elk (met 1 kolom tussenruimte).
export function kolommenVoor(breedte) {
  const n = breedte >= TWEE_KOLOMMEN_VANAF ? 2 : 1
  return { n, breed: Math.floor((breedte - (n - 1)) / n) }
}
