// Palet, woordmerk en voortgangsbalk voor de FutureFlow-skin en het dashboard.
// Pure functies, zonder Node-API's, zodat de hooks-module en de tests ze delen.

const LICHT = {
  groen: '#32a029', groenZacht: '#e8f5e6', inkt: '#3D3D3D', mut: '#7a807a', lijn: '#e3e6e3',
  achtergrond: '#ffffff', vlak: '#f6f7f6', rood: '#d4483b', oranje: '#d99a1e',
}

const DONKER = {
  groen: '#32a029', groenZacht: '#16301a', inkt: '#e9ece9', mut: '#8d958d', lijn: '#2b302b',
  achtergrond: '#121412', vlak: '#1b1e1b', rood: '#e5675b', oranje: '#e0a93a',
}

const LICHTE_THEMAS = ['light', 'light-daltonized', 'light-ansi']

// Onbekende of ontbrekende waarden vallen terug op donker (in de Stijl-tab te overschrijven).
export function modusVoor(theme) {
  return LICHTE_THEMAS.includes(theme) ? 'licht' : 'donker'
}

export function palet(modus) {
  return modus === 'licht' ? { ...LICHT } : { ...DONKER }
}

export function woordmerkSvg(modus, breedte) {
  const p = palet(modus)
  const font = "'BR Sonoma', -apple-system, 'Segoe UI', sans-serif"
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${breedte}" height="28" viewBox="0 0 ${breedte} 28" role="img" aria-label="FutureFlowAI"><text x="0" y="21" font-family="${font}" font-weight="600" font-size="20"><tspan fill="${p.inkt}">FutureFlow</tspan><tspan fill="${p.groen}">AI</tspan></text></svg>`
}

// Gevulde blokjes ▰ en lege ▱; de fractie wordt geklemd op 0..1.
export function balkTekst(fractie, breedte) {
  const f = Number.isFinite(fractie) ? Math.min(1, Math.max(0, fractie)) : 0
  const vol = Math.round(f * breedte)
  return '▰'.repeat(vol) + '▱'.repeat(breedte - vol)
}
