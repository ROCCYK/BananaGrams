# 🍌 BananaGrams (Web App)

A multiplayer **web-based word game** inspired by **Bananagrams**, the fast-paced anagram game where players race to build a connected crossword using all their letters.

This project recreates the core gameplay mechanics of Bananagrams in a browser-based experience, supporting player names, multiplayer logic, and real-time game actions like **SPLIT**, **PEEL**, **DUMP**, and **BANANAS**.

---

## 🎮 Gameplay Overview

BananaGrams is a **real-time, turnless word game**. All players play simultaneously, racing to be the first to use all their letters correctly.

### Game Setup
- All **144 letter tiles** are placed face-down into a central pool called the **BUNCH**
- Each player draws tiles based on player count:
  - **2–4 players** → 21 tiles each
  - **5–6 players** → 15 tiles each
  - **7 players** → 11 tiles each
- Players choose and lock in their names before the game starts

### SPLIT
- Any player may start the game by calling **“SPLIT!”**
- All players flip their tiles face-up and begin forming **their own crossword grid**
- Words:
  - Must connect
  - Can be horizontal or vertical
  - Go left → right or top → bottom
  - May be rearranged freely at any time
- There are **no turns** — everyone plays simultaneously

### PEEL
- When a player successfully uses **all their tiles**, they call **“PEEL!”**
- Every player draws **one additional tile** from the BUNCH and adds it to their grid

### DUMP
- At any time, a player may return **one unwanted tile** to the BUNCH by calling **“DUMP!”**
- In exchange, that player draws **three new tiles**
- This action only affects the player who dumped

### BANANAS (Winning the Game)
- When there are **fewer tiles left in the BUNCH than players**
- The first player with **no remaining letters** calls **“BANANAS!”**
- Other players verify the winner’s grid:
  - All words must be spelled correctly
  - Proper nouns are not allowed
  - A dictionary may be used for verification

#### ❌ Rotten Banana Rule
- If any word is invalid:
  - The player becomes the **“ROTTEN BANANA”**
  - They return all their tiles to the BUNCH
  - The game continues without them

---

## 🚀 Features

- 🌐 Web-based multiplayer gameplay
- 👤 Custom player names with duplicate-name protection
- 🔒 Name locking once the game starts
- ⚡ Real-time actions (SPLIT, PEEL, DUMP, BANANAS)
- 🧩 Individual crossword boards per player
- 🏁 Automatic win condition handling
- 📚 Word validation support (dictionary-based)

---

## 🛠️ Tech Stack

*(Update this section if needed)*

- Frontend: HTML / CSS / JavaScript
- Backend: JavaScript (Node.js or similar)
- Real-time communication: WebSockets / multiplayer state management
- Dictionary validation: Local or online word list

---

## ▶️ Running the App Locally

```bash
git clone https://github.com/ROCCYK/BananaGrams.git
cd BananaGrams
