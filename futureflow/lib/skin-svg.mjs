// Kaarten van de FFAI-skin als SVG (desktop): diff-kaart voor Edit/Write, shell-kaart voor Bash.
// Pure functies zonder Node-API's. Opzet (kop, regels met nummer, tinten) naar claude-skins
// (MIT, hellosverre, commit cf0d39f); de code is eigen werk.

import { inklappen, regelsVan } from './skin.mjs'

const FONT = "-apple-system, 'Segoe UI', sans-serif"
const MONO = "ui-monospace, 'SF Mono', Menlo, monospace"
const KOP = 34
const REGEL = 18
const MAX_TEKENS = 160

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
// De kop deelt zijn breedte met de status rechts: korter afkappen.
const kopTekst = (t) => { const plat = t.replace(/\s+/g, ' '); return plat.length > 80 ? `${plat.slice(0, 79)}…` : plat }
const kort = (t) => (t.length > MAX_TEKENS ? `${t.slice(0, MAX_TEKENS - 1)}…` : t)

// Doorzichtige tint van een kleur (#rrggbb + alfa).
const tint = (kleur, alfa) => `${kleur}${alfa}`

function kaart(breedte, hoogte, p, inhoud) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${breedte}" height="${hoogte}" viewBox="0 0 ${breedte} ${hoogte}" font-family="${FONT}">` +
    `<rect x="0.5" y="0.5" width="${breedte - 1}" height="${hoogte - 1}" rx="10" fill="${p.vlak}" stroke="${p.lijn}"/>` +
    `<line x1="0" y1="${KOP}" x2="${breedte}" y2="${KOP}" stroke="${p.lijn}"/>` +
    inhoud + '</svg>'
}

// regels: [{ soort, tekst, nr }], tel: { plus, min }.
export function diffSvg(regels, pad, tel, p, breedte = 720) {
  const hoogte = KOP + 8 + regels.length * REGEL + 8
  let y = KOP + 8
  const rijen = regels.map((r) => {
    const top = y
    y += REGEL
    const achter = r.soort === '+' ? `<rect x="1" y="${top}" width="${breedte - 2}" height="${REGEL}" fill="${tint(p.groen, '26')}"/>`
      : r.soort === '-' ? `<rect x="1" y="${top}" width="${breedte - 2}" height="${REGEL}" fill="${tint(p.rood, '26')}"/>` : ''
    const kleur = r.soort === '+' ? p.groen : r.soort === '-' ? p.rood : p.inkt
    return achter +
      `<text x="44" y="${top + 13}" font-family="${MONO}" font-size="11" text-anchor="end" fill="${p.mut}">${r.nr > 0 ? r.nr : ''}</text>` +
      `<text x="54" y="${top + 13}" font-family="${MONO}" font-size="12" fill="${kleur}">${esc(r.soort)}</text>` +
      `<text x="68" y="${top + 13}" font-family="${MONO}" font-size="12" fill="${r.nr === 0 ? p.mut : p.inkt}" xml:space="preserve">${esc(kort(r.tekst))}</text>`
  }).join('')
  const kop = `<text x="14" y="22" font-size="12" font-weight="600" fill="${p.inkt}">${esc(kopTekst(pad))}</text>` +
    `<text x="${breedte - 14}" y="22" font-size="12" font-weight="600" text-anchor="end" fill="${p.groen}">+${tel.plus} −${tel.min}</text>`
  return kaart(breedte, hoogte, p, kop + rijen)
}

// sh: { stdout, stderr }, status: { toon, tekst }. Elke stroom ingeklapt tot 8 + 4 regels.
export function shellSvg(commando, sh, status, p, breedte = 720) {
  const rijen = []
  for (const r of inklappen(regelsVan(sh.stdout))) rijen.push(typeof r === 'string' ? { tekst: r, kleur: p.inkt } : { tekst: `… ${r.weg} regels verborgen`, kleur: p.mut })
  const fout = inklappen(regelsVan(sh.stderr))
  if (fout.length > 0) {
    rijen.push({ tekst: 'stderr', kleur: p.rood, label: true })
    for (const r of fout) rijen.push(typeof r === 'string' ? { tekst: r, kleur: p.rood } : { tekst: `… ${r.weg} regels verborgen`, kleur: p.mut })
  }
  if (rijen.length === 0) rijen.push({ tekst: 'geen uitvoer', kleur: p.mut })
  const hoogte = KOP + 8 + rijen.length * REGEL + 8
  const kleur = status.toon === 'rood' ? p.rood : status.toon === 'oranje' ? p.oranje : p.groen
  let y = KOP + 8
  const tekst = rijen.map((r) => {
    const top = y
    y += REGEL
    return `<text x="14" y="${top + 13}" font-family="${r.label ? FONT : MONO}" font-size="${r.label ? 11 : 12}"${r.label ? ' font-weight="600"' : ''} fill="${r.kleur}" xml:space="preserve">${esc(kort(r.tekst))}</text>`
  }).join('')
  const kop = `<text x="14" y="22" font-family="${MONO}" font-size="12" fill="${p.groen}">$</text>` +
    `<text x="28" y="22" font-family="${MONO}" font-size="12" font-weight="600" fill="${p.inkt}">${esc(kopTekst(commando || 'Uitvoer'))}</text>` +
    `<text x="${breedte - 14}" y="22" font-size="12" font-weight="600" text-anchor="end" fill="${kleur}">${esc(status.tekst)}</text>`
  return kaart(breedte, hoogte, p, kop + tekst)
}
