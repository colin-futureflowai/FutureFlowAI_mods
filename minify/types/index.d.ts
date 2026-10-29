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
    minify: {
      niveau: MinifyNiveau | null
      teller: MinifyTeller | null
      /** Output-tokens per beurt van deze sessie, de laatste 60. */
      reeks: number[] | null
      /** De laatste 8 inkortingen, nieuwste eerst. */
      recent: MinifyInkorting[] | null
    }
  }
}
