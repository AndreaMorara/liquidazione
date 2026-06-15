#!/bin/bash
ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT=3333

# Avvia il server
node "$ROOT/editor-server.js" &
SERVER_PID=$!

# Chiusura pulita con Ctrl+C
trap "kill $SERVER_PID 2>/dev/null; echo ''; echo 'Editor chiuso.'; exit 0" INT TERM

# Aspetta che la porta risponda, poi apri il browser
for i in $(seq 1 25); do
  sleep 0.2
  if curl -s "http://localhost:$PORT" >/dev/null 2>&1; then
    if command -v open >/dev/null 2>&1; then open "http://localhost:$PORT"        # macOS
    elif command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:$PORT"  # Linux
    fi
    break
  fi
done

wait $SERVER_PID
