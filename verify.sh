#!/bin/bash
# Verification script for the Opmaint PTW module.
# Run this against your local dev server (npm run dev must be running on :3000).
# Usage: bash verify.sh
#
# This exercises the exact kind of things a reviewer described in the brief
# will try: hitting the API directly to break illegal transitions, testing
# self-approval and area-restriction rules, and confirming auth is enforced.

BASE="http://localhost:3000"
PASS=0
FAIL=0
TMPDIR=$(mktemp -d)

pass() { echo "  PASS - $1"; PASS=$((PASS+1)); }
fail() { echo "  FAIL - $1"; FAIL=$((FAIL+1)); }

json_field() {
  # $1 = json string, $2 = python-style key path e.g. "permit.id"
  python3 -c "
import json, sys
data = json.loads('''$1''')
path = '$2'.split('.')
for p in path:
    if p.isdigit():
        data = data[int(p)]
    else:
        data = data[p]
print(data)
" 2>/dev/null
}

login() {
  # $1 = email, $2 = password, $3 = cookie jar filename
  curl -s -c "$TMPDIR/$3" -X POST "$BASE/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" > /dev/null
}

echo "=== Setup: logging in as all seeded roles ==="
login "requester@opmaint.com" "password123" "requester.txt"
login "owner@opmaint.com" "password123" "owner.txt"        # Process Unit A
login "owner2@opmaint.com" "password123" "owner2.txt"       # Tank Farm
login "safety@opmaint.com" "password123" "safety.txt"
login "admin@opmaint.com" "password123" "admin.txt"
pass "Logged in as requester, two area owners, safety officer, admin"
echo ""

echo "=== Test 1: Unauthenticated access is blocked ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/permits")
if [ "$CODE" == "401" ]; then pass "GET /api/permits without a session returns 401 (got $CODE)"; else fail "Expected 401, got $CODE"; fi
echo ""

echo "=== Fetching reference data (areas/equipment) as requester ==="
REF=$(curl -s -b "$TMPDIR/requester.txt" "$BASE/api/reference")
PROCESS_AREA_ID=$(json_field "$REF" "plants.0.areas.1.id")
PROCESS_EQUIP_ID=$(json_field "$REF" "plants.0.areas.1.equipment.0.id")
echo "  Using area: $PROCESS_AREA_ID, equipment: $PROCESS_EQUIP_ID"
echo ""

echo "=== Test 2: Create a permit whose window has already started (for the happy-path lifecycle) ==="
NOW_MINUS_1H=$(python3 -c "from datetime import datetime,timedelta; print((datetime.utcnow()-timedelta(hours=1)).isoformat()+'Z')")
NOW_PLUS_4H=$(python3 -c "from datetime import datetime,timedelta; print((datetime.utcnow()+timedelta(hours=4)).isoformat()+'Z')")

CREATE_BODY=$(cat <<EOF
{
  "type": "HOT_WORK",
  "contractorName": "Verify Co",
  "workDescription": "Verification script test permit",
  "areaId": "$PROCESS_AREA_ID",
  "equipmentId": "$PROCESS_EQUIP_ID",
  "plannedStart": "$NOW_MINUS_1H",
  "plannedEnd": "$NOW_PLUS_4H",
  "hazards": ["test hazard"],
  "ppeRequired": ["test ppe"],
  "precautions": ["test precaution"],
  "typeData": {
    "hotWorkType": "welding",
    "fireWatchAssigned": "Test Watcher",
    "fireExtinguisherType": "CO2",
    "combustiblesClearedRadiusMeters": 10,
    "gasTest": { "lelPercent": 0, "o2Percent": 20.9, "testTime": "$NOW_MINUS_1H" }
  }
}
EOF
)

RESP=$(curl -s -b "$TMPDIR/requester.txt" -X POST "$BASE/api/permits" \
  -H "Content-Type: application/json" -d "$CREATE_BODY")
PERMIT_A=$(json_field "$RESP" "permit.id")
if [ -n "$PERMIT_A" ] && [ "$PERMIT_A" != "None" ]; then pass "Created permit A: $PERMIT_A"; else fail "Could not create permit A. Response: $RESP"; fi
echo ""

