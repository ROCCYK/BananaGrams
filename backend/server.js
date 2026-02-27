const express = require('express');
const { Server } = require('socket.io');
const http = require('http');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
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
const SNAP_TOLERANCE = 16;

function shuffleArray(array) {
  const newArr = [...array];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
}

function allTilesHaveAtLeastOneNeighbor(boardTiles, expectedCount) {
  if (!Array.isArray(boardTiles) || boardTiles.length !== expectedCount || expectedCount <= 0) {
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
  return {
    players: room.players,
    status: room.status,
    poolSize: room.pool.length,
    inspectingPlayer: room.inspectingPlayer || null,
    inspectingBoardTiles: room.inspectingBoardTiles || [],
    inspectingJudges: room.inspectingJudges || [],
    inspectionVotes: room.inspectionVotes || {}
  };
}

function clearInspectionState(room) {
  room.inspectingPlayer = null;
  room.inspectingBoardTiles = [];
  room.inspectingJudges = [];
  room.inspectionVotes = {};
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

  socket.on('join_room', ({ roomId, playerName }) => {
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

    rooms[roomId].players[socket.id] = {
      id: socket.id,
      name: playerName || `Player ${Object.keys(rooms[roomId].players).length + 1}`,
      handSize: 0,
      isOut: false
    };

    io.to(roomId).emit('room_state_updated', getRoomState(rooms[roomId]));
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
      const hand = room.pool.splice(0, initialTiles);
      room.players[player.id].handSize = hand.length;
      io.to(player.id).emit('game_started', { hand });
    });

    io.to(roomId).emit('room_state_updated', getRoomState(room));
    console.log(`Game started in room ${roomId}`);
  });

  socket.on('peel', ({ roomId, boardTiles }) => {
    const room = rooms[roomId];
    if (!room || room.status !== 'playing') return;
    const peeler = room.players[socket.id];
    if (!peeler || peeler.isOut) return;

    if (!allTilesHaveAtLeastOneNeighbor(boardTiles, peeler.handSize)) {
      socket.emit('error', { message: 'You can only peel when every tile has at least one connection.' });
      return;
    }

    const activePlayers = Object.values(room.players).filter((player) => !player.isOut);
    if (room.pool.length < activePlayers.length) {
      socket.emit('error', { message: 'Not enough tiles left in the pool for a full peel. Call BANANAS.' });
      return;
    }

    activePlayers.forEach((player) => {
      const tile = room.pool.pop();
      room.players[player.id].handSize += 1;
      io.to(player.id).emit('peel_received', { tile });
    });

    io.to(roomId).emit('room_state_updated', getRoomState(room));
    console.log(`PEEL in room ${roomId}. Pool size: ${room.pool.length}`);
  });

  socket.on('dump', ({ roomId, letter }) => {
    const room = rooms[roomId];
    if (!room || room.status !== 'playing') return;
    if (room.players[socket.id]?.isOut) return;

    if (room.pool.length >= 3) {
      room.pool.push(letter);
      room.pool = shuffleArray(room.pool);

      const newTiles = room.pool.splice(0, 3);
      room.players[socket.id].handSize += 2;
      io.to(socket.id).emit('dump_received', { tiles: newTiles });

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
      .filter((player) => !player.isOut && player.id !== socket.id)
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

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    for (const roomId in rooms) {
      const room = rooms[roomId];
      if (!room.players[socket.id]) continue;

      if (room.status === 'inspecting') {
        if (room.inspectingPlayer === socket.id) {
          clearInspectionState(room);
          room.status = 'playing';
        } else {
          room.inspectingJudges = (room.inspectingJudges || []).filter((id) => id !== socket.id);
          if (room.inspectionVotes[socket.id]) {
            delete room.inspectionVotes[socket.id];
          }
          maybeResolveInspection(roomId);
        }
      }

      delete room.players[socket.id];

      if (Object.keys(room.players).length === 0) {
        delete rooms[roomId];
      } else {
        io.to(roomId).emit('room_state_updated', getRoomState(room));
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Socket.io Server running on port ${PORT}`);
});
