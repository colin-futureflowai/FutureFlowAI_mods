import type { Status } from './accounts.mjs'
import type { Limiet, Modus, Stap } from './api.mjs'

export type WisselInvoer = {
  modus: Modus
  apiAuto: boolean
  stappen: readonly Stap[] | undefined
  hoog: number
  laag: number
  accounts: Status | null
  limieten: Limiet[]
  apiKey: boolean
  orKey: boolean
  orModel?: string
  orSnel?: string
  orNu?: string
  nu: number
}
export type WisselRegel = { sleutel: 'abonnement' | 'account' | Stap; tekst: string; nu: boolean; dim: boolean }
export type WisselOverzicht = { aan: boolean; accAuto: boolean; nuOp: string; regels: WisselRegel[]; zinnen: [string, string]; noot: string }

export function wisselOverzicht(s: WisselInvoer): WisselOverzicht
export function grensVan(welke: 'hoog' | 'laag', invoer: string, andere: number): { n: number; fout?: undefined } | { fout: string; n?: undefined }
