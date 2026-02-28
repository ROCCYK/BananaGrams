const express = require('express');
const { Server } = require('socket.io');
const http = require('http');
const cors = require('cors');

const app = express();
const allowedOrigins = (process.env.CORS_ORIGIN || '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin: allowedOrigins.includes('*') ? true : allowedOrigins,
  methods: ['GET', 'POST']
}));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins.includes('*') ? true : allowedOrigins,
    methods: ['GET', 'POST']
  }
});

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true });
});

// A=13 B=3 C=3 D=6 E=18 F=3 G=4 H=3 I=12 J=2 K=2 L=5 M=3 N=8 O=11 P=3 Q=2 R=9 S=6 T=9 U=6 V=3 W=3 X=2 Y=3 Z=2
const INITIAL_POOL = [
  ...Array(13).fill('A'), ...Array(3).fill('B'), ...Array(3).fill('C'), ...Array(6).fill('D'),
  ...Array(18).fill('E'), ...Array(3).fill('F'), ...Array(4).fill('G'), ...Array(3).fill('H'),
  ...Array(12).fill('I'), ...Array(2).fill('J'), ...Array(2).fill('K'), ...Array(5).fill('L'),
  ...Array(3).fill('M'), ...Array(8).fill('N'), ...Array(11).fill('O'), ...Array(3).fill('P'),
  ...Array(2).fill('Q'), ...Array(9).fill('R'), ...Array(6).fill('S'), ...Array(9).fill('T'),
  ...Array(6).fill('U'), ...Array(3).fill('V'), ...Array(3).fill('W'), ...Array(2).fill('X'),
  ...Array(3).fill('Y'), ...Array(2).fill('Z')
];

const TILE_SPACING = 65;
const SNAP_TOLERANCE = 28;
const REJOIN_GRACE_MS = 2 * 60 * 1000;
const disconnectTimers = new Map();

function shuffleArray(array) {
  const newArr = [...array];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
}

function allTilesHaveAtLeastOneNeighbor(boardTiles) {
  if (!Array.isArray(boardTiles) || boardTiles.length <= 0) {
    return false;
  }

  const rawCoords = [];
  for (const tile of boardTiles) {
    if (!tile || typeof tile.left !== 'number' || typeof tile.top !== 'number') {
      return false;
    }
    rawCoords.push({ left: tile.left, top: tile.top });
  }

  // Use a relative grid anchor so different viewport-centered boards remain valid.
  const anchor = rawCoords[0];
  const coords = [];
  const occupied = new Set();

  for (const tile of rawCoords) {
    const colFloat = (tile.left - anchor.left) / TILE_SPACING;
    const rowFloat = (tile.top - anchor.top) / TILE_SPACING;
    const col = Math.round(colFloat);
    const row = Math.round(rowFloat);

    const snappedLeft = anchor.left + col * TILE_SPACING;
    const snappedTop = anchor.top + row * TILE_SPACING;
    if (
      Math.abs(tile.left - snappedLeft) > SNAP_TOLERANCE ||
      Math.abs(tile.top - snappedTop) > SNAP_TOLERANCE
    ) {
      return false;
    }

    const key = `${col},${row}`;
    if (occupied.has(key)) {
      return false;
    }

    occupied.add(key);
    coords.push({ col, row, key });
  }

  const neighborsByKey = new Map();
  coords.forEach(({ key }) => neighborsByKey.set(key, []));

  coords.forEach(({ col, row, key }) => {
    const candidates = [
      `${col + 1},${row}`,
      `${col - 1},${row}`,
      `${col},${row + 1}`,
      `${col},${row - 1}`
    ];

    candidates.forEach((candidate) => {
      if (occupied.has(candidate)) {
        neighborsByKey.get(key).push(candidate);
      }
    });
  });

  return coords.every(({ key }) => neighborsByKey.get(key).length > 0);
}

const rooms = {};

