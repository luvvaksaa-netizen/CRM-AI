#!/usr/bin/env bash
# ============================================================
# Smoke Test Script — v2-core Architecture Cleanup Verification
# ============================================================
# Tests: backend starts, frontend builds, health endpoint responds,
#        login API works, TypeScript compiles cleanly.
#
# Usage: bash tests/smoke.sh
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASS=0
FAIL=0
BACKEND_PORT=3002
BACKEND_URL="http://localhost:${BACKEND_PORT}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND_DIR="${SCRIPT_DIR}/backend"
FRONTEND_DIR="${SCRIPT_DIR}/frontend"
BACKEND_PID=""
SMOKE_DATA_DIR="$(mktemp -d 2>/dev/null || echo "${BACKEND_DIR}/tmp-smoke-data")"

cleanup() {
    if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
        echo -e "${YELLOW}[CLEANUP] Stopping backend (PID $BACKEND_PID)...${NC}"
        kill "$BACKEND_PID" 2>/dev/null || true
        wait "$BACKEND_PID" 2>/dev/null || true
    fi
    rm -rf "$SMOKE_DATA_DIR" 2>/dev/null || true
}
trap cleanup EXIT

log_pass()  { echo -e "${GREEN}[PASS]${NC} $1"; PASS=$((PASS + 1)); }
log_fail()  { echo -e "${RED}[FAIL]${NC} $1"; FAIL=$((FAIL + 1)); }
log_info()  { echo -e "${YELLOW}[INFO]${NC} $1"; }

echo "============================================================"
echo "  v2-core Smoke Test"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================================"
echo ""

# ─── TEST 1: TypeScript Compilation ───────────────────────────
log_info "Test 1: TypeScript Compilation (npx tsc --noEmit)..."
cd "$BACKEND_DIR"
if npx tsc --noEmit > /dev/null 2>&1; then
    log_pass "TypeScript compiles with zero errors"
else
    log_fail "TypeScript compilation failed"
fi

# ─── TEST 2: Frontend Build ───────────────────────────────────
log_info "Test 2: Frontend Build (npm run build)..."
cd "$FRONTEND_DIR"
if npm run build > /dev/null 2>&1; then
    log_pass "Frontend builds successfully"
else
    log_fail "Frontend build failed"
fi

# ─── TEST 3: Backend Starts ────────────────────────────────────
log_info "Test 3: Backend starts on port ${BACKEND_PORT}..."
cd "$BACKEND_DIR"

# Start backend in background
JWT_SECRET=smoke-test-secret \
ADMIN_USER=admin \
ADMIN_PASS=admin123 \
DATA_DIR="$SMOKE_DATA_DIR" \
SKIP_WHATSAPP_INIT=true \
node dist/app.js &
BACKEND_PID=$!

# Wait for backend to be ready (max 15 seconds)
READY=0
for i in $(seq 1 15); do
    if curl -s "${BACKEND_URL}/health" > /dev/null 2>&1; then
        READY=1
        break
    fi
    sleep 1
done

if [ "$READY" -eq 1 ]; then
    log_pass "Backend started successfully (PID $BACKEND_PID)"
else
    log_fail "Backend failed to start within 15 seconds"
    cleanup
    exit 1
fi

# ─── TEST 4: Health Endpoint ───────────────────────────────────
log_info "Test 4: Health endpoint..."
HEALTH=$(curl -s "${BACKEND_URL}/health")
if echo "$HEALTH" | grep -q '"status":"ok"'; then
    log_pass "Health endpoint responds OK: $(echo $HEALTH | head -c 80)"
else
    log_fail "Health endpoint returned unexpected: $HEALTH"
fi

# ─── TEST 5: Login API ────────────────────────────────────────
log_info "Test 5: Login API..."
LOGIN_RESP=$(curl -s -X POST "${BACKEND_URL}/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"user":"admin","pass":"admin123"}')

if echo "$LOGIN_RESP" | grep -q '"success":true'; then
    TOKEN=$(echo "$LOGIN_RESP" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
    log_pass "Login API works, got token: ${TOKEN:0:20}..."
else
    log_fail "Login API failed: $(echo $LOGIN_RESP | head -c 100)"
fi

# ─── TEST 6: Unit Tests (vitest) ───────────────────────────────
log_info "Test 6: Unit Tests (vitest run)..."
cd "$BACKEND_DIR"
if npx vitest run --reporter=dot > /dev/null 2>&1; then
    log_pass "Unit tests pass"
else
    log_fail "Unit tests failed"
fi

# ─── SUMMARY ───────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "  RESULTS: ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC}"
echo "============================================================"

if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
exit 0
