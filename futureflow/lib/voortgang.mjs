// Takenlijst voor de voortgangsbalk, uit drie bronnen: TaskCreate/TaskUpdate, TodoWrite en
// mcp__ccd_turn__update_plan; mcp__ccd_turn__wrap_up sluit de lijst af. Pure functies, zonder
// Node-API's; de hooks-module gebruikt ze ook.
// Onbekende of foute invoer laat de lijst ongewijzigd (zelfde object terug), nooit een fout.

const STATUS = { completed: 'klaar', in_progress: 'bezig', pending: 'open' }

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
const tekst = (x) => (typeof x === 'string' ? x.trim() : '')

// Eerste niet-lege regel van de opdracht, max 60 tekens (afgekapt met …).
export function doelVan(opdracht) {
  const regel = (typeof opdracht === 'string' ? opdracht : '').split('\n').map((r) => r.trim()).find((r) => r !== '') ?? ''
  return regel.length > 60 ? `${regel.slice(0, 59)}…` : regel
}

// Stappen uit een lijst `[{ content, status }]` (TodoWrite en update_plan); null als de vorm niet klopt.
function stappenUit(lijst) {
  if (!Array.isArray(lijst)) return null
  const stappen = []
  for (const item of lijst) {
    if (!isObject(item)) return null
    const titel = tekst(item.content)
    if (titel === '') return null
    stappen.push({ id: String(stappen.length + 1), titel, status: STATUS[item.status] ?? 'open' })
  }
  return stappen
}

// Id van een nieuwe taak: uit het resultaat, anders één hoger dan het hoogste getal tot nu toe.
function nieuwId(result, stappen) {
  const r = isObject(result) ? result : {}
  for (const kandidaat of [isObject(r.task) ? r.task.id : undefined, r.taskId, r.id]) {
    if ((typeof kandidaat === 'string' && kandidaat !== '') || typeof kandidaat === 'number') return String(kandidaat)
  }
  const hoogste = stappen.reduce((m, s) => (/^\d+$/.test(s.id) ? Math.max(m, Number(s.id)) : m), 0)
  return String(Math.max(hoogste, stappen.length) + 1)
}

// Een nieuwe lijst, of een vervanging van de oude: doel uit de opdracht (anders het oude doel),
// begin blijft staan zolang de oude lijst nog niet af was.
function vervang(lijst, stappen, nu, opdracht) {
  if (stappen.length === 0) return null
  const loopt = lijst !== null && percentage(lijst) < 100
  return {
    doel: doelVan(opdracht) || lijst?.doel || '',
    stappen,
    begin: loopt ? lijst.begin : nu,
  }
}

function taskCreate(lijst, input, result, nu, opdracht) {
  const titel = tekst(input.subject)
  if (titel === '') return lijst
  // Een afgeronde lijst is voorbij: een nieuwe taak begint een nieuwe lijst.
  const basis = lijst === null || percentage(lijst) === 100 ? null : lijst
  const stappen = basis?.stappen ?? []
  const stap = { id: nieuwId(result, stappen), titel, status: 'open' }
  if (basis === null) return { doel: doelVan(opdracht), stappen: [stap], begin: nu }
  if (stappen.some((s) => s.id === stap.id)) return lijst
  return { ...basis, stappen: [...stappen, stap] }
}

function taskUpdate(lijst, input) {
  if (lijst === null) return lijst
  const id = typeof input.taskId === 'number' ? String(input.taskId) : tekst(input.taskId)
  const i = lijst.stappen.findIndex((s) => s.id === id)
  if (i < 0) return lijst
  if (input.status === 'deleted') {
    const stappen = lijst.stappen.filter((_, j) => j !== i)
    return stappen.length === 0 ? null : { ...lijst, stappen }
  }
  const status = STATUS[input.status]
  const titel = tekst(input.subject)
  if (status === undefined && titel === '') return lijst
  const stap = { ...lijst.stappen[i], ...(status ? { status } : {}), ...(titel ? { titel } : {}) }
  return { ...lijst, stappen: lijst.stappen.map((s, j) => (j === i ? stap : s)) }
}

