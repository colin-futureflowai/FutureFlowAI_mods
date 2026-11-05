#!/bin/sh
# Geeft de regels van minify mee aan Claude Code, als command hook (zoals caveman doet).
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