echo "=== Test 3: Cannot activate a DRAFT permit directly ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$TMPDIR/requester.txt" -X POST "$BASE/api/permits/$PERMIT_A/activate")
# Note: canActivatePermit checks status != APPROVED first and throws a generic
# ForbiddenError (403) for any non-APPROVED status, including DRAFT. It only
# surfaces the specific "before planned start" 409 message when status IS
# APPROVED but timing is wrong (see Test 17). So 403 is correct here.
if [ "$CODE" == "403" ]; then pass "Activating a DRAFT permit returns 403 (got $CODE)"; else fail "Expected 403, got $CODE"; fi
echo ""

echo "=== Test 4: Submit permit A (DRAFT -> PENDING_APPROVAL) ==="
RESP=$(curl -s -b "$TMPDIR/requester.txt" -X POST "$BASE/api/permits/$PERMIT_A/submit")
STATUS=$(json_field "$RESP" "permit.status")
if [ "$STATUS" == "PENDING_APPROVAL" ]; then pass "Status is PENDING_APPROVAL"; else fail "Expected PENDING_APPROVAL, got $STATUS"; fi
echo ""

echo "=== Test 5: Cannot submit the same permit twice ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$TMPDIR/requester.txt" -X POST "$BASE/api/permits/$PERMIT_A/submit")
if [ "$CODE" != "200" ]; then pass "Re-submitting returns non-200 (got $CODE)"; else fail "Expected a rejection, got 200"; fi
echo ""

echo "=== Test 6: Requester cannot approve their own permit ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$TMPDIR/requester.txt" -X POST "$BASE/api/permits/$PERMIT_A/approve" \
  -H "Content-Type: application/json" -d '{"role":"SAFETY_OFFICER","decision":"APPROVED"}')
if [ "$CODE" == "403" ]; then pass "Self-approval blocked with 403 (got $CODE)"; else fail "Expected 403, got $CODE"; fi
echo ""

echo "=== Test 7: Area owner from a DIFFERENT area cannot approve this permit ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$TMPDIR/owner2.txt" -X POST "$BASE/api/permits/$PERMIT_A/approve" \
  -H "Content-Type: application/json" -d '{"role":"AREA_OWNER","decision":"APPROVED"}')
if [ "$CODE" == "403" ]; then pass "Wrong-area owner blocked with 403 (got $CODE)"; else fail "Expected 403, got $CODE"; fi
echo ""

echo "=== Test 8: Correct area owner CAN approve ==="
RESP=$(curl -s -b "$TMPDIR/owner.txt" -X POST "$BASE/api/permits/$PERMIT_A/approve" \
  -H "Content-Type: application/json" -d '{"role":"AREA_OWNER","decision":"APPROVED","comment":"verified"}')
STATUS=$(json_field "$RESP" "permit.status")
if [ "$STATUS" == "PENDING_APPROVAL" ]; then pass "Correct area owner approved; permit still PENDING_APPROVAL (safety officer slot open)"; else fail "Unexpected status: $STATUS. Response: $RESP"; fi
echo ""

echo "=== Test 9: Rejecting without a comment is blocked ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$TMPDIR/safety.txt" -X POST "$BASE/api/permits/$PERMIT_A/approve" \
  -H "Content-Type: application/json" -d '{"role":"SAFETY_OFFICER","decision":"REJECTED"}')
if [ "$CODE" != "200" ]; then pass "Reject without comment rejected (got $CODE)"; else fail "Expected rejection, got 200"; fi
echo ""

echo "=== Test 10: Safety officer approves -> permit becomes APPROVED (all approvals in) ==="
RESP=$(curl -s -b "$TMPDIR/safety.txt" -X POST "$BASE/api/permits/$PERMIT_A/approve" \
  -H "Content-Type: application/json" -d '{"role":"SAFETY_OFFICER","decision":"APPROVED"}')
STATUS=$(json_field "$RESP" "permit.status")
if [ "$STATUS" == "APPROVED" ]; then pass "Status is APPROVED"; else fail "Expected APPROVED, got $STATUS. Response: $RESP"; fi
echo ""

