import type { Usage } from './api.mjs'

export type OrModel = { id: string; naam: string; context?: number; in?: number; uit?: number }
export type OrInstellingen = { apiKeyHelper: string; env: Record<string, string> }
export type OrMarker = { apiKeyHelper?: string; env: Record<string, string>; envNieuw?: boolean }

export const OR_SERVICE: string
export const OR_HELPER: string
export const OR_URL: string
export const OR_ACCOUNT: string
export const CACHE_MS: number
export const TOON: number
export const CONTEXT_MIN: number
export const CONTEXT_1M: number
export const START: string
export const SHIM_MERK: string
export function modelIdVoor(m: { id: string; context?: number } | null | undefined): string | undefined
export function teKlein(m: { context?: number } | null | undefined): boolean
export const CACHE_ZWAK: string[]
export const CACHE_ZWAK_TEKST: string
export function cacheZwak(m: { id?: string } | null | undefined): boolean
export type CacheOordeel = 'goed' | 'wisselend' | 'zwak'
export type CacheRonde = { in: number; read: number; write: number; aandeel: number }
export type CacheMeting = { oordeel: CacheOordeel; aandeel: number; raak: number; van: number; gemeten: number }
export function cacheTelling(rondes: readonly CacheRonde[] | null | undefined): { raak: number; van: number; aandeel: number }
export const CACHE_RONDES: number
export const CACHE_GRENS: number
export const CACHE_OORDEEL_TEKST: Record<CacheOordeel, string>
export function cacheBlok(zaad: string, woorden?: number): string
export function cacheProef(model: string, zaad: string): Array<Record<string, unknown>>
export function cacheRonde(usage: unknown): CacheRonde
export function cacheOordeel(rondes: readonly CacheRonde[] | null | undefined): CacheOordeel | 'onbekend'
export function cacheMetingen(ruw: unknown): Record<string, CacheMeting>
export function cacheStand(m: { id?: string } | null | undefined, metingen: Record<string, CacheMeting> | null | undefined): { oordeel: CacheOordeel; tekst: string; aandeel?: number; raak?: number; van?: number; gemeten?: number } | null
export function shimTekst(settingsPad: string, poortPad?: string): string
export type PoortReden = { id: string; reden: 'zwak' | 'ongemeten' }
export type PoortOordeel = { ok: boolean; redenen: PoortReden[] }
export function instellingModellen(d: unknown): string[]
export function poortOordeel(ids: Array<string | undefined>, metingen: Record<string, CacheMeting> | null | undefined): PoortOordeel
export const POORT_REDEN: Record<'zwak' | 'ongemeten', string>
export function poortTekst(redenen: PoortReden[]): string
export const POORT_OK: string
export function poortBestand(oordeel: PoortOordeel): string

export function geldigeOrKey(s: unknown): boolean
export function geldigModel(s: unknown): boolean
export type Slot = 'm1' | 'm2' | 'm3' | 'm4' | 'm5'
export type OrKeuze = Partial<Record<Slot, string>>
export const SLOTS: readonly Slot[]
export const SLOT_UITLEG: Readonly<Record<Slot, string>>
export function keuzeVan(ruw: unknown): OrKeuze
export function orInstellingen(k: OrKeuze & { m1: string }): OrInstellingen
export function pasToe(data: unknown, gewenst: OrInstellingen): { data: Record<string, any>; marker: OrMarker; vreemd?: undefined } | { vreemd: string; data?: undefined; marker?: undefined }
export function haalWeg(data: unknown, marker: unknown): Record<string, any>
export function eigenBasis(marker: unknown): string | undefined
export function perMtok(v: unknown): number | undefined
export function modellenVan(ruw: unknown): OrModel[]
export function isClaude(id: unknown): boolean
export function sorteer(lijst: readonly OrModel[] | null | undefined, zoek?: string): OrModel[]
export function prijsTekst(n: number | undefined): string
export function contextTekst(n: number | undefined): string
export function orKosten(usage: Usage | null | undefined, prijs: { in?: number; uit?: number } | null | undefined): number
export function geldigeSessie(s: unknown): boolean
export function shQuote(s: string): string
export function herstartCommando(a: { cwd: unknown; sessie: unknown; shim: unknown }): string | undefined
export function asString(s: string): string
export function herstartScript(app: 'terminal' | 'iterm', commando: string): string
export function contextTeGroot(tokens: unknown, context: unknown): boolean
export const OR_MARKER: string
export function orModelAlsStandaard(model: unknown, keuze: unknown): boolean
export function orcaArgs(a: { bin: unknown; worktree: unknown; cwd: unknown; commando: unknown }): string[] | undefined
export function orcaClaudeStart(command: unknown): boolean
export const ORCA_WEIGER: string
