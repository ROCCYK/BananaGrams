# 🍌 Bananagrams (Realtime Web App)

Multiplayer Bananagrams-style game built with:
- React + Vite (frontend)
- Node.js + Socket.IO (backend)

Players join a room, start a game, drag tiles into connected layouts, use `PEEL` / `DUMP`, and finish with `BANANAS` + inspection voting.

## Features
- Realtime multiplayer rooms (Socket.IO)
- Drag-and-drop tile board with grid snapping
- `PEEL`, `DUMP`, and `BANANAS` game flow
- Inspection voting (`Valid Winner` vs `Rotten Banana`)
- Reconnect support (players can rejoin and resume board state)
- Mobile-focused UI improvements
- Camera controls on board:
  - pan/zoom controls
  - tile lock toggle for safe camera movement

## Project Structure
- `frontend/` React app (Vite)
- `backend/` Socket.IO server
- `render.yaml` Render blueprint for frontend + backend

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

## Environment Variables

### Frontend
- `VITE_API_URL` (optional in local dev)
  - Default fallback: `http://localhost:3001`
  - Set this in production to your backend URL.

### Backend
- `PORT` (optional, default `3001`)
- `CORS_ORIGIN`
  - Use `*` for open access, or
  - Comma-separated allowed origins, e.g.:
    - `https://your-frontend.onrender.com,https://your-preview.onrender.com`

Backend health endpoint:
- `GET /healthz` → `{ "ok": true }`

## Deploy on Render

You need two services:
1. Backend: **Web Service** (Node)
2. Frontend: **Static Site**

### Backend service settings
- Root Directory: `backend`
- Build Command: `npm ci`
- Start Command: `npm run start`
- Environment:
  - `NODE_ENV=production`
  - `CORS_ORIGIN=https://<your-frontend>.onrender.com`

### Frontend service settings
- Root Directory: `frontend`
- Build Command: `npm ci && npm run build`
- Publish Directory: `dist`
- Environment:
  - `VITE_API_URL=https://<your-backend>.onrender.com`

### Important
- Vite env vars are build-time. After changing `VITE_API_URL`, redeploy frontend.
- If UI appears unstyled, your static site build/publish settings are wrong (usually not publishing `dist`).

## Troubleshooting

### Start Game does nothing
Usually frontend is not connected to backend:
- Verify frontend `VITE_API_URL`
- Verify backend `CORS_ORIGIN` includes exact frontend URL
- Check backend logs for socket connections

### App loads without styling
- Ensure frontend is deployed as **Static Site**
- Build command: `npm ci && npm run build`
- Publish directory: `dist`

### Rejoin doesn’t restore board
- Confirm backend and frontend are both updated to latest deploy
- Ensure socket reconnect succeeds (no CORS/origin mismatch)

## Scripts

### Backend
```bash
npm --prefix backend run start
```

### Frontend
```bash
npm --prefix frontend run dev
npm --prefix frontend run build
npm --prefix frontend run lint
```
