export type Modus = 'abonnement' | 'api'
export type Limiet = { label: string; percent: number; resetsAt?: number }
export type Door = { label: string; resetsAt?: number }
export type Toestand = { modus: Modus; auto: boolean; hoog: number; laag: number; overgeschakeldDoor?: Door; laatsteWissel: number }
export type Besluit = { naar: Modus; reden: string; door?: Door }
export type Prijs = { input: number; output: number; cacheLezen: number; cacheSchrijven: number }
export type Usage = {
  model?: string
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export const SERVICE: string
export const ACCOUNT: string
export const HELPER: string
export const WACHTTIJD: number
export const STANDAARD: Toestand
export const PRIJZEN: Record<'opus' | 'sonnet' | 'haiku', Prijs>

export function geldigeKey(s: unknown): boolean
export function masker(s: string): string
export function familie(model: unknown): 'opus' | 'sonnet' | 'haiku'
export function kosten(usage: Usage | null | undefined, prijzen?: Record<string, Prijs>): number
export function limietLabel(kind: unknown): string
export function limietenVan(rateLimits: unknown): Limiet[]
export function toestandVan(ruw: unknown): Toestand
export function beslis(s: Toestand & { limieten: Limiet[]; nu: number }): Besluit | null
export function dagSleutel(ms: number): string
export function telOp(perDag: Record<string, number> | null | undefined, dag: string, bedrag: number): Record<string, number>
export function kostenOverzicht(perDag: Record<string, number> | null | undefined, ms: number): { vandaag: number; maand: number }
export function usd(n: number): string
