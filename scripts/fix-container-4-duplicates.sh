#!/usr/bin/env bash
# One-time cleanup for Container 4 (barcode 699865138112b2ead7034081) duplicate activeItems.
# Requires ACCESS_TOKEN env var (Bearer token from logged-in supervisor session).
#
# Option A — clear staged items entirely:
#   ACCESS_TOKEN='...' ./scripts/fix-container-4-duplicates.sh clear
#
# Option B — keep single deduped row (adjust ARTICLE_ID and QTY as needed):
#   ACCESS_TOKEN='...' ARTICLE_ID='6a2f8734e232672116a44652' QTY=30 ./scripts/fix-container-4-duplicates.sh dedupe

set -euo pipefail

BARCODE="${BARCODE:-699865138112b2ead7034081}"
API_BASE="${API_BASE:-http://localhost:8000/v1}"
MODE="${1:-clear}"

if [[ -z "${ACCESS_TOKEN:-}" ]]; then
  echo "Set ACCESS_TOKEN to a valid Bearer token" >&2
  exit 1
fi

auth_header=(-H "Authorization: Bearer ${ACCESS_TOKEN}" -H "Content-Type: application/json")

case "$MODE" in
  clear)
    curl -sS -X PATCH "${API_BASE}/containers-masters/barcode/${BARCODE}/clear-active" "${auth_header[@]}"
    echo ""
    echo "Cleared active items on container ${BARCODE}"
    ;;
  dedupe)
    ARTICLE_ID="${ARTICLE_ID:?Set ARTICLE_ID}"
    QTY="${QTY:-30}"
    curl -sS -X PATCH "${API_BASE}/containers-masters/barcode/${BARCODE}" "${auth_header[@]}" \
      -d "{\"activeFloor\":\"Dispatch\",\"activeItems\":[{\"article\":\"${ARTICLE_ID}\",\"quantity\":${QTY}}]}"
    echo ""
    echo "Set container ${BARCODE} to single article row qty=${QTY}"
    ;;
  *)
    echo "Usage: $0 clear|dedupe" >&2
    exit 1
    ;;
esac
