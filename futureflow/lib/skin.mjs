// Pure helpers voor de FFAI-skin: iconen, tijden, regel-diff en korte invoer.
// Zonder Node-API's, zodat de hooks-module en de tests ze delen.
// Vorm van de tool-uitvoer (structuredPatch, stdout/stderr, "Exit code N") gelezen uit
// claude-skins (MIT, hellosverre, commit cf0d39f); de code is eigen werk.

// Alle escape-reeksen (CSI, OSC, DCS/PM/APC/SOS, losse ESC) en C0/C1-stuurtekens behalve \n en \t.
// Alles wat de skin toont gaat hierdoor: tooluitvoer kan de terminal anders besturen.
const ESCAPES = /\u001b(?:\[[0-?]*[ -\/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[PX^_][^\u001b]*\u001b\\|.)/g
const STUURTEKENS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g

export function schoonTekst(t) {
  return String(t ?? '').replace(/\r\n/g, '\n').replace(ESCAPES, '').replace(STUURTEKENS, '')
}

const ICONEN = {
  Read: 'R',
  Write: 'E', Edit: 'E', MultiEdit: 'E', NotebookEdit: 'E',
  Bash: '$',
  Grep: '⌕', Glob: '⌕',
  WebFetch: '↗', WebSearch: '↗',
  Task: '◆', Agent: '◆',
}

export function icoonVoor(tool) {
  if (typeof tool === 'string' && tool.startsWith('mcp__')) return '◇'
  return ICONEN[tool] ?? '•'
}

// < 1 minuut: '0,4 s'; anders '1 m 05 s'.
export function duurTekst(ms) {
  const t = Number.isFinite(ms) && ms > 0 ? ms : 0
  if (t < 60000) return `${(t / 1000).toFixed(1).replace('.', ',')} s`
  const s = Math.floor(t / 1000)
  return `${Math.floor(s / 60)} m ${String(s % 60).padStart(2, '0')} s`
}

// Zoals Claude Code de beurtduur schrijft: '3s', '1m 4s', '1h 2m 3s'.
export function beurtDuur(ms) {
  const s = Math.max(0, Math.round((Number.isFinite(ms) ? ms : 0) / 1000))
  const u = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  if (u > 0) return `${u}h ${m}m ${r}s`
  if (m > 0) return `${m}m ${r}s`
  return `${r}s`
}

// Boven dit aantal cellen geen LCS: alles weg en alles erbij (een gigantische diff blijft snel).
const MAX_CELLEN = 1_000_000

function kap(regels, max) {
  if (regels.length <= max) return regels
  return [...regels.slice(0, max), { soort: ' ', tekst: `… ${regels.length - max} regels meer`, nr: 0 }]
}

// Regel-diff (LCS). '-' draagt het oude regelnummer, ' ' en '+' het nieuwe.
export function diffRegels(oud, nieuw, max = 200) {
  const a = schoonTekst(oud).split('\n')
  const b = schoonTekst(nieuw).split('\n')
  // Gemeenschappelijk begin en eind eerst, dan de LCS alleen over het midden.
  let begin = 0
  while (begin < a.length && begin < b.length && a[begin] === b[begin]) begin++
  let eind = 0
  while (eind < a.length - begin && eind < b.length - begin && a[a.length - 1 - eind] === b[b.length - 1 - eind]) eind++
  const ma = a.slice(begin, a.length - eind)
  const mb = b.slice(begin, b.length - eind)
  const uit = []
  for (let i = 0; i < begin; i++) uit.push({ soort: ' ', tekst: a[i], nr: i + 1 })
  const n = ma.length, m = mb.length
  if ((n + 1) * (m + 1) > MAX_CELLEN) {
    ma.forEach((t, i) => uit.push({ soort: '-', tekst: t, nr: begin + i + 1 }))
    mb.forEach((t, j) => uit.push({ soort: '+', tekst: t, nr: begin + j + 1 }))
  } else {
    // L[i][j] = lengte LCS van ma[i..] en mb[j..], plat in één array.
    const L = new Int32Array((n + 1) * (m + 1))
    const at = (i, j) => i * (m + 1) + j
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        L[at(i, j)] = ma[i] === mb[j] ? L[at(i + 1, j + 1)] + 1 : Math.max(L[at(i + 1, j)], L[at(i, j + 1)])
      }
    }
    let i = 0, j = 0
    while (i < n || j < m) {
      if (i < n && j < m && ma[i] === mb[j]) {
        uit.push({ soort: ' ', tekst: mb[j], nr: begin + j + 1 }); i++; j++
      } else if (j >= m || (i < n && L[at(i + 1, j)] >= L[at(i, j + 1)])) {
        uit.push({ soort: '-', tekst: ma[i], nr: begin + i + 1 }); i++
      } else {
        uit.push({ soort: '+', tekst: mb[j], nr: begin + j + 1 }); j++
      }
    }
  }
  for (let k = eind; k > 0; k--) uit.push({ soort: ' ', tekst: b[b.length - k], nr: b.length - k + 1 })
  return kap(uit, max)
}