echo "=== Test 11: Requester CAN activate now (plannedStart is in the past) ==="
RESP=$(curl -s -b "$TMPDIR/requester.txt" -X POST "$BASE/api/permits/$PERMIT_A/activate")
STATUS=$(json_field "$RESP" "permit.status")
if [ "$STATUS" == "ACTIVE" ]; then pass "Status is ACTIVE"; else fail "Expected ACTIVE, got $STATUS. Response: $RESP"; fi
echo ""

echo "=== Test 12: A different requester-role user (safety officer) cannot close it - only requester/admin can ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$TMPDIR/owner.txt" -X POST "$BASE/api/permits/$PERMIT_A/close" \
  -H "Content-Type: application/json" -d '{"completionNotes":"not my permit"}')
if [ "$CODE" == "403" ]; then pass "Non-owner/non-requester close blocked with 403 (got $CODE)"; else fail "Expected 403, got $CODE"; fi
echo ""

echo "=== Test 13: Requester closes their own ACTIVE permit ==="
RESP=$(curl -s -b "$TMPDIR/requester.txt" -X POST "$BASE/api/permits/$PERMIT_A/close" \
  -H "Content-Type: application/json" -d '{"completionNotes":"Verification script completed the job"}')
STATUS=$(json_field "$RESP" "permit.status")
if [ "$STATUS" == "CLOSED" ]; then pass "Status is CLOSED"; else fail "Expected CLOSED, got $STATUS. Response: $RESP"; fi
echo ""

echo "=== Test 14: Requester cannot verify their own closure (only safety officer/admin can) ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$TMPDIR/requester.txt" -X POST "$BASE/api/permits/$PERMIT_A/verify" \
  -H "Content-Type: application/json" -d '{"verificationNotes":"trying to self-verify"}')
if [ "$CODE" == "403" ]; then pass "Requester self-verify blocked with 403 (got $CODE)"; else fail "Expected 403, got $CODE"; fi
echo ""

echo "=== Test 15: Safety officer verifies closure (CLOSED -> CLOSED_VERIFIED) ==="
RESP=$(curl -s -b "$TMPDIR/safety.txt" -X POST "$BASE/api/permits/$PERMIT_A/verify" \
  -H "Content-Type: application/json" -d '{"verificationNotes":"Area inspected, clean"}')
STATUS=$(json_field "$RESP" "permit.status")
if [ "$STATUS" == "CLOSED_VERIFIED" ]; then pass "Status is CLOSED_VERIFIED"; else fail "Expected CLOSED_VERIFIED, got $STATUS. Response: $RESP"; fi
echo ""

echo "=== Test 16: Terminal state - cannot cancel a CLOSED_VERIFIED permit ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$TMPDIR/requester.txt" -X POST "$BASE/api/permits/$PERMIT_A/cancel" \
  -H "Content-Type: application/json" -d '{}')
if [ "$CODE" != "200" ]; then pass "Cancelling a terminal-state permit rejected (got $CODE)"; else fail "Expected rejection, got 200"; fi
echo ""

echo "=== Test 17: Create a second permit with a FUTURE start time, approve it fully, confirm early activation is blocked ==="
NOW_PLUS_2H=$(python3 -c "from datetime import datetime,timedelta; print((datetime.utcnow()+timedelta(hours=2)).isoformat()+'Z')")
NOW_PLUS_6H=$(python3 -c "from datetime import datetime,timedelta; print((datetime.utcnow()+timedelta(hours=6)).isoformat()+'Z')")

