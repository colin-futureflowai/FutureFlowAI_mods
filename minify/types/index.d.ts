// Contract van de state van minify: het niveau van deze sessie en wat het tot nu toe scheelde.

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

declare module 'claude-code' {
  interface PluginState {
    minify: { niveau: MinifyNiveau | null; teller: MinifyTeller | null }
  }
}
