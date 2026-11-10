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
export function shimTekst(settingsPad: string): string

export function geldigeOrKey(s: unknown): boolean
export function geldigModel(s: unknown): boolean
export const STANDEN: readonly ['opus', 'sonnet', 'fable']
export type Stand = 'opus' | 'sonnet' | 'fable'
export function orInstellingen(model: string, snel: string, standen?: Partial<Record<Stand, string>>): OrInstellingen
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
