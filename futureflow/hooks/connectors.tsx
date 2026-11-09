import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine } from 'claude-code'

import type { ConnectorsLijst, DashboardTab } from '../types'

import { failOpen } from './ctx'
import { PANE } from './paneel'
import { actieveKleuren } from './skins/register'

import { getal, perServer, procent, totalen, verdeel } from '../lib/connectors.mjs'
import type { McpTool, ServerRij } from '../lib/connectors.mjs'
import { balkTekst } from '../lib/thema.mjs'

// De lijst uit de CLI, gelezen bij het openen van de tab, na een klik en elke 30 s zolang de tab
// open staat; tekenen leest alleen deze kopie en start geen Node-proces.
const lijstAtom = atom({ plugin: 'futureflow', key: 'connectors.lijst' } as const, null as ConnectorsLijst | null)
// Wat in deze sessie met een klik is omgezet, per server; de lopende sessie verandert daar niet door.
const gewijzigdAtom = atom({ plugin: 'futureflow', key: 'connectors.gewijzigd' } as const, {} as Record<string, 'uit' | 'aan'>)
// Zelfde atom als in dashboard.tsx en paneel.ts: welke tab open staat.
const tabAtom = atom({ plugin: 'futureflow', key: 'dashboard.tab' } as const, null as DashboardTab | null)

const UITLEG = 'Geldt vanaf de volgende sessie in deze map, net als /mcp.'
const VERS_MS = 30_000

// `env` van $.process.run komt bovenop die van de host: zo komt een CLAUDE_JSON (of SECURITY_BIN,
// SETTINGS_JSON) uit een settings-`env`-blok niet bij de CLI. Leeg = de standaard van de CLI.
const CLI_ENV = { CLAUDE_JSON: '', SECURITY_BIN: '/usr/bin/security', SETTINGS_JSON: '' }

let ticker: { cancel(): void } | undefined

function cliPath($: Engine): string {
  return `${$.plugin.root}/cli/connectors.mjs`
}

