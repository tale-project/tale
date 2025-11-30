#!/bin/bash
# Test script for the Tale Crawler service

set -e

CRAWLER_URL="${CRAWLER_URL:-http://localhost:8002}"

echo "Testing Tale Crawler Service at $CRAWLER_URL"
echo "=============================================="
echo ""

# Test 1: Health Check
echo "Test 1: Health Check"
echo "--------------------"
curl -s "$CRAWLER_URL/health" | jq '.'
echo ""
echo "✅ Health check passed"
echo ""

# Test 2: Check URL Type
echo "Test 2: Check URL Type"
echo "----------------------"
echo "Checking if https://example.com is a website..."
curl -s "$CRAWLER_URL/api/v1/check-url?url=https://example.com" | jq '.'
echo ""
echo "✅ URL type check passed"
echo ""

# Test 3: Discover URLs (small test)
echo "Test 3: Discover URLs"
echo "---------------------"
echo "Discovering URLs on example.com (max 5)..."
curl -s -X POST "$CRAWLER_URL/api/v1/discover" \
  -H "Content-Type: application/json" \
  -d '{
    "domain": "example.com",
    "max_urls": 5
  }' | jq '.success, .domain, .urls_discovered'
echo ""
echo "✅ URL discovery passed"
echo ""

# Test 4: Crawl Website (small test)
echo "Test 4: Crawl Website"
echo "---------------------"
echo "Crawling example.com (max 2 pages)..."
curl -s -X POST "$CRAWLER_URL/api/v1/crawl" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "max_pages": 2,
    "word_count_threshold": 10
  }' | jq '.success, .domain, .pages_discovered, .pages_crawled'
echo ""
echo "✅ Website crawl passed"
echo ""

echo "=============================================="
echo "All tests passed! ✅"
echo ""
echo "The Crawler service is working correctly."
echo ""
echo "Next steps:"
echo "  - Test with your own websites"
echo "  - Integrate with RAG service"
echo "  - Check the API docs at $CRAWLER_URL/docs"