export function telling(regels) {
  let plus = 0, min = 0
  for (const r of regels ?? []) {
    if (r.soort === '+') plus++
    else if (r.soort === '-') min++
  }
  return { plus, min }
}

// Regels uit de uitvoer van Edit/Write/MultiEdit: structuredPatch (met echte nummers),
// anders oldString/newString, anders de inhoud van een nieuw bestand. null als er niets te lezen is.
export function wijzigRegels(uitvoer, max = 200) {
  if (typeof uitvoer !== 'object' || uitvoer === null) return null
  const patch = Array.isArray(uitvoer.structuredPatch) ? uitvoer.structuredPatch : []
  if (patch.length > 0) {
    const uit = []
    for (const stuk of patch) {
      let o = Number(stuk?.oldStart) || 1
      let nw = Number(stuk?.newStart) || 1
      for (const regel of Array.isArray(stuk?.lines) ? stuk.lines : []) {
        if (typeof regel !== 'string') continue
        const soort = regel[0] === '+' || regel[0] === '-' ? regel[0] : ' '
        const tekst = schoonTekst(regel[0] === '+' || regel[0] === '-' || regel[0] === ' ' ? regel.slice(1) : regel)
        if (soort === '-') uit.push({ soort, tekst, nr: o++ })
        else if (soort === '+') uit.push({ soort, tekst, nr: nw++ })
        else { uit.push({ soort, tekst, nr: nw++ }); o++ }
      }
    }
    return kap(uit, max)
  }
  if (typeof uitvoer.oldString === 'string' && typeof uitvoer.newString === 'string') {
    return diffRegels(uitvoer.oldString, uitvoer.newString, max)
  }
  if (uitvoer.type === 'create' && typeof uitvoer.content === 'string') {
    return kap(schoonTekst(uitvoer.content).split('\n').map((tekst, i) => ({ soort: '+', tekst, nr: i + 1 })), max)
  }
  return null
}

const MAX_KORT = 80

const tekstVan = (v) => (typeof v === 'string' ? v : '')

