import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
} from '@dnd-kit/core';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';

import { Tile } from './components/Tile';
import { Board } from './components/Board';
import './App.css';

const socket = io('http://localhost:3001');

const getOrCreateRejoinKey = (roomId, playerName) => {
  const roomKey = roomId.trim().toLowerCase();
  const playerKey = playerName.trim().toLowerCase();
  const storageKey = `bananagrams.rejoinKey.${roomKey}.${playerKey}`;
  const existing = window.localStorage.getItem(storageKey);
  if (existing) return existing;

  const nextKey = typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `rejoin-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  window.localStorage.setItem(storageKey, nextKey);
  return nextKey;
};

const TILE_SIZE = 60;
const TILE_SPACING = 65;
const DEAL_COLUMNS = 7;
const GRID_SNAP_RADIUS = 26;
const NEIGHBOR_SNAP_TOLERANCE = 28;
const ALIGNMENT_TOLERANCE = 22;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const getBoardDimensions = () => {
  const board = document.querySelector('.board-container');
  if (board) {
    const rect = board.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  return { width: window.innerWidth, height: window.innerHeight };
};

const getCenteredDealPositions = (count) => {
  const { width, height } = getBoardDimensions();
  const columns = Math.max(1, Math.min(DEAL_COLUMNS, count));
  const rows = Math.ceil(count / columns);
  const layoutWidth = (columns - 1) * TILE_SPACING + TILE_SIZE;
  const layoutHeight = (rows - 1) * TILE_SPACING + TILE_SIZE;
  const startLeft = Math.max(0, (width - layoutWidth) / 2);
  const startTop = Math.max(0, (height - layoutHeight) / 2);

  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;
    return {
      left: Math.round(startLeft + col * TILE_SPACING),
      top: Math.round(startTop + row * TILE_SPACING)
    };
  });
};

const getOpenSpawnPositions = (existingTiles, count) => {
  const occupied = new Set(
    Object.values(existingTiles).map((tile) => `${Math.round(tile.left)},${Math.round(tile.top)}`)
  );
  const positions = [];
  const centerLeft = Math.round((window.innerWidth / 2) / TILE_SPACING) * TILE_SPACING;
  const centerTop = Math.round((window.innerHeight / 2) / TILE_SPACING) * TILE_SPACING;
  const maxRadius = 20;

  for (let radius = 0; radius <= maxRadius && positions.length < count; radius += 1) {
    for (let dy = -radius; dy <= radius && positions.length < count; dy += 1) {
      for (let dx = -radius; dx <= radius && positions.length < count; dx += 1) {
        const onEdge = radius === 0 || Math.abs(dx) === radius || Math.abs(dy) === radius;
        if (!onEdge) continue;

        const left = centerLeft + dx * TILE_SPACING;
        const top = centerTop + dy * TILE_SPACING;
        const key = `${left},${top}`;
        if (occupied.has(key)) continue;

        occupied.add(key);
        positions.push({ left, top });
      }
    }
  }

  while (positions.length < count) {
    positions.push({
      left: centerLeft + positions.length * TILE_SPACING,
      top: centerTop
    });
  }

  return positions;
};

const buildInspectionGrid = (boardTiles) => {
  if (!Array.isArray(boardTiles) || boardTiles.length === 0) {
    return { cols: 0, cells: [] };
  }

  const normalized = boardTiles.map((tile) => ({
    col: Math.round(tile.left / TILE_SPACING),
    row: Math.round(tile.top / TILE_SPACING),
    letter: tile.letter
  }));

  const minCol = Math.min(...normalized.map((tile) => tile.col));
  const maxCol = Math.max(...normalized.map((tile) => tile.col));
  const minRow = Math.min(...normalized.map((tile) => tile.row));
  const maxRow = Math.max(...normalized.map((tile) => tile.row));
  const cols = maxCol - minCol + 1;
  const rows = maxRow - minRow + 1;
  const cells = Array.from({ length: cols * rows }, () => '');

  normalized.forEach((tile) => {
    const col = tile.col - minCol;
    const row = tile.row - minRow;
    const index = row * cols + col;
    if (index >= 0 && index < cells.length) {
      cells[index] = tile.letter || '';
    }
  });

  return { cols, cells };
};

const snapToGrid = (value) => Math.round(value / TILE_SPACING) * TILE_SPACING;

const buildSnappedBoardTiles = (tilesMap, includeLetters = false) =>
  Object.values(tilesMap).map((tile) => {
    const snapped = {
      left: snapToGrid(tile.left),
      top: snapToGrid(tile.top)
    };

    if (!includeLetters) return snapped;
    return { ...snapped, letter: tile.letter };
  });

function App() {
  const [roomId, setRoomId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [inLobby, setInLobby] = useState(true);
  const [roomState, setRoomState] = useState({
    status: 'waiting',
    players: {},
    poolSize: 0,
    inspectingPlayer: null,
    inspectingBoardTiles: [],
    inspectingJudges: [],
    inspectionVotes: {}
  });
  const [tiles, setTiles] = useState({});
  const [activeId, setActiveId] = useState(null);
  const [pendingDumpTileId, setPendingDumpTileId] = useState(null);
  const pendingDumpTileIdRef = useRef(null);
  const [gameOver, setGameOver] = useState(null);

  useEffect(() => {
    socket.on('room_state_updated', (state) => {
      setRoomState(state);
    });

    socket.on('game_started', ({ hand }) => {
      const initialTiles = {};
      const positions = getCenteredDealPositions(hand.length);

      hand.forEach((letter, index) => {
        const id = `tile-${Date.now()}-${index}`;
        initialTiles[id] = {
          id,
          letter,
          left: positions[index].left,
          top: positions[index].top,
          placed: false,
          revealed: false
        };
      });

      setTiles(initialTiles);
      setActiveId(null);
      setPendingDumpTileId(null);
      setGameOver(null);
    });

    socket.on('peel_received', ({ tile }) => {
      const id = `tile-${Date.now()}`;
      setTiles((prev) => ({
        ...prev,
        [id]: {
          id,
          letter: tile,
          ...getOpenSpawnPositions(prev, 1)[0],
          placed: false,
          revealed: true
        }
      }));
    });

    socket.on('dump_received', ({ tiles: newTiles, clientTileId, dumpedLetter }) => {
      setTiles((prev) => {
        const next = { ...prev };
        let removedTile = false;
        const preferredTileId = clientTileId || pendingDumpTileIdRef.current;

        if (preferredTileId && next[preferredTileId]) {
          delete next[preferredTileId];
          removedTile = true;
        }

        if (!removedTile && dumpedLetter) {
          const fallbackId = Object.keys(next).find((tileId) => next[tileId]?.letter === dumpedLetter);
          if (fallbackId) {
            delete next[fallbackId];
          }
        }

        const spawnPositions = getOpenSpawnPositions(next, newTiles.length);
        const mappedTiles = {};
        newTiles.forEach((letter, index) => {
          const id = `tile-${Date.now()}-${index}`;
          mappedTiles[id] = {
            id,
            letter,
            left: spawnPositions[index].left,
            top: spawnPositions[index].top,
            placed: false,
            revealed: true
          };
        });

        return { ...next, ...mappedTiles };
      });
      setPendingDumpTileId(null);
      pendingDumpTileIdRef.current = null;
      setActiveId(null);
    });

    socket.on('game_over', ({ message }) => {
      setGameOver(message);
    });

    socket.on('rotten_banana_declared', ({ rottenId, rottenName }) => {
      if (rottenId === socket.id) {
        setTiles({});
        alert('You are the Rotten Banana! Your tiles have been returned to the bunch.');
      } else {
        alert(`${rottenName} was a Rotten Banana! Game resumes!`);
      }
    });

    socket.on('error', (err) => {
      const message = String(err?.message || '').toLowerCase();
      const isDumpError =
        message.includes('dump') ||
        message.includes('currently in your hand');

      if (isDumpError) {
        setPendingDumpTileId(null);
        pendingDumpTileIdRef.current = null;
      }
      alert(err.message);
    });

    return () => {
      socket.off('room_state_updated');
      socket.off('game_started');
      socket.off('peel_received');
      socket.off('dump_received');
      socket.off('game_over');
      socket.off('rotten_banana_declared');
      socket.off('error');
    };
  }, []);

  const handleJoin = (e) => {
    e.preventDefault();
    const trimmedRoomId = roomId.trim();
    const trimmedPlayerName = playerName.trim();
    if (trimmedRoomId && trimmedPlayerName) {
      if (!socket.connected) {
        socket.connect();
      }
      const rejoinKey = getOrCreateRejoinKey(trimmedRoomId, trimmedPlayerName);
      socket.emit('join_room', { roomId: trimmedRoomId, playerName: trimmedPlayerName, rejoinKey });
      setInLobby(false);
    }
  };

  const handleStartGame = () => {
    socket.emit('start_game', { roomId });
  };

  const handlePeel = () => {
    const hiddenTiles = Object.values(tiles).filter((tile) => !tile.revealed).length;
    if (hiddenTiles > 0) {
      alert('Flip all your tiles before calling PEEL!');
      return;
    }

    const boardTiles = buildSnappedBoardTiles(tiles);
    socket.emit('peel', { roomId, boardTiles });
  };

  const handleDump = () => {
    if (!activeId) {
      alert('Select a tile to dump first!');
      return;
    }
    if (pendingDumpTileId) {
      return;
    }

    const letter = tiles[activeId]?.letter;
    if (!letter) return;

    setPendingDumpTileId(activeId);
    pendingDumpTileIdRef.current = activeId;
    socket.emit('dump', { roomId, letter, clientTileId: activeId });
  };

  const handleBananas = () => {
    const boardTiles = buildSnappedBoardTiles(tiles, true);
    socket.emit('bananas', { roomId, boardTiles });
  };

  const handleInspectionVote = (vote) => {
    socket.emit('inspection_vote', { roomId, vote });
  };

  const resetToLobbyState = () => {
    setTiles({});
    setActiveId(null);
    setPendingDumpTileId(null);
    pendingDumpTileIdRef.current = null;
    setGameOver(null);
    setRoomState({
      status: 'waiting',
      players: {},
      poolSize: 0,
      inspectingPlayer: null,
      inspectingBoardTiles: [],
      inspectingJudges: [],
      inspectionVotes: {}
    });
    setInLobby(true);
  };

  const handleExitGame = () => {
    socket.disconnect();
    resetToLobbyState();
  };

  const handleReturnToLobby = () => {
    socket.emit('leave_room', { roomId });
    setRoomId('');
    resetToLobbyState();
  };

  const handleRevealTile = (tileId) => {
    setTiles((prev) => {
      const tile = prev[tileId];
      if (!tile || tile.revealed) return prev;

      return {
        ...prev,
        [tileId]: {
          ...tile,
          revealed: true
        }
      };
    });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  const handleDragStart = (event) => {
    setActiveId(event.active.id);
  };

  const handleDragEnd = (event) => {
    const { active, delta } = event;

    setTiles((prev) => {
      const tile = prev[active.id];
      if (!tile) return prev;

      const baseLeft = tile.left + delta.x;
      const baseTop = tile.top + delta.y;
      const maxLeft = window.innerWidth - TILE_SIZE;
      const maxTop = window.innerHeight - TILE_SIZE;
      const others = Object.values(prev).filter((t) => t.id !== active.id);

      const isOccupied = (left, top) => others.some((other) => other.left === left && other.top === top);

      const candidateSnaps = [];
      const gridLeft = Math.round(baseLeft / TILE_SPACING) * TILE_SPACING;
      const gridTop = Math.round(baseTop / TILE_SPACING) * TILE_SPACING;
      const gridDistance = Math.hypot(baseLeft - gridLeft, baseTop - gridTop);
      if (gridDistance <= GRID_SNAP_RADIUS) {
        candidateSnaps.push({ left: gridLeft, top: gridTop, distance: gridDistance });
      }

      others.forEach((other) => {
        const neighborTargets = [
          { left: other.left + TILE_SPACING, top: other.top, aligned: Math.abs(baseTop - other.top) <= ALIGNMENT_TOLERANCE },
          { left: other.left - TILE_SPACING, top: other.top, aligned: Math.abs(baseTop - other.top) <= ALIGNMENT_TOLERANCE },
          { left: other.left, top: other.top + TILE_SPACING, aligned: Math.abs(baseLeft - other.left) <= ALIGNMENT_TOLERANCE },
          { left: other.left, top: other.top - TILE_SPACING, aligned: Math.abs(baseLeft - other.left) <= ALIGNMENT_TOLERANCE },
        ];

        neighborTargets.forEach((target) => {
          const distance = Math.hypot(baseLeft - target.left, baseTop - target.top);
          if (target.aligned && distance <= NEIGHBOR_SNAP_TOLERANCE) {
            candidateSnaps.push({ left: target.left, top: target.top, distance });
          }
        });
      });

      candidateSnaps.sort((a, b) => a.distance - b.distance);
      const bestSnap = candidateSnaps.find((candidate) => !isOccupied(candidate.left, candidate.top));
      const nextLeft = bestSnap ? bestSnap.left : baseLeft;
      const nextTop = bestSnap ? bestSnap.top : baseTop;

      return {
        ...prev,
        [active.id]: {
          ...tile,
          left: clamp(nextLeft, 0, maxLeft),
          top: clamp(nextTop, 0, maxTop),
          placed: true,
        }
      };
    });
  };

  if (inLobby) {
    return (
      <div className="lobby">
        <h1>Bananagrams</h1>
        <form onSubmit={handleJoin} className="lobby-form glass-panel">
          <input
            placeholder="Your Name"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            required
          />
          <input
            placeholder="Room ID"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            required
          />
          <button type="submit">Join Room</button>
        </form>
      </div>
    );
  }

  const myPlayer = roomState.players[socket.id] || {};
  const isPlaying = roomState.status === 'playing';
  const isInspecting = roomState.status === 'inspecting';
  const isInspectingPlayer = roomState.inspectingPlayer === socket.id;
  const isJudge = (roomState.inspectingJudges || []).includes(socket.id);
  const hasVoted = Boolean(roomState.inspectionVotes?.[socket.id]);
  const allTilesRevealed = Object.values(tiles).every((tile) => tile.revealed);
  const playerEntries = Object.values(roomState.players || {})
    .sort((a, b) => a.name.localeCompare(b.name));
  const voteEntries = Object.entries(roomState.inspectionVotes || {}).map(([playerId, vote]) => ({
    playerId,
    playerName: roomState.players[playerId]?.name || 'Unknown',
    vote
  }));
  const inspectionGrid = buildInspectionGrid(roomState.inspectingBoardTiles || []);

  return (
    <div className="app-container">
      <header className="game-header">
        <div className="header-stats">
          <span>Room: {roomId}</span>
          <span className="pool-count">Pool: {roomState.poolSize}</span>
          <span>My Hand: {myPlayer.handSize || 0}</span>
        </div>

        <div className="game-controls">
          {!isPlaying && !isInspecting && roomState.poolSize === 0 ? (
            <button onClick={handleStartGame}>Start Game</button>
          ) : null}

          {isPlaying && !myPlayer.isOut && (
            <>
              <button className="btn-peel" onClick={handlePeel} disabled={!allTilesRevealed}>
                PEEL!
              </button>
              {activeId ? (
                <button className="btn-dump" onClick={handleDump} disabled={Boolean(pendingDumpTileId)}>
                  Dump Selected
                </button>
              ) : null}
              <button
                onClick={handleBananas}
                style={{ backgroundColor: '#ffdd00', color: 'black' }}
              >
                BANANAS!
              </button>
            </>
          )}
        </div>
      </header>

      <section className="player-roster">
        {playerEntries.map((player) => (
          <div key={player.id} className="player-chip">
            <span>{player.name}</span>
            <span className={`connection-badge ${player.connected === false ? 'reconnecting' : 'connected'}`}>
              {player.connected === false ? 'Reconnecting' : 'Connected'}
            </span>
          </div>
        ))}
      </section>

      {myPlayer.isOut ? (
        <div style={{ padding: '10px', background: 'rgba(255,50,50,0.8)', color: 'white', fontWeight: 'bold' }}>
          You are a Rotten Banana! Waiting for the game to finish...
        </div>
      ) : null}

      <DndContext
        sensors={sensors}
        modifiers={[restrictToWindowEdges]}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <Board>
          {Object.values(tiles).map((tile) => (
            <Tile
              key={tile.id}
              id={tile.id}
              letter={tile.letter}
              left={tile.left}
              top={tile.top}
              revealed={Boolean(tile.revealed)}
              onReveal={handleRevealTile}
            />
          ))}
        </Board>

        <DragOverlay>
          {activeId && tiles[activeId] ? (
            <div className={`tile dragging ${tiles[activeId].revealed ? '' : 'facedown'}`}>
              {tiles[activeId].revealed ? tiles[activeId].letter : ''}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {isInspecting && !gameOver ? (
        <div className="overlay">
          <h2>Inspecting {roomState.players[roomState.inspectingPlayer]?.name}'s board</h2>

          {inspectionGrid.cols > 0 ? (
            <div className="inspection-board-wrap">
              <div
                className="inspection-board-grid"
                style={{ gridTemplateColumns: `repeat(${inspectionGrid.cols}, 42px)` }}
              >
                {inspectionGrid.cells.map((letter, index) => (
                  <div key={index} className={`inspection-cell ${letter ? 'filled' : ''}`}>
                    {letter}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p>No board tiles submitted for inspection.</p>
          )}

          <div className="vote-results">
            <h3>Votes</h3>
            {voteEntries.length > 0 ? (
              <ul>
                {voteEntries.map((entry) => (
                  <li key={entry.playerId}>
                    {entry.playerName}: {entry.vote === 'valid' ? 'Valid Winner' : 'Rotten Banana'}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No votes yet.</p>
            )}
          </div>

          {isInspectingPlayer ? (
            <p>The judges are voting now. You cannot vote on your own board.</p>
          ) : null}

          {!isInspectingPlayer && isJudge ? (
            hasVoted ? (
              <p>You voted: {roomState.inspectionVotes[socket.id] === 'valid' ? 'Valid Winner' : 'Rotten Banana'}</p>
            ) : (
              <div style={{ display: 'flex', gap: '20px', marginTop: '20px' }}>
                <button onClick={() => handleInspectionVote('valid')} style={{ backgroundColor: '#4CAF50' }}>
                  Valid Winner
                </button>
                <button onClick={() => handleInspectionVote('rotten')} style={{ backgroundColor: '#f44336', color: 'white' }}>
                  Rotten Banana
                </button>
              </div>
            )
          ) : null}

          {!isInspectingPlayer && !isJudge ? (
            <p>You are not a judge for this inspection.</p>
          ) : null}
        </div>
      ) : null}

      {gameOver ? (
        <div className="overlay">
          <h1>{gameOver}</h1>
          <div className="game-over-actions">
            <button onClick={handleExitGame}>Exit Game</button>
            <button onClick={handleReturnToLobby}>Return to Lobby</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
