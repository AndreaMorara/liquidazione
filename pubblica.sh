#!/bin/bash
set -e

# ── Aggiorna articoli/index.json automaticamente ──────────────────────────────
ARTICOLI_DIR="$(dirname "$0")/articoli"

# Legge le sottocartelle di articoli/, esclude index.json e file non-cartelle
nomi=()
while IFS= read -r -d '' dir; do
  nomi+=("\"$(basename "$dir")\"")
done < <(find "$ARTICOLI_DIR" -mindepth 1 -maxdepth 1 -type d -print0 | sort -z)

# Costruisce il JSON: ["bancone","scanner","sedie"]
json="[$(IFS=,; echo "${nomi[*]}")]"
echo "$json" > "$ARTICOLI_DIR/index.json"
echo "✓ index.json aggiornato: $json"

# ── Genera foto.txt per ogni cartella articolo ────────────────────────────────
while IFS= read -r -d '' dir; do
  foto=()
  while IFS= read -r -d '' f; do
    nome="$(basename "$f")"
    [[ "$nome" == "cover.jpg" ]] && continue
    foto+=("$nome")
  done < <(find "$dir" -maxdepth 1 -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" \) -print0 | sort -z)

  printf "%s\n" "${foto[@]}" > "$dir/foto.txt"
  echo "✓ foto.txt aggiornato: $(basename "$dir")/ — ${#foto[@]} foto"
done < <(find "$ARTICOLI_DIR" -mindepth 1 -maxdepth 1 -type d -print0 | sort -z)

# ── Git ───────────────────────────────────────────────────────────────────────
git -C "$(dirname "$0")" add .
git -C "$(dirname "$0")" commit -m "aggiornamento $(date '+%Y-%m-%d %H:%M')"
git -C "$(dirname "$0")" push
echo "✓ Sito aggiornato. Visibile in 1-2 minuti."
