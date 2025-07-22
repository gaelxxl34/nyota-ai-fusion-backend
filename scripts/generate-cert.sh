#!/bin/bash

# Create certificates directory if it doesn't exist
mkdir -p ../certificates

# Create a configuration file for OpenSSL
cat > ../certificates/openssl.cnf << EOF
[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_req
prompt = no

[req_distinguished_name]
CN = localhost

[v3_req]
basicConstraints = CA:FALSE
keyUsage = nonRepudiation, digitalSignature, keyEncipherment
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = *.localhost
IP.1 = 127.0.0.1
EOF

# Generate a certificate
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout ../certificates/key.pem \
  -out ../certificates/cert.pem \
  -config ../certificates/openssl.cnf

echo "Self-signed certificates generated!"
echo "For Chrome/Edge: visit chrome://flags/#allow-insecure-localhost and enable it."
echo "For other browsers: you may need to add an exception for the certificate."
