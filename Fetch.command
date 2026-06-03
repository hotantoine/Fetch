#!/bin/zsh
cd "$(dirname "$0")"

PORT="${PORT:-4273}"
URL="http://127.0.0.1:${PORT}/"
NODE="/Applications/Codex.app/Contents/Resources/node"

if [[ ! -x "$NODE" ]]; then
  NODE="$(command -v node)"
fi

if [[ -z "$NODE" || ! -x "$NODE" ]]; then
  osascript -e 'display dialog "Node.js was not found." buttons {"OK"} default button "OK"'
  exit 1
fi

if lsof -n -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  open -a Safari "$URL" 2>/dev/null || open "$URL"
  exit 0
fi

printf "\nIG Fetch is starting...\n"
printf "Keep this Terminal window open while you use it.\n"
printf "%s\n\n" "$URL"

(
  for _ in {1..25}; do
    /usr/bin/curl --silent --fail --max-time 1 "$URL" >/dev/null 2>&1 && break
    sleep 0.2
  done
  open -a Safari "$URL" 2>/dev/null || open "$URL"
) &

PORT="$PORT" "$NODE" server.js

printf "\nIG Fetch stopped. Close this window or double-click Open IG Fetch.command again.\n"
read -r