const geldigNummer = (n, lijst) => Number.isInteger(n) && n >= 1 && n <= lijst.stappen.length

function updatePlan(lijst, input, nu, opdracht) {
  let l = lijst
  if (input.items !== undefined) {
    const stappen = stappenUit(input.items)
    if (stappen === null) return lijst
    l = vervang(lijst, stappen, nu, opdracht)
  }
  if (l === null) return l
  const zet = (nummers, status) => {
    l = { ...l, stappen: l.stappen.map((s, j) => (nummers.includes(j + 1) ? { ...s, status } : s)) }
  }
  if (Array.isArray(input.done)) {
    const nummers = input.done.filter((n) => geldigNummer(n, l))
    if (nummers.length > 0) zet(nummers, 'klaar')
  }
  if (input.start !== undefined && geldigNummer(input.start, l)) zet([input.start], 'bezig')
  if (input.advance === true) {
    const bezig = l.stappen.findIndex((s) => s.status === 'bezig')
    if (bezig >= 0) zet([bezig + 1], 'klaar')
    const open = l.stappen.findIndex((s) => s.status === 'open')
    if (open >= 0) zet([open + 1], 'bezig')
  }
  return l
}

// Verwerkt één tool-aanroep. `input` zijn de argumenten van de tool, `result` het resultaat.
export function pasToe(lijst, tool, input, result, nu, opdracht) {
  try {
    if (!isObject(input)) return lijst
    const tijd = typeof nu === 'number' && Number.isFinite(nu) ? nu : 0
    switch (tool) {
      case 'TaskCreate':
        return taskCreate(lijst, input, result, tijd, opdracht)
      case 'TaskUpdate':
        return taskUpdate(lijst, input)
      case 'TodoWrite': {
        const stappen = stappenUit(input.todos)
        return stappen === null ? lijst : vervang(lijst, stappen, tijd, opdracht)
      }
      case 'mcp__ccd_turn__update_plan':
        return updatePlan(lijst, input, tijd, opdracht)
      case 'mcp__ccd_turn__wrap_up':
        // De desktop-app vinkt bij wrap_up de hele lijst af zonder update_plan: alles klaar.
        return lijst === null || lijst.stappen.every((s) => s.status === 'klaar')
          ? lijst
          : { ...lijst, stappen: lijst.stappen.map((s) => ({ ...s, status: 'klaar' })) }
      default:
        return lijst
    }
  } catch {
    return lijst
  }
}

export function telling(l) {
  const t = { klaar: 0, bezig: 0, open: 0 }
  for (const s of l?.stappen ?? []) t[s.status] = (t[s.status] ?? 0) + 1
  return t
}

// Afgerond percentage klaar; een lege lijst is 0.
export function percentage(l) {
  const alle = l?.stappen?.length ?? 0
  return alle === 0 ? 0 : Math.round((telling(l).klaar / alle) * 100)
}

// De stap waar het nu om gaat: de eerste die bezig is, anders de eerste open.
export function huidige(l) {
  const stappen = l?.stappen ?? []
  return stappen.find((s) => s.status === 'bezig') ?? stappen.find((s) => s.status === 'open')
}

// Plaats van de huidige stap (1-based), of 0 als er geen is.
export function positie(l) {
  const stap = huidige(l)
  return stap ? l.stappen.indexOf(stap) + 1 : 0
}

// Het balkje als tekst: vol (▰) en leeg (▱), één blokje per stap tot een maximum.
export function blokjes(l, max = 12) {
  const n = Math.max(1, Math.min(max, l?.stappen?.length ?? 0))
  const vol = Math.round((percentage(l) / 100) * n)
  return { vol: '▰'.repeat(vol), leeg: '▱'.repeat(n - vol) }
}

// Verstreken tijd, kort: "12 s", "4 min", "1 u 5 min".
export function duur(ms) {
  const s = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000))
  if (s < 60) return `${s} s`
  const min = Math.floor(s / 60)
  if (min < 60) return `${min} min`
  const u = Math.floor(min / 60)
  return min % 60 === 0 ? `${u} u` : `${u} u ${min % 60} min`
}
