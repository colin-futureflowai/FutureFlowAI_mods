export type DiffRegel = { soort: '+' | '-' | ' '; tekst: string; nr: number }
export type Shell = { stdout: string; stderr: string; exit: number | undefined; onderbroken: boolean }
export type ShellStatus = { toon: 'groen' | 'rood' | 'oranje'; tekst: string }
export function icoonVoor(tool: string): string
export function duurTekst(ms: number): string
export function beurtDuur(ms: number): string
export function diffRegels(oud: string, nieuw: string, max?: number): DiffRegel[]
export function telling(regels: DiffRegel[] | null | undefined): { plus: number; min: number }
export function wijzigRegels(uitvoer: unknown, max?: number): DiffRegel[] | null
export function korteInvoer(tool: string, invoer: unknown): string
export function inklappen<T>(regels: readonly T[], kop?: number, staart?: number): Array<T | { weg: number }>
export function shellUitvoer(uitvoer: unknown, fout: boolean): Shell | null
export function shellStatus(sh: Shell, fout: boolean): ShellStatus
export function regelsVan(tekst: string): string[]
export function resultaatTekst(uitvoer: unknown): string
export function invoerVelden(invoer: unknown): Array<[string, string]>
export function toolLabel(tool: string): string
