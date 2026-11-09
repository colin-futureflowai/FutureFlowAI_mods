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

// Kan /mcp deze server uitzetten? Ja voor claude.ai-connectors, servers van plugins (`plugin:<plugin>:<naam>`)
// en servers uit de eigen configuratie (`mcpServers` in ~/.claude.json, het project of .mcp.json).
// De rest komt van de app of van een mod (bv. ccd_session, Claude_Browser, terminal, futureflow).
export function wisselbaar(server, geconfigureerd) {
  if (typeof server !== 'string' || !server) return false
  if (server.startsWith('claude.ai ') || server.startsWith('plugin:')) return true
  return Array.isArray(geconfigureerd) ? geconfigureerd.includes(server) : false
}

// Splitst de rijen: `eigen` met een knop (wisselbaar, of al uitgezet zodat hij weer aan kan) en
// `intern` als één optelsom (servers, tools, schema-tokens, tokens in context) zonder knop.
export function verdeel(rijen, geconfigureerd) {
  const eigen = []
  const intern = { servers: 0, tools: 0, tokens: 0, inContext: 0 }
  for (const r of Array.isArray(rijen) ? rijen : []) {
    if (r.uit || wisselbaar(r.server, geconfigureerd)) {
      eigen.push(r)
    } else {
      intern.servers++
      intern.tools += r.tools
      intern.tokens += r.tokens
      intern.inContext += r.inContext
    }
  }
  return { eigen, intern }
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
