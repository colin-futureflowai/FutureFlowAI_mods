#!/bin/sh
# Geeft de regels van minify mee aan Claude Code, als command hook (zoals caveman doet).
# Dit is het onderdeel Minify van futureflow. Staat de oude minify-plugin nog aan (zie het bestand
# `oud` in de state van futureflow), dan zwijgt dit script: anders kreeg Claude de regels twee keer.
# Gewone sh en cat, geen Node: de desktop-app heeft een kaal PATH.
#
# De mod schrijft per sessie het niveau naar ~/.claude/minify/niveau/<sessie> en de teksten naar
# ~/.claude/minify/regels/<niveau>{.md,.kort.md,.subagent.md}. Dit script leest ze alleen.
#
#   regels.sh start     SessionStart: volledige regels
#   regels.sh prompt    UserPromptSubmit: korte herinnering; volledige regels na een niveauwissel
#   regels.sh subagent  SubagentStart: regel voor het eindrapport (als JSON)

soort="$1"
dir="${MINIFY_HOME:-$HOME/.claude/minify}"
invoer=$(cat)

# Oude minify-plugin nog aan: die geeft de regels mee, wij zeggen niets.
ff="${FUTUREFLOW_HOME:-$HOME/.claude/futureflow}"
if [ -e "$ff/oud" ]; then
  grep -q minify "$ff/oud" && exit 0
else
  # De mod schreef `oud` nog niet (eerste sessie ooit, SessionStart komt eerder): zelf beslissen.
  # Oude minify telt als aanwezig als hij geinstalleerd is en niet op `false` staat in settings.json.
  # Ook de door claude.ai gesynchroniseerde kopie (map minify of minify~* onder plugins/synced/<account>/,
  # niet in installed_plugins.json) telt, tenzij "minify@synced" op `false` staat.
  settings=$(tr '\n' ' ' < "$HOME/.claude/settings.json" 2>/dev/null)
  uit() { printf '%s' "$settings" | grep -Eq "$1[[:space:]]*:[[:space:]]*false"; }
  oudnaam='"minify@futureflowai-mods"'
  if grep -q "$oudnaam" "$HOME/.claude/plugins/installed_plugins.json" 2>/dev/null && ! uit "$oudnaam"; then
    exit 0
  fi
  for kopie in "$HOME"/.claude/plugins/synced/*/minify "$HOME"/.claude/plugins/synced/*/minify~*; do
    if [ -e "$kopie" ] && ! uit '"minify@synced"'; then
      exit 0
    fi
  done
fi

# session_id uit de JSON op stdin; alleen veilige tekens, het wordt een bestandsnaam.
sessie=$(printf '%s' "$invoer" | tr '\n' ' ' | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([A-Za-z0-9_-]*\)".*/\1/p')

niveau=""
[ -n "$sessie" ] && [ -f "$dir/niveau/$sessie" ] && niveau=$(cat "$dir/niveau/$sessie")
[ -z "$niveau" ] && [ -f "$dir/standaard" ] && niveau=$(cat "$dir/standaard")
[ -z "$niveau" ] && niveau=O2
case "$niveau" in
  O1 | O2 | O3) ;;
  *) exit 0 ;;
esac

regels="$dir/regels/$niveau.md"
# Zonder regelbestanden (de mod draaide nog nooit) zeggen we niets.
[ -f "$regels" ] || exit 0

# Onthoudt welk niveau deze sessie het laatst volledig kreeg.
gemeld() {
  [ -n "$sessie" ] || return 0
  mkdir -p "$dir/gemeld" && printf '%s' "$niveau" > "$dir/gemeld/$sessie"
}

case "$soort" in
  start)
    cat "$regels"
    gemeld
    ;;
  prompt)
    vorig=""
    [ -n "$sessie" ] && [ -f "$dir/gemeld/$sessie" ] && vorig=$(cat "$dir/gemeld/$sessie")
    if [ "$vorig" != "$niveau" ]; then
      cat "$regels"
      gemeld
    else
      cat "$dir/regels/$niveau.kort.md"
    fi
    ;;
  subagent)
    # SubagentStart neemt alleen context aan als JSON; de tekst wordt hier ge-escaped.
    tekst=$(awk '{ gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); gsub(/\t/, "\\t"); printf "%s\\n", $0 }' "$dir/regels/$niveau.subagent.md")
    printf '{"hookSpecificOutput":{"hookEventName":"SubagentStart","additionalContext":"%s"}}\n' "$tekst"
    ;;
esac
exit 0
