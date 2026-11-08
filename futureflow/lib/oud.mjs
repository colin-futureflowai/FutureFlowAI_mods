// Herkent of de oude plugins agent-slots en minify nog geïnstalleerd én aan staan.
// Pure functie, zonder Node-API's, zodat de hooks-module en de tests hem delen.

const SLOTS = 'agent-slots@futureflowai-mods'
const MINIFY = 'minify@futureflowai-mods'

const isObject = x => typeof x === 'object' && x !== null && !Array.isArray(x)

export function oudePlugins(installed, settings) {
  if (!isObject(installed)) return { slots: false, minify: false }
  const lijst = isObject(installed.plugins) ? installed.plugins : installed
  const enabled = isObject(settings) && isObject(settings.enabledPlugins) ? settings.enabledPlugins : {}
  const aanwezig = naam => Object.prototype.hasOwnProperty.call(lijst, naam) && enabled[naam] !== false
  return { slots: aanwezig(SLOTS), minify: aanwezig(MINIFY) }
}
