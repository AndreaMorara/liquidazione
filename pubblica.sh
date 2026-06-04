#!/bin/bash
set -e

git add .
git commit -m "aggiornamento $(date '+%Y-%m-%d %H:%M')"
git push
echo "✓ Sito aggiornato. Visibile in 1-2 minuti."
