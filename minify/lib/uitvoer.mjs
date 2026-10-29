// Kort lange tooluitvoer in voordat het model hem leest. Deterministisch, geen LLM, geen Node-API's.
// Het origineel bewaart de mod op schijf; het model krijgt het pad, zodat niets echt verloren gaat.

export const STANDAARD_DREMPEL = 6000

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)/g
const FOUT = /\b(error|errors|err!|fail|failed|failing|failure|fatal|panic|panicked|exception|traceback|warn|warning|assert(ion)?|not ok|expected|received|denied|cannot|could not|unable|undefined is not|\w+Error|exit code [1-9])\b|✗|✘|×|❌/i
const KOP = 30
const STAART = 50
const MAX_FOUTREGELS = 60
const MAX_REGEL = 400

/** Haalt ANSI-codes en voortgangsbalken (alles vóór de laatste \r op een regel) weg. */
export function opschonen(tekst) {
  return String(tekst ?? '')
    .replace(ANSI, '')
    .split('\n')
    .map(r => {
      const zonderEinde = r.endsWith('\r') ? r.slice(0, -1) : r
      const i = zonderEinde.lastIndexOf('\r')
      return i >= 0 ? zonderEinde.slice(i + 1) : zonderEinde
    })
    .join('\n')
}

// Regels die alleen in getallen verschillen ("Downloading 12%", "test 341 ok") hebben dezelfde vorm.
const vorm = r => r.replace(/\d+(\.\d+)?/g, '#').trim()

/** Voegt opeenvolgende gelijke (of alleen in getallen verschillende) regels samen. */
export function samenvoegen(regels) {
  const uit = []
  let i = 0
  while (i < regels.length) {
    let j = i + 1
    const v = vorm(regels[i])
    while (j < regels.length && vorm(regels[j]) === v) j++
    const aantal = j - i
    if (aantal >= 3 && v !== '') {
      uit.push(regels[i])
      uit.push(`… ${aantal - 2}× vergelijkbare regel …`)
      uit.push(regels[j - 1])
    } else {
      for (let k = i; k < j; k++) uit.push(regels[k])
    }
    i = j
  }
  return uit
}

const kapRegel = r => (r.length > MAX_REGEL ? `${r.slice(0, MAX_REGEL)}… (+${r.length - MAX_REGEL} tekens)` : r)

/** Opbouw van grote JSON: sleutels, typen en lengtes van lijsten, tot 3 lagen diep. */
export function jsonSkelet(waarde, diepte = 0) {
  if (Array.isArray(waarde)) {
    if (waarde.length === 0) return '[]'
    if (diepte >= 3) return `[… ${waarde.length} items]`
    return `[${waarde.length}× ${jsonSkelet(waarde[0], diepte + 1)}]`
  }
  if (waarde && typeof waarde === 'object') {
    const sleutels = Object.keys(waarde)
    if (diepte >= 3) return `{… ${sleutels.length} sleutels}`
    const delen = sleutels.slice(0, 25).map(k => `${k}: ${jsonSkelet(waarde[k], diepte + 1)}`)
    if (sleutels.length > 25) delen.push(`… +${sleutels.length - 25} sleutels`)
    return `{ ${delen.join(', ')} }`
  }
  if (typeof waarde === 'string') return waarde.length > 40 ? `"${waarde.slice(0, 40)}…"` : JSON.stringify(waarde)
  return JSON.stringify(waarde)
}

function probeerJson(tekst) {
  const t = tekst.trim()
  if (!/^[[{]/.test(t)) return null
  try {
    return JSON.parse(t)
  } catch {
    return null
  }
}

/**
 * Kort `tekst` in als hij langer is dan `drempel` tekens.
 * Geeft { tekst, ingekort, voor, na } terug; `voor` en `na` zijn aantallen tekens.
 */
export function inkorten(tekst, { drempel = STANDAARD_DREMPEL } = {}) {
  const ruw = String(tekst ?? '')
  if (ruw.length <= drempel) return { tekst: ruw, ingekort: false, voor: ruw.length, na: ruw.length }

  const schoon = opschonen(ruw)
  const json = probeerJson(schoon)
  if (json !== null) {
    const skelet = `JSON, ${schoon.length} tekens. Opbouw: ${jsonSkelet(json)}`
    const kort = skelet.length > drempel ? `${skelet.slice(0, drempel)}…` : skelet
    return { tekst: kort, ingekort: true, voor: ruw.length, na: kort.length }
  }

  const regels = samenvoegen(schoon.split('\n')).map(kapRegel)
  let resultaat
  if (regels.join('\n').length <= drempel) {
    resultaat = regels
  } else {
    const kop = regels.slice(0, KOP)
    const staart = regels.slice(Math.max(KOP, regels.length - STAART))
    const midden = regels.slice(KOP, Math.max(KOP, regels.length - STAART))
    // In het midden alleen regels die op fouten lijken, met de regel erna (vaak bestand:regel).
    const houden = new Set()
    midden.forEach((r, i) => {
      if (houden.size < MAX_FOUTREGELS && FOUT.test(r)) {
        houden.add(i)
        if (i + 1 < midden.length) houden.add(i + 1)
      }
    })
    resultaat = [...kop]
    let weg = 0
    midden.forEach((r, i) => {
      if (houden.has(i)) {
        if (weg) resultaat.push(`… ${weg} regels weggelaten …`)
        weg = 0
        resultaat.push(r)
      } else weg++
    })
    if (weg) resultaat.push(`… ${weg} regels weggelaten …`)
    resultaat.push(...staart)
  }
  const kort = resultaat.join('\n')
  // Levert inkorten bijna niets op, dan liever het origineel (minder verwarrend).
  if (kort.length > ruw.length * 0.9) return { tekst: ruw, ingekort: false, voor: ruw.length, na: ruw.length }
  return { tekst: kort, ingekort: true, voor: ruw.length, na: kort.length }
}

/** De regel die onder ingekorte uitvoer komt, zodat het model het origineel kan lezen. */
export function voetregel(pad, voor, na) {
  return `\n[minify: uitvoer ingekort van ${voor} naar ${na} tekens. Volledige uitvoer: ${pad} (lees die met Read als je details nodig hebt)]`
}
