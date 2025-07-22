#!/bin/bash

# Create certificates directory if it doesn't exist
mkdir -p ../certificates

# Generate a self-signed certificate
openssl req -x509 -newkey rsa:4096 -nodes -keyout ../certificates/key.pem -out ../certificates/cert.pem -days 365 -subj "/CN=localhost"

echo "Self-signed certificates generated in ../certificates/"
echo "Note: These are for development only. Use proper certificates in production."
