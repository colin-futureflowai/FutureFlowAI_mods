export type MeterToon = 'ok' | 'warn' | 'err'
export function meterToon(vrij: number, vloer: number, kritiek: number): MeterToon
export function meterTekst(vrij: number, totaalGB: number, breedte?: number): string
