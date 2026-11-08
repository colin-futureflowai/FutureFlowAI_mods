import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { DashboardTab } from '../types'

import { failOpen } from './ctx'
import { minifyTab } from './minify'
import { openDashboard, PANE, TABS } from './paneel'
import { slotsTab, startSlotsTicker } from './slots'

import { modusVoor, palet, woordmerkSvg } from '../lib/thema.mjs'
import type { Modus } from '../lib/thema.mjs'

export { openDashboard }

const tabAtom = atom({ plugin: 'futureflow', key: 'dashboard.tab' } as const, null as DashboardTab | null)
const themaAtom = atom({ plugin: 'futureflow', key: 'dashboard.theme' } as const, null as string | null)

const NAMEN: Record<DashboardTab, string> = { overzicht: 'Overzicht', slots: 'Slots', minify: 'Minify', stijl: 'Stijl' }

// De stijl-instelling (licht/donker) komt in een latere stap; tot dan volgt de modus Claude Code's thema.
async function stijlModus($: Engine): Promise<Modus | undefined> {
  return undefined
}

async function themaNu($: Engine): Promise<string | null> {
  const gezet = await read($, themaAtom)
  if (gezet) return gezet
  try {
    const rij = (await $.config.list()).find(r => r.key === 'theme')
    return typeof rij?.value === 'string' ? rij.value : null
  } catch {
    return null
  }
}

async function modusNu($: Engine): Promise<Modus> {
  return (await stijlModus($)) ?? modusVoor(await themaNu($))
}

// Start van het dashboard; register.tsx roept dit aan vanuit zijn ene session.start.
export async function startDashboard($: Engine): Promise<void> {
  try {
    await $.command.register({ name: 'futureflow', description: 'Dashboard van FutureFlowAI: overzicht, slots, minify, stijl' })
  } catch (err) {
    failOpen($, err)
  }
}

export const registerDashboard = (on: Parameters<Register>[0]): void => {
  on('command.run', { command: 'futureflow' }, async ($, e) => {
    const woord = (e.args ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? ''
    if (woord && !(TABS as readonly string[]).includes(woord)) {
      return { text: `Onbekende tab "${woord}". Gebruik: /futureflow ${TABS.join('|')}` }
    }
    const tab = (woord || undefined) as DashboardTab | undefined
    await openDashboard($, tab)
    await startSlotsTicker($)
    return { text: `Dashboard geopend${tab ? ` op de tab ${NAMEN[tab]}` : ''}.` }
  })

  // Thema van Claude Code gewijzigd: kop opnieuw tekenen in de juiste modus.
  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const r = await next(e)
    if (typeof e.value === 'string') await update($, themaAtom, () => e.value as string)
    return r
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    const { Box, Text, Button } = el
    const tab = (await read($, tabAtom)) ?? 'overzicht'
    const modus = await modusNu($)
    const p = palet(modus)
    // Alleen de terminal tekent geen Svg. Niet `'Svg' in el` gebruiken: de tabel antwoordt daar ook in de terminal ja.
    const Svg = e.surface !== 'terminal' && 'Svg' in el ? el.Svg : undefined

    const inhoud =
      tab === 'slots' ? await slotsTab($, e)
      : tab === 'minify' ? await minifyTab($, e)
      : <Text dimColor>Komt in de volgende stap.</Text>

    return (
      <Box flexDirection="column" gap={1} padding={1}>
        <Box flexDirection="column">
          {Svg ? (
            <Svg source={woordmerkSvg(modus, 220)} alt="FutureFlowAI" />
          ) : (
            <Text bold>
              <Text>FutureFlow</Text>
              <Text color={p.groen}>AI</Text>
            </Text>
          )}
          <Box flexDirection="row" gap={2}>
            {TABS.map((t, i) => (
              <Button
                key={`tab-${t}`}
                hotkey={String(i + 1)}
                onPress={async () => {
                  await update($, tabAtom, () => t)
                  if (t === 'slots' || t === 'overzicht') await startSlotsTicker($)
                }}
              >
                {t === tab ? <Text color={p.groen} bold>{NAMEN[t]}</Text> : NAMEN[t]}
              </Button>
            ))}
          </Box>
        </Box>
        {inhoud}
      </Box>
    )
  })
}
