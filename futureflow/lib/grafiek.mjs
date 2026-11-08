// SVG-grafiekjes voor het dashboard van minify. Pure functies die een <svg>-string teruggeven;
// de desktop-app tekent die als afbeelding. Kleuren zijn middentonen die op licht en donker leesbaar zijn.

export const KLEUR = {
  accent: '#d97757',
  accentZacht: '#d9775733',
  goed: '#3fa66b',
  raster: '#8888881f',
  tekst: '#8a8a8a',
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const r1 = n => Math.round(n * 10) / 10

/** Getal kort: 1234 → "1,2k", 45806 → "46k". */
export function kort(n) {
  const v = Math.round(Number(n) || 0)
  if (Math.abs(v) >= 10_000) return `${Math.round(v / 1000)}k`
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1).replace('.', ',')}k`
  return String(v)
}

/**
 * Lijn met vlak eronder: output-tokens per beurt. Geeft null bij minder dan 2 punten.
 * De laatste waarde krijgt een stip en een label.
 */
export function lijn(waarden, { breedte = 520, hoogte = 120 } = {}) {
  const v = waarden.filter(x => Number.isFinite(x))
  if (v.length < 2) return null
  const pad = { l: 8, r: 44, t: 12, b: 18 }
  const w = breedte - pad.l - pad.r
  const h = hoogte - pad.t - pad.b
  const max = Math.max(...v) || 1
  const x = i => pad.l + (i / (v.length - 1)) * w
  const y = n => pad.t + h - (n / max) * h
  const punten = v.map((n, i) => `${r1(x(i))},${r1(y(n))}`)
  const gem = v.reduce((a, b) => a + b, 0) / v.length
  const laatste = v[v.length - 1]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${breedte} ${hoogte}" width="${breedte}" height="${hoogte}" font-family="-apple-system, system-ui, sans-serif">
<line x1="${pad.l}" y1="${r1(y(gem))}" x2="${pad.l + w}" y2="${r1(y(gem))}" stroke="${KLEUR.tekst}" stroke-dasharray="3 4" stroke-width="1"/>
<text x="${pad.l + w + 6}" y="${r1(y(gem)) + 4}" font-size="10" fill="${KLEUR.tekst}">⌀ ${esc(kort(gem))}</text>
<polygon points="${pad.l},${pad.t + h} ${punten.join(' ')} ${pad.l + w},${pad.t + h}" fill="${KLEUR.accentZacht}"/>
<polyline points="${punten.join(' ')}" fill="none" stroke="${KLEUR.accent}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
<circle cx="${r1(x(v.length - 1))}" cy="${r1(y(laatste))}" r="3.5" fill="${KLEUR.accent}"/>
<line x1="${pad.l}" y1="${pad.t + h}" x2="${pad.l + w}" y2="${pad.t + h}" stroke="${KLEUR.raster}" stroke-width="1"/>
<text x="${pad.l}" y="${hoogte - 4}" font-size="10" fill="${KLEUR.tekst}">beurt 1</text>
<text x="${pad.l + w}" y="${hoogte - 4}" font-size="10" fill="${KLEUR.tekst}" text-anchor="end">${v.length}</text>
</svg>`
}

/**
 * Horizontale staven met een label links en de waarde rechts. `rijen`: [{ label, waarde, nadruk? }].
 * Geeft null als er niets te tekenen is.
 */
export function staven(rijen, { breedte = 520, rijHoogte = 26 } = {}) {
  const r = rijen.filter(x => Number.isFinite(x.waarde) && x.waarde > 0)
  if (!r.length) return null
  const labelB = 44
  const waardeB = 56
  const w = breedte - labelB - waardeB
  const max = Math.max(...r.map(x => x.waarde))
  const hoogte = r.length * rijHoogte + 4
  const delen = r.map((x, i) => {
    const y = i * rijHoogte + 4
    const bw = Math.max(2, (x.waarde / max) * w)
    const kleur = x.nadruk ? KLEUR.accent : KLEUR.tekst
    return `<text x="0" y="${y + 13}" font-size="12" font-weight="${x.nadruk ? 600 : 400}" fill="${KLEUR.tekst}">${esc(x.label)}</text>
<rect x="${labelB}" y="${y}" width="${r1(w)}" height="16" rx="4" fill="${KLEUR.raster}"/>
<rect x="${labelB}" y="${y}" width="${r1(bw)}" height="16" rx="4" fill="${kleur}" opacity="${x.nadruk ? 1 : 0.55}"/>
<text x="${breedte}" y="${y + 13}" font-size="12" fill="${KLEUR.tekst}" text-anchor="end">${esc(x.tekst ?? kort(x.waarde))}</text>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${breedte} ${hoogte}" width="${breedte}" height="${hoogte}" font-family="-apple-system, system-ui, sans-serif">
${delen.join('\n')}
</svg>`
}

/** Tekstbalk voor de terminal: "████░░░░" van `deel` op `geheel`. */
export function tekstBalk(deel, geheel, breedte = 20) {
  const vol = geheel > 0 ? Math.round(Math.min(1, Math.max(0, deel / geheel)) * breedte) : 0
  return '█'.repeat(vol) + '░'.repeat(breedte - vol)
}
