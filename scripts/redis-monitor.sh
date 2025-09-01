#!/bin/bash

# Redis Production Monitoring Script
# This script provides comprehensive monitoring for Redis in production

echo "📊 Redis Production Monitoring Dashboard"
echo "======================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Function to print colored output
print_section() {
    echo -e "\n${CYAN}🔍 $1${NC}"
    echo "$(printf '%*s' ${#1} '' | tr ' ' '-')"
}

print_good() {
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
    print_error "Redis is not running!"
    exit 1
fi

print_good "Redis is running and responding"

# 1. Basic Information
print_section "Basic Information"
redis_info=$(redis-cli INFO server)
redis_version=$(echo "$redis_info" | grep "redis_version:" | cut -d: -f2 | tr -d '\r')
uptime_seconds=$(echo "$redis_info" | grep "uptime_in_seconds:" | cut -d: -f2 | tr -d '\r')
uptime_days=$((uptime_seconds / 86400))
uptime_hours=$(((uptime_seconds % 86400) / 3600))
uptime_minutes=$(((uptime_seconds % 3600) / 60))

echo "Redis Version: $redis_version"
echo "Uptime: ${uptime_days}d ${uptime_hours}h ${uptime_minutes}m"
echo "Process ID: $(echo "$redis_info" | grep "process_id:" | cut -d: -f2 | tr -d '\r')"

# 2. Memory Usage
print_section "Memory Usage"
memory_info=$(redis-cli INFO memory)
used_memory_human=$(echo "$memory_info" | grep "used_memory_human:" | cut -d: -f2 | tr -d '\r')
used_memory_peak_human=$(echo "$memory_info" | grep "used_memory_peak_human:" | cut -d: -f2 | tr -d '\r')
used_memory_rss_human=$(echo "$memory_info" | grep "used_memory_rss_human:" | cut -d: -f2 | tr -d '\r')
maxmemory_human=$(echo "$memory_info" | grep "maxmemory_human:" | cut -d: -f2 | tr -d '\r')
maxmemory_policy=$(echo "$memory_info" | grep "maxmemory_policy:" | cut -d: -f2 | tr -d '\r')

echo "Used Memory: $used_memory_human"
echo "Peak Memory: $used_memory_peak_human"
echo "RSS Memory: $used_memory_rss_human"
echo "Max Memory: $maxmemory_human"
echo "Eviction Policy: $maxmemory_policy"

# Memory usage percentage
if [ "$maxmemory_human" != "0B" ]; then
    used_memory=$(echo "$memory_info" | grep "^used_memory:" | cut -d: -f2 | tr -d '\r')
    maxmemory=$(echo "$memory_info" | grep "^maxmemory:" | cut -d: -f2 | tr -d '\r')
    if [ "$maxmemory" -gt 0 ]; then
        memory_percentage=$((used_memory * 100 / maxmemory))
        if [ $memory_percentage -gt 80 ]; then
            print_warning "Memory usage is at ${memory_percentage}%"
        else
            print_good "Memory usage is at ${memory_percentage}%"
        fi
    fi
fi

# 3. Connection Information
print_section "Connections"
clients_info=$(redis-cli INFO clients)
connected_clients=$(echo "$clients_info" | grep "connected_clients:" | cut -d: -f2 | tr -d '\r')
maxclients=$(echo "$clients_info" | grep "maxclients:" | cut -d: -f2 | tr -d '\r')
blocked_clients=$(echo "$clients_info" | grep "blocked_clients:" | cut -d: -f2 | tr -d '\r')

echo "Connected Clients: $connected_clients / $maxclients"
echo "Blocked Clients: $blocked_clients"

if [ "$connected_clients" -gt $((maxclients * 80 / 100)) ]; then
    print_warning "High number of connected clients"
else
    print_good "Client connections look healthy"
fi

# 4. Database Statistics
print_section "Database Statistics"
stats_info=$(redis-cli INFO stats)
total_commands=$(echo "$stats_info" | grep "total_commands_processed:" | cut -d: -f2 | tr -d '\r')
ops_per_sec=$(echo "$stats_info" | grep "instantaneous_ops_per_sec:" | cut -d: -f2 | tr -d '\r')
keyspace_hits=$(echo "$stats_info" | grep "keyspace_hits:" | cut -d: -f2 | tr -d '\r')
keyspace_misses=$(echo "$stats_info" | grep "keyspace_misses:" | cut -d: -f2 | tr -d '\r')

echo "Total Commands: $total_commands"
echo "Operations/sec: $ops_per_sec"
echo "Keyspace Hits: $keyspace_hits"
echo "Keyspace Misses: $keyspace_misses"

# Calculate hit rate
if [ "$keyspace_hits" -gt 0 ] || [ "$keyspace_misses" -gt 0 ]; then
    total_requests=$((keyspace_hits + keyspace_misses))
    hit_rate=$((keyspace_hits * 100 / total_requests))
    echo "Hit Rate: ${hit_rate}%"
    
    if [ $hit_rate -lt 80 ]; then
        print_warning "Cache hit rate is below 80%"
    else
        print_good "Cache hit rate is healthy"
    fi
fi

# 5. Persistence Status
print_section "Persistence"
persistence_info=$(redis-cli INFO persistence)
aof_enabled=$(echo "$persistence_info" | grep "aof_enabled:" | cut -d: -f2 | tr -d '\r')
rdb_last_save=$(echo "$persistence_info" | grep "rdb_last_save_time:" | cut -d: -f2 | tr -d '\r')
aof_last_write_status=$(echo "$persistence_info" | grep "aof_last_write_status:" | cut -d: -f2 | tr -d '\r')

echo "AOF Enabled: $aof_enabled"
echo "Last RDB Save: $(date -r $rdb_last_save 2>/dev/null || echo 'Unknown')"
echo "AOF Write Status: $aof_last_write_status"

if [ "$aof_last_write_status" = "ok" ]; then
    print_good "AOF persistence is working"
else
    print_error "AOF persistence has issues"
fi

# 6. Cache Keys Analysis
print_section "Cache Analysis"
# Get all our application cache keys
conv_keys=$(redis-cli KEYS "conv:*" | wc -l)
conv_msg_keys=$(redis-cli KEYS "conv_msg:*" | wc -l)
conv_list_keys=$(redis-cli KEYS "conv_list:*" | wc -l)
lead_keys=$(redis-cli KEYS "lead:*" | wc -l)
lead_name_keys=$(redis-cli KEYS "lead_name:*" | wc -l)
kb_keys=$(redis-cli KEYS "kb:*" | wc -l)
ai_resp_keys=$(redis-cli KEYS "ai_resp:*" | wc -l)
analytics_keys=$(redis-cli KEYS "analytics:*" | wc -l)

echo "Conversations: $conv_keys"
echo "Messages: $conv_msg_keys"
echo "Conversation Lists: $conv_list_keys"
echo "Leads: $lead_keys"
echo "Lead Names: $lead_name_keys"
echo "Knowledge Base: $kb_keys"
echo "AI Responses: $ai_resp_keys"
echo "Analytics: $analytics_keys"

total_keys=$((conv_keys + conv_msg_keys + conv_list_keys + lead_keys + lead_name_keys + kb_keys + ai_resp_keys + analytics_keys))
echo "Total Application Keys: $total_keys"

# 7. Slow Log Analysis
print_section "Slow Query Analysis"
slow_queries=$(redis-cli SLOWLOG LEN)
echo "Slow Queries in Log: $slow_queries"

if [ "$slow_queries" -gt 0 ]; then
    print_warning "Found $slow_queries slow queries"
    echo "Recent slow queries:"
    redis-cli SLOWLOG GET 5 | head -20
else
    print_good "No slow queries detected"
fi

# 8. Latency Information
print_section "Latency Information"
latency_latest=$(redis-cli --latency-history -i 1 | head -1 2>/dev/null &)
sleep 2
kill $! 2>/dev/null
print_info "Run 'redis-cli --latency-history' for real-time latency monitoring"

# 9. Configuration Check
print_section "Critical Configuration"
protected_mode=$(redis-cli CONFIG GET protected-mode | tail -1)
bind_address=$(redis-cli CONFIG GET bind | tail -1)
save_config=$(redis-cli CONFIG GET save | tail -1)

echo "Protected Mode: $protected_mode"
echo "Bind Address: $bind_address"
echo "Save Configuration: $save_config"

if [ "$protected_mode" = "yes" ]; then
    print_good "Protected mode is enabled"
else
    print_warning "Protected mode is disabled"
fi

# 10. Health Summary
print_section "Health Summary"

health_score=100
issues=0

# Check memory usage
if [ "$maxmemory_human" != "0B" ]; then
    used_memory=$(echo "$memory_info" | grep "^used_memory:" | cut -d: -f2 | tr -d '\r')
    maxmemory=$(echo "$memory_info" | grep "^maxmemory:" | cut -d: -f2 | tr -d '\r')
    if [ "$maxmemory" -gt 0 ]; then
        memory_percentage=$((used_memory * 100 / maxmemory))
        if [ $memory_percentage -gt 90 ]; then
            health_score=$((health_score - 30))
            issues=$((issues + 1))
        elif [ $memory_percentage -gt 80 ]; then
            health_score=$((health_score - 15))
            issues=$((issues + 1))
        fi
    fi
fi

# Check hit rate
if [ "$keyspace_hits" -gt 0 ] || [ "$keyspace_misses" -gt 0 ]; then
    total_requests=$((keyspace_hits + keyspace_misses))
    hit_rate=$((keyspace_hits * 100 / total_requests))
    if [ $hit_rate -lt 70 ]; then
        health_score=$((health_score - 20))
        issues=$((issues + 1))
    elif [ $hit_rate -lt 80 ]; then
        health_score=$((health_score - 10))
        issues=$((issues + 1))
    fi
fi

# Check slow queries
if [ "$slow_queries" -gt 10 ]; then
    health_score=$((health_score - 15))
    issues=$((issues + 1))
elif [ "$slow_queries" -gt 5 ]; then
    health_score=$((health_score - 5))
    issues=$((issues + 1))
fi

# Check persistence
if [ "$aof_last_write_status" != "ok" ]; then
    health_score=$((health_score - 25))
    issues=$((issues + 1))
fi

# Display health score
if [ $health_score -ge 90 ]; then
    print_good "Redis Health Score: ${health_score}/100 - Excellent"
elif [ $health_score -ge 80 ]; then
    print_warning "Redis Health Score: ${health_score}/100 - Good"
elif [ $health_score -ge 70 ]; then
    print_warning "Redis Health Score: ${health_score}/100 - Fair"
else
    print_error "Redis Health Score: ${health_score}/100 - Poor"
fi

echo "Issues Found: $issues"
echo ""
print_info "For continuous monitoring, run this script periodically or set up monitoring tools"
print_info "Use 'redis-cli MONITOR' to watch commands in real-time"
print_info "Use 'redis-cli INFO' for detailed statistics"
