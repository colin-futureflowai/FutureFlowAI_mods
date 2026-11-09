// Geheugenmeter van de tab Slots. Pure functies, zonder Node-API's.

// ok vanaf de vloer, warn tussen kritiek en vloer, err onder kritiek.
export function meterToon(vrij, vloer, kritiek) {
  if (vrij < kritiek) return 'err'
  if (vrij < vloer) return 'warn'
  return 'ok'
}

// Komma als decimaalteken, één decimaal.
const getal = n => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',')

// Blokmeter van 8 cellen: gevuld = vrij geheugen. Bv. `▰▰▰▱▱▱▱▱ 38% vrij (6,1 van 16 GB)`.
export function meterTekst(vrij, totaalGB, breedte = 8) {
  const f = Number.isFinite(vrij) ? Math.min(1, Math.max(0, vrij / 100)) : 0
  const vol = Math.round(f * breedte)
  const gb = Number.isFinite(totaalGB) ? ` (${getal((f * totaalGB))} van ${getal(totaalGB).replace(/,0$/, '')} GB)` : ''
  return `${'▰'.repeat(vol)}${'▱'.repeat(breedte - vol)} ${Math.round(vrij)}% vrij${gb}`
}
