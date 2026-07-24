#!/usr/bin/env bash
set -euo pipefail

TOKEN="${1:-}"

if [[ -z "$TOKEN" ]]; then
  echo "Usage: bash test-rb2b-webhook.sh YOUR_RB2B_WEBHOOK_TOKEN"
  exit 1
fi

curl --fail-with-body \
  --request POST \
  "http://localhost:3000/api/webhooks/rb2b?token=${TOKEN}" \
  --header "Content-Type: application/json" \
  --data '{
    "LinkedIn URL": "https://www.linkedin.com/in/rb2b-test-visitor/",
    "First Name": "RB2B",
    "Last Name": "Test Visitor",
    "Title": "Webhook Test",
    "Company Name": "RB2B Test Company",
    "Business Email": "rb2b-test@example.com",
    "Website": "https://example.com",
    "Industry": "Software",
    "Employee Count": "11-50",
    "Estimate Revenue": "$5M",
    "City": "London",
    "State": "England",
    "Zipcode": "SW1A 1AA",
    "Seen At": "2026-07-24T17:30:00.000Z",
    "Referrer": "https://www.google.com",
    "Captured URL": "https://yourcompany.com/pricing",
    "Tags": "Hot Page, Test",
    "is_repeat_visit": false
  }'

echo
