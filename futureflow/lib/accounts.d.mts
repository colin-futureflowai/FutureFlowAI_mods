import type { Beschikbaar, Door, Limiet, Modus, Toestand } from './api.mjs'

export type Venster = { label: '5u' | '7d' | string; pct?: number; resetsAt?: number }
export type Meting = { vensters: Venster[]; gemetenOp: number; fout?: string }
export type AccountStatus = 'ok' | 'opnieuw-inloggen' | 'onbekend'
export type Account = { id: number; sleutel: string; email: string; plan: string; inRotatie: boolean; status: AccountStatus }
export type Instellingen = {
  auto: boolean
  marge5u: number
  marge7d: number
  strategie: 'meeste-ruimte'
  wachttijd: number
  hysterese: number
  stand: 'stil' | 'vragen'
  maxWacht: number
}
export type KeuzeInvoer = {
  accounts: Account[]
  actief: number | null
  metingen: Record<number, Meting | undefined>
  instellingen: Instellingen
  nu: number
  laatsteWissel: number
}
export type KettingInvoer = KeuzeInvoer & { api: Toestand; sessieLimieten: Limiet[]; handmatigTot?: number; beschikbaar?: Beschikbaar }
export type KettingBesluit =
  | { soort: 'account'; naar: number; reden: string; door?: Door }
  | { soort: 'api'; naar: Modus; reden: string; door?: Door }
  | { soort: 'terug'; naar: number; reden: string }
export type PollInvoer = {
  vorig?: { interval: number; pct?: number }
  nieuwPct?: number
  actief: boolean
  uitgeput: boolean
  recent429: boolean
  mislukt?: boolean
  retryAfter?: number
  resetsAt?: number
  nu: number
  rnd: () => number
}
export type EigenSessie = { sessie: string; status: 'bezig' | 'tussen' | 'weg'; hartslag: number }
export type ClaudeRecord = {
  pid: number
  sessionId?: string
  entrypoint?: string
  status?: string
  statusUpdatedAt?: number
  levend: boolean
  onleesbaar?: boolean
}

export const LIVE: string
export const KOPIE: string
export const VORIGE: string
export const REDDING: string
export const GEDEELD: string[]
export const VERS: number
export const STANDAARD_INSTELLINGEN: Instellingen
export const POLL: {
  vloer: number
  actiefMax: number
  kandidaatStart: number
  kandidaatMax: number
  uitgeput: number
  na429Min: number
  na429Max: number
  factor: number
  beweging: number
  jitter: number
  resetMarge: number
  retryMarge: number
  recent429: number
}

export function instellingenVan(ruw: unknown): Instellingen
export function maskEmail(e: unknown): string
export function planLabel(o: { subscriptionType?: string; rateLimitTier?: string } | null | undefined): string
export function ruimte(m: Meting | undefined, i: Instellingen, nu: number): number | null
export function kiesAccount(s: KeuzeInvoer): { naar: number; reden: string } | null
export function sessieMeting(limieten: Limiet[], nu: number): Meting | undefined
export function handmatigTotVan(s: { nu: number; door?: Door; meting?: Meting }): number
export function ketting(s: KettingInvoer): KettingBesluit | null
export function pollPlan(p: PollInvoer): { volgende: number; interval: number }
export function telBezig(p: { eigen: EigenSessie[]; claude: ClaudeRecord[]; ikzelf: string; nu: number }): { bezig: number; wie: string[] }

export type StatusVenster = { pct?: number; resetsAt?: number }
export type StatusAccount = {
  id: number
  email: string
  plan: string
  inRotatie: boolean
  status: AccountStatus
  statusUitleg?: string
  label?: string
  gebruik: { '5u'?: StatusVenster; '7d'?: StatusVenster }
  gemetenOp?: number
  fout?: string
}
export type Status = {
  actief: number | null
  profiel: 'standaard' | 'eigen'
  accounts: StatusAccount[]
  instellingen: Instellingen
  laatsteWissel?: { tijd: number; van: number | null; naar: number; auto: boolean }
  wacht?: { sinds: number; wie: string[] }
  fout?: string
  gelezen: number
}

export function kettingAan(staat: unknown): boolean
export function statusVan(ruw: unknown, gelezen: number): Status
export function kettingInvoerVan(status: Status): Omit<KeuzeInvoer, 'nu'>
