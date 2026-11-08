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

export type DashboardTab = 'overzicht' | 'slots' | 'minify' | 'stijl'

/** Instellingen van de FFAI-skin, in `$.store` onder `stijl`. */
export type Stijl = {
  aan: boolean
  modus: 'auto' | 'licht' | 'donker'
  /** Tool-regels met icoon en tijd. */
  regels: boolean
  /** Diff-kaart onder Edit/Write/MultiEdit. */
  diff: boolean
  /** Shell-kaart onder Bash. */
  shell: boolean
  /** Spinner en beurtduur in groen. */
  spinner: boolean
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
      'dashboard.tab': DashboardTab | null
      /** Laatst gezette waarde van Claude Code's thema, om skin en dashboard opnieuw te tekenen. */
      'skin.theme': string | null
      /** Stijl zoals laatst gezet in deze sessie (spiegel van de store, zodat tekenaars opnieuw tekenen). */
      'skin.stijl': Stijl | null
      /** Per tool-aanroep (id = tool_use_id): duur in ms, -1 zolang onbekend. */
      'skin.duur': number
      /** Per Bash-aanroep: het commando, voor de kop van de shell-kaart. */
      'skin.commando': string
      /** Per tool-regel: opengeklapt met ▸. */
      'skin.open': boolean
      /** Begin van de lopende beurt (clock-ms), 0 = onbekend. */
      'skin.start': number
      /** Telt elke seconde op zolang de spinner loopt, om hem opnieuw te tekenen. */
      'skin.tik': number
      'minify.niveau': MinifyNiveau | null
      'minify.teller': MinifyTeller | null
      /** Output-tokens per beurt van deze sessie, de laatste 60. */
      'minify.reeks': number[] | null
      /** De laatste 8 inkortingen, nieuwste eerst. */
      'minify.recent': MinifyInkorting[] | null
    }
  }
}
