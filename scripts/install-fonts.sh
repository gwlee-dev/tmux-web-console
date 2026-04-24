#!/usr/bin/env bash
# install-fonts.sh -- Register Pretendard + Monoplex KR Nerd as system fonts
# Used by the Dockerfile and the GitHub Actions CI workflow so that the
# chromium-linux visual regression goldens render with the same fonts as the
# darwin goldens.
#
# Strategy:
#   1. Copy the vendored PretendardVariable.woff2 from public/fonts/pretendard/
#      into /usr/local/share/fonts/pretendard/.
#   2. Copy Monoplex KR Nerd woff files from public/fonts/monoplex-kr-nerd/ so
#      that fontconfig recognizes the xterm fallback font at the OS level.
#   3. Run fc-cache -f -v.
#   4. Verify Pretendard is listed via `fc-list | grep -i pretendard`. If the
#      installed fontconfig does not register woff2, download the official
#      Pretendard TTF bundle from GitHub releases and retry.
#
# Environment overrides (mostly for local debugging):
#   PRETENDARD_SRC_DIR      -- source of the vendored Pretendard woff2
#                              (default: /app/public/fonts/pretendard)
#   MONOPLEX_SRC_DIR        -- source of Monoplex KR Nerd fonts
#                              (default: /app/public/fonts/monoplex-kr-nerd)
#   PRETENDARD_TTF_URL      -- fallback TTF archive URL
#   FONT_DIR / MONOPLEX_DIR -- destination system font directories

set -euo pipefail

FONT_DIR="${FONT_DIR:-/usr/local/share/fonts/pretendard}"
MONOPLEX_DIR="${MONOPLEX_DIR:-/usr/local/share/fonts/monoplex-kr-nerd}"
PRETENDARD_SRC_DIR="${PRETENDARD_SRC_DIR:-/app/public/fonts/pretendard}"
MONOPLEX_SRC_DIR="${MONOPLEX_SRC_DIR:-/app/public/fonts/monoplex-kr-nerd}"
PRETENDARD_TTF_URL="${PRETENDARD_TTF_URL:-https://github.com/orioncactus/pretendard/releases/download/v1.3.9/Pretendard-1.3.9.zip}"

log() { echo "[install-fonts] $*"; }

mkdir -p "$FONT_DIR" "$MONOPLEX_DIR"

# --- Step 1: Pretendard from vendored public/fonts/pretendard ---
copied=0
if [ -d "$PRETENDARD_SRC_DIR" ]; then
  log "Copying vendored Pretendard assets from $PRETENDARD_SRC_DIR"
  shopt -s nullglob
  for ext in ttf otf woff2 woff; do
    for file in "$PRETENDARD_SRC_DIR"/*."$ext"; do
      cp "$file" "$FONT_DIR/"
      copied=$((copied + 1))
    done
  done
  shopt -u nullglob
  log "Copied $copied Pretendard file(s) from vendored sources"
else
  log "WARN: vendored Pretendard dir not found: $PRETENDARD_SRC_DIR"
fi

# --- Step 2: Monoplex KR Nerd ---
if [ -d "$MONOPLEX_SRC_DIR" ]; then
  log "Copying Monoplex KR Nerd assets from $MONOPLEX_SRC_DIR"
  shopt -s nullglob
  for file in "$MONOPLEX_SRC_DIR"/*.ttf "$MONOPLEX_SRC_DIR"/*.otf "$MONOPLEX_SRC_DIR"/*.woff2 "$MONOPLEX_SRC_DIR"/*.woff; do
    cp "$file" "$MONOPLEX_DIR/"
  done
  shopt -u nullglob
else
  log "WARN: monoplex source dir not found: $MONOPLEX_SRC_DIR"
fi

# --- Step 3: fc-cache ---
log "Running fc-cache -f -v"
fc-cache -f -v >/dev/null 2>&1 || fc-cache -f -v

# --- Step 4: Verify Pretendard registration ---
if fc-list | grep -qi pretendard; then
  log "SUCCESS: Pretendard registered via fontconfig"
  fc-list | grep -i pretendard | head -5 | sed 's/^/[install-fonts]   /'
else
  log "WARN: Pretendard not registered by fontconfig -- attempting TTF fallback from $PRETENDARD_TTF_URL"

  if ! command -v curl >/dev/null 2>&1; then
    log "ERROR: curl is required for the TTF fallback"
    exit 1
  fi
  if ! command -v unzip >/dev/null 2>&1; then
    log "ERROR: unzip is required for the TTF fallback"
    exit 1
  fi

  tmp_zip="$(mktemp -t pretendard-XXXXXX.zip)"
  tmp_dir="$(mktemp -d -t pretendard-XXXXXX)"
  trap 'rm -rf "$tmp_zip" "$tmp_dir"' EXIT

  log "Downloading Pretendard TTF archive"
  curl -fsSL --retry 3 -o "$tmp_zip" "$PRETENDARD_TTF_URL"

  log "Extracting TTF archive"
  unzip -q -o "$tmp_zip" -d "$tmp_dir"

  found_ttf=$(find "$tmp_dir" -type f -name '*.ttf' | wc -l | tr -d ' ')
  if [ "$found_ttf" -eq 0 ]; then
    log "ERROR: no ttf files found in downloaded archive"
    exit 1
  fi
  find "$tmp_dir" -type f -name '*.ttf' -exec cp {} "$FONT_DIR/" \;
  log "Installed $found_ttf ttf file(s) from fallback archive"

  fc-cache -f -v >/dev/null 2>&1 || fc-cache -f -v

  if fc-list | grep -qi pretendard; then
    log "SUCCESS: Pretendard registered via TTF fallback"
    fc-list | grep -i pretendard | head -5 | sed 's/^/[install-fonts]   /'
  else
    log "ERROR: Pretendard still not registered after TTF fallback"
    exit 1
  fi
fi

log "Done. Font directories:"
log "  $FONT_DIR"
log "  $MONOPLEX_DIR"
