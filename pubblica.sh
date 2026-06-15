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

# ── Aggiorna foto.txt per ogni cartella articolo ──────────────────────────────
# Preserva l'ordine già presente in foto.txt (impostato dall'editor con drag&drop),
# rimuove i file non più esistenti e aggiunge in coda le foto nuove.
while IFS= read -r -d '' dir; do
  # foto presenti su disco (escluso cover.jpg)
  presenti=()
  while IFS= read -r -d '' f; do
    nome="$(basename "$f")"
    [[ "$nome" == "cover.jpg" ]] && continue
    presenti+=("$nome")
  done < <(find "$dir" -maxdepth 1 -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" \) -print0 | sort -z)

  ordinate=()
  # 1) mantieni l'ordine esistente, solo per file ancora presenti
  if [[ -f "$dir/foto.txt" ]]; then
    while IFS= read -r riga; do
      riga="$(echo "$riga" | tr -d '\r' | xargs)"
      [[ -z "$riga" ]] && continue
      for p in "${presenti[@]}"; do
        if [[ "$p" == "$riga" ]]; then ordinate+=("$riga"); break; fi
      done
    done < "$dir/foto.txt"
  fi
  # 2) aggiungi in coda le foto nuove non ancora elencate
  for p in "${presenti[@]}"; do
    found=0
    for o in "${ordinate[@]}"; do [[ "$o" == "$p" ]] && { found=1; break; }; done
    [[ $found -eq 0 ]] && ordinate+=("$p")
  done

  : > "$dir/foto.txt"
  [[ ${#ordinate[@]} -gt 0 ]] && printf "%s\n" "${ordinate[@]}" > "$dir/foto.txt"
  echo "✓ foto.txt aggiornato: $(basename "$dir")/ — ${#ordinate[@]} foto"
done < <(find "$ARTICOLI_DIR" -mindepth 1 -maxdepth 1 -type d -print0 | sort -z)

# ── Git ───────────────────────────────────────────────────────────────────────
REPO="$(dirname "$0")"
git -C "$REPO" add .

if git -C "$REPO" diff --cached --quiet; then
  echo "— Nessuna modifica da committare, procedo con il push."
else
  git -C "$REPO" commit -m "aggiornamento $(date '+%Y-%m-%d %H:%M')"
fi

git -C "$REPO" push
echo "✓ Sito aggiornato. Visibile in 1-2 minuti."
