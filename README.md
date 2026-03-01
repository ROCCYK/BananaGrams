# Bananagrams (Realtime Web App)

Multiplayer Bananagrams-style game where players join a room, **SPLIT** to start, drag tiles into a connected crossword layout, use **PEEL / DUMP**, and finish with **BANANAS** + inspection voting. :contentReference[oaicite:1]{index=1}

---

## Tech Stack (What I used)

### Frontend
- **React + Vite** (SPA + fast dev/build pipeline) :contentReference[oaicite:2]{index=2}  
- **Socket.IO Client** for realtime state updates and gameplay events :contentReference[oaicite:3]{index=3}  
- **@dnd-kit** for drag-and-drop interactions (tiles → board / hand) :contentReference[oaicite:4]{index=4}  
- **UI utilities**
  - `clsx` + `tailwind-merge` for composing/merging classNames cleanly :contentReference[oaicite:5]{index=5}  
  - `lucide-react` for icons :contentReference[oaicite:6]{index=6}  

### Backend
- **Node.js + Express** (HTTP + health endpoint) :contentReference[oaicite:7]{index=7}  
- **Socket.IO** server for rooms + game events :contentReference[oaicite:8]{index=8}  
- **CORS** handling for browser access control :contentReference[oaicite:9]{index=9}  

---

## Core Features (What I built)
- Realtime multiplayer rooms (Socket.IO) :contentReference[oaicite:10]{index=10}  
- Drag-and-drop tile board with **grid snapping** :contentReference[oaicite:11]{index=11}  
- Full game loop: **PEEL**, **DUMP**, **BANANAS** :contentReference[oaicite:12]{index=12}  
- Endgame **inspection voting** (“Valid Winner” vs “Rotten Banana”) :contentReference[oaicite:13]{index=13}  
- **Reconnect support**: players can rejoin and restore state :contentReference[oaicite:14]{index=14}  
- Mobile-friendly camera controls: **pan/zoom** + tile-lock toggle :contentReference[oaicite:15]{index=15}  

---

## How it works (Implementation overview)

### 1) Rooms + Realtime events
- Players join a **roomId** and the server maintains in-memory room state (players, pool size, status, inspection state). :contentReference[oaicite:16]{index=16}  
- The server broadcasts “room state updated” events so everyone sees live lobby/game changes. :contentReference[oaicite:17]{index=17}  

### 2) Tile system + board representation
- Each tile is represented by an `id`, `letter`, and board position (`left`, `top`) when placed.
- The board uses a **fixed spacing grid** (snap-to-grid math), so “connected layout” checks are consistent and fast. :contentReference[oaicite:18]{index=18}  

### 3) Drag & drop + snapping behavior (frontend)
- Drag/drop is built with **@dnd-kit**.
- When dropping onto the board:
  - it snaps to the nearest grid cell,
  - prefers snapping adjacent to existing tiles (within a tolerance),
  - avoids placing onto occupied cells,
  - clamps positions to a bounded world so tiles don’t fly infinitely. :contentReference[oaicite:19]{index=19}  

### 4) Keeping players in sync (without spamming)
- The client batches board changes and periodically sends a **board state update** (with a signature check to avoid redundant sends). :contentReference[oaicite:20]{index=20}  
- This gives smooth multiplayer while keeping traffic reasonable.

### 5) Rejoin + resume
- The client generates/stores a persistent **rejoin key** (localStorage) per room+player name.
- On reconnect, the client re-emits join with that key so the server can restore the right player session and state. :contentReference[oaicite:21]{index=21}  

### 6) Game rules enforcement (backend)
- Tile pool is created using the standard Bananagrams letter distribution. :contentReference[oaicite:22]{index=22}  
- The server validates gameplay moments that matter:
  - **PEEL** checks based on board placement validity rules (grid + adjacency expectations),
  - **BANANAS** triggers inspection mode and voting,
  - Majority vote resolves winner vs rotten banana outcome. :contentReference[oaicite:23]{index=23}  

---

## Project Structure
- `frontend/` — React UI (rooms, tiles, board interactions, camera controls) :contentReference[oaicite:24]{index=24}  
- `backend/` — Socket.IO + Express server (rooms, rules, validation, inspection voting) :contentReference[oaicite:25]{index=25}  

---

## Notes
This repository documents the **engineering approach** (architecture + libraries + key mechanics).  
Operational/deployment specifics are intentionally omitted from this README.
