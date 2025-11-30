#!/bin/bash

# Tale RAG - Test Setup Script
# This script tests the Tale RAG service setup and basic functionality

set -e

echo "=========================================="
echo "Tale RAG - Test Setup"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
RAG_URL="${RAG_URL:-http://localhost:8001}"
MAX_RETRIES=30
RETRY_DELAY=2

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

# Function to wait for service
wait_for_service() {
    local url=$1
    local retries=0
    
    print_info "Waiting for service at $url..."
    
    while [ $retries -lt $MAX_RETRIES ]; do
        if curl -s -f "$url/health" > /dev/null 2>&1; then
            print_success "Service is ready!"
            return 0
        fi
        
        retries=$((retries + 1))
        echo "Attempt $retries/$MAX_RETRIES - Service not ready yet..."
        sleep $RETRY_DELAY
    done
    
    print_error "Service failed to start after $MAX_RETRIES attempts"
    return 1
}

# Function to test endpoint
test_endpoint() {
    local method=$1
    local endpoint=$2
    local data=$3
    local description=$4
    
    print_info "Testing: $description"
    
    if [ -z "$data" ]; then
        response=$(curl -s -X "$method" "$RAG_URL$endpoint")
    else
        response=$(curl -s -X "$method" "$RAG_URL$endpoint" \
            -H "Content-Type: application/json" \
            -d "$data")
    fi
    
    if [ $? -eq 0 ]; then
        print_success "$description - OK"
        echo "Response: $response" | head -c 200
        echo ""
        return 0
    else
        print_error "$description - FAILED"
        return 1
    fi
}

# Main test sequence
main() {
    echo "Step 1: Check if service is running"
    echo "-----------------------------------"
    if ! wait_for_service "$RAG_URL"; then
        print_error "Service is not running. Please start it with: docker compose up -d rag"
        exit 1
    fi
    echo ""
    
    echo "Step 2: Test health endpoint"
    echo "----------------------------"
    test_endpoint "GET" "/health" "" "Health check"
    echo ""
    
    echo "Step 3: Test root endpoint"
    echo "--------------------------"
    test_endpoint "GET" "/" "" "Root endpoint"
    echo ""
    
    echo "Step 4: Test config endpoint"
    echo "----------------------------"
    test_endpoint "GET" "/config" "" "Configuration endpoint"
    echo ""
    
    echo "Step 5: Test document addition"
    echo "-------------------------------"
    test_endpoint "POST" "/api/v1/documents" \
        '{"content":"Tale RAG is a powerful retrieval-augmented generation service.","document_id":"test-001"}' \
        "Add document"
    echo ""
    
    echo "Step 6: Test search"
    echo "-------------------"
    test_endpoint "POST" "/api/v1/search" \
        '{"query":"What is Tale RAG?","top_k":3}' \
        "Search documents"
    echo ""
    
    echo "Step 7: Test batch document addition"
    echo "-------------------------------------"
    test_endpoint "POST" "/api/v1/documents/batch" \
        '{"documents":[{"content":"Document 1","document_id":"batch-001"},{"content":"Document 2","document_id":"batch-002"}]}' \
        "Batch add documents"
    echo ""
    
    echo "Step 8: Test generation (if OpenAI key is set)"
    echo "-----------------------------------------------"
    if [ -n "$OPENAI_API_KEY" ]; then
        test_endpoint "POST" "/api/v1/generate" \
            '{"query":"Explain Tale RAG","top_k":3}' \
            "Generate response"
    else
        print_info "Skipping generation test (no OpenAI API key set)"
    fi
    echo ""
    
    echo "=========================================="
    echo "Test Summary"
    echo "=========================================="
    print_success "All basic tests completed!"
    echo ""
    echo "Next steps:"
    echo "1. Visit the API documentation: $RAG_URL/docs"
    echo "2. Try the interactive API: $RAG_URL/redoc"
    echo "3. Check the logs: docker logs tale-rag"
    echo ""
}

# Run main function
main

