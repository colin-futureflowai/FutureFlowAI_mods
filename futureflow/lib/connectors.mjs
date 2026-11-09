// Tab Connectors: MCP-tools per server samentellen. Pure functies, zonder Node-API's.

const getalOf = n => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0)

// Eén rij per server: aantal tools, schema-tokens totaal, tokens nu in context (geladen schema's)
// en of de server in deze map uit staat. Uitgezette servers zonder tools komen er ook in
// (tokens 0); `ook` zijn servers die er zonder tools toch in moeten (bv. net weer aangezet).
// Gesorteerd op tokens aflopend, daarna op naam.
export function perServer(mcpTools, uit, ook = []) {
  const uitSet = new Set((Array.isArray(uit) ? uit : []).filter(s => typeof s === 'string'))
  const rijen = new Map()
  const rij = server => {
    let r = rijen.get(server)
    if (!r) {
      r = { server, tools: 0, tokens: 0, inContext: 0, uit: uitSet.has(server) }
      rijen.set(server, r)
    }
    return r
  }
  for (const t of Array.isArray(mcpTools) ? mcpTools : []) {
    if (!t || typeof t.serverName !== 'string' || !t.serverName) continue
    const r = rij(t.serverName)
    const tokens = getalOf(t.tokens)
    r.tools++
    r.tokens += tokens
    if (t.isLoaded) r.inContext += tokens
  }
  for (const s of uitSet) rij(s)
  for (const s of Array.isArray(ook) ? ook : []) if (typeof s === 'string' && s) rij(s)
  return [...rijen.values()].sort((a, b) => b.tokens - a.tokens || a.server.localeCompare(b.server))
}

// Totalen over alle rijen: schema-tokens en tokens nu in context.
export function totalen(rijen) {
  return rijen.reduce((t, r) => ({ tokens: t.tokens + r.tokens, inContext: t.inContext + r.inContext }), { tokens: 0, inContext: 0 })
}

// Heel getal met punt als duizendtal-scheiding: 12345 → "12.345".
export function getal(n) {
  return String(Math.round(getalOf(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

// Percentage van het venster als tekst: "6%", "<1%" bij iets maar minder dan 1%, "0%" bij niets.
export function procent(deel, geheel) {
  const d = getalOf(deel), g = getalOf(geheel)
  if (!g || !d) return '0%'
  const p = (d / g) * 100
  return p < 1 ? '<1%' : `${Math.round(p)}%`
}
