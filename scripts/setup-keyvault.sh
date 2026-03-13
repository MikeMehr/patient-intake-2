#!/usr/bin/env bash
#
# setup-keyvault.sh — Migrate App Service secrets to Azure Key Vault references
#
# Prerequisites:
#   1. Azure CLI installed and logged in (az login)
#   2. Key Vault "health-assist-ai-prod-kv" already exists
#   3. App Service managed identity enabled and granted Key Vault Secrets User role
#
# Usage:
#   ./scripts/setup-keyvault.sh <RESOURCE_GROUP>
#
# After running:
#   - Verify in Azure Portal: App Service > Configuration > green checkmarks
#   - Restart the app: az webapp restart --name healt-assist-ai-prod --resource-group <RG>
#   - Rotate all credentials at their source and update Key Vault values

set -eo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
APP_NAME="healt-assist-ai-prod"
VAULT_NAME="health-assist-ai-prod-kv"

# Pairs: "APP_SETTING_NAME:kv-secret-name"
SECRETS=(
  "AZURE_OPENAI_API_KEY:openai-api-key"
  "AZURE_PHI_API_KEY:phi-api-key"
  "AZURE_SPEECH_KEY:speech-key"
  "AZURE_DOCUMENT_INTELLIGENCE_API_KEY:document-intelligence-api-key"
  "DATABASE_URL:database-url"
  "RESEND_API_KEY:resend-api-key"
  "SRFAX_ACCESS_ID:srfax-access-id"
  "SRFAX_ACCESS_PASSWORD:srfax-access-password"
  "GOOGLE_CLIENT_SECRET:google-client-secret"
  "SESSION_SECRET:session-secret"
  "INVITATION_SESSION_SECRET:invitation-session-secret"
  "NEXTAUTH_SECRET:nextauth-secret"
  "AUTH_MFA_SECRET:auth-mfa-secret"
  "CRON_SECRET:cron-secret"
  "PATIENT_PHI_ENCRYPTION_KEY:patient-phi-encryption-key"
  "PATIENT_HIN_HASH_PEPPER:patient-hin-hash-pepper"
  "EMR_ENCRYPTION_KEY:emr-encryption-key"
  "APPLICATIONINSIGHTS_CONNECTION_STRING:appinsights-connection-string"
)

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------
if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <RESOURCE_GROUP>"
  echo ""
  echo "Example: $0 rg-health-assist-prod"
  exit 1
fi

RESOURCE_GROUP="$1"

echo "=== Azure Key Vault Migration ==="
echo "App Service:    $APP_NAME"
echo "Key Vault:      $VAULT_NAME"
echo "Resource Group: $RESOURCE_GROUP"
echo "Secrets to migrate: ${#SECRETS[@]}"
echo ""

# ---------------------------------------------------------------------------
# Step 1: Fetch current App Service settings
# ---------------------------------------------------------------------------
echo "--- Step 1: Fetching current App Service settings ---"
CURRENT_SETTINGS=$(az webapp config appsettings list \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --output json)

get_setting_value() {
  local key="$1"
  echo "$CURRENT_SETTINGS" | python3 -c "
import json, sys
settings = json.load(sys.stdin)
for s in settings:
    if s['name'] == '$key':
        print(s['value'])
        sys.exit(0)
sys.exit(1)
" 2>/dev/null
}

# ---------------------------------------------------------------------------
# Step 2: Store secrets in Key Vault
# ---------------------------------------------------------------------------
echo ""
echo "--- Step 2: Storing secrets in Key Vault ---"

FAILED=()
SKIPPED=()
STORED_PAIRS=()

for PAIR in "${SECRETS[@]}"; do
  APP_SETTING="${PAIR%%:*}"
  KV_SECRET="${PAIR##*:}"

  VALUE=$(get_setting_value "$APP_SETTING") || true

  if [[ -z "$VALUE" ]]; then
    echo "  SKIP: $APP_SETTING (not set in App Service)"
    SKIPPED+=("$APP_SETTING")
    continue
  fi

  if [[ "$VALUE" == @Microsoft.KeyVault* ]]; then
    echo "  SKIP: $APP_SETTING (already a Key Vault reference)"
    SKIPPED+=("$APP_SETTING")
    continue
  fi

  echo "  Storing: $APP_SETTING -> $KV_SECRET"
  if az keyvault secret set \
    --vault-name "$VAULT_NAME" \
    --name "$KV_SECRET" \
    --value "$VALUE" \
    --output none 2>/dev/null; then
    STORED_PAIRS+=("$PAIR")
  else
    echo "  ERROR: Failed to store $KV_SECRET"
    FAILED+=("$APP_SETTING")
  fi
done

echo ""
echo "Stored: ${#STORED_PAIRS[@]}, Skipped: ${#SKIPPED[@]}, Failed: ${#FAILED[@]}"

if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "FAILED secrets: ${FAILED[*]}"
  echo "Fix errors above before continuing."
  exit 1
fi

# ---------------------------------------------------------------------------
# Step 3: Update App Service settings to Key Vault References
# ---------------------------------------------------------------------------
echo ""
echo "--- Step 3: Updating App Service settings to Key Vault References ---"

SETTINGS_ARGS=()
for PAIR in "${STORED_PAIRS[@]}"; do
  APP_SETTING="${PAIR%%:*}"
  KV_SECRET="${PAIR##*:}"
  REF="@Microsoft.KeyVault(SecretUri=https://${VAULT_NAME}.vault.azure.net/secrets/${KV_SECRET}/)"
  SETTINGS_ARGS+=("${APP_SETTING}=${REF}")
done

if [[ ${#SETTINGS_ARGS[@]} -gt 0 ]]; then
  echo "  Updating ${#SETTINGS_ARGS[@]} settings..."
  az webapp config appsettings set \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --settings "${SETTINGS_ARGS[@]}" \
    --output none
  echo "  Done."
else
  echo "  No settings to update."
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "=== Migration Complete ==="
echo ""
echo "Next steps:"
echo "  1. Verify in Azure Portal: App Service > Configuration"
echo "     Each migrated setting should show a green checkmark"
echo "  2. Restart the app:"
echo "     az webapp restart --name $APP_NAME --resource-group $RESOURCE_GROUP"
echo "  3. Test the application (login, patient intake, AI analysis)"
echo "  4. Rotate all credentials at their source, then update Key Vault:"
echo "     az keyvault secret set --vault-name $VAULT_NAME --name <secret> --value <new-value>"
echo ""
echo "Migrated secrets:"
for PAIR in "${STORED_PAIRS[@]}"; do
  APP_SETTING="${PAIR%%:*}"
  KV_SECRET="${PAIR##*:}"
  echo "  - $APP_SETTING -> $KV_SECRET"
done
if [[ ${#SKIPPED[@]} -gt 0 ]]; then
  echo ""
  echo "Skipped (not set or already migrated):"
  for s in "${SKIPPED[@]}"; do
    echo "  - $s"
  done
fi
