// Herkent of de oude plugins agent-slots en minify nog geïnstalleerd én aan staan.
// Pure functie, zonder Node-API's, zodat de hooks-module en de tests hem delen.
// Twee bronnen: installed_plugins.json (`<naam>@futureflowai-mods`) en de door claude.ai
// gesynchroniseerde kopieën (`<naam>@synced`, mappen onder ~/.claude/plugins/synced/*/).

const SLOTS = 'agent-slots@futureflowai-mods'
const MINIFY = 'minify@futureflowai-mods'

const isObject = x => typeof x === 'object' && x !== null && !Array.isArray(x)

// Mapnaam is de pluginnaam zelf of met achtervoegsel `~...` (bv. `minify~g2`); `minifyx` telt niet.
const heetSynced = (naam, plugin) => naam === plugin || naam.startsWith(`${plugin}~`)

export function oudePlugins(installed, settings, synced) {
  const lijst = !isObject(installed) ? {} : isObject(installed.plugins) ? installed.plugins : installed
  const enabled = isObject(settings) && isObject(settings.enabledPlugins) ? settings.enabledPlugins : {}
  const mappen = Array.isArray(synced) ? synced.filter(n => typeof n === 'string') : []
  const aanwezig = (naam, plugin) => {
    if (Object.prototype.hasOwnProperty.call(lijst, naam) && enabled[naam] !== false) return true
    const kopie = `${plugin}@synced`
    return mappen.some(m => heetSynced(m, plugin)) && enabled[kopie] !== false
  }
  return { slots: aanwezig(SLOTS, 'agent-slots'), minify: aanwezig(MINIFY, 'minify') }
}
