#!/usr/bin/env bash
# Smoke test of the self-hosting stack (compose.yaml): start it, wait for health, sign up,
# create a scan token, upload one scan with briff-scan, check the repo landed. Prints
# PASS/FAIL per step; exits 1 on the first failure. Needs docker (compose v2), curl,
# base64, od and sha256sum (or shasum); briff-scan runs through npx, or in a node:22-alpine
# container when Node is not installed.
#
# It runs its own compose project with its own database volume and env file in a temp
# directory, so it never touches an existing Briff stack on the same host. Plain http on
# 127.0.0.1; no domain, SMTP, LLM key or GitHub App needed.
#
#   scripts/smoke.sh                                   # ghcr.io/metelabs/briff:latest
#   BRIFF_IMAGE=briff-local BRIFF_VERSION=latest scripts/smoke.sh   # a locally built image
#
# Environment:
#   BRIFF_IMAGE, BRIFF_VERSION   image under test (default ghcr.io/metelabs/briff, latest)
#   SMOKE_COMPOSE_FILE           compose file (default: compose.yaml next to this repo's root)
#   SMOKE_ENV_EXAMPLE            env template (default: .env.selfhost.example next to the compose file)
#   SMOKE_PROJECT                compose project name (default briff-smoke)
#   SMOKE_PORT                   host port for web (default 3999)
#   SMOKE_KEEP=1                 leave the stack running (default: docker compose down -v)
#   BRIFF_SCAN                   scanner command (default: npx --yes briff-scan@0)
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
compose_src=${SMOKE_COMPOSE_FILE:-$here/../compose.yaml}
env_example=${SMOKE_ENV_EXAMPLE:-$(dirname "$compose_src")/.env.selfhost.example}
project=${SMOKE_PROJECT:-briff-smoke}
port=${SMOKE_PORT:-3999}
base="http://127.0.0.1:$port"
image=${BRIFF_IMAGE:-ghcr.io/metelabs/briff}
version=${BRIFF_VERSION:-latest}

pass() { printf 'PASS  %s\n' "$1"; }
fail() {
  printf 'FAIL  %s\n' "$1"
  [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/      /'
  if [ -n "${workdir:-}" ] && [ -f "$workdir/compose.yaml" ]; then
    echo "----- last logs -----"
    dc logs --tail 40 2>&1 || true
  fi
  exit 1
}

for tool in docker curl base64 od; do
  command -v "$tool" > /dev/null || fail "prerequisites" "$tool not found"
done
if command -v sha256sum > /dev/null; then
  sha256() { sha256sum | cut -d' ' -f1; }
elif command -v shasum > /dev/null; then
  sha256() { shasum -a 256 | cut -d' ' -f1; }
else
  fail "prerequisites" "sha256sum or shasum not found"
fi
rand_hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
docker compose version > /dev/null 2>&1 || fail "prerequisites" "docker compose v2 not found"
[ -f "$compose_src" ] || fail "prerequisites" "no compose file at $compose_src"
[ -f "$env_example" ] || fail "prerequisites" "no env template at $env_example"
pass "prerequisites (docker, compose, curl)"

workdir=$(mktemp -d "${TMPDIR:-/tmp}/briff-smoke.XXXXXX")
dc() { docker compose --project-directory "$workdir" -f "$workdir/compose.yaml" -p "$project" "$@"; }
psql_q() { dc exec -T postgres psql -U briff -d briff -v ON_ERROR_STOP=1 -tAc "$1"; }
cleanup() {
  if [ "${SMOKE_KEEP:-}" = "1" ]; then
    echo "kept: docker compose --project-directory $workdir -p $project down -v"
  else
    dc down -v --remove-orphans > /dev/null 2>&1 || true
    rm -rf "$workdir"
  fi
}
trap cleanup EXIT

# The env file: the template with the required values filled in for this run.
set_env() {
  grep -v "^$1=" "$workdir/.env" > "$workdir/.env.next" || true
  printf '%s=%s\n' "$1" "$2" >> "$workdir/.env.next"
  mv "$workdir/.env.next" "$workdir/.env"
}
cp "$compose_src" "$workdir/compose.yaml"
cp "$env_example" "$workdir/.env"
set_env POSTGRES_PASSWORD "$(rand_hex 24)"
set_env BETTER_AUTH_SECRET "$(head -c 48 /dev/urandom | base64 | tr -d '\n')"
set_env BETTER_AUTH_URL "$base"
set_env BRIFF_IMAGE "$image"
set_env BRIFF_VERSION "$version"
set_env BRIFF_BIND 127.0.0.1
set_env BRIFF_WEB_PORT "$port"
set_env COMPOSE_PROJECT_NAME "$project"
chmod 600 "$workdir/.env"

out=$(dc config -q 2>&1) || fail "docker compose config" "$out"
pass "docker compose config"

out=$(dc up -d 2>&1) || fail "docker compose up -d ($image:$version)" "$out"
pass "docker compose up -d ($image:$version, project $project, port $port)"

health=""
for _ in $(seq 1 90); do
  health=$(curl -fsS "$base/api/health" 2>/dev/null || true)
  case "$health" in *'"ok":true'*) break ;; esac
  sleep 2