function getRoomState(room) {
  const publicPlayers = {};
  Object.entries(room.players).forEach(([playerId, player]) => {
    publicPlayers[playerId] = {
      id: player.id,
      name: player.name,
      handSize: player.handSize,
      isOut: player.isOut,
      connected: player.connected !== false
    };
  });

  return {
    players: publicPlayers,
    status: room.status,
    poolSize: room.pool.length,
    inspectingPlayer: room.inspectingPlayer || null,
    inspectingBoardTiles: room.inspectingBoardTiles || [],
    inspectingJudges: room.inspectingJudges || [],
    inspectionVotes: room.inspectionVotes || {}
  };
}

function sanitizePlayerTiles(tiles) {
  if (!Array.isArray(tiles)) return [];

  return tiles
    .filter((tile) =>
      tile &&
      typeof tile.id === 'string' &&
      typeof tile.letter === 'string' &&
      tile.letter.length === 1 &&
      typeof tile.revealed === 'boolean' &&
      typeof tile.placed === 'boolean' &&
      (
        tile.placed === false ||
        (typeof tile.left === 'number' && typeof tile.top === 'number')
      )
    )
    .slice(0, 300)
    .map((tile) => ({
      id: tile.id,
      letter: tile.letter.toUpperCase(),
      revealed: tile.revealed,
      placed: tile.placed,
      left: tile.placed ? tile.left : 0,
      top: tile.placed ? tile.top : 0,
      order: typeof tile.order === 'number' ? tile.order : 0
    }));
}

function clearInspectionState(room) {
  room.inspectingPlayer = null;
  room.inspectingBoardTiles = [];
  room.inspectingJudges = [];
  room.inspectionVotes = {};
}

function getTimerKey(roomId, rejoinKey) {
  return `${roomId}:${rejoinKey}`;
}

function clearDisconnectTimer(roomId, rejoinKey) {
  if (!roomId || !rejoinKey) return;
  const key = getTimerKey(roomId, rejoinKey);
  const existing = disconnectTimers.get(key);
  if (existing) {
    clearTimeout(existing);
    disconnectTimers.delete(key);
  }
}

function concludeInspectionAsWinner(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const winnerId = room.inspectingPlayer;
  const winnerName = room.players[winnerId]?.name || 'Unknown';
  const votes = room.inspectionVotes || {};

  room.status = 'waiting';
  clearInspectionState(room);

  io.to(roomId).emit('room_state_updated', getRoomState(room));
  io.to(roomId).emit('game_over', {
    winnerId,
    winnerName,
    votes,
    message: `${winnerName} is the true WINNER!`
  });
}

function concludeInspectionAsRotten(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const rottenId = room.inspectingPlayer;
  if (!rottenId || !room.players[rottenId]) return;

  const returnedTiles = (room.inspectingBoardTiles || [])
    .map((tile) => tile.letter)
    .filter(Boolean);

  room.pool.push(...returnedTiles);
  room.pool = shuffleArray(room.pool);
  room.players[rottenId].isOut = true;
  room.players[rottenId].hand = [];
  room.players[rottenId].handSize = 0;
  room.status = 'playing';

  const rottenName = room.players[rottenId].name;
  clearInspectionState(room);

  io.to(roomId).emit('rotten_banana_declared', {
    rottenId,
    rottenName
  });
  io.to(roomId).emit('room_state_updated', getRoomState(room));
}

