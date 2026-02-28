import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  useDroppable,
} from '@dnd-kit/core';

import { Tile } from './components/Tile';
import { Board } from './components/Board';
import './App.css';

const SOCKET_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const socket = io(SOCKET_URL, {
  transports: ['websocket', 'polling']
});

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
const GRID_SNAP_RADIUS = 26;
const NEIGHBOR_SNAP_TOLERANCE = 28;
const ALIGNMENT_TOLERANCE = 22;
const WORLD_LIMIT = 5000;
const MOBILE_DEFAULT_SCALE = 0.5;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const getBoardDimensions = () => {
  const board = document.querySelector('.board-container');
  if (board) {
    const rect = board.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  return { width: window.innerWidth, height: window.innerHeight };
};

const isMobileViewport = () =>
  window.matchMedia('(max-width: 900px)').matches ||
  window.matchMedia('(pointer: coarse)').matches;

const getDefaultCamera = () => {
  if (!isMobileViewport()) {
    return { x: 0, y: 0, scale: 1 };
  }

  const { width, height } = getBoardDimensions();
  const centerOffsetX = (width * (1 - MOBILE_DEFAULT_SCALE)) / 2;
  const centerOffsetY = (height * (1 - MOBILE_DEFAULT_SCALE)) / 2;

  return { x: centerOffsetX, y: centerOffsetY, scale: MOBILE_DEFAULT_SCALE };
};

const getCameraCenteredOnTiles = (tilesMap) => {
  const tilesList = Object.values(tilesMap || {}).filter((tile) => tile.placed);
  if (!tilesList.length) return getDefaultCamera();

  const { width, height } = getBoardDimensions();
  const scale = isMobileViewport() ? MOBILE_DEFAULT_SCALE : 1;

  const minLeft = Math.min(...tilesList.map((tile) => tile.left));
  const minTop = Math.min(...tilesList.map((tile) => tile.top));
  const maxRight = Math.max(...tilesList.map((tile) => tile.left + TILE_SIZE));
  const maxBottom = Math.max(...tilesList.map((tile) => tile.top + TILE_SIZE));

  const tilesCenterX = (minLeft + maxRight) / 2;
  const tilesCenterY = (minTop + maxBottom) / 2;

  return {
    x: (width / 2) - (tilesCenterX * scale),
    y: (height / 2) - (tilesCenterY * scale),
    scale
  };
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
  Object.values(tilesMap).filter((tile) => tile.placed).map((tile) => {
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
  const [camera, setCamera] = useState(() => getDefaultCamera());
  const [panMode, setPanMode] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [pendingDumpTileId, setPendingDumpTileId] = useState(null);
  const pendingDumpTileIdRef = useRef(null);
  const boardSyncTimerRef = useRef(null);
  const [gameOver, setGameOver] = useState(null);
  const {
    isOver: isHandDropOver,
    setNodeRef: setHandDropRef,
  } = useDroppable({
    id: 'hand-droppable',
  });

  useEffect(() => {
    if (panMode) {
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';
    } else {
      document.body.style.userSelect = '';
      document.body.style.webkitUserSelect = '';
    }

    return () => {
      document.body.style.userSelect = '';
      document.body.style.webkitUserSelect = '';
    };
  }, [panMode]);

  useEffect(() => {
    socket.on('room_state_updated', (state) => {
      setRoomState(state);
    });

    socket.on('game_started', ({ hand, tiles: restoredTiles, resumed }) => {
      const initialTiles = {};

      const canRestoreTiles =
        resumed &&
        Array.isArray(restoredTiles) &&
        (
          restoredTiles.length === hand.length ||
          (hand.length === 0 && restoredTiles.length > 0)
        );

      if (canRestoreTiles) {
        restoredTiles.forEach((tile, index) => {
          const id = typeof tile.id === 'string' ? tile.id : `tile-restored-${Date.now()}-${index}`;
          initialTiles[id] = {
            id,
            letter: tile.letter,
            left: typeof tile.left === 'number' ? tile.left : 0,
            top: typeof tile.top === 'number' ? tile.top : 0,
            placed: Boolean(tile.placed),
            revealed: Boolean(tile.revealed),
            order: typeof tile.order === 'number' ? tile.order : index,
          };
        });
      } else {
        hand.forEach((letter, index) => {
          const id = `tile-${Date.now()}-${index}`;
          initialTiles[id] = {
            id,
            letter,
            placed: false,
            revealed: false,
            order: index,
          };
        });
      }

      setTiles(initialTiles);
      setCamera(resumed ? getCameraCenteredOnTiles(initialTiles) : getDefaultCamera());
      setActiveId(null);
      setPendingDumpTileId(null);
      setGameOver(null);
    });

    socket.on('peel_received', ({ tile }) => {
      const id = `tile-${Date.now()}`;
      const order = Date.now();
      setTiles((prev) => ({
        ...prev,
        [id]: {
          id,
          letter: tile,
          placed: false,
          revealed: true,
          isNew: true,
          order,
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

        const mappedTiles = {};
        newTiles.forEach((letter, index) => {
          const id = `tile-${Date.now()}-${index}`;
          mappedTiles[id] = {
            id,
            letter,
            placed: false,
            revealed: true,
            isNew: true,
            order: Date.now() + index,
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
        setTiles((prev) => {
          const next = {};
          Object.values(prev)
            .filter((tile) => tile.placed)
            .forEach((tile) => {
              next[tile.id] = {
                ...tile,
                revealed: true
              };
            });
          return next;
        });
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

  useEffect(() => {
    if (inLobby || !roomId || !socket.connected) return;

    if (boardSyncTimerRef.current) {
      clearTimeout(boardSyncTimerRef.current);
    }

    boardSyncTimerRef.current = setTimeout(() => {
      const playerTiles = Object.values(tiles)
        .map((tile) => ({
        id: tile.id,
        letter: tile.letter,
        left: typeof tile.left === 'number' ? tile.left : 0,
        top: typeof tile.top === 'number' ? tile.top : 0,
        placed: Boolean(tile.placed),
        revealed: Boolean(tile.revealed),
        order: typeof tile.order === 'number' ? tile.order : 0
        }));

      socket.emit('board_state_update', { roomId, tiles: playerTiles });
    }, 120);

    return () => {
      if (boardSyncTimerRef.current) {
        clearTimeout(boardSyncTimerRef.current);
        boardSyncTimerRef.current = null;
      }
    };
  }, [tiles, roomId, inLobby]);

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
    const { active, delta, over } = event;
    const droppedOverId = over?.id;

    setTiles((prev) => {
      const tile = prev[active.id];
      if (!tile) return prev;

      if (droppedOverId === 'hand-droppable') {
        return {
          ...prev,
          [active.id]: {
            ...tile,
            placed: false,
            isNew: false,
            order: tile.order ?? Date.now(),
          }
        };
      }

      if (droppedOverId !== 'board-droppable') {
        return prev;
      }

      let baseLeft;
      let baseTop;

      if (tile.placed) {
        const adjustedDeltaX = delta.x / camera.scale;
        const adjustedDeltaY = delta.y / camera.scale;
        baseLeft = tile.left + adjustedDeltaX;
        baseTop = tile.top + adjustedDeltaY;
      } else {
        const board = document.querySelector('.board-container');
        const translatedRect = active.rect.current.translated || active.rect.current.initial;
        if (!board || !translatedRect) return prev;
        const boardRect = board.getBoundingClientRect();
        const dropCenterX = translatedRect.left + (translatedRect.width / 2);
        const dropCenterY = translatedRect.top + (translatedRect.height / 2);
        baseLeft = ((dropCenterX - boardRect.left - camera.x) / camera.scale) - (TILE_SIZE / 2);
        baseTop = ((dropCenterY - boardRect.top - camera.y) / camera.scale) - (TILE_SIZE / 2);
      }

      const others = Object.values(prev).filter((t) => t.id !== active.id && t.placed);

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
          left: clamp(nextLeft, -WORLD_LIMIT, WORLD_LIMIT),
          top: clamp(nextTop, -WORLD_LIMIT, WORLD_LIMIT),
          placed: true,
          isNew: false,
          order: tile.order ?? Date.now(),
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
  const boardTiles = Object.values(tiles).filter((tile) => tile.placed);
  const handTiles = Object.values(tiles)
    .filter((tile) => !tile.placed)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const playerEntries = Object.values(roomState.players || {})
    .sort((a, b) => a.name.localeCompare(b.name));
  const voteEntries = Object.entries(roomState.inspectionVotes || {}).map(([playerId, vote]) => ({
    playerId,
    playerName: roomState.players[playerId]?.name || 'Unknown',
    vote
  }));
  const inspectionGrid = buildInspectionGrid(roomState.inspectingBoardTiles || []);
  const showPregameRules = !isPlaying && !isInspecting && roomState.poolSize === 0;

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
              <button className="btn-bananas" onClick={handleBananas}>
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

      {showPregameRules ? (
        <section className="pregame-rules" aria-label="How To Play">
          <h2>How To Play</h2>
          <p>Place all 144 tiles face down in the center of the table. These tiles are called the BUNCH.</p>
          <p>Everyone then takes tiles from the bunch and puts them in front of them, face-down. The number of tiles depends on player count:</p>
          <ul>
            <li>2-4 people: 21 letters each</li>
            <li>5-6 people: 15 letters each</li>
            <li>7 people: 11 letters each</li>
          </ul>
          <p>Once everyone is ready, any player can start by saying "SPLIT!". Everyone flips tiles face up and builds their own connected crossword grid.</p>
          <p>Words can be horizontal or vertical (left-to-right or top-to-bottom). Rearranging is allowed. There are no turns, everyone plays at the same time.</p>
          <p>When you use all your letters, call "PEEL!". Every active player takes one tile from the bunch.</p>
          <p>If you have a troublesome letter, call "DUMP!" to return it to the bunch and take 3 new letters. This affects only you.</p>
          <p>When the bunch has fewer tiles than active players, the first player with no letters calls "BANANAS!".</p>
          <p>Other players inspect the board. If words are valid, that player wins. If not, that player is a "ROTTEN BANANA", returns all tiles to the bunch, and the game continues.</p>
        </section>
      ) : null}

      {myPlayer.isOut ? (
        <div style={{ padding: '10px', background: 'rgba(255,50,50,0.8)', color: 'white', fontWeight: 'bold' }}>
          You are a Rotten Banana! Waiting for the game to finish...
        </div>
      ) : null}

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="play-area">
          <Board
            camera={camera}
            setCamera={setCamera}
            panMode={panMode}
            setPanMode={setPanMode}
            defaultCamera={getDefaultCamera()}
          >
            {boardTiles.map((tile) => (
              <Tile
                key={tile.id}
                id={tile.id}
                letter={tile.letter}
                left={tile.left}
                top={tile.top}
                revealed={Boolean(tile.revealed)}
                isNew={Boolean(tile.isNew)}
                onReveal={handleRevealTile}
                dragDisabled={panMode}
                selected={activeId === tile.id}
                onSelect={setActiveId}
              />
            ))}
          </Board>

          <section
            ref={setHandDropRef}
            className={`hand-tray ${isHandDropOver ? 'drop-over' : ''}`}
            aria-label="Player hand"
          >
            <div className="hand-tray-header">Hand</div>
            <div className="hand-tray-tiles">
              {handTiles.map((tile) => (
                <Tile
                  key={tile.id}
                  id={tile.id}
                  letter={tile.letter}
                  revealed={Boolean(tile.revealed)}
                  isNew={Boolean(tile.isNew)}
                  onReveal={handleRevealTile}
                  dragDisabled={panMode}
                  inHand
                  selected={activeId === tile.id}
                  onSelect={setActiveId}
                />
              ))}
            </div>
          </section>
        </div>

        <DragOverlay>
          {activeId && tiles[activeId] ? (
            <div
              className={`tile dragging overlay-tile ${tiles[activeId].revealed ? '' : 'facedown'}`}
              style={{
                transform: `scale(${tiles[activeId].placed ? camera.scale : 1})`,
                transformOrigin: 'top left'
              }}
            >
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
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
