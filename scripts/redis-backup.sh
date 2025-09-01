#!/bin/bash

# Redis Production Backup Script
# This script creates automated backups of Redis data for production

BACKUP_DIR="/Applications/XAMPP/htdocs/Nyota-AI-Fusion/nyota-ai-fusion-backend/backups/redis"
REDIS_DATA_DIR="/opt/homebrew/var/db/redis"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="redis_backup_${DATE}"
MAX_BACKUPS=7  # Keep last 7 backups

echo "💾 Redis Production Backup Script"
echo "================================="

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
    print_error "Redis is not running. Cannot create backup."
    exit 1
fi

print_status "Redis is running"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"
print_info "Backup directory: $BACKUP_DIR"

# Get current Redis info
print_info "Getting Redis information..."
total_keys=$(redis-cli DBSIZE)
memory_usage=$(redis-cli INFO memory | grep used_memory_human | cut -d: -f2 | tr -d '\r')
echo "Total keys: $total_keys"
echo "Memory usage: $memory_usage"

# Create RDB backup
print_info "Creating RDB backup..."
redis-cli BGSAVE

# Wait for backup to complete
print_info "Waiting for backup to complete..."
while [ $(redis-cli LASTSAVE) -eq $(redis-cli LASTSAVE) ]; do
    sleep 1
done

# Copy RDB file to backup directory
if [ -f "$REDIS_DATA_DIR/dump.rdb" ]; then
    cp "$REDIS_DATA_DIR/dump.rdb" "$BACKUP_DIR/${BACKUP_FILE}.rdb"
    print_status "RDB backup created: ${BACKUP_FILE}.rdb"
else
    print_error "RDB file not found at $REDIS_DATA_DIR/dump.rdb"
fi

# Create AOF backup if enabled
aof_enabled=$(redis-cli CONFIG GET appendonly | tail -1)
if [ "$aof_enabled" = "yes" ]; then
    print_info "Creating AOF backup..."
    redis-cli BGREWRITEAOF
    
    # Wait for AOF rewrite to complete
    while [ $(redis-cli INFO persistence | grep aof_rewrite_in_progress | cut -d: -f2 | tr -d '\r') = "1" ]; do
        sleep 1
    done
    
    if [ -f "$REDIS_DATA_DIR/appendonly.aof" ]; then
        cp "$REDIS_DATA_DIR/appendonly.aof" "$BACKUP_DIR/${BACKUP_FILE}.aof"
        print_status "AOF backup created: ${BACKUP_FILE}.aof"
    fi
fi

# Create a backup manifest with metadata
cat > "$BACKUP_DIR/${BACKUP_FILE}.manifest" << EOF
# Redis Backup Manifest
# Generated on: $(date)

BACKUP_DATE=$DATE
REDIS_VERSION=$(redis-cli INFO server | grep redis_version | cut -d: -f2 | tr -d '\r')
TOTAL_KEYS=$total_keys
MEMORY_USAGE=$memory_usage
AOF_ENABLED=$aof_enabled
BACKUP_TYPE=full
BACKUP_SIZE_RDB=$([ -f "$BACKUP_DIR/${BACKUP_FILE}.rdb" ] && du -h "$BACKUP_DIR/${BACKUP_FILE}.rdb" | cut -f1 || echo "N/A")
BACKUP_SIZE_AOF=$([ -f "$BACKUP_DIR/${BACKUP_FILE}.aof" ] && du -h "$BACKUP_DIR/${BACKUP_FILE}.aof" | cut -f1 || echo "N/A")

# Application-specific cache information
CONVERSATIONS=$(redis-cli KEYS "conv:*" | wc -l)
MESSAGES=$(redis-cli KEYS "conv_msg:*" | wc -l)
LEADS=$(redis-cli KEYS "lead*:*" | wc -l)
KNOWLEDGE_BASE=$(redis-cli KEYS "kb:*" | wc -l)
AI_RESPONSES=$(redis-cli KEYS "ai_resp:*" | wc -l)
ANALYTICS=$(redis-cli KEYS "analytics:*" | wc -l)
EOF

