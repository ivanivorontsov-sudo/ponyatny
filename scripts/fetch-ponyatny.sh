#!/usr/bin/env bash
# Скачивает сборку «Понятный» 2.5.0 из GitHub Releases и сверяет SHA256.
# Использование: из корня репозитория или с указанием каталога назначения.
set -euo pipefail
DEST="${1:-bin}"
REPO="${PONYATNY_REPO:-ivanivorontsov-sudo/ponyatny}"
TAG="${PONYATNY_TAG:-v2.5.0}"
mkdir -p "$DEST"
cd "$DEST"
gh release download "$TAG" -R "$REPO" --clobber -p 'ponyatny*' -p SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt
chmod +x ponyatny-linux 2>/dev/null || true