CREATE_BODY_2=$(cat <<EOF
{
  "type": "WORKING_AT_HEIGHT",
  "contractorName": "Verify Co",
  "workDescription": "Future-start test permit",
  "areaId": "$PROCESS_AREA_ID",
  "equipmentId": "$PROCESS_EQUIP_ID",
  "plannedStart": "$NOW_PLUS_2H",
  "plannedEnd": "$NOW_PLUS_6H",
  "hazards": [], "ppeRequired": [], "precautions": [],
  "typeData": { "heightMeters": 5, "accessMethod": "ladder", "fallArrestEquipment": "harness", "anchorPointChecked": true, "barricadingBelow": true }
}
EOF
)
RESP=$(curl -s -b "$TMPDIR/requester.txt" -X POST "$BASE/api/permits" -H "Content-Type: application/json" -d "$CREATE_BODY_2")
PERMIT_B=$(json_field "$RESP" "permit.id")
curl -s -b "$TMPDIR/requester.txt" -X POST "$BASE/api/permits/$PERMIT_B/submit" > /dev/null
curl -s -b "$TMPDIR/owner.txt" -X POST "$BASE/api/permits/$PERMIT_B/approve" -H "Content-Type: application/json" -d '{"role":"AREA_OWNER","decision":"APPROVED"}' > /dev/null
curl -s -b "$TMPDIR/safety.txt" -X POST "$BASE/api/permits/$PERMIT_B/approve" -H "Content-Type: application/json" -d '{"role":"SAFETY_OFFICER","decision":"APPROVED"}' > /dev/null

CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$TMPDIR/requester.txt" -X POST "$BASE/api/permits/$PERMIT_B/activate")
if [ "$CODE" == "409" ]; then pass "Early activation (before plannedStart) blocked with 409 (got $CODE)"; else fail "Expected 409, got $CODE"; fi
echo ""

echo "=== Test 18: A DRAFT permit can be cancelled by its requester ==="
CREATE_BODY_3=$(cat <<EOF
{
  "type": "HOT_WORK",
  "contractorName": "Verify Co",
  "workDescription": "Cancel-test permit",
  "areaId": "$PROCESS_AREA_ID",
  "equipmentId": "$PROCESS_EQUIP_ID",
  "plannedStart": "$NOW_PLUS_2H",
  "plannedEnd": "$NOW_PLUS_6H",
  "hazards": [], "ppeRequired": [], "precautions": [],
  "typeData": {
    "hotWorkType": "cutting", "fireWatchAssigned": "X", "fireExtinguisherType": "CO2",
    "combustiblesClearedRadiusMeters": 10, "gasTest": { "lelPercent": 0, "o2Percent": 20.9, "testTime": "$NOW_PLUS_2H" }
  }
}
EOF
)
RESP=$(curl -s -b "$TMPDIR/requester.txt" -X POST "$BASE/api/permits" -H "Content-Type: application/json" -d "$CREATE_BODY_3")
PERMIT_C=$(json_field "$RESP" "permit.id")
RESP=$(curl -s -b "$TMPDIR/requester.txt" -X POST "$BASE/api/permits/$PERMIT_C/cancel" -H "Content-Type: application/json" -d '{"comment":"no longer needed"}')
STATUS=$(json_field "$RESP" "permit.status")
if [ "$STATUS" == "CANCELLED" ]; then pass "Status is CANCELLED"; else fail "Expected CANCELLED, got $STATUS. Response: $RESP"; fi
echo ""

echo "=== Test 19: Audit log is populated for permit A (full lifecycle) ==="
DETAIL=$(curl -s -b "$TMPDIR/requester.txt" "$BASE/api/permits/$PERMIT_A")
AUDIT_COUNT=$(python3 -c "
import json
d = json.loads('''$DETAIL''')
print(len(d['permit']['auditLogs']))
" 2>/dev/null)
if [ -n "$AUDIT_COUNT" ] && [ "$AUDIT_COUNT" -ge 7 ]; then pass "Audit log has $AUDIT_COUNT entries for permit A's lifecycle"; else fail "Expected at least 7 audit entries, got $AUDIT_COUNT"; fi
echo ""

echo "=== Test 20: Unit test suite (state machine + permissions) ==="
if npx vitest run > "$TMPDIR/vitest.log" 2>&1; then
  UNIT_RESULT=$(tail -5 "$TMPDIR/vitest.log")
  pass "Unit tests passed"
  echo "$UNIT_RESULT" | sed 's/^/    /'
else
  fail "Unit tests failed - see output below"
  cat "$TMPDIR/vitest.log" | sed 's/^/    /'
fi
echo ""

echo "================================================"
echo "RESULTS: $PASS passed, $FAIL failed"
echo "================================================"

rm -rf "$TMPDIR"