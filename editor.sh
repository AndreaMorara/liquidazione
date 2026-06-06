#!/bin/bash
ROOT="$(cd "$(dirname "$0")" && pwd)"

# Avvia il server in background e aspetta che sia pronto
node "$ROOT/editor-server.js" &
SERVER_PID=$!

# Aspetta che la porta 3333 risponda
for i in $(seq 1 20); do
  sleep 0.2
  curl -s http://localhost:3333 > /dev/null 2>&1 && break
done

# Apri il browser
if command -v open &>/dev/null; then
  open http://localhost:3333          # macOS
elif command -v xdg-open &>/dev/null; then
  xdg-open http://localhost:3333      # Linux
fi

echo "Editor avviato su http://localhost:3333 — premi Ctrl+C per fermare."

# Alla pressione di Ctrl+C, termina il server
trap "kill $SERVER_PID 2>/dev/null; echo ''; echo 'Editor chiuso.'" EXIT INT TERM
wait $SERVER_PID
