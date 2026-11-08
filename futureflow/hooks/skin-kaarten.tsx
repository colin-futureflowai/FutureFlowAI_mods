// Tekenwerk van de FFAI-skin: tool-regel, diff-kaart en shell-kaart, voor terminal (Box/Text)
// en desktop (Svg). Krijgt de elementen-tabel (`ui`) mee, nooit `$`.
// Opzet (regel met ▸ rechts, kaart met kop en ingeklapte stromen) naar claude-skins
// (MIT, hellosverre, commit cf0d39f); de code is eigen werk.

import type { Palet } from '../lib/thema.mjs'
import { diffSvg, shellSvg } from '../lib/skin-svg.mjs'
import { inklappen, regelsVan } from '../lib/skin.mjs'
import type { DiffRegel, Shell, ShellStatus } from '../lib/skin.mjs'

// Een Svg mag niet groter zijn; daarboven tekent Claude Code zelf.
export const MAX_SVG = 131072

// Achtergrond van een verwijderde regel in de terminal (geen alfa daar).
const roodZacht = (p: Palet) => (p.achtergrond === '#ffffff' ? '#fbe7e5' : '#3a1d1a')

export type Regel = {
  icoon: string
  label: string
  kort: string
  fout: boolean
  duur?: string
  tel?: { plus: number; min: number }
  open: boolean
  velden: Array<[string, string]>
  resultaat: string
  wissel: () => void
}

// Eén regel: icoon in een groen vlakje, toolnaam vet, korte invoer, rechts tijd, +N −M en ▸.
export function toolRegel(ui: any, p: Palet, r: Regel) {
  const { Box, Text, Button } = ui
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end">
            <Text backgroundColor={p.groenZacht} color={p.groen} bold>{` ${r.icoon} `}</Text>
            <Text color={p.inkt} bold>{` ${r.label}`}</Text>
            <Text color={r.fout ? p.rood : p.mut}>{r.kort === '' ? '' : `  ${r.kort}`}</Text>
          </Text>
        </Box>
        {r.duur ? (
          <Box flexShrink={0} paddingLeft={1}>
            <Text color={p.mut}>{r.duur}</Text>
          </Box>
        ) : ''}
        {r.tel ? (
          <Box flexShrink={0} paddingLeft={1}>
            <Text>
              <Text color={p.groen}>{`+${r.tel.plus}`}</Text>
              <Text color={p.rood}>{` −${r.tel.min}`}</Text>
            </Text>
          </Box>
        ) : ''}
        <Box flexShrink={0} paddingLeft={1}>
          <Button key="open" label={r.open ? '▾' : '▸'} plain dimColor onPress={r.wissel} />
        </Box>
      </Box>
      {r.open ? (
        <Box flexDirection="column" paddingLeft={4}>
          {r.velden.map(([naam, waarde]) => (
            <Text key={`veld-${naam}`}>
              <Text color={p.mut}>{`${naam}  `}</Text>
              <Text color={p.inkt}>{waarde}</Text>
            </Text>
          ))}
          {r.resultaat === '' ? '' : <Text color={r.fout ? p.rood : p.inkt}>{r.resultaat}</Text>}
        </Box>
      ) : ''}
    </Box>
  )
}

// Diff-kaart. Desktop: Svg; terminal: rand, kop en regels op een groene of rode tint.
// null als de Svg te groot wordt (dan tekent Claude Code zelf).
export function diffKaart(ui: any, desktop: boolean, p: Palet, pad: string, regels: DiffRegel[], tel: { plus: number; min: number }) {
  const { Box, Text, Svg } = ui
  const kop = `+${tel.plus} −${tel.min}`
  if (desktop) {
    const source = diffSvg(regels, pad, tel, p)
    if (source.length > MAX_SVG) return null
    return <Svg source={source} alt={`Wijziging in ${pad}: ${kop}`} />
  }
  const breedte = String(Math.max(1, ...regels.map(r => r.nr))).length
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={p.lijn}>
      <Box flexDirection="row" paddingX={1}>
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end" color={p.inkt} bold>{pad}</Text>
        </Box>
        <Box flexShrink={0} paddingLeft={2}>
          <Text color={p.groen} bold>{kop}</Text>
        </Box>
      </Box>
      {regels.map((r, i) => (
        <Text key={`d-${i}`} backgroundColor={r.soort === '+' ? p.groenZacht : r.soort === '-' ? roodZacht(p) : undefined}>
          <Text color={p.mut}>{` ${r.nr > 0 ? String(r.nr).padStart(breedte) : ' '.repeat(breedte)} `}</Text>
          <Text color={r.soort === '+' ? p.groen : r.soort === '-' ? p.rood : p.mut}>{`${r.soort} `}</Text>
          <Text color={r.nr === 0 ? p.mut : p.inkt}>{r.tekst === '' ? ' ' : r.tekst}</Text>
        </Text>
      ))}
    </Box>
  )
}

// Shell-kaart: commando en status in de kop, stdout, dan stderr onder een rood label; elke stroom 8 + 4.
export function shellKaart(ui: any, desktop: boolean, p: Palet, commando: string, sh: Shell, status: ShellStatus) {
  const { Box, Text, Svg } = ui
  const kleur = status.toon === 'rood' ? p.rood : status.toon === 'oranje' ? p.oranje : p.groen
  if (desktop) {
    const source = shellSvg(commando, sh, status, p)
    if (source.length > MAX_SVG) return null
    return <Svg source={source} alt={`${commando || 'Uitvoer'}: ${status.tekst}`} />
  }
  const uit = inklappen(regelsVan(sh.stdout))
  const fout = inklappen(regelsVan(sh.stderr))
  const rij = (r: string | { weg: number }, i: number, isFout: boolean) =>
    typeof r === 'string'
      ? <Text key={`${isFout ? 'e' : 'o'}-${i}`} color={isFout ? p.rood : p.inkt}>{r === '' ? ' ' : r}</Text>
      : <Text key={`${isFout ? 'e' : 'o'}-${i}`} color={p.mut}>{`… ${r.weg} regels verborgen`}</Text>
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={p.lijn}>
      <Box flexDirection="row" paddingX={1} backgroundColor={p.vlak}>
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end">
            <Text color={p.groen}>$ </Text>
            <Text color={p.inkt} bold>{commando === '' ? 'Uitvoer' : commando}</Text>
          </Text>
        </Box>
        <Box flexShrink={0} paddingLeft={2}>
          <Text color={kleur}>{status.tekst}</Text>
        </Box>
      </Box>
      <Box flexDirection="column" paddingX={1}>
        {uit.length === 0 && fout.length === 0 ? <Text color={p.mut}>geen uitvoer</Text> : ''}
        {uit.map((r, i) => rij(r, i, false))}
        {fout.length > 0 ? <Text color={p.rood} bold>stderr</Text> : ''}
        {fout.map((r, i) => rij(r, i, true))}
      </Box>
    </Box>
  )
}