function maybeResolveInspection(roomId) {
  const room = rooms[roomId];
  if (!room || room.status !== 'inspecting') return;

  const judgesCount = (room.inspectingJudges || []).length;
  if (judgesCount === 0) {
    concludeInspectionAsWinner(roomId);
    return;
  }

  const votes = Object.values(room.inspectionVotes || {});
  const validVotes = votes.filter((vote) => vote === 'valid').length;
  const rottenVotes = votes.filter((vote) => vote === 'rotten').length;
  const majorityNeeded = Math.floor(judgesCount / 2) + 1;
  const remainingVotes = judgesCount - votes.length;

  if (validVotes >= majorityNeeded) {
    concludeInspectionAsWinner(roomId);
    return;
  }

  if (rottenVotes >= majorityNeeded || validVotes + remainingVotes < majorityNeeded) {
    concludeInspectionAsRotten(roomId);
  }
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  const removePlayerFromRoom = (roomId, playerId) => {
    const room = rooms[roomId];
    if (!room || !room.players[playerId]) return;
    const player = room.players[playerId];
    clearDisconnectTimer(roomId, player.rejoinKey);

    if (room.status === 'inspecting') {
      if (room.inspectingPlayer === playerId) {
        clearInspectionState(room);
        room.status = 'playing';
      } else {
        room.inspectingJudges = (room.inspectingJudges || []).filter((id) => id !== playerId);
        if (room.inspectionVotes[playerId]) {
          delete room.inspectionVotes[playerId];
        }
        maybeResolveInspection(roomId);
      }
    }

    delete room.players[playerId];

    if (Object.keys(room.players).length === 0) {
      delete rooms[roomId];
    } else {
      io.to(roomId).emit('room_state_updated', getRoomState(room));
    }
  };

  const scheduleDisconnectRemoval = (roomId, playerId) => {
    const room = rooms[roomId];
    if (!room || !room.players[playerId]) return;

    const player = room.players[playerId];
    player.connected = false;
    player.disconnectedAt = Date.now();

    if (!player.rejoinKey) {
      removePlayerFromRoom(roomId, playerId);
      return;
    }

    clearDisconnectTimer(roomId, player.rejoinKey);
    const key = getTimerKey(roomId, player.rejoinKey);

    const timeout = setTimeout(() => {
      const latestRoom = rooms[roomId];
      if (!latestRoom) {
        disconnectTimers.delete(key);
        return;
      }

      const latestEntry = Object.entries(latestRoom.players).find(([, p]) => p.rejoinKey === player.rejoinKey);
      if (!latestEntry) {
        disconnectTimers.delete(key);
        return;
      }

      const [latestPlayerId, latestPlayer] = latestEntry;
      if (latestPlayer.connected === false) {
        removePlayerFromRoom(roomId, latestPlayerId);
      } else {
        disconnectTimers.delete(key);
      }
    }, REJOIN_GRACE_MS);

    disconnectTimers.set(key, timeout);
    io.to(roomId).emit('room_state_updated', getRoomState(room));
  };

  socket.on('join_room', ({ roomId, playerName, rejoinKey }) => {
    if (!roomId) return;
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        status: 'waiting',
        pool: [],
        players: {},
        inspectingPlayer: null,
        inspectingBoardTiles: [],
        inspectingJudges: [],
        inspectionVotes: {}
      };
    }

    const room = rooms[roomId];
    const normalizedRejoinKey = typeof rejoinKey === 'string' && rejoinKey.trim()
      ? rejoinKey.trim()
      : null;
    const existingPlayerEntry = normalizedRejoinKey
      ? Object.entries(room.players).find(([, player]) => player.rejoinKey === normalizedRejoinKey)
      : null;

    if (existingPlayerEntry) {
      const [previousId, previousPlayer] = existingPlayerEntry;
      if (previousPlayer.connected !== false && previousId !== socket.id) {
        socket.emit('error', { message: 'That player is already connected. Close the old tab or use a different name.' });
        return;
      }

      clearDisconnectTimer(roomId, previousPlayer.rejoinKey);

      room.players[socket.id] = {
        ...previousPlayer,
        id: socket.id,
        name: playerName || previousPlayer.name,
        connected: true,
        disconnectedAt: null
      };
      if (previousId !== socket.id) {
        delete room.players[previousId];
      }

      if (room.inspectingPlayer === previousId) {
        room.inspectingPlayer = socket.id;
      }

      room.inspectingJudges = (room.inspectingJudges || []).map((judgeId) =>
        judgeId === previousId ? socket.id : judgeId
      );

      if (room.inspectionVotes[previousId]) {
        room.inspectionVotes[socket.id] = room.inspectionVotes[previousId];
        delete room.inspectionVotes[previousId];
      }

      io.to(roomId).emit('room_state_updated', getRoomState(room));
      const restoredTiles = room.players[socket.id].tiles || [];
      const restoredHand = room.players[socket.id].hand || [];
      io.to(socket.id).emit('game_started', {
        hand: [...restoredHand],
        tiles: restoredTiles,
        resumed: true
      });
      console.log(`${room.players[socket.id].name} rejoined room ${roomId}`);
      return;
    }

    room.players[socket.id] = {
      id: socket.id,
      name: playerName || `Player ${Object.keys(room.players).length + 1}`,
      rejoinKey: normalizedRejoinKey,
      hand: [],
      tiles: [],
      handSize: 0,
      isOut: false,
      connected: true,
      disconnectedAt: null
    };

    io.to(roomId).emit('room_state_updated', getRoomState(room));
    console.log(`${playerName || socket.id} joined room ${roomId}`);
  });

  socket.on('start_game', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.status === 'playing') return;

    room.status = 'playing';
    room.pool = shuffleArray(INITIAL_POOL);
    clearInspectionState(room);

    const players = Object.values(room.players);

    let initialTiles = 21;
    if (players.length >= 7) initialTiles = 11;
    else if (players.length >= 5) initialTiles = 15;

    players.forEach((player) => {
      room.players[player.id].isOut = false;
      room.players[player.id].connected = room.players[player.id].connected !== false;
      room.players[player.id].tiles = [];
      const hand = room.pool.splice(0, initialTiles);
      room.players[player.id].hand = hand;
      room.players[player.id].handSize = hand.length;
      if (room.players[player.id].connected !== false) {
        io.to(player.id).emit('game_started', { hand });
      }
    });

    io.to(roomId).emit('room_state_updated', getRoomState(room));
    console.log(`Game started in room ${roomId}`);
  });

  socket.on('peel', ({ roomId, boardTiles }) => {
    const room = rooms[roomId];
    if (!room || room.status !== 'playing') return;
    const peeler = room.players[socket.id];
    if (!peeler || peeler.isOut) return;

    if (!Array.isArray(boardTiles) || boardTiles.length !== peeler.handSize) {
      socket.emit('error', { message: `Board tile count (${Array.isArray(boardTiles) ? boardTiles.length : 0}) must match hand size (${peeler.handSize}).` });
      return;
    }

    if (!allTilesHaveAtLeastOneNeighbor(boardTiles)) {
      socket.emit('error', { message: 'You can only peel when every tile has at least one orthogonal connection.' });
      return;
    }

    const activePlayers = Object.values(room.players).filter((player) => !player.isOut);
    if (room.pool.length < activePlayers.length) {
      socket.emit('error', { message: 'Not enough tiles left in the pool for a full peel. Call BANANAS.' });
      return;
    }

    activePlayers.forEach((player) => {
      const tile = room.pool.pop();
      room.players[player.id].hand.push(tile);
      room.players[player.id].handSize = room.players[player.id].hand.length;
      if (room.players[player.id].connected !== false) {
        io.to(player.id).emit('peel_received', { tile });
      }
    });

    io.to(roomId).emit('room_state_updated', getRoomState(room));
    console.log(`PEEL in room ${roomId}. Pool size: ${room.pool.length}`);
  });

  socket.on('dump', ({ roomId, letter, clientTileId }) => {
    const room = rooms[roomId];
    if (!room || room.status !== 'playing') return;
    const player = room.players[socket.id];
    if (!player || player.isOut) return;

    if (room.pool.length >= 3) {
      const normalizedLetter = typeof letter === 'string' ? letter.toUpperCase() : '';
      const dumpedIndex = player.hand.indexOf(normalizedLetter);
      if (dumpedIndex === -1) {
        socket.emit('error', { message: 'You can only dump a tile currently in your hand.' });
        return;
      }

      player.hand.splice(dumpedIndex, 1);
      room.pool.push(normalizedLetter);
      room.pool = shuffleArray(room.pool);

      const newTiles = room.pool.splice(0, 3);
      player.hand.push(...newTiles);
      player.handSize = player.hand.length;
      io.to(socket.id).emit('dump_received', {
        tiles: newTiles,
        dumpedLetter: normalizedLetter,
        clientTileId: typeof clientTileId === 'string' ? clientTileId : null
      });

      io.to(roomId).emit('room_state_updated', getRoomState(room));
      console.log(`${socket.id} dumped ${letter} in room ${roomId}`);
    } else {
      socket.emit('error', { message: 'Not enough tiles left to dump!' });
    }
  });

  socket.on('bananas', ({ roomId, boardTiles }) => {
    const room = rooms[roomId];
    if (!room || room.status !== 'playing') return;
    if (room.players[socket.id]?.isOut) return;
    const candidate = room.players[socket.id];

    const activePlayersCount = Object.values(room.players).filter((player) => !player.isOut).length;
    if (room.pool.length >= activePlayersCount) {
      socket.emit('error', { message: 'Not enough tiles have been peeled to call Bananas!' });
      return;
    }

    if (!Array.isArray(boardTiles) || boardTiles.length !== candidate.handSize) {
      socket.emit('error', { message: 'Your submitted board does not match your hand size.' });
      return;
    }

    const sanitizedBoard = [];
    for (const tile of boardTiles) {
      if (
        !tile ||
        typeof tile.left !== 'number' ||
        typeof tile.top !== 'number' ||
        typeof tile.letter !== 'string' ||
        tile.letter.length !== 1
      ) {
        socket.emit('error', { message: 'Invalid board data for inspection.' });
        return;
      }

      sanitizedBoard.push({
        left: tile.left,
        top: tile.top,
        letter: tile.letter.toUpperCase()
      });
    }

    room.status = 'inspecting';
    room.inspectingPlayer = socket.id;
    room.inspectingBoardTiles = sanitizedBoard;
    room.inspectingJudges = Object.values(room.players)
      .filter((player) => !player.isOut && player.id !== socket.id && player.connected !== false)
      .map((player) => player.id);
    room.inspectionVotes = {};

    io.to(roomId).emit('room_state_updated', getRoomState(room));
    maybeResolveInspection(roomId);
    console.log(`${socket.id} called BANANAS in room ${roomId}. Entering inspection.`);
  });

  socket.on('inspection_vote', ({ roomId, vote }) => {
    const room = rooms[roomId];
    if (!room || room.status !== 'inspecting') return;
    if (!['valid', 'rotten'].includes(vote)) return;

    if (socket.id === room.inspectingPlayer) {
      socket.emit('error', { message: 'Potential winner cannot vote on their own board.' });
      return;
    }

    if (!(room.inspectingJudges || []).includes(socket.id)) {
      socket.emit('error', { message: 'You are not a judge for this inspection.' });
      return;
    }

    if (room.inspectionVotes[socket.id]) {
      socket.emit('error', { message: 'You already voted for this inspection.' });
      return;
    }

    room.inspectionVotes[socket.id] = vote;
    io.to(roomId).emit('room_state_updated', getRoomState(room));
    maybeResolveInspection(roomId);
  });

  socket.on('board_state_update', ({ roomId, tiles }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players[socket.id];
    if (!player) return;

    const sanitized = sanitizePlayerTiles(tiles);
    if (player.handSize > 0 && sanitized.length !== player.handSize) return;

    player.tiles = sanitized;
  });

  socket.on('leave_room', ({ roomId }) => {
    if (!roomId) return;
    socket.leave(roomId);
    removePlayerFromRoom(roomId, socket.id);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    for (const roomId in rooms) {
      if (rooms[roomId].players[socket.id]) {
        scheduleDisconnectRemoval(roomId, socket.id);
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Socket.io Server running on port ${PORT}`);
});