done
case "$health" in
  *'"ok":true'*) pass "GET /api/health ok (migrations applied)" ;;
  *) fail "GET /api/health ok within 180s" "${health:-no response}" ;;
esac

state=""
for _ in $(seq 1 60); do
  state=$(docker inspect -f '{{.State.Health.Status}}' "$(dc ps -q worker)" 2>/dev/null || true)
  [ "$state" = "healthy" ] && break
  sleep 3
done
if [ "$state" = "healthy" ]; then pass "worker healthy (heartbeat)"; else fail "worker healthy within 180s" "state: ${state:-missing}"; fi

email="smoke-$(rand_hex 4)@example.com"
password=$(rand_hex 16)
code=$(curl -sS -o "$workdir/signup.json" -w '%{http_code}' -X POST "$base/api/auth/sign-up/email" \
  -H 'content-type: application/json' -H "origin: $base" \
  --data "{\"name\":\"Smoke test\",\"email\":\"$email\",\"password\":\"$password\"}") || code=000
if [ "$code" = "200" ]; then
  pass "sign up $email (POST /api/auth/sign-up/email)"
else
  fail "sign up (POST /api/auth/sign-up/email)" "HTTP $code: $(cat "$workdir/signup.json" 2> /dev/null)"
fi

org=""
for _ in $(seq 1 10); do
  org=$(psql_q "SELECT m.\"orgId\" FROM org_member m JOIN \"user\" u ON u.id = m.\"userId\" WHERE u.email = '$email'" 2>/dev/null || true)
  [ -n "$org" ] && break
  sleep 1
done
if [ -n "$org" ]; then pass "org created for the first account"; else fail "org created for the first account"; fi

# Scan tokens are created by a Server Action (Settings -> Scan tokens), which has no stable
# HTTP route. Same shape as src/lib/scan/tokens.ts: brf_ + 40 url-safe chars, only the
# sha256 and the first 8 characters are stored.
secret="brf_$(head -c 30 /dev/urandom | base64 | tr '+/' '-_' | tr -d '\n=')"
hash=$(printf '%s' "$secret" | sha256)
token_id="smoke$(rand_hex 8)"
out=$(psql_q "INSERT INTO scan_token (id, \"orgId\", name, \"tokenHash\", prefix) VALUES ('$token_id', '$org', 'smoke', '$hash', '${secret:0:8}') RETURNING id" 2>&1) ||
  fail "scan token created" "$out"
pass "scan token created (${secret:0:8}..., stored as sha256 like Settings does)"

fixture="$workdir/fixture"
mkdir -p "$fixture"
cat > "$fixture/package.json" << 'JSON'
{ "name": "smoke-fixture", "version": "1.0.0", "dependencies": { "lodash": "4.17.20" }, "engines": { "node": ">=22" } }
JSON
cat > "$fixture/package-lock.json" << 'JSON'
{
  "name": "smoke-fixture",
  "version": "1.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": { "name": "smoke-fixture", "version": "1.0.0", "dependencies": { "lodash": "4.17.20" } },
    "node_modules/lodash": { "version": "4.17.20" }
  }
}
JSON
printf '22.12.0\n' > "$fixture/.nvmrc"

repo_name="smoke/fixture"
scan() {
  if [ -n "${BRIFF_SCAN:-}" ]; then
    # shellcheck disable=SC2086 # BRIFF_SCAN is a command line on purpose
    $BRIFF_SCAN "$@" --root "$fixture"
  elif command -v npx > /dev/null; then
    npx --yes briff-scan@0 "$@" --root "$fixture"
  else
    docker run --rm --network host -v "$fixture:/repo:ro" node:22-alpine \
      npx --yes briff-scan@0 "$@" --root /repo
  fi
}
out=$(scan --dry-run --repo-name "$repo_name" 2>&1) || fail "briff-scan --dry-run" "$out"
case "$out" in
  *"1 repos, 1 dependencies"*) pass "briff-scan --dry-run (1 repo, 1 dependency)" ;;
  *) fail "briff-scan --dry-run (1 repo, 1 dependency)" "$out" ;;
esac
out=$(BRIFF_TOKEN="$secret" scan --api "$base" --repo-name "$repo_name" 2>&1) || fail "briff-scan upload" "$out"
case "$out" in
  *"uploaded 1 repos"*) pass "briff-scan upload (POST /api/scan)" ;;
  *) fail "briff-scan upload (POST /api/scan)" "$out" ;;
esac

deps=$(psql_q "SELECT count(*) FROM dependency d JOIN repo r ON r.id = d.\"repoId\" WHERE r.\"orgId\" = '$org' AND r.name = '$repo_name'" 2>&1) || true
used=$(psql_q "SELECT \"lastUsedAt\" IS NOT NULL FROM scan_token WHERE id = '$token_id'" 2>&1) || true
if [ "$deps" = "1" ] && [ "$used" = "t" ]; then
  pass "repo $repo_name stored with 1 dependency; token last used set"
else
  fail "repo stored with 1 dependency and token marked used" "dependencies: $deps, token used: $used"
fi

health=$(curl -fsS "$base/api/health" 2>/dev/null || true)
case "$health" in
  *'"ok":true'*) pass "GET /api/health still ok after the scan" ;;
  *) fail "GET /api/health still ok after the scan" "${health:-no response}" ;;
esac

echo "smoke: all steps passed"
