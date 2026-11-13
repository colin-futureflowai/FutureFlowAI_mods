export const PROXY_POORT: number
export const PROXY_VERSIE: string
export const PROXY_STIL_MS: number
export const LOG_MAX_BYTES: number
export const TELT_VENSTER_MS: number
export const TELT_MIN_TOKENS: number
export const RAAK_GRENS: number
export function proxyUrl(poort?: number): string
export function doorHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string | string[]>
export type Info = { model?: string; stream: boolean; baan?: string }
export function aanvraagInfo(bodyTekst: string): Info
export type Gebruik = { in: number; uit: number; read: number; write: number; aanbieder?: string; kosten?: number }
export function gebruikUitJson(obj: unknown): Gebruik
export function maakSseLezer(): { voeg(tekst: string): void; uit(): Gebruik }
export type Telling = 'raak' | 'mis' | 'telt-niet'
export type Regel = {
  t: number; sessie: string; pad: string; model?: string; baan?: string; stream: boolean; status: number
  aanbieder?: string; in: number; uit: number; read: number; write: number; aandeel: number; telling: Telling; ms: number; kosten?: number; vast?: boolean; fout?: string
  van?: string; actie?: 'wissel' | 'stop'
}
export function logRegel(a: { t: number; sessie?: string; pad: string; info: Info; status: number; gebruik: Gebruik; ms: number; fout?: string; vorige?: Regel; gewisseld?: boolean; vast?: boolean; venster?: number }): Regel
export type Stand = Record<string, Record<string, { aanvragen: number; raak: number; mis: number; in: number; read: number; aanbieder?: string; laatst: number }>>
export function werkStandBij(stand: Stand, regel: Regel): Stand
export function geldigeHost(host: unknown, poort: number): boolean
export function isEigenPad(pad: string): boolean
export function foutAntwoord(bericht: string): { type: 'error'; error: { type: 'api_error'; message: string } }
export const MIS_WISSEL: number
export const MIS_STOP: number
export const SLECHT_MS: number
export type AanbiederStand = { raak: number; mis: number; fout: number; laatst: number; slechtTot?: number }
export type Aanbieders = Record<string, Record<string, AanbiederStand>>
export function werkAanbiederBij(a: Aanbieders, model: string, aanbieder: string, wat: 'raak' | 'mis' | 'fout' | 'slecht', nu: number): Aanbieders
export function slechte(a: Aanbieders, model: string, nu: number): string[]
export function kiesAanbieder(a: Aanbieders, model: string, nu: number, zonder?: string[]): string | undefined
export function metAanbieder(body: Record<string, unknown>, vast: string | undefined, negeer: string[]): Record<string, unknown>
export function probeerOpnieuw(status: number): boolean
export type Baan = { mis: number; gewisseld: boolean }
export type Besluit = { baan: Baan; actie: 'niets' | 'wissel' | 'stop' }
export function besluit(baan: Baan | undefined, telling: Telling): Besluit
export type Rijen = Partial<Record<'m1' | 'm2' | 'm3' | 'm4' | 'm5', string>>
export type RijHistorie = Partial<Record<keyof Rijen, Array<{ id: string; t: number }>>>
export function wisselModel(id: string | undefined, nu: Rijen, historie: RijHistorie): string | undefined
export function isZwak(metingen: unknown, model: string): boolean
export function stopBericht(model: string, poort: number): string
export function zwakMeting(aandeel: number, nu: number): { oordeel: 'zwak'; aandeel: number; raak: 0; van: number; gemeten: number }
export function geldigeSchrijf(a: { host: unknown; origin: unknown; xff: unknown; contentType: unknown; poort: number }): boolean
