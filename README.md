# BlinkChat — Backend Server

> A Node.js + TypeScript backend that powers real-time chat using socket io, group conversations, media sharing, and peer-to-peer audio/video calls
> using webrtc and turn server especially for reliability.

---

## Table of Contents

1. [What This Server Does](#1-what-this-server-does)
2. [Features at a Glance](#2-features-at-a-glance)
3. [Quick Start](#3-quick-start)
4. [Tech Stack](#4-tech-stack)
5. [How the Server Is Organized](#5-how-the-server-is-organized)
6. [Architecture — How a Request Travels](#6-architecture--how-a-request-travels)
7. [How Key Features Work](#7-how-key-features-work)
8. [API Routes](#8-api-routes)
9. [Real-Time Events (Socket.IO)](#9-real-time-events-socketio)
10. [Environment Variables](#10-environment-variables)
11. [Security & Validation](#11-security--validation)
12. [Design Decisions](#12-design-decisions)
13. [Scalability Notes](#13-scalability-notes)
14. [Deployment](#14-deployment)
15. [Troubleshooting](#15-troubleshooting)
16. [Screenshots](#16-screenshots)
17. [Contributing](#17-contributing)

---

## 1. What This Server Does

BlinkChat's server is the single backend for the entire chat platform. It handles:

- User accounts (sign up, log in, Google OAuth, two-factor auth)
- Direct messages and group conversations
- Real-time message delivery, typing indicators, and online presence
- Audio and video call coordination (WebRTC signaling)
- File and media uploads via Cloudinary
- Session management across multiple devices

It is a single Node.js process that serves both an HTTP REST API and a Socket.IO real-time server on the same port.

---

## 2. Features at a Glance

**Auth**

- Email + OTP verified registration
- Password login with optional 2FA
- Google OAuth (sign in with Google)
- Refresh token rotation with theft detection
- Up to 5 simultaneous sessions per user
- Forgot password / reset password via OTP
- Session management (view, revoke individual sessions)

**Messaging**

- Text, image, audio, video, and file messages
- Emoji reactions
- Reply to a message (with snapshot for context)
- Forward messages to other conversations
- Soft delete (message appears as "deleted" to others)
- Full-text search within a conversation

**Conversations**

- Direct messages between two users
- Group chats with admin roles
- Rename group, update group avatar, add/remove members
- Promote / demote group admins
- Leave group
- Pin and unpin messages inside a conversation
- Pin and mute conversations in the sidebar
- Delete a direct conversation

**Calls**

- Audio and video calls between two users
- WebRTC signaling relay (server passes SDP offers/answers, ICE candidates)
- Call state machine: INITIATED → RINGING → ACCEPTED → ONGOING → ENDED / MISSED / CANCELLED / REJECTED / FAILED
- 30-second ring timeout (auto marks as missed)
- 15-second reconnect window if a user drops mid-call
- Call history with direction (incoming / outgoing) and duration
- Calls logged as messages in the conversation

**Users**

- Profile: name, username, bio, avatar
- Block / unblock users
- Privacy settings (hide online status, hide last seen)
- Notification preferences

---

## 3. Quick Start

**Requirements:**

- Node.js 20 or later
- A MongoDB database (MongoDB Atlas free tier works)
- A Cloudinary account (free tier works)
- A Resend account for email delivery

```bash
# 1. Install dependencies
cd server
npm install

# 2. Create your environment file
cp .env.example .env
# Edit .env with your real credentials (see Section 10)

# 3. Start the development server
npm run dev
# Server runs at http://localhost:5000
```

**Minimum required variables before first run:**

```
MONGO_URI
JWT_SECRET
REFRESH_TOKEN_SECRET
GOOGLE_CLIENT_ID
RESEND_API_KEY
CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
CLOUDINARY_BASE_URL
ALLOWED_UPLOAD_MIME_TYPES
```

---

## 4. Tech Stack

| Category         | What's Used                                 |
| ---------------- | ------------------------------------------- |
| Language         | TypeScript                                  |
| Runtime          | Node.js                                     |
| HTTP Framework   | Express 4                                   |
| Database         | MongoDB via Mongoose                        |
| Real-time        | Socket.IO 4                                 |
| Authentication   | JWT (access) + cryptographic refresh tokens |
| Google OAuth     | google-auth-library                         |
| Email            | Resend API                                  |
| File Storage     | Cloudinary                                  |
| Password hashing | bcryptjs                                    |
| Rate limiting    | express-rate-limit                          |
| Security headers | Helmet                                      |
| File uploads     | Multer (memory storage, no disk temp files) |
| Build            | tsc (TypeScript compiler)                   |
| Dev server       | tsx watch (hot reload)                      |
| Testing          | Jest + Supertest + mongodb-memory-server    |

---

## 5. How the Server Is Organized

The `src/` folder is split into self-contained modules. Each module owns its own routes, controller, service, and model files.

```
server/
├── src/
│   ├── server.ts          ← Entry point. Connects DB, starts HTTP + Socket.IO
│   ├── app.ts             ← Express setup: middleware, routes, error handler
│   │
│   ├── config/
│   │   ├── db.ts          ← MongoDB connection
│   │   ├── dotenv.ts      ← Loads .env file
│   │   └── env.ts         ← Parses all env vars, builds CORS + cookie config
│   │
│   ├── middleware/
│   │   ├── auth.ts        ← JWT Bearer token guard (the "protect" middleware)
│   │   ├── asyncHandler.ts← Wraps async route handlers so errors auto-propagate
│   │   ├── error.ts       ← Global error handler
│   │   ├── rateLimiter.ts ← Per-route rate limiters
│   │   └── upload.middleware.ts ← Multer: file type + size validation
│   │
│   ├── modules/
│   │   ├── auth/          ← Register, login, refresh, logout, Google, 2FA, sessions
│   │   ├── otp/           ← OTP send/verify, email via Resend, proof tokens
│   │   ├── user/          ← Profile, search, presence, block/unblock, settings
│   │   ├── conversation/  ← DMs, groups, pin/mute, members, admin roles
│   │   ├── message/       ← Send, fetch, delete, react, reply, forward, search
│   │   ├── call/          ← Call lifecycle, ICE config, call history
│   │   └── upload/        ← Cloudinary upload/delete
│   │
│   ├── socket/
│   │   ├── socket.server.ts   ← Socket.IO init + connection lifecycle
│   │   ├── socket.auth.ts     ← JWT check on WebSocket handshake
│   │   ├── socket.types.ts    ← Typed event maps (all events documented here)
│   │   ├── socket.event.ts    ← join/leave conversation room events
│   │   ├── message.handler.ts ← send, read, sync, delete over socket
│   │   ├── typing.handler.ts  ← typing indicators with auto-timeout
│   │   ├── call.handler.ts    ← call lifecycle + WebRTC signaling relay
│   │   ├── conversation-room.guard.ts ← Auth check before joining a room
│   │   ├── presence.store.ts  ← In-memory userId ↔ socketId map + call state
│   │   └── socket.emitter.ts  ← Helper to send events to a specific user
│   │
│   └── utils/
│       ├── ApiError.ts        ← Custom error class with HTTP status codes
│       ├── token.utils.ts     ← JWT generation, refresh token hashing
│       ├── objectId.ts        ← MongoDB ObjectId validator
│       └── validatePassword.ts← Password strength rules
│
├── dist/              ← Compiled output (after npm run build)
├── docs/              ← Internal design documents
├── jest.config.js
├── tsconfig.json
├── .env.example       ← Copy this to .env and fill in your values
└── package.json
```

---

## 6. Architecture — How a Request Travels

### HTTP Request Flow

```
Browser / Mobile App
        |
        |  HTTP REST  (Authorization: Bearer <token>)
        v
+-----------------------------------------------+
|  Express Server  (port 5000)                  |
|                                               |
|  1. Helmet      → security headers            |
|  2. CORS        → origin check                |
|  3. Body parser → JSON (50 KB max)            |
|  4. Cookies     → parse refresh token         |
|                                               |
|  5. Route match → /api/auth, /api/messages... |
|  6. Rate limiter (where applied)              |
|  7. Auth guard  → verify JWT                  |
|  8. Controller  → validate input              |
|  9. Service     → business logic              |
| 10. MongoDB     → read / write                |
| 11. JSON response → client                   |
+-----------------------------------------------+
```

### WebSocket Connection Flow

```
Browser / Mobile App
        |
        |  WebSocket (socket.io)
        |  auth: { token: "<access_token>" }
        v
+-----------------------------------------------+
|  Socket.IO Server                             |
|                                               |
|  1. JWT check on handshake                    |
|  2. userId stored in socket.data              |
|  3. Added to in-memory presence store         |
|  4. "user_online" broadcast to others         |
|                                               |
|  Handlers registered:                         |
|   - message handler                           |
|   - typing handler                            |
|   - call + WebRTC signaling handler           |
|   - join/leave conversation room              |
+-----------------------------------------------+
```

### How the Server Connects to External Services

```
                        ┌─────────────────┐
                        │  Express Server  │
                        └────────┬────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
              v                  v                  v
       ┌──────────┐      ┌─────────────┐    ┌─────────────┐
       │ MongoDB  │      │  Cloudinary │    │   Resend    │
       │(database)│      │(file store) │    │  (email)    │
       └──────────┘      └─────────────┘    └─────────────┘
                                                    │
                                            ┌───────────────┐
                                            │ Google OAuth  │
                                            │  (id tokens)  │
                                            └───────────────┘
```

---

## 7. How Key Features Work

### Registration (Email + OTP)

The server requires a verified email before creating any account. The flow is:

```
Step 1  →  POST /api/auth/otp/send
           User submits email
           Server sends a 6-digit OTP via Resend
           OTP is bcrypt-hashed before storing in MongoDB

Step 2  →  POST /api/auth/otp/verify
           User submits the OTP code
           If correct → server issues a short-lived "verified token" (JWT, 15 min)

Step 3  →  POST /api/auth/register
           User submits name, email, password, and the verified token
           Server validates the token, then creates the account
           Without the verified token, registration is rejected
```

---

### Login & Token System

```
POST /api/auth/login

      If no 2FA:
      ┌─────────────────────────────────────────────────┐
      │  Access token  →  returned in JSON body         │
      │  Refresh token →  set as HttpOnly cookie        │
      └─────────────────────────────────────────────────┘

      If 2FA is enabled:
      ┌─────────────────────────────────────────────────┐
      │  OTP emailed → user must call /verify-2fa       │
      │  Tokens only issued after OTP is confirmed      │
      └─────────────────────────────────────────────────┘
```

**Access token** — short-lived JWT (default 15 min). Sent in `Authorization: Bearer` header.

**Refresh token** — cryptographically random 128-char hex string. Stored _hashed_ in MongoDB. Sent back as an HttpOnly cookie (inaccessible to JavaScript). Valid for 7 days.

**Rotation** — every time the refresh token is used, it is revoked and a new one is issued. If a revoked token is presented again, the server assumes theft and revokes the _entire session_.

**Session limit** — max 5 active sessions per user. When a 6th session is created, the oldest one is automatically dropped.

---

### Password Reset Flow

```
Step 1  →  POST /api/auth/forgot-password
           OTP is sent to the registered email address

Step 2  →  POST /api/auth/otp/verify
           User verifies OTP → gets a verified token

Step 3  →  POST /api/auth/reset-password
           Submit: email + new password + verified token
           All existing sessions are revoked after reset
```

---

### File Upload Flow

```
Client  →  POST /api/upload
           Content-Type: multipart/form-data
           Field name: "file"

           ↓
     Multer validates:
     - MIME type is in ALLOWED_UPLOAD_MIME_TYPES
     - File size is under MAX_UPLOAD_SIZE_MB

           ↓
     File buffer is streamed to Cloudinary
     (no temp files written to disk)

           ↓
     Server returns:
     {
       url,         ← Cloudinary secure URL
       publicId,    ← used for future deletion
       fileSize,
       mimeType,
       resourceType ← image / video / audio / raw
     }
```

---

### Call Flow (WebRTC via Socket.IO)

The server does **not** handle audio or video streams. It only relays the signaling messages that let two browsers connect directly to each other.

```
Caller                    Server                   Receiver
  |                          |                         |
  |-- call:initiate -------->|                         |
  |                          |-- call:incoming ------->|
  |                          |                         |
  |                          |<-- call:ringing --------|
  |<-- call:ringing ---------|                         |
  |                          |                         |
  |                          |<-- call:accept ---------|
  |<-- call:accepted --------|                         |
  |                          |                         |
  |-- webrtc:offer --------->|                         |
  |                          |-- webrtc:offer -------->|
  |                          |                         |
  |                          |<-- webrtc:answer -------|
  |<-- webrtc:answer --------|                         |
  |                          |                         |
  |<--- ICE candidates exchanged both ways ----------->|
  |                          |                         |
  |    Peer-to-peer media stream established           |
  |    (audio/video flows directly, not via server)    |
  |                          |                         |
  |-- call:end ------------->|                         |
  |                          |-- call:ended ---------->|
  |                          |   (duration logged)     |
```

**Ring timeout** — if the receiver does not answer within 30 seconds, the server marks the call as MISSED.

**Reconnect window** — if a user drops mid-call, the server waits 15 seconds before marking the call as FAILED, giving time to reconnect.

**Call states:**

```
INITIATED → RINGING → ACCEPTED → ONGOING → ENDED
                    ↘ REJECTED
         ↘ CANCELLED  (caller hung up before answer)
         ↘ MISSED     (ring timeout)
         ↘ FAILED     (reconnect timeout)
```

---

### Presence System

Online status is tracked in memory — no database polling.

```
User connects via WebSocket
  ↓
Added to PresenceStore (userId → set of socketIds)
  ↓
"user_online" broadcast to all other connected users
  (skipped if user has showOnlineStatus = false)

User disconnects
  ↓
SocketId removed from PresenceStore
  ↓
If no other sockets remain for this user:
  - "user_offline" broadcast to others
  - lastSeen updated in MongoDB
  - Any active call handled (cancelled or reconnecting)
```

A user with multiple browser tabs open only appears offline when **all** tabs disconnect.

---

### Typing Indicators

```
User A types         →  "typing_start" sent to server
                         Server broadcasts "user_typing" to conversation room
                         Server sets a 3-second auto-timeout

User A stops typing  →  "typing_stop" sent to server
  OR timeout fires      Server broadcasts "user_stopped_typing"
```

Typing is tracked per socket, so multiple tabs do not interfere with each other.

---

## 8. API Routes

All routes are prefixed with `/api`. Routes marked **Protected** require `Authorization: Bearer <access_token>`.

### Auth `/api/auth`

| Method | Path                   | Protected | Description                                  |
| ------ | ---------------------- | --------- | -------------------------------------------- |
| POST   | `/otp/send`            | No        | Send OTP to email                            |
| POST   | `/otp/verify`          | No        | Verify OTP — returns a verified token        |
| POST   | `/register`            | No        | Create account (needs verified token)        |
| POST   | `/login`               | No        | Login with email + password                  |
| POST   | `/verify-2fa`          | No        | Complete 2FA step                            |
| POST   | `/google`              | No        | Login or register with Google                |
| POST   | `/refresh`             | No        | Get new access token using refresh cookie    |
| POST   | `/logout`              | No        | Revoke current session                       |
| POST   | `/logout-all`          | Yes       | Revoke all sessions                          |
| POST   | `/forgot-password`     | No        | Send password reset OTP                      |
| POST   | `/reset-password`      | No        | Set new password (needs verified token)      |
| PATCH  | `/change-password`     | Yes       | Change password (all sessions revoked after) |
| GET    | `/sessions`            | Yes       | List active login sessions                   |
| DELETE | `/sessions`            | Yes       | Revoke all _other_ sessions                  |
| DELETE | `/sessions/:sessionId` | Yes       | Revoke one specific session                  |

### Users `/api/users`

| Method | Path                     | Protected | Description                                  |
| ------ | ------------------------ | --------- | -------------------------------------------- |
| GET    | `/`                      | Yes       | Search users by name or username             |
| GET    | `/me`                    | Yes       | Get own profile                              |
| PATCH  | `/me`                    | Yes       | Update profile (name, bio, username, avatar) |
| DELETE | `/me`                    | Yes       | Delete account                               |
| DELETE | `/me/avatar`             | Yes       | Remove avatar                                |
| PATCH  | `/me/2fa`                | Yes       | Toggle 2FA on/off                            |
| PATCH  | `/me/notification-prefs` | Yes       | Update notification preferences              |
| PATCH  | `/me/privacy-prefs`      | Yes       | Update privacy settings                      |
| GET    | `/presence`              | Yes       | Check online status for a list of user IDs   |
| GET    | `/blocked`               | Yes       | List blocked users                           |
| POST   | `/:id/block`             | Yes       | Block a user                                 |
| DELETE | `/:id/block`             | Yes       | Unblock a user                               |
| GET    | `/:id`                   | Yes       | Get another user's public profile            |

### Conversations `/api/conversations`

| Method | Path                           | Protected | Description                  |
| ------ | ------------------------------ | --------- | ---------------------------- |
| GET    | `/`                            | Yes       | List all conversations       |
| POST   | `/`                            | Yes       | Start a direct message       |
| GET    | `/:id`                         | Yes       | Get one conversation         |
| DELETE | `/:id`                         | Yes       | Delete a direct conversation |
| POST   | `/group`                       | Yes       | Create a group               |
| PATCH  | `/:id/name`                    | Yes       | Rename group                 |
| PATCH  | `/:id/description`             | Yes       | Update group description     |
| PATCH  | `/:id/avatar`                  | Yes       | Update group avatar          |
| DELETE | `/:id/avatar`                  | Yes       | Remove group avatar          |
| POST   | `/:id/members`                 | Yes       | Add members to group         |
| DELETE | `/:id/members`                 | Yes       | Remove members from group    |
| DELETE | `/:id/members/me`              | Yes       | Leave a group                |
| PATCH  | `/:id/members/:userId/promote` | Yes       | Promote member to admin      |
| PATCH  | `/:id/members/:userId/demote`  | Yes       | Demote admin to member       |
| POST   | `/:id/pin`                     | Yes       | Pin conversation to top      |
| DELETE | `/:id/pin`                     | Yes       | Unpin conversation           |
| PATCH  | `/:id/mute`                    | Yes       | Mute conversation            |
| DELETE | `/:id/mute`                    | Yes       | Unmute conversation          |
| POST   | `/:id/pins/:messageId`         | Yes       | Pin a message                |
| DELETE | `/:id/pins/:messageId`         | Yes       | Unpin a message              |
| GET    | `/:id/pins`                    | Yes       | Get all pinned messages      |

### Messages `/api/messages`

| Method | Path                                   | Protected | Description           |
| ------ | -------------------------------------- | --------- | --------------------- |
| POST   | `/`                                    | Yes       | Send a message        |
| GET    | `/conversation/:conversationId`        | Yes       | Fetch message history |
| POST   | `/forward`                             | Yes       | Forward a message     |
| GET    | `/conversation/:conversationId/search` | Yes       | Search messages       |
| POST   | `/:id/reactions`                       | Yes       | Add emoji reaction    |
| DELETE | `/:id/reactions`                       | Yes       | Remove your reaction  |
| DELETE | `/:id`                                 | Yes       | Soft-delete a message |

### Uploads `/api/upload`

| Method | Path | Protected | Description                            |
| ------ | ---- | --------- | -------------------------------------- |
| POST   | `/`  | Yes       | Upload a file — returns Cloudinary URL |

> `multipart/form-data`, field name: `file`

### Calls `/api/webrtc`

| Method | Path            | Protected | Description                                |
| ------ | --------------- | --------- | ------------------------------------------ |
| GET    | `/ice-config`   | Yes       | Get STUN/TURN ICE server config for WebRTC |
| GET    | `/call-history` | Yes       | Get paginated call history                 |

> **Note:** Detailed endpoint-level API docs may move to `docs/api.md` or a Swagger/OpenAPI spec in the future.

---

## 9. Real-Time Events (Socket.IO)

The client connects to Socket.IO with the access token in the handshake:

```js
const socket = io("http://localhost:5000", {
  auth: { token: "<access_token>" },
  withCredentials: true,
});
```

### Events the Client Sends to the Server

| Event                  | What it does                                          |
| ---------------------- | ----------------------------------------------------- |
| `join_conversation`    | Join a room to receive messages for that conversation |
| `leave_conversation`   | Leave a conversation room                             |
| `send_message`         | Send a new message                                    |
| `messages_delivered`   | Tell server these messages were delivered             |
| `messages_read`        | Tell server messages have been read up to a point     |
| `sync_messages`        | Fetch any messages missed while offline               |
| `delete_message`       | Delete a message                                      |
| `typing_start`         | "I am typing in this conversation"                    |
| `typing_stop`          | "I stopped typing"                                    |
| `get_presence`         | "Which of these user IDs are currently online?"       |
| `call:initiate`        | Start a call with another user                        |
| `call:ringing`         | Confirm the receiver's phone is ringing               |
| `call:accept`          | Accept an incoming call                               |
| `call:reject`          | Decline an incoming call                              |
| `call:end`             | End or cancel a call                                  |
| `webrtc:offer`         | Send SDP offer to the other party                     |
| `webrtc:answer`        | Send SDP answer to the other party                    |
| `webrtc:ice-candidate` | Send an ICE candidate                                 |
| `webrtc:restart-ice`   | Request ICE restart (after network change)            |

### Events the Server Sends to the Client

| Event                       | What it means                                                   |
| --------------------------- | --------------------------------------------------------------- |
| `receive_message`           | A new message arrived                                           |
| `message_deleted`           | A message was deleted                                           |
| `messages_delivered_update` | Someone received your messages                                  |
| `messages_read_update`      | Someone read your messages                                      |
| `user_typing`               | Someone is typing in a conversation                             |
| `user_stopped_typing`       | They stopped typing                                             |
| `user_online`               | A contact came online                                           |
| `user_offline`              | A contact went offline                                          |
| `group_created`             | A new group you are part of was created                         |
| `group_members_added`       | Members were added to a group                                   |
| `group_members_removed`     | Members were removed                                            |
| `group_renamed`             | Group name changed                                              |
| `group_member_left`         | Someone left the group                                          |
| `group_avatar_updated`      | Group avatar changed                                            |
| `group_avatar_deleted`      | Group avatar removed                                            |
| `member_promoted`           | Someone became an admin                                         |
| `member_demoted`            | An admin was demoted                                            |
| `message_pinned`            | A message was pinned                                            |
| `message_unpinned`          | A message was unpinned                                          |
| `message_reaction_added`    | Someone reacted to a message                                    |
| `message_reaction_removed`  | A reaction was removed                                          |
| `call:incoming`             | Someone is calling you                                          |
| `call:ringing`              | The other person's phone is ringing                             |
| `call:accepted`             | Your call was accepted                                          |
| `call:rejected`             | Your call was declined                                          |
| `call:ended`                | Call ended (with reason: ended / cancelled / missed / rejected) |
| `call:reconnecting`         | Participant dropped, trying to reconnect                        |
| `call:failed`               | Reconnect timed out, call is over                               |
| `webrtc:offer`              | Incoming SDP offer                                              |
| `webrtc:answer`             | Incoming SDP answer                                             |
| `webrtc:ice-candidate`      | Incoming ICE candidate                                          |
| `webrtc:restart-ice`        | Other side requested ICE restart                                |
| `conversation_access_error` | You tried to join a room you don't have access to               |

---

## 11. Security & Validation

### How Errors Are Returned

Every error response has this shape:

```json
{
  "success": false,
  "message": "Something went wrong",
  "stack": null
}
```

In development, `stack` includes the full error stack trace. In production it is always `null`.

### Rate Limits

Each sensitive endpoint has its own rate limiter. All limiters return HTTP 429 when the limit is hit.

| Endpoint        | Window | Max requests | Key used   |
| --------------- | ------ | ------------ | ---------- |
| Login           | 1 min  | 5            | IP + email |
| Register        | 1 min  | 3            | IP         |
| Token refresh   | 1 min  | 10           | IP         |
| User search     | 1 min  | 30           | IP         |
| OTP send        | 10 min | 3            | IP + email |
| OTP verify      | 1 min  | 5            | IP         |
| Forgot password | 10 min | 3            | IP + email |
| Reset password  | 1 min  | 3            | IP         |
| 2FA verify      | 15 min | 10           | IP         |

Successful logins do not count toward the login limit (`skipSuccessfulRequests: true`).

### Security Measures in the Code

- **Helmet** — adds secure HTTP headers on every response
- **CORS** — only configured origins are allowed; `credentials: true` for cookie support
- **HttpOnly cookies** — refresh tokens are never accessible to JavaScript
- **Refresh token rotation** — every use rotates the token; reuse of an old token triggers full session revocation
- **Password hashing** — bcrypt (default 10 rounds) for user passwords
- **OTP hashing** — bcrypt-hashed before DB storage; never stored plain
- **Token type claim** — access tokens have `type: "access"` — the auth middleware rejects any other JWT type
- **Block relationships** — blocked users cannot message, call, or see each other's presence
- **Privacy settings** — `showOnlineStatus` and `showLastSeen` are respected in all presence events
- **Body size limit** — JSON body capped at 50 KB
- **File type validation** — Multer checks MIME type before the controller runs
- **Proxy trust** — `app.set("trust proxy", 1)` only active in production so rate limiters see real client IPs

---

## 12. Design Decisions

These are the architectural choices made in this codebase and why.

### Socket.IO instead of raw WebSockets

Socket.IO was chosen because it handles automatic reconnection, fallback transports, and room management out of the box. For a chat app where reliability matters, this saves a significant amount of custom code. The trade-off is a slightly heavier client library.

### Refresh token rotation

Every token refresh issues a new token and revokes the old one. If an attacker steals a refresh token and uses it, the legitimate user's next request will fail because the token has already been rotated — and the server detects the reuse and revokes the entire session. This makes token theft much harder to exploit silently.

### Cloudinary instead of local disk storage

Files are streamed from memory directly to Cloudinary. The server never writes files to disk. This means:

- No disk space to manage
- Files survive server restarts and deployments
- CDN delivery built in
- The trade-off is a runtime dependency on Cloudinary's API

### In-memory presence store

User online/offline state is stored in a `Map` inside the Node.js process — not in Redis or the database. This is the right call for a single-server deployment: it is fast, zero-config, and avoids adding another dependency. The trade-off is that **this does not work if you run multiple server instances** — all users must connect to the same process. See Scalability Notes below.

### OTP-gated registration

Users must verify their email with an OTP before an account is created. This prevents throwaway registrations and ensures email addresses are valid from day one.

### Module-based folder structure

Each feature (auth, user, conversation, message, call, upload, OTP) lives in its own folder with its own routes, controller, service, model, and types. This makes it easy to find code and reduces cross-module dependencies.

---

## 13. Scalability Notes

The current architecture is designed for a **single server process**. Before scaling horizontally, these areas need attention:

**Presence store** — currently in-memory (`PresenceStore`). If you run two server instances, a user connected to Server A will be invisible to a user connected to Server B. The fix is to replace the in-memory store with a shared Redis store.

**Socket.IO rooms** — same issue as presence. Socket.IO rooms are per-process. The fix is the `@socket.io/redis-adapter` which synchronizes events across instances.

**Call timeout timers** — `setTimeout` calls in `CallTimeoutManager` run in-process. If the server restarts mid-call, timers are lost. For production resilience, these could be moved to a job queue (Bull, BullMQ) or a scheduled MongoDB check.

**File uploads** — already stateless (Cloudinary). No changes needed here.

**Database** — MongoDB Atlas with a replica set is already in use. Indexing is set up on the most common query patterns (conversation + createdAt, sender + createdAt, etc.).

**What is already production-ready:**

- All business logic is stateless (except presence/timers)
- MongoDB transactions for token rotation
- Rate limiting per IP and per email
- CORS and cookie config is env-driven

---

## 14. Deployment

### Setting Up for Production

```bash
# Build the TypeScript to JavaScript
npm run build

# Start the compiled server
npm start
```

Set these environment variables in production:

```bash
NODE_ENV=production
FRONTEND_ORIGINS=https://yourapp.com
COOKIE_SAME_SITE=none     # if frontend is on a different domain
COOKIE_SECURE=true        # required when COOKIE_SAME_SITE=none
```

### Nginx (Reverse Proxy)

The project has a `nginx/` directory at the root. The `conf.d/` folder is currently empty — place your Nginx config there.

A minimal working config for this server:

```nginx
server {
    listen 443 ssl;
    server_name api.yourapp.com;

    # HTTP API requests
    location /api/ {
        proxy_pass http://localhost:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # Socket.IO — requires WebSocket upgrade headers
    location /socket.io/ {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### MongoDB

Use a MongoDB Atlas replica set. The refresh token rotation uses `session.startTransaction()` which requires a replica set. A single-node Atlas M0 (free tier) is already a replica set, so this works out of the box.

### Cloudinary

No setup needed beyond getting your credentials. Files are uploaded on demand during user actions.

### TURN Server (for Audio/Video Calls)

Calls over a local network or between users on the same ISP will likely work with just STUN (Google's public servers are used by default). But calls across strict NAT or corporate firewalls will fail without a TURN server.

The recommended setup is **coturn** self-hosted on a VPS:

```ini
# coturn config (/etc/turnserver.conf)
use-auth-secret
static-auth-secret=your_coturn_shared_secret   # must match TURN_SECRET in .env
realm=yourdomain.com
```

Then set in `.env`:

```bash
TURN_URL=turn:your.vps.ip:3478
TURN_TLS_URL=turns:your.vps.ip:5349
TURN_SECRET=your_coturn_shared_secret
```

### Logging & Monitoring

The server currently uses `console.log` and `console.error` for all logging. There is no structured logger or monitoring integration in the codebase. For production, consider:

- Replacing `console.*` with a structured logger like **Pino** or **Winston**
- Adding request logging middleware (e.g. `morgan`)
- Shipping logs to a log aggregator (Datadog, Logtail, etc.)
- Adding health check endpoints (the `health` module directory exists but is empty)

---

## 15. Troubleshooting

### Server won't start

**`Error: MONGO_URI is not configured`**

Your `.env` file is missing or `MONGO_URI` is not set. Run:

```bash
cp .env.example .env
# then edit .env with your credentials
```

---

**`Error: JWT_SECRET is not defined`**

Add both `JWT_SECRET` and `REFRESH_TOKEN_SECRET` to your `.env` file.

---

**`Error: FRONTEND_ORIGIN or FRONTEND_ORIGINS must be configured in production`**

You are running with `NODE_ENV=production` but forgot to set the frontend URL. Add:

```bash
FRONTEND_ORIGINS=https://yourapp.com
```

---

**`Resend API key is not configured`**

The server could not send an OTP email. Add `RESEND_API_KEY` to your `.env`.

---

### CORS error in the browser

The frontend URL is not in `FRONTEND_ORIGINS`. Check:

- No trailing slash in the origin
- Correct protocol (`http` vs `https`)
- Exact port match if using a non-standard port

---

### Login works but token refresh fails (cookie not sent)

Your frontend and backend are on different domains. You need:

```bash
COOKIE_SAME_SITE=none
COOKIE_SECURE=true
```

And the frontend must send requests with credentials:

```js
// fetch
fetch(url, { credentials: "include" });

// axios
axios.defaults.withCredentials = true;

// socket.io
io(url, { withCredentials: true });
```

Your backend must be served over HTTPS for `COOKIE_SECURE=true` to work.

---

### OTP emails not arriving

1. Check `RESEND_API_KEY` is valid in your Resend dashboard
2. Check `RESEND_FROM_EMAIL` is a verified sender (for production — sandbox address works for testing)
3. Check spam/junk folder
4. Check rate limit: only 3 OTPs can be sent per 10-minute window per email

---

### Audio/video calls fail between users on different networks

This is a NAT traversal issue. Add a TURN server:

```bash
TURN_URL=turn:your.server:3478
TURN_TLS_URL=turns:your.server:5349
TURN_SECRET=your_shared_secret
```

---

### All users getting rate-limited together (proxy issue)

The rate limiter is seeing the proxy IP instead of real client IPs. Make sure:

```bash
NODE_ENV=production
```

This enables `app.set("trust proxy", 1)` which reads the real IP from the `X-Forwarded-For` header.

---

### TypeScript errors when building

```bash
# Make sure you're on Node.js 20+
node --version

# Fresh install
rm -rf node_modules
npm install

# Build
npm run build
```

---

## 16. Screenshots

> Screenshots have not been added to the repository yet. Below are the placeholders for when they are ready.

To add a screenshot, save it to `docs/screenshots/` and update the path below.

| Screen                        | File                                |
| ----------------------------- | ----------------------------------- |
| Main chat interface           | `docs/screenshots/chat-main.png`    |
| Authentication / login screen | `docs/screenshots/auth.png`         |
| Group conversation            | `docs/screenshots/group-chat.png`   |
| Audio / video call screen     | `docs/screenshots/call-screen.png`  |
| Mobile / responsive view      | `docs/screenshots/mobile.png`       |
| System architecture diagram   | `docs/screenshots/architecture.png` |

---

## 17. Contributing

1. Fork the repo and create a branch from `main`
2. Keep pull requests focused — one feature or fix per PR
3. Run the TypeScript compiler before submitting: `npm run build`
4. Run the linter: `npm run lint`
5. Add or update tests where relevant: `npm test`
6. Write a clear PR description explaining what changed and why

For larger changes, open an issue first to discuss the approach.
