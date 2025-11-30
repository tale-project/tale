#!/bin/bash
set -e

# Tale DB Test Setup Script
# This script tests the Tale DB Docker setup locally

echo "=================================================="
echo "Tale DB Test Setup"
echo "=================================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test configuration
TEST_DB_NAME="tale_test"
TEST_DB_USER="tale_test"
TEST_DB_PASSWORD="test_password_123"
CONTAINER_NAME="tale-db-test"

# Function to print colored output
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

# Function to cleanup
cleanup() {
    print_info "Cleaning up test containers..."
    docker stop ${CONTAINER_NAME} 2>/dev/null || true
    docker rm ${CONTAINER_NAME} 2>/dev/null || true
}

# Trap to ensure cleanup on exit
trap cleanup EXIT

# ============================================================================
# Test 1: Build Docker Image
# ============================================================================
echo ""
print_info "Test 1: Building Docker image..."
if docker build -t tale-db:test -f db/Dockerfile .; then
    print_success "Docker image built successfully"
else
    print_error "Failed to build Docker image"
    exit 1
fi

# ============================================================================
# Test 2: Start Container
# ============================================================================
echo ""
print_info "Test 2: Starting container..."
if docker run -d \
    --name ${CONTAINER_NAME} \
    -e DB_NAME=${TEST_DB_NAME} \
    -e DB_USER=${TEST_DB_USER} \
    -e DB_PASSWORD=${TEST_DB_PASSWORD} \
    -e DB_SHARED_BUFFERS=128MB \
    -e DB_EFFECTIVE_CACHE_SIZE=512MB \
    -e DB_LOG_STATEMENT=all \
    -p 5433:5432 \
    tale-db:test; then
    print_success "Container started successfully"
else
    print_error "Failed to start container"
    exit 1
fi

# ============================================================================
# Test 3: Wait for Database to be Ready
# ============================================================================
echo ""
print_info "Test 3: Waiting for database to be ready..."
MAX_RETRIES=30
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if docker exec ${CONTAINER_NAME} pg_isready -U ${TEST_DB_USER} -d ${TEST_DB_NAME} >/dev/null 2>&1; then
        print_success "Database is ready"
        break
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo -n "."
    sleep 2
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    print_error "Database failed to become ready"
    docker logs ${CONTAINER_NAME}
    exit 1
fi

# ============================================================================
# Test 4: Verify TimescaleDB Extension
# ============================================================================
echo ""
print_info "Test 4: Verifying TimescaleDB extension..."
RESULT=$(docker exec ${CONTAINER_NAME} psql -U ${TEST_DB_USER} -d ${TEST_DB_NAME} -t -c "SELECT extname FROM pg_extension WHERE extname = 'timescaledb';")
if echo "$RESULT" | grep -q "timescaledb"; then
    print_success "TimescaleDB extension is installed"
else
    print_error "TimescaleDB extension not found"
    exit 1
fi

# ============================================================================
# Test 5: Verify Tale Schema
# ============================================================================
echo ""
print_info "Test 5: Verifying tale schema..."
RESULT=$(docker exec ${CONTAINER_NAME} psql -U ${TEST_DB_USER} -d ${TEST_DB_NAME} -t -c "SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'tale';")
if echo "$RESULT" | grep -q "tale"; then
    print_success "Tale schema exists"
else
    print_error "Tale schema not found"
    exit 1
fi

# ============================================================================
# Test 6: Verify Metrics Table
# ============================================================================
echo ""
print_info "Test 6: Verifying metrics table..."
RESULT=$(docker exec ${CONTAINER_NAME} psql -U ${TEST_DB_USER} -d ${TEST_DB_NAME} -t -c "SELECT tablename FROM pg_tables WHERE schemaname = 'tale' AND tablename = 'metrics';")
if echo "$RESULT" | grep -q "metrics"; then
    print_success "Metrics table exists"
else
    print_error "Metrics table not found"
    exit 1
fi

