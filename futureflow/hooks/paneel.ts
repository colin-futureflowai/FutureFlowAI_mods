import { atom, update } from 'claude-code'
import type { EngineInterface as Engine } from 'claude-code'

import type { DashboardTab } from '../types'

// Atoms moeten in het bestand staan waar ze gelezen of gezet worden (de hooks-module leest ze statisch);
// dashboard.tsx maakt dezelfde atoms nog eens aan, dat wijst naar dezelfde state.
// Gedeeld door dashboard.tsx, slots.tsx en minify.tsx: zo hoeven die geen kringimport te maken.
export const PANE = 'futureflow'
export const TITEL = 'FutureFlowAI'
export const TABS: readonly DashboardTab[] = ['overzicht', 'slots', 'minify', 'stijl']

const tabAtom = atom({ plugin: 'futureflow', key: 'dashboard.tab' } as const, null as DashboardTab | null)

// Zet de tab (als die er is) en opent het dashboard.
export async function openDashboard($: Engine, tab?: DashboardTab): Promise<void> {
  if (tab) await update($, tabAtom, () => tab)
  await $.ui.open({ id: PANE, title: TITEL })
}
