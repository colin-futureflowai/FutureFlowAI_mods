export type Modus = 'licht' | 'donker'
export type Palet = {
  groen: string; groenZacht: string; inkt: string; mut: string; lijn: string
  achtergrond: string; vlak: string; rood: string; oranje: string
}
export function modusVoor(theme: unknown): Modus
export function palet(modus: Modus): Palet
export function woordmerkSvg(modus: Modus, breedte: number): string
export function balkTekst(fractie: number, breedte: number): string
