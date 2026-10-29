export type Niveau = 'O1' | 'O2' | 'O3'
export type Commando =
  | { soort: 'dashboard' | 'status' | 'stats' | 'uit' | 'toepassen' }
  | { soort: 'niveau'; niveau: Niveau }
  | { soort: 'standaard'; niveau: Niveau | 'uit' }
  | { soort: 'bestand' | 'herstel'; pad: string }
  | { soort: 'onbekend'; tekst: string }
export const NIVEAUS: Niveau[]
export const STANDAARD: Niveau
export function regelsVoor(niveau: Niveau): string
export function herinnering(niveau: Niveau): string
export function subagentRegel(niveau: Niveau): string
export function leesCommando(args: string | undefined): Commando
export function normaliseerNiveau(woord: string | undefined): Niveau | 'uit' | null
export function isUitVerzoek(prompt: string | undefined): boolean