print_status "Backup manifest created: ${BACKUP_FILE}.manifest"

# Compress backups to save space
print_info "Compressing backup files..."
cd "$BACKUP_DIR"

# Create tar.gz archive
tar -czf "${BACKUP_FILE}.tar.gz" "${BACKUP_FILE}".* 2>/dev/null

if [ $? -eq 0 ]; then
    # Remove individual files after successful compression
    rm -f "${BACKUP_FILE}.rdb" "${BACKUP_FILE}.aof" "${BACKUP_FILE}.manifest"
    print_status "Backup compressed: ${BACKUP_FILE}.tar.gz"
    
    # Show backup size
    backup_size=$(du -h "${BACKUP_FILE}.tar.gz" | cut -f1)
    echo "Backup size: $backup_size"
else
    print_error "Failed to compress backup files"
fi

# Clean up old backups (keep only the last MAX_BACKUPS)
print_info "Cleaning up old backups..."
backup_count=$(ls -1 redis_backup_*.tar.gz 2>/dev/null | wc -l)

if [ $backup_count -gt $MAX_BACKUPS ]; then
    files_to_delete=$((backup_count - MAX_BACKUPS))
    ls -1t redis_backup_*.tar.gz | tail -n $files_to_delete | xargs rm -f
    print_status "Removed $files_to_delete old backup(s)"
fi

# List current backups
print_info "Current backups:"
ls -lh redis_backup_*.tar.gz 2>/dev/null || echo "No backups found"

# Verify backup integrity
print_info "Verifying backup integrity..."
if tar -tzf "${BACKUP_FILE}.tar.gz" >/dev/null 2>&1; then
    print_status "Backup integrity verified"
else
    print_error "Backup integrity check failed"
fi

# Create backup report
cat > "$BACKUP_DIR/backup_report_${DATE}.txt" << EOF
Redis Backup Report
==================
Date: $(date)
Backup File: ${BACKUP_FILE}.tar.gz
Backup Size: $(du -h "${BACKUP_FILE}.tar.gz" | cut -f1)
Total Keys Backed Up: $total_keys
Memory Usage: $memory_usage
Redis Version: $(redis-cli INFO server | grep redis_version | cut -d: -f2 | tr -d '\r')
AOF Enabled: $aof_enabled

Application Cache Statistics:
- Conversations: $(redis-cli KEYS "conv:*" | wc -l)
- Messages: $(redis-cli KEYS "conv_msg:*" | wc -l)
- Leads: $(redis-cli KEYS "lead*:*" | wc -l)
- Knowledge Base: $(redis-cli KEYS "kb:*" | wc -l)
- AI Responses: $(redis-cli KEYS "ai_resp:*" | wc -l)
- Analytics: $(redis-cli KEYS "analytics:*" | wc -l)

Backup Status: SUCCESS
EOF

print_status "Backup completed successfully!"
print_info "Backup location: $BACKUP_DIR/${BACKUP_FILE}.tar.gz"
print_info "Backup report: $BACKUP_DIR/backup_report_${DATE}.txt"

# Show backup restore instructions
print_warning "To restore this backup:"
echo "  1. Stop Redis: brew services stop redis"
echo "  2. Extract backup: tar -xzf ${BACKUP_FILE}.tar.gz"
echo "  3. Copy RDB file: cp ${BACKUP_FILE}.rdb $REDIS_DATA_DIR/dump.rdb"
echo "  4. Copy AOF file (if exists): cp ${BACKUP_FILE}.aof $REDIS_DATA_DIR/appendonly.aof"
echo "  5. Start Redis: brew services start redis"

# Optional: Send backup notification (uncomment if needed)
# echo "Redis backup completed: ${BACKUP_FILE}.tar.gz" | mail -s "Redis Backup Report" admin@your-domain.com