// Het ene dat je in één oogopslag wilt zien: commando, pad of patroon. Gooit bij invoer zonder velden.
export function korteInvoer(tool, invoer) {
  if (typeof invoer !== 'object' || invoer === null) throw new Error(`${tool} zonder invoer`)
  const v = invoer
  const ruw = (() => {
    switch (tool) {
      case 'Bash': return tekstVan(v.command)
      case 'Read': case 'Edit': case 'MultiEdit': case 'Write': return tekstVan(v.file_path)
      case 'NotebookEdit': return tekstVan(v.notebook_path)
      case 'Glob': return tekstVan(v.pattern)
      case 'Grep': return v.path ? `${tekstVan(v.pattern)} in ${tekstVan(v.path)}` : tekstVan(v.pattern)
      case 'WebFetch': return tekstVan(v.url).replace(/^https?:\/\//, '')
      case 'WebSearch': return tekstVan(v.query)
      default: return Object.values(v).map(tekstVan).find(t => t !== '') ?? ''
    }
  })()
  const plat = schoonTekst(ruw).replace(/\s+/g, ' ').trim()
  return plat.length > MAX_KORT ? `${plat.slice(0, MAX_KORT - 1)}…` : plat
}

// Eerste `kop` en laatste `staart` regels met een telling ertussen; één verborgen regel tonen we gewoon.
export function inklappen(regels, kop = 8, staart = 4) {
  const weg = regels.length - kop - staart
  return weg <= 1 ? [...regels] : [...regels.slice(0, kop), { weg }, ...regels.slice(regels.length - staart)]
}

const EXIT = /^\s*Exit code (-?\d+)[^\S\n]*\r?\n?/

// Uitvoer van Bash: stdout, stderr (zonder de regel "Exit code N") en de exitcode.
// Een mislukte aanroep kan een tekst zijn in plaats van een record. null als het geen shell-uitvoer is.
export function shellUitvoer(uitvoer, fout) {
  const schoon = (t) => schoonTekst(t).replace(/\n+$/, '')
  if (typeof uitvoer === 'object' && uitvoer !== null && typeof uitvoer.stdout === 'string' && typeof uitvoer.stderr === 'string') {
    const m = EXIT.exec(uitvoer.stderr)
    return {
      stdout: schoon(uitvoer.stdout),
      stderr: schoon(m ? uitvoer.stderr.slice(m[0].length) : uitvoer.stderr),
      exit: m ? Number(m[1]) : undefined,
      onderbroken: uitvoer.interrupted === true,
    }
  }
  if (typeof uitvoer !== 'string') return null
  const t = uitvoer.replace(/<\/?tool_use_error>/g, '')
  if (!fout) return { stdout: schoon(t), stderr: '', exit: undefined, onderbroken: false }
  const m = EXIT.exec(t)
  return { stdout: '', stderr: schoon(m ? t.slice(m[0].length) : t), exit: m ? Number(m[1]) : undefined, onderbroken: false }
}

// '✓', '✗ exit 2', '✗ mislukt' of 'onderbroken'.
export function shellStatus(sh, fout) {
  if (sh.onderbroken) return { toon: 'oranje', tekst: 'onderbroken' }
  if (fout || (sh.exit !== undefined && sh.exit !== 0)) return { toon: 'rood', tekst: `✗ ${sh.exit === undefined ? 'mislukt' : `exit ${sh.exit}`}` }
  return { toon: 'groen', tekst: '✓' }
}

export function regelsVan(tekst) {
  return tekst === '' ? [] : tekst.split('\n')
}

const MAX_RESULTAAT = 4000

// Het resultaat van een aanroep als leesbare tekst voor een opengeklapte regel, begrensd.
export function resultaatTekst(uitvoer) {
  if (uitvoer === undefined || uitvoer === null) return ''
  let t
  if (typeof uitvoer === 'string') t = uitvoer
  else if (typeof uitvoer.stdout === 'string') t = [uitvoer.stdout, uitvoer.stderr].filter(x => typeof x === 'string' && x !== '').join('\n')
  else if (typeof uitvoer.file?.content === 'string') t = uitvoer.file.content
  else {
    try { t = JSON.stringify(uitvoer, null, 2) ?? '' } catch { t = String(uitvoer) }
  }
  t = schoonTekst(t)
  return t.length > MAX_RESULTAAT ? `${t.slice(0, MAX_RESULTAAT)}\n… ${t.length - MAX_RESULTAAT} tekens meer` : t
}

// Velden van de invoer als [naam, waarde]-paren voor een opengeklapte regel.
export function invoerVelden(invoer) {
  if (typeof invoer !== 'object' || invoer === null) return []
  return Object.entries(invoer).map(([k, v]) => {
    const t = schoonTekst(typeof v === 'string' ? v : JSON.stringify(v) ?? String(v))
    return [schoonTekst(k), t.length > MAX_RESULTAAT ? `${t.slice(0, MAX_RESULTAAT)}…` : t]
  })
}

// mcp__server__tool leest als server:tool.
export function toolLabel(tool) {
  if (typeof tool !== 'string' || !tool.startsWith('mcp__')) return schoonTekst(tool)
  const [, server = '', ...naam] = tool.split('__')
  return schoonTekst(`${server}:${naam.join('__')}`)
}
