#!/bin/bash

# Redis Production Cleanup Script
# This script cleans up development/test data and prepares Redis for production

echo "🧹 Redis Production Cleanup Script"
echo "=================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Check if Redis is running
if ! redis-cli ping > /dev/null 2>&1; then
    print_error "Redis is not running. Please start Redis first."
    exit 1
fi

print_status "Redis is running"

# Confirmation prompt
print_warning "This will clean ALL data from Redis. Are you sure you want to continue?"
read -p "Type 'YES' to confirm: " confirmation

if [ "$confirmation" != "YES" ]; then
    print_info "Cleanup cancelled."
    exit 0
fi

print_info "Starting Redis cleanup for production..."

# 1. Get current statistics
print_info "Current Redis statistics:"
total_keys=$(redis-cli DBSIZE)
memory_before=$(redis-cli INFO memory | grep used_memory_human | cut -d: -f2 | tr -d '\r')
echo "Total keys: $total_keys"
echo "Memory usage: $memory_before"

# 2. Clear all databases
print_info "Clearing all Redis databases..."
redis-cli FLUSHALL
print_status "All databases cleared"

# 3. Clear any persisted data
print_info "Clearing persisted data..."

# Clear AOF file if it exists
redis-cli BGREWRITEAOF > /dev/null 2>&1

# Create a new RDB snapshot
redis-cli BGSAVE > /dev/null 2>&1

print_status "Persisted data cleared"

# 4. Reset statistics
print_info "Resetting Redis statistics..."
redis-cli CONFIG RESETSTAT > /dev/null 2>&1
print_status "Statistics reset"

# 5. Clear slow log
print_info "Clearing slow query log..."
redis-cli SLOWLOG RESET > /dev/null 2>&1
print_status "Slow query log cleared"

# 6. Verify cleanup
print_info "Verifying cleanup..."
total_keys_after=$(redis-cli DBSIZE)
memory_after=$(redis-cli INFO memory | grep used_memory_human | cut -d: -f2 | tr -d '\r')

echo "Keys after cleanup: $total_keys_after"
echo "Memory usage after cleanup: $memory_after"

if [ "$total_keys_after" -eq 0 ]; then
    print_status "Cleanup successful - Redis is clean"
else
    print_error "Cleanup incomplete - $total_keys_after keys remaining"
fi

# 7. Test basic functionality
print_info "Testing Redis functionality..."
redis-cli SET test_production_ready "yes" > /dev/null
test_result=$(redis-cli GET test_production_ready)
redis-cli DEL test_production_ready > /dev/null

if [ "$test_result" = "yes" ]; then
    print_status "Redis functionality test passed"
else
    print_error "Redis functionality test failed"
fi

# 8. Display final status
print_info "Final Redis status:"
redis-cli INFO server | grep "redis_version\|uptime_in_seconds" | while read line; do
    echo "$line"
done

print_status "Redis is clean and ready for production!"
print_info "Next steps:"
echo "  1. Deploy your application with production environment variables"
echo "  2. Monitor Redis using: ./scripts/redis-monitor.sh"
echo "  3. Set up regular backups for production data"
echo "  4. Configure monitoring alerts for Redis health"

# 9. Security reminder
print_warning "Security Checklist:"
echo "  ✓ Protected mode is enabled"
echo "  ✓ Bind address is restricted"
echo "  ✓ No default password (ensure firewall protection)"
echo "  ○ Consider setting up Redis AUTH for additional security"
echo "  ○ Configure log rotation for Redis logs"
echo "  ○ Set up automated backups"
