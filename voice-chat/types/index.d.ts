export type VoiceState = 'connecting' | 'listening' | 'speaking' | 'muted'

export type VoiceBand = {
  mode: 'agent' | 'voorlezen'
  state: VoiceState
  claudeBusy: boolean
  /** Tool waarvoor Claude op goedkeuring wacht; leeg als hij niet wacht. */
  waitingFor: string
  /** Laatste taak die de spraakagent aan Claude doorgaf; leeg als er geen agent-taak loopt. */
  task: string
  heard: string
  said: string
}

declare module 'claude-code' {
  interface PluginState {
    'voice-chat': { band: VoiceBand | null }
  }
}