// De desktop-app heeft een kaal PATH en argv[0] wordt daarop gezocht, dus via /usr/bin/env met een
// PATH waar Homebrew vooraan staat (Windows: gewoon de naam).
async function opPath($: Engine, argv: string[]): Promise<{ argv: string[]; PATH?: string }> {
  if ((await $.env.get('OS')) === 'Windows_NT') return { argv }
  const hostPath = (await $.env.get('PATH')) ?? ''
  return { argv: ['/usr/bin/env', ...argv], PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${hostPath}` }
}

// Draait cli/connectors.mjs.
async function cli($: Engine, args: string[]) {
  const { argv, PATH } = await opPath($, ['node', cliPath($), ...args])
  return $.process.run(argv, { env: PATH === undefined ? CLI_ENV : { ...CLI_ENV, PATH }, timeoutMs: 15_000 })
}

const absoluut = (p: string) => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)

// De sleutel in `projects` van ~/.claude.json zoals Claude Code hem kiest: de git-root van de
// sessiemap (`git rev-parse --show-toplevel`; in een worktree is dat de worktree), anders de map zelf.
async function projectSleutel($: Engine): Promise<{ sleutel: string; map: string }> {
  const map = await $.session.cwd()
  try {
    const { argv, PATH } = await opPath($, ['git', 'rev-parse', '--show-toplevel'])
    const r = await $.process.run(argv, { cwd: map, timeoutMs: 5000, ...(PATH === undefined ? {} : { env: { PATH } }) })
    const top = r.exitCode === 0 ? (r.stdout.trim().split('\n')[0] ?? '').trim() : ''
    return { sleutel: absoluut(top) ? top : map, map }
  } catch {
    return { sleutel: map, map }
  }
}

// Leest de lijst van de projectmap (alleen lezen). Een fout komt terug als tekst, niet als throw.
async function leesLijst($: Engine): Promise<ConnectorsLijst> {
  const gelezen = await $.clock.now()
  let sleutel = '', map = ''
  try {
    ;({ sleutel, map } = await projectSleutel($))
    const r = await cli($, ['list', '--cwd', sleutel, '--map', map])
    if (r.exitCode !== 0) {
      return { sleutel, map, uit: [], servers: [], gelezen, fout: r.stderr.trim().replace(/^\[connectors\] /, '').slice(0, 160) || `exitcode ${r.exitCode}` }
    }
    const data = JSON.parse(r.stdout.trim().split('\n').pop() ?? '{}') as { uit?: unknown; servers?: unknown }
    const namen = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [])
    return { sleutel, map, uit: namen(data.uit), servers: namen(data.servers), gelezen }
  } catch (err) {
    return { sleutel, map, uit: [], servers: [], gelezen, fout: err instanceof Error ? err.message : String(err) }
  }
}

// Leest de lijst opnieuw en zet hem in de atom (de tab tekent dan opnieuw).
async function ververs($: Engine): Promise<void> {
  const lijst = await leesLijst($)
  await update($, lijstAtom, () => lijst)
}

// Bij het openen van de tab: nu lezen en daarna elke 30 s, tot het paneel dicht is of een andere tab open staat.
export async function openConnectors($: Engine): Promise<void> {
  try {
    await ververs($)
    ticker?.cancel()
    ticker = $.clock.every(VERS_MS, () => {
      void (async () => {
        const open = (await $.ui.panes()).some(p => p.id === PANE) && (await read($, tabAtom)) === 'connectors'
        if (!open) {
          ticker?.cancel()
          ticker = undefined
          return
        }
        await ververs($)
      })().catch(err => failOpen($, err))
    })
  } catch (err) {
    failOpen($, err)
  }
}

// MCP-tools in de context van deze sessie en het contextvenster; zonder gegevens een lege lijst.
async function leesContext($: Engine): Promise<{ tools: McpTool[]; venster: number }> {
  try {
    const gebruik = await $.session.usage({ breakdown: 'summary' })
    return { tools: gebruik.context.breakdown?.mcpTools ?? [], venster: gebruik.context.window ?? 0 }
  } catch {
    return { tools: [], venster: 0 }
  }
}

// Zet één server uit of aan via de CLI; één toast per klik, ook bij een fout.
async function wissel($: Engine, sleutel: string, server: string, uit: boolean): Promise<void> {
  try {
    const r = await cli($, ['zet', '--cwd', sleutel, '--server', server, uit ? '--uit' : '--aan'])
    if (r.exitCode !== 0) {
      $.ui.toast(`Connector ${server} niet omgezet: ${r.stderr.trim().replace(/^\[connectors\] /, '').slice(0, 160) || `exitcode ${r.exitCode}`}`)
      return
    }
    const stand: 'uit' | 'aan' = uit ? 'uit' : 'aan'
    await update($, gewijzigdAtom, prev => ({ ...(prev ?? {}), [server]: stand }))
    await ververs($)
    $.ui.toast(uit ? `${server} staat uit vanaf de volgende sessie in deze map.` : `${server} staat weer aan vanaf de volgende sessie in deze map.`)
  } catch (err) {
    failOpen($, err)
  }
}

// Wat er bij een rij staat: wat deze klik deed, of hoe het nu is.
function status(r: ServerRij, gewijzigd: 'uit' | 'aan' | undefined): string {
  if (r.uit) return r.tools > 0 || gewijzigd === 'uit' ? 'uit vanaf volgende sessie' : 'uit'
  if (gewijzigd === 'aan') return 'aan vanaf volgende sessie'
  return ''
}

// Inhoud van de tab Connectors: per MCP-server de tokens in context en een knop om hem
// in deze map uit (of weer aan) te zetten; servers van de app en van mods als één regel zonder knop.
// Tekent alleen; schrijven gebeurt in onPress. Zonder gelezen lijst (paneel hersteld zonder openen)
// leest hij hem één keer zelf, zonder iets te bewaren.
export async function connectorsTab($: Engine, e: any) {
  const { Box, Text, Button } = $.ui.resolve(e)
  try {
    const k = await actieveKleuren($)
    const gewijzigd = (await read($, gewijzigdAtom)) ?? {}
    const lijst = (await read($, lijstAtom)) ?? (await leesLijst($))
    const { tools, venster } = await leesContext($)
    const rijen = perServer(tools, lijst.uit, Object.keys(gewijzigd))
    const som = totalen(rijen)
    const { eigen, intern } = verdeel(rijen, [...lijst.servers, ...Object.keys(gewijzigd)])

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold color={k.accent}>Connectors</Text>
          <Text>
            <Text color={k.mut}>MCP in context </Text>
            <Text bold>{getal(som.inContext)} tokens</Text>
            <Text color={k.mut}>
              {venster ? ` · ${procent(som.inContext, venster)} van het venster (${getal(venster)})` : ''} · schema's samen {getal(som.tokens)}
            </Text>
          </Text>
          <Text color={k.mut}>{UITLEG}</Text>
          {lijst.sleutel && lijst.sleutel !== lijst.map ? (
            <Text color={k.mut} wrap="truncate-end">Projectmap (git-root): {lijst.sleutel}</Text>
          ) : null}
          {lijst.fout ? <Text color={k.err} wrap="truncate-end">Lijst van /mcp niet gelezen: {lijst.fout}</Text> : null}
        </Box>

        {rijen.length === 0 ? <Text color={k.mut}>Geen connectors in deze sessie.</Text> : null}
        {eigen.map(r => {
          const tekst = status(r, gewijzigd[r.server])
          return (
            <Box key={`rij-${r.server}`} flexDirection="column">
              <Text wrap="truncate-end">
                <Text color={r.uit ? k.warn : k.ok}>{'●'}</Text>
                {'  '}<Text bold>{r.server}</Text>
                <Text color={k.mut}>
                  {'  '}{r.tools} {r.tools === 1 ? 'tool' : 'tools'} · {getal(r.inContext)} / {getal(r.tokens)} tokens
                </Text>
              </Text>
              <Text>
                {'   '}<Text color={r.uit ? k.mut : k.accent}>{balkTekst(venster ? r.inContext / venster : 0, 20)}</Text>
                <Text color={k.mut}> {venster ? procent(r.inContext, venster) : ''}</Text>
                {tekst ? <Text color={k.warn}>  {tekst}</Text> : null}
              </Text>
              <Box flexDirection="row">
                <Text>{'   '}</Text>
                <Button key={`conn-${r.server}`} onPress={() => wissel($, lijst.sleutel, r.server, !r.uit)}>
                  {r.uit ? 'Weer aan' : 'Uit vanaf volgende sessie'}
                </Button>
              </Box>
            </Box>
          )
        })}
        {intern.servers > 0 ? (
          <Text color={k.mut} wrap="truncate-end">
            Intern (app en mods): {intern.tools} {intern.tools === 1 ? 'tool' : 'tools'}, {getal(intern.inContext)} tokens
          </Text>
        ) : null}
      </Box>
    )
  } catch (err) {
    failOpen($, err)
    return <Text dimColor>Connectors laden lukte niet; de fout staat in het logboek van de mod.</Text>
  }
}
