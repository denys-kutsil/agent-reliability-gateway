#!/usr/bin/env bash
# Checks the deployed mock providers: a SigV4-signed request creates and finds an event,
# an unsigned request is rejected with 403. Needs AWS_PROFILE (never root) and a deployed ArgStack.
set -euo pipefail

: "${AWS_PROFILE:?Set AWS_PROFILE, e.g. AWS_PROFILE=my-project}"
region="${AWS_REGION:-us-east-1}"

url="$(aws cloudformation describe-stacks --stack-name ArgStack --region "$region" \
  --query "Stacks[0].Outputs[?contains(OutputKey,'MockProvidersUrl')].OutputValue | [0]" --output text)"
url="${url%/}"
[ -n "$url" ] && [ "$url" != "None" ] || { echo "ArgStack output not found. Run: pnpm deploy:aws" >&2; exit 1; }

creds="$(aws configure export-credentials --format process)"
field() { node -e 'const c=JSON.parse(process.argv[1]);console.log(c[process.argv[2]]??"")' "$creds" "$1"; }
key="$(field AccessKeyId)"; secret="$(field SecretAccessKey)"; token="$(field SessionToken)"

signed() {
  curl -sS --aws-sigv4 "aws:amz:$region:lambda" --user "$key:$secret" \
    ${token:+-H "x-amz-security-token: $token"} "$@"
}

ref="smoke-$(date +%s)"
echo "1. unsigned request (expect 403):"
curl -sS -o /dev/null -w "   HTTP %{http_code}\n" "$url/calendar/events?clientRef=$ref"

echo "2. signed create (expect 201):"
signed -o /dev/null -w "   HTTP %{http_code}\n" -X POST "$url/calendar/events" \
  -H 'content-type: application/json' \
  -d "{\"title\":\"Smoke\",\"start\":\"2026-03-01T10:00:00Z\",\"end\":\"2026-03-01T10:15:00Z\",\"clientRef\":\"$ref\"}"

echo "3. signed find by clientRef (expect the event):"
signed "$url/calendar/events?clientRef=$ref"
echo
