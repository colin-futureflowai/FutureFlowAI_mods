// Contract van de state van agent-slots: de laatste momentopname voor het dashboard.

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

export type SlotsSnapshot = {
  memory: SlotsMemory
  config: { limits: Record<string, number>; floorPercent: number; criticalPercent: number }
  slots: SlotsHolder[]
  refusals: SlotsEvent[]
  at: number
  error?: string
}

declare module 'claude-code' {
  interface PluginState {
    'agent-slots': { snapshot: SlotsSnapshot | null }
  }
}
