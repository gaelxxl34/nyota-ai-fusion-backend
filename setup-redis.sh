#!/bin/bash

# Redis Setup Script for Nyota AI Fusion Backend
echo "🚀 Setting up Redis for Nyota AI Fusion..."

# Check if Redis is already installed
if command -v redis-server &> /dev/null; then
    echo "✅ Redis is already installed"
    redis-server --version
else
    echo "📦 Installing Redis..."
    
    # Detect OS and install Redis accordingly
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        if command -v brew &> /dev/null; then
            brew install redis
        else
            echo "❌ Homebrew not found. Please install Homebrew first or install Redis manually."
            exit 1
        fi
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        if command -v apt-get &> /dev/null; then
            sudo apt-get update
            sudo apt-get install -y redis-server
        elif command -v yum &> /dev/null; then
            sudo yum install -y redis
        else
            echo "❌ Unsupported Linux distribution. Please install Redis manually."
            exit 1
        fi
    else
        echo "❌ Unsupported operating system. Please install Redis manually."
        exit 1
    fi
fi

# Start Redis server
echo "🔧 Starting Redis server..."
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS with Homebrew
    brew services start redis
    echo "✅ Redis started as a service (will restart automatically)"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    sudo systemctl start redis-server
    sudo systemctl enable redis-server
    echo "✅ Redis started and enabled as a service"
fi

# Test Redis connection
echo "🧪 Testing Redis connection..."
sleep 2

if redis-cli ping | grep -q "PONG"; then
    echo "✅ Redis is running and responding to commands"
    
    # Set some test values for the application
    echo "🔧 Setting up initial cache configuration..."
    
    # Test the cache
    redis-cli set "cache_test" "Redis is working!" EX 60
    test_value=$(redis-cli get "cache_test")
    
    if [ "$test_value" = "Redis is working!" ]; then
        echo "✅ Cache test successful"
        redis-cli del "cache_test"
    else
        echo "⚠️ Cache test failed"
    fi
    
    # Display Redis info
    echo "📊 Redis Information:"
    redis-cli info server | grep -E "redis_version|os"
    redis-cli info memory | grep -E "used_memory_human"
    
    echo ""
    echo "🎉 Redis setup completed successfully!"
    echo ""
    echo "📋 Next steps:"
    echo "1. Update your .env file with Redis configuration:"
    echo "   REDIS_HOST=localhost"
    echo "   REDIS_PORT=6379"
    echo "   REDIS_PASSWORD="
    echo "   REDIS_DB=0"
    echo ""
    echo "2. Restart your Node.js application to enable Redis caching"
    echo ""
    echo "3. Monitor cache performance via the API:"
    echo "   GET /api/cache/stats"
    echo "   GET /api/cache/size"
    echo ""
    echo "4. Use cache management endpoints:"
    echo "   POST /api/cache/conversations/refresh"
    echo "   POST /api/cache/warmup"
    echo ""
    
else
    echo "❌ Redis is not responding. Please check the installation and try again."
    exit 1
fi
