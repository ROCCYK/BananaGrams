# 🍌 Bananagrams (Realtime Web App)

[![Play Live](https://img.shields.io/badge/Play-Live%20Demo-FADB5F?style=for-the-badge&logo=googlechrome&logoColor=111111)](https://bananagrams-frontend-0n1g.onrender.com)

Multiplayer Bananagrams-style game where players join a room, **SPLIT** to start, drag tiles into a connected crossword layout, use **PEEL / DUMP**, and finish with **BANANAS** + inspection voting.

---

## Tech Stack

### Frontend
- **React + Vite** (SPA + fast dev/build pipeline)
- **Socket.IO Client** for realtime state updates and gameplay events
- **@dnd-kit** for drag-and-drop interactions (tiles → board / hand)
- **UI utilities**
  - `clsx` + `tailwind-merge` for composing/merging classNames
  - `lucide-react` for icons

### Backend
- **Node.js + Express** (HTTP + health endpoint)
- **Socket.IO** server for rooms + game events
- **CORS** handling for browser access control

---

## Features

- Realtime multiplayer rooms (Socket.IO)
- Drag-and-drop tile board with **grid snapping**
- Full game loop: **PEEL**, **DUMP**, **BANANAS**
- Endgame **inspection voting** ("Valid Winner" vs "Rotten Banana")
- **Reconnect support**: players can rejoin and restore board state
- Mobile-friendly camera controls: **pan/zoom** + tile-lock toggle

---

## How It Works

### 1) Rooms + Realtime Events
Players join a **roomId** and the server maintains in-memory room state (players, pool size, status, inspection state). The server broadcasts "room state updated" events so everyone sees live lobby/game changes.

### 2) Tile System + Board Representation
Each tile is represented by an `id`, `letter`, and board position (`left`, `top`) when placed. The board uses a **fixed spacing grid** (snap-to-grid math), so "connected layout" checks are consistent and fast.

### 3) Drag & Drop + Snapping (Frontend)
Built with **@dnd-kit**. When dropping onto the board:
- Snaps to the nearest grid cell
- Prefers snapping adjacent to existing tiles (within a tolerance)
- Avoids placing onto occupied cells
- Clamps positions to a bounded world so tiles don't fly infinitely

### 4) Keeping Players in Sync
The client batches board changes and periodically sends a **board state update** (with a signature check to avoid redundant sends), giving smooth multiplayer while keeping traffic reasonable.

### 5) Rejoin + Resume
The client generates/stores a persistent **rejoin key** (localStorage) per room+player name. On reconnect, the client re-emits join with that key so the server can restore the right player session and state.

### 6) Game Rules Enforcement (Backend)
Tile pool is created using the standard Bananagrams letter distribution. The server validates:
- **PEEL** checks based on board placement validity rules (grid + adjacency)
- **BANANAS** triggers inspection mode and voting
- Majority vote resolves winner vs rotten banana outcome

---

## Project Structure

```
frontend/    React UI (rooms, tiles, board interactions, camera controls)
backend/     Socket.IO + Express server (rooms, rules, validation, inspection voting)
render.yaml  Render blueprint for frontend + backend
```

---

## Run Locally

### 1) Install dependencies
```bash
npm --prefix backend ci
npm --prefix frontend ci
```

### 2) Start backend (port 3001 by default)
```bash
npm --prefix backend run start
```

### 3) Start frontend
```bash
npm --prefix frontend run dev
```

Frontend runs on Vite dev server (usually `http://localhost:5173`), backend on `http://localhost:3001`.

---

## Environment Variables

### Frontend
- `VITE_API_URL` (optional in local dev)
  - Default fallback: `http://localhost:3001`
  - Set this in production to your backend URL.

### Backend
- `PORT` (optional, default `3001`)
- `CORS_ORIGIN`
  - Use `*` for open access, or
  - Comma-separated allowed origins, e.g. `https://your-frontend.onrender.com`

Backend health endpoint: `GET /healthz` → `{ "ok": true }`
