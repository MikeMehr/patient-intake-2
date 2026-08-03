#!/usr/bin/env bash
#
# set-blob-cors.sh — Set the blob CORS allowlist on the documents storage account
#
# Why this exists:
#   The "Send files" flow on /org/documents uploads browser→Azure directly via a write-SAS,
#   so the storage account must allow PUT from the app's exact origin. That rule is
#   account-wide config, outside anything this repo deploys. In Aug 2026 the dashboard moved
#   from mymd.health-assist.org to physician.health-assist.org and the rule was never
#   updated — every upload then failed on a CORS preflight 403.
#
#   src/lib/azure-blob-documents.ts (ensureDocumentsCors) now keeps this in sync
#   automatically from NEXT_PUBLIC_APP_URL. This script is the out-of-band equivalent:
#     - fix production without waiting for a deploy
#     - prune stale origins (the runtime guard only ever widens, never removes)
#     - repair when the app's credential cannot write service properties
#
# Prerequisites:
#   1. Azure CLI installed and logged in (az login)
#   2. Your identity can list the storage account keys (az resolves them automatically;
#      `az storage cors` does NOT support --auth-mode login)
#
# Usage:
#   ./scripts/set-blob-cors.sh <ACCOUNT_NAME> [--apply] [--include-localhost]
#
# Defaults to a dry run: prints the current rules and what would be written. Nothing is
# changed without --apply.

set -eo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
ORIGINS=(
  "https://physician.health-assist.org"
  "https://healt-assist-ai-prod-f0bce3hwfhdrbvgr.canadacentral-01.azurewebsites.net"
)
# NOT included: https://mymd.health-assist.org — src/proxy.ts 301-redirects every path on
# that host before any JS runs, so it can never originate a browser upload. A rule for it is
# dead config, and a stale one is exactly what caused the outage this script exists to fix.

# PUT is what the preflight asks for. GET/HEAD cost nothing. DELETE and POST are deliberately
# absent: nothing in the flow needs them, and DELETE from a browser holding a leaked SAS is
# destructive.
METHODS=(GET HEAD PUT OPTIONS)
MAX_AGE=3600

# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------
ACCOUNT_NAME="$1"
shift || true

if [[ -z "$ACCOUNT_NAME" || "$ACCOUNT_NAME" == -* ]]; then
  echo "Usage: $0 <ACCOUNT_NAME> [--apply] [--include-localhost]"
  echo "Example: $0 healthassistaistorage --apply"
  exit 1
fi

APPLY=false
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=true ;;
    --include-localhost)
      ORIGINS+=("http://localhost:3000")
      echo "WARNING: adding http://localhost:3000 to a production storage account's CORS"
      echo "         allowlist. Re-run without this flag once you are done testing."
      echo ""
      ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Show current state
# ---------------------------------------------------------------------------
echo "=== Blob CORS: $ACCOUNT_NAME ==="
echo ""
echo "--- Current rules ---"
az storage cors list --services b --account-name "$ACCOUNT_NAME" -o table || true

echo ""
echo "--- Desired ---"
printf '  origin:  %s\n' "${ORIGINS[@]}"
echo "  methods: ${METHODS[*]}"
echo "  allowed-headers: *   exposed-headers: *   max-age: $MAX_AGE"
echo ""
echo "  allowed-headers is '*' because the SAS is the credential — the header list is not a"
echo "  security boundary, and '*' stops a future x-ms-* header silently breaking preflight."
echo "  exposed-headers is '*' so the client can read x-ms-request-id off a failed PUT."

if [[ "$APPLY" != true ]]; then
  echo ""
  echo "Dry run. Re-run with --apply to write."
  exit 0
fi

# ---------------------------------------------------------------------------
# Apply
# ---------------------------------------------------------------------------
echo ""
echo "'clear' removes ALL blob CORS rules on this account. Review the current rules above."
read -r -p "Replace them with the desired set? [y/N] " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  echo "Aborted. Nothing changed."
  exit 1
fi

# --services b on BOTH commands: 'bfqt' would clear file/queue/table CORS too.
az storage cors clear --services b --account-name "$ACCOUNT_NAME"
az storage cors add --services b \
  --account-name "$ACCOUNT_NAME" \
  --methods "${METHODS[@]}" \
  --origins "${ORIGINS[@]}" \
  --allowed-headers '*' \
  --exposed-headers '*' \
  --max-age "$MAX_AGE"

echo ""
echo "--- New rules ---"
az storage cors list --services b --account-name "$ACCOUNT_NAME" -o table

# ---------------------------------------------------------------------------
# Verify
# ---------------------------------------------------------------------------
# The preflight is unauthenticated, so this reproduces the exact browser request without a
# SAS, a login, or a file. Failed preflights are never cached, so a fix takes effect at once.
echo ""
echo "=== Verifying preflight (expect 200 + Access-Control-Allow-Origin) ==="
curl -si -X OPTIONS \
  -H "Origin: ${ORIGINS[0]}" \
  -H "Access-Control-Request-Method: PUT" \
  -H "Access-Control-Request-Headers: content-type,x-ms-blob-type" \
  "https://${ACCOUNT_NAME}.blob.core.windows.net/patient-documents/preflight-probe" \
  | grep -iE "^HTTP|^access-control" || echo "  (no CORS headers returned — check the rules above)"

echo ""
echo "=== Negative control (must stay 403) ==="
curl -so /dev/null -w '  evil.example -> %{http_code}\n' -X OPTIONS \
  -H "Origin: https://evil.example" \
  -H "Access-Control-Request-Method: PUT" \
  "https://${ACCOUNT_NAME}.blob.core.windows.net/patient-documents/preflight-probe"

echo ""
echo "Done. Now send a small file from /org/documents to confirm end to end."
