export const STANDAARD_DREMPEL: number
export type Ingekort = { tekst: string; ingekort: boolean; voor: number; na: number }
export function opschonen(tekst: string): string
export function samenvoegen(regels: string[]): string[]
export function jsonSkelet(waarde: unknown, diepte?: number): string
export function inkorten(tekst: string, opties?: { drempel?: number }): Ingekort
export function voetregel(pad: string, voor: number, na: number): string
