// Contract van de state van futureflow: Slots (momentopname voor het dashboard) en Minify (niveau en tellers).

export type SlotsMemory = { freePercent: number; totalGB: number; source: string }

export type SlotsHolder = {
  kind: string
  session?: string
  cwd?: string
  command?: string
  since?: string
  pid?: number
  childPid?: number
}

export type SlotsEvent = { t: string; kind?: string; tool?: string; reason?: string; command?: string }

export type OverflowJob = {
  id: string
  repo: string
  branch: string
  base: string
  task: string
  session?: string
  started: string
  status: 'running' | 'done'
  finished?: string
  commit?: string
  report?: string
  progress?: string
  error?: string
  delivered?: boolean
}

export type SlotsSnapshot = {
  memory: SlotsMemory
  config: { limits: Record<string, number>; floorPercent: number; criticalPercent: number; cloudOverflow?: boolean; enabled?: boolean }
  slots: SlotsHolder[]
  refusals: SlotsEvent[]
  overflow?: OverflowJob[]
  at: number
  error?: string
}

export type MinifyNiveau = 'O1' | 'O2' | 'O3' | 'uit'

export type MinifyTeller = {
  /** Beurten van de hoofdsessie met een gemeten usage. */
  beurten: number
  /** Output-tokens van die beurten samen. */
  output: number
  /** Tooluitvoer die minify inkortte: aantal keer en tekens voor en na. */
  ingekort: number
  uitvoerVoor: number
  uitvoerNa: number
}

/** Eén ingekorte tooluitvoer, voor de lijst in het dashboard. */
export type MinifyInkorting = {
  tool: string
  voor: number
  na: number
  pad: string
  t: number
}

declare module 'claude-code' {
  interface PluginState {
    futureflow: {
      'slots.snapshot': SlotsSnapshot | null
      'minify.niveau': MinifyNiveau | null
      'minify.teller': MinifyTeller | null
      /** Output-tokens per beurt van deze sessie, de laatste 60. */
      'minify.reeks': number[] | null
      /** De laatste 8 inkortingen, nieuwste eerst. */
      'minify.recent': MinifyInkorting[] | null
    }
  }
}
