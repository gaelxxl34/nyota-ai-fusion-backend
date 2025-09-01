#!/bin/bash

# Production Redis Setup Script
# This script configures Redis for production use

echo "🔧 Setting up Redis for production..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
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

# Clear any existing data
print_info "Clearing any existing test data..."
redis-cli FLUSHALL
print_status "Redis database cleared"

# Configure Redis for production
print_info "Configuring Redis for production..."

# Memory optimization
redis-cli CONFIG SET maxmemory "2gb"
redis-cli CONFIG SET maxmemory-policy "allkeys-lru"
redis-cli CONFIG SET maxmemory-samples 10

# Connection optimization
redis-cli CONFIG SET tcp-keepalive 300
redis-cli CONFIG SET timeout 0
redis-cli CONFIG SET tcp-backlog 511

# Performance optimization
redis-cli CONFIG SET rdbcompression yes
redis-cli CONFIG SET rdbchecksum yes
redis-cli CONFIG SET stop-writes-on-bgsave-error yes

# Enable persistence for production
redis-cli CONFIG SET save "900 1 300 10 60 10000"
redis-cli CONFIG SET appendonly yes
redis-cli CONFIG SET appendfsync everysec
redis-cli CONFIG SET no-appendfsync-on-rewrite no
redis-cli CONFIG SET auto-aof-rewrite-percentage 100
redis-cli CONFIG SET auto-aof-rewrite-min-size 67108864

# Security settings
redis-cli CONFIG SET protected-mode yes
redis-cli CONFIG SET bind "127.0.0.1 ::1"

# Logging
redis-cli CONFIG SET loglevel notice
redis-cli CONFIG SET syslog-enabled no

# Slow log for monitoring
redis-cli CONFIG SET slowlog-log-slower-than 10000
redis-cli CONFIG SET slowlog-max-len 128

# Latency monitoring
redis-cli CONFIG SET latency-monitor-threshold 100

print_status "Redis production configuration applied"

# Display current configuration summary
print_info "Current Redis Configuration Summary:"
echo "Memory Policy: $(redis-cli CONFIG GET maxmemory-policy | tail -1)"
echo "Max Memory: $(redis-cli CONFIG GET maxmemory | tail -1)"
echo "Persistence: AOF=$(redis-cli CONFIG GET appendonly | tail -1), RDB=$(redis-cli CONFIG GET save | tail -1)"
echo "Protected Mode: $(redis-cli CONFIG GET protected-mode | tail -1)"
echo "Bind Address: $(redis-cli CONFIG GET bind | tail -1)"

# Test Redis performance
print_info "Running Redis performance test..."
redis-cli --latency-history -i 1 > /dev/null 2>&1 &
LATENCY_PID=$!
sleep 3
kill $LATENCY_PID 2>/dev/null

# Test basic operations
print_info "Testing Redis operations..."
redis-cli SET test_key "test_value" > /dev/null
if [ "$(redis-cli GET test_key)" = "test_value" ]; then
    print_status "SET/GET operations working"
else
    print_error "SET/GET operations failed"
fi

redis-cli DEL test_key > /dev/null

# Check memory usage
MEMORY_USAGE=$(redis-cli INFO memory | grep used_memory_human | cut -d: -f2 | tr -d '\r')
print_info "Current memory usage: $MEMORY_USAGE"

# Save configuration to file (if Redis is configured to write config)
redis-cli CONFIG REWRITE 2>/dev/null && print_status "Configuration saved to Redis config file" || print_warning "Could not save config to file (this is normal for Homebrew Redis)"

print_status "Redis is ready for production!"
print_info "Monitor Redis with: redis-cli MONITOR"
print_info "Check stats with: redis-cli INFO"
print_info "View slow queries with: redis-cli SLOWLOG GET 10"
