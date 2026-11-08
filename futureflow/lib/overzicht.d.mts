export type Kpi = { titel: string; waarde: string; sub: string; toon: 'groen' | 'oranje' | 'mut'; fractie?: number }
export type KpiInvoer = {
  teller?: { beurten: number; output: number; ingekort: number; uitvoerVoor: number; uitvoerNa: number } | null
  perNiveau?: Record<string, { beurten: number; output: number }>
  niveau?: string
  snapshot?: { memory: { freePercent: number; totalGB: number } } | null
  context?: { gebruikt: number; max: number } | null
}
export function kpis(invoer: KpiInvoer): Kpi[]
