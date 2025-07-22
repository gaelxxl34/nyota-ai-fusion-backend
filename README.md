# Nyota AI Fusion Backend

## Prerequisites
- Node.js 16+
- Firebase account with Firestore enabled
- WhatsApp Business API account (for WhatsApp integration)

## Setup
1. Clone the repository:
```bash
git clone https://github.com/your-username/nyota-ai-fusion.git
cd nyota-ai-fusion/nyota-ai-fusion-backend
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
   - Copy `.env.example` to `.env`
   - Fill in the required credentials

```bash
cp .env.example .env
# Edit .env with your actual values
```

4. Set up Firebase credentials:
   - Option 1: Place your `serviceAccountKey.json` in the root directory
   - Option 2: Set the Firebase credentials in the `.env` file

5. Generate SSL certificates for HTTPS (if needed):
```bash
npm run generate-certs
```

6. Start the server:

Development mode (with auto-reload):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

## Available Scripts
- `npm start`: Run production server
- `npm run dev`: Run development server with hot-reload
- `npm run generate-certs`: Generate SSL certificates for HTTPS

## Core Features
- Lead management with qualification scoring
- WhatsApp integration for messaging
- AI-powered chatbot with Anthropic Claude
- Admin and Organization user management
- WebSocket for real-time communication
- Webhook handlers for Meta Ads, Google Ads, and WordPress

## API Documentation

### Authentication Endpoints
- POST /api/auth/login - User login
- POST /api/auth/forgot-password - Request password reset
- POST /api/auth/reset-password - Reset password
- GET /api/auth/verify-token - Verify JWT token
- POST /api/auth/check-email - Check if email exists

### Lead Management
- GET /api/leads - Get all leads
- POST /api/leads - Create a new lead
- GET /api/leads/:id - Get lead details
- PUT /api/leads/:id - Update lead
- DELETE /api/leads/:id - Delete lead
Verifies Firebase ID token
```json
{
  "token": "firebase-id-token"
}
```

### GET /api/auth/profile
Get user profile (requires authentication header)
Header: `Authorization: Bearer {firebase-id-token}`

### POST /api/auth/logout
Logout user (requires authentication header)
Header: `Authorization: Bearer {firebase-id-token}`

## Facebook Ads Integration Endpoints

### GET /api/facebook/accounts
Get user's Facebook Ad accounts (requires authentication)
Header: `Authorization: Bearer {firebase-id-token}`

### GET /api/facebook/campaigns/:accountId
Get campaigns for specific ad account (requires authentication)
Header: `Authorization: Bearer {firebase-id-token}`

## Authentication Flow
1. Frontend: Login with Firebase Authentication
2. Frontend: Get ID token from Firebase
3. Frontend: Send token to /api/auth/verify-token
4. Frontend: Store verified token
5. Frontend: Include token in all API requests
6. Frontend: Call /api/auth/logout when logging out

## Headers for Protected Routes
```
Authorization: Bearer {firebase-id-token}
```

## Project Structure
```
src/
├── models/
│   └── note.model.js
├── routes/
│   └── notes.routes.js
└── index.js
```