# ============================================================================
# Test 7: Verify Events Table
# ============================================================================
echo ""
print_info "Test 7: Verifying events table..."
RESULT=$(docker exec ${CONTAINER_NAME} psql -U ${TEST_DB_USER} -d ${TEST_DB_NAME} -t -c "SELECT tablename FROM pg_tables WHERE schemaname = 'tale' AND tablename = 'events';")
if echo "$RESULT" | grep -q "events"; then
    print_success "Events table exists"
else
    print_error "Events table not found"
    exit 1
fi

# ============================================================================
# Test 8: Test Metric Insertion
# ============================================================================
echo ""
print_info "Test 8: Testing metric insertion..."
docker exec ${CONTAINER_NAME} psql -U ${TEST_DB_USER} -d ${TEST_DB_NAME} -c "
INSERT INTO tale.metrics (time, metric_name, value, tags)
VALUES (NOW(), 'test.metric', 123.45, '{\"test\": \"true\"}');
" >/dev/null

RESULT=$(docker exec ${CONTAINER_NAME} psql -U ${TEST_DB_USER} -d ${TEST_DB_NAME} -t -c "SELECT COUNT(*) FROM tale.metrics WHERE metric_name = 'test.metric';")
if [ "$(echo $RESULT | tr -d ' ')" = "1" ]; then
    print_success "Metric insertion successful"
else
    print_error "Metric insertion failed"
    exit 1
fi

# ============================================================================
# Test 9: Test Event Insertion
# ============================================================================
echo ""
print_info "Test 9: Testing event insertion..."
docker exec ${CONTAINER_NAME} psql -U ${TEST_DB_USER} -d ${TEST_DB_NAME} -c "
INSERT INTO tale.events (time, event_type, user_id, properties)
VALUES (NOW(), 'test.event', '123e4567-e89b-12d3-a456-426614174000', '{\"test\": \"true\"}');
" >/dev/null

RESULT=$(docker exec ${CONTAINER_NAME} psql -U ${TEST_DB_USER} -d ${TEST_DB_NAME} -t -c "SELECT COUNT(*) FROM tale.events WHERE event_type = 'test.event';")
if [ "$(echo $RESULT | tr -d ' ')" = "1" ]; then
    print_success "Event insertion successful"
else
    print_error "Event insertion failed"
    exit 1
fi

# ============================================================================
# Test 10: Test Time Bucket Query
# ============================================================================
echo ""
print_info "Test 10: Testing time bucket query..."
RESULT=$(docker exec ${CONTAINER_NAME} psql -U ${TEST_DB_USER} -d ${TEST_DB_NAME} -t -c "
SELECT time_bucket('1 hour', time) AS bucket, COUNT(*)
FROM tale.metrics
GROUP BY bucket;
")
if [ -n "$RESULT" ]; then
    print_success "Time bucket query successful"
else
    print_error "Time bucket query failed"
    exit 1
fi

# ============================================================================
# Test 11: Verify Environment Variables
# ============================================================================
echo ""
print_info "Test 11: Verifying environment variables..."
RESULT=$(docker exec ${CONTAINER_NAME} psql -U ${TEST_DB_USER} -d ${TEST_DB_NAME} -t -c "SHOW shared_buffers;")
if echo "$RESULT" | grep -q "128MB"; then
    print_success "Environment variables applied correctly"
else
    print_error "Environment variables not applied correctly"
    echo "Expected: 128MB, Got: $RESULT"
    exit 1
fi

# ============================================================================
# Test 12: Check Logs
# ============================================================================
echo ""
print_info "Test 12: Checking container logs..."
LOGS=$(docker logs ${CONTAINER_NAME} 2>&1)
if echo "$LOGS" | grep -q "Tale DB Starting"; then
    print_success "Container logs look good"
else
    print_error "Container logs missing expected output"
    echo "$LOGS"
    exit 1
fi

# ============================================================================
# Summary
# ============================================================================
echo ""
echo "=================================================="
print_success "All tests passed! ✓"
echo "=================================================="
echo ""
print_info "Container is still running for manual inspection"
print_info "Connect with: docker exec -it ${CONTAINER_NAME} psql -U ${TEST_DB_USER} -d ${TEST_DB_NAME}"
print_info "Stop with: docker stop ${CONTAINER_NAME}"
print_info "Remove with: docker rm ${CONTAINER_NAME}"
echo ""

