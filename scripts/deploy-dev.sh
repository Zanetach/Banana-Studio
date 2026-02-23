#!/usr/bin/env bash
set -euo pipefail

VAULT_PATH="${1:-${OBSIDIAN_VAULT_PATH:-}}"
PLUGIN_ID="banana-studio"

if [[ -z "${VAULT_PATH}" ]]; then
  echo "Usage: $0 <vault-path>"
  echo "Or set env: OBSIDIAN_VAULT_PATH=/path/to/vault"
  exit 1
fi

if [[ ! -d "${VAULT_PATH}" ]]; then
  echo "Vault path not found: ${VAULT_PATH}"
  exit 1
fi

TARGET_DIR="${VAULT_PATH}/.obsidian/plugins/${PLUGIN_ID}"
mkdir -p "${TARGET_DIR}"

echo "[1/3] Building plugin..."
npm run build

echo "[2/3] Syncing files to: ${TARGET_DIR}"
cp main.js manifest.json styles.css "${TARGET_DIR}/"

echo "[3/3] Done"
echo "Reload plugin in Obsidian: Developer -> Reload plugins"
echo "Installed files:"
ls -lh "${TARGET_DIR}/main.js" "${TARGET_DIR}/manifest.json" "${TARGET_DIR}/styles.css"
