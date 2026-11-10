import { atom, update } from 'claude-code'
import type { EngineInterface as Engine } from 'claude-code'

import type { DashboardTab } from '../types'

// Atoms moeten in het bestand staan waar ze gelezen of gezet worden (de hooks-module leest ze statisch);
// dashboard.tsx maakt dezelfde atoms nog eens aan, dat wijst naar dezelfde state.
// Gedeeld door dashboard.tsx, slots.tsx en minify.tsx: zo hoeven die geen kringimport te maken.
export const PANE = 'futureflow'
export const TITEL = 'FutureFlowAI'
export const TABS: readonly DashboardTab[] = ['overzicht', 'wisselen', 'zuinig', 'instellingen']

// Oude tabnamen (tot 0.8) wijzen naar de nieuwe tab.
export const OUDE_TABS: Readonly<Record<string, DashboardTab>> = {
  slots: 'zuinig',
  minify: 'zuinig',
  stijl: 'instellingen',
  connectors: 'instellingen',
  api: 'wisselen',
  accounts: 'wisselen',
  openrouter: 'wisselen',
}

// Tabnaam (nieuw of oud) → tab; onbekend = null.
export function tabVan(naam: unknown): DashboardTab | null {
  if (typeof naam !== 'string') return null
  if ((TABS as readonly string[]).includes(naam)) return naam as DashboardTab
  return OUDE_TABS[naam] ?? null
}

const tabAtom = atom({ plugin: 'futureflow', key: 'dashboard.tab' } as const, null as DashboardTab | null)

// Zet de tab (als die er is) en opent het dashboard.
export async function openDashboard($: Engine, tab?: DashboardTab): Promise<void> {
  if (tab) await update($, tabAtom, () => tab)
  await $.ui.open({ id: PANE, title: TITEL })
}
