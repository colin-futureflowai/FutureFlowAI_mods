import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine } from 'claude-code'

import { failOpen } from './ctx'
import { actieveKleuren } from './skins/register'

import { getal, perServer, procent, totalen } from '../lib/connectors.mjs'
import type { McpTool, ServerRij } from '../lib/connectors.mjs'
import { balkTekst } from '../lib/thema.mjs'

// Telt op na elke klik, zodat de tab opnieuw tekent (en de lijst opnieuw leest).
const versieAtom = atom({ plugin: 'futureflow', key: 'connectors.versie' } as const, 0)
// Wat in deze sessie met een klik is omgezet, per server; de lopende sessie verandert daar niet door.
const gewijzigdAtom = atom({ plugin: 'futureflow', key: 'connectors.gewijzigd' } as const, {} as Record<string, 'uit' | 'aan'>)

const UITLEG = 'Geldt vanaf de volgende sessie in deze map, net als /mcp.'

function cliPath($: Engine): string {
  return `${$.plugin.root}/cli/connectors.mjs`
}

// Draait cli/connectors.mjs. De desktop-app heeft een kaal PATH en argv[0] wordt daarop gezocht,
// dus `node` via /usr/bin/env met een PATH waar Homebrew vooraan staat.
async function cli($: Engine, args: string[]) {
  const isWin = (await $.env.get('OS')) === 'Windows_NT'
  if (isWin) return $.process.run(['node', cliPath($), ...args], { timeoutMs: 15_000 })
  const hostPath = (await $.env.get('PATH')) ?? ''
  const PATH = `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${hostPath}`
  return $.process.run(['/usr/bin/env', 'node', cliPath($), ...args], { env: { PATH }, timeoutMs: 15_000 })
}

// De uitgezette servers van deze map (alleen lezen). Een fout komt terug als tekst, niet als throw.
async function leesUit($: Engine, cwd: string): Promise<{ uit: string[]; fout?: string }> {
  try {
    const r = await cli($, ['list', '--cwd', cwd])
    if (r.exitCode !== 0) return { uit: [], fout: r.stderr.trim().replace(/^\[connectors\] /, '').slice(0, 160) || `exitcode ${r.exitCode}` }
    const data = JSON.parse(r.stdout.trim().split('\n').pop() ?? '{}') as { uit?: unknown }
    return { uit: Array.isArray(data.uit) ? data.uit.filter((s): s is string => typeof s === 'string') : [] }
  } catch (err) {
    return { uit: [], fout: err instanceof Error ? err.message : String(err) }
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
async function wissel($: Engine, cwd: string, server: string, uit: boolean): Promise<void> {
  try {
    const r = await cli($, ['zet', '--cwd', cwd, '--server', server, uit ? '--uit' : '--aan'])
    if (r.exitCode !== 0) {
      $.ui.toast(`Connector ${server} niet omgezet: ${r.stderr.trim().replace(/^\[connectors\] /, '').slice(0, 160) || `exitcode ${r.exitCode}`}`)
      return
    }
    const stand: 'uit' | 'aan' = uit ? 'uit' : 'aan'
    await update($, gewijzigdAtom, prev => ({ ...(prev ?? {}), [server]: stand }))
    await update($, versieAtom, n => (n ?? 0) + 1)
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
// in deze map uit (of weer aan) te zetten. Tekent alleen; schrijven gebeurt in onPress.
export async function connectorsTab($: Engine, e: any) {
  const { Box, Text, Button } = $.ui.resolve(e)
  try {
    const k = await actieveKleuren($)
    await read($, versieAtom) // opnieuw tekenen na een klik
    const gewijzigd = (await read($, gewijzigdAtom)) ?? {}
    const cwd = await $.session.cwd()
    const [{ tools, venster }, { uit, fout }] = await Promise.all([leesContext($), leesUit($, cwd)])
    const rijen = perServer(tools, uit, Object.keys(gewijzigd))
    const som = totalen(rijen)

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
          {fout ? <Text color={k.err} wrap="truncate-end">Lijst van /mcp niet gelezen: {fout}</Text> : null}
        </Box>

        {rijen.length === 0 ? <Text color={k.mut}>Geen connectors in deze sessie.</Text> : null}
        {rijen.map(r => {
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
                <Button key={`conn-${r.server}`} onPress={() => wissel($, cwd, r.server, !r.uit)}>
                  {r.uit ? 'Weer aan' : 'Uit vanaf volgende sessie'}
                </Button>
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  } catch (err) {
    failOpen($, err)
    return <Text dimColor>Connectors laden lukte niet; de fout staat in het logboek van de mod.</Text>
  }
}
