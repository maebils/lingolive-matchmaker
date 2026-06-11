const express = require("express");
const http = require("http");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ["websocket", "polling"]
});

const WAITING_TTL_MS = 30000;
const CLEANUP_INTERVAL_MS = 10000;

const waitingQueues = {
  TEXT: [],
  VIDEO: []
};

const socketState = new Map();

app.get("/", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "LingoLive Matchmaker",
    status: "running",
    uptime: process.uptime(),
    waiting: {
      TEXT: waitingQueues.TEXT.length,
      VIDEO: waitingQueues.VIDEO.length
    }
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    timestamp: Date.now()
  });
});

function normalizeMode(mode) {
  return mode === "VIDEO" ? "VIDEO" : "TEXT";
}

function cleanUserId(userId, socketId) {
  return typeof userId === "string" && userId.trim()
    ? userId.trim()
    : socketId;
}

function cleanLanguage(language) {
  return typeof language === "string" && language.trim()
    ? language.trim()
    : "English";
}

function buildRoomId(userA, userB, mode) {
  const sorted = [userA, userB].sort();
  const hash = crypto
    .createHash("sha256")
    .update(`${sorted[0]}_${sorted[1]}_${mode}_${Date.now()}_${Math.random()}`)
    .digest("hex")
    .slice(0, 12);

  return `room_${mode}_${hash}`;
}

function removeSocketFromQueues(socketId) {
  ["TEXT", "VIDEO"].forEach(mode => {
    waitingQueues[mode] = waitingQueues[mode].filter(
      item => item.socket.id !== socketId
    );
  });
}

function removeUserFromQueues(userId) {
  if (!userId) return;

  ["TEXT", "VIDEO"].forEach(mode => {
    waitingQueues[mode] = waitingQueues[mode].filter(
      item => item.userId !== userId
    );
  });
}

function cleanupExpiredUsers() {
  const now = Date.now();

  ["TEXT", "VIDEO"].forEach(mode => {
    waitingQueues[mode] = waitingQueues[mode].filter(item => {
      const alive =
        item &&
        item.socket &&
        item.socket.connected &&
        now - item.createdAt <= WAITING_TTL_MS;

      if (!alive && item && item.socket && item.socket.connected) {
        item.socket.emit("matchTimeout", {
          message: "Search expired. Please try again.",
          timestamp: Date.now()
        });
      }

      return alive;
    });
  });
}

function findPartner(mode, userId) {
  cleanupExpiredUsers();

  const queue = waitingQueues[mode];

  while (queue.length > 0) {
    const candidate = queue.shift();

    if (
      candidate &&
      candidate.socket &&
      candidate.socket.connected &&
      candidate.userId !== userId
    ) {
      return candidate;
    }
  }

  return null;
}

function addWaitingUser(socket, userId, matchMode, targetLanguage) {
  removeSocketFromQueues(socket.id);
  removeUserFromQueues(userId);

  waitingQueues[matchMode].push({
    socket,
    userId,
    matchMode,
    targetLanguage,
    createdAt: Date.now()
  });

  socketState.set(socket.id, {
    userId,
    matchMode,
    status: "waiting"
  });

  socket.emit("waiting", {
    mode: matchMode,
    message: "Waiting for partner...",
    timestamp: Date.now()
  });

  console.log(`WAITING user=${userId}, mode=${matchMode}, queue=${waitingQueues[matchMode].length}`);
}

function emitMatch(socketA, userA, socketB, userB, mode, targetLanguage) {
  const roomId = buildRoomId(userA, userB, mode);
  const timestamp = Date.now();

  socketA.join(roomId);
  socketB.join(roomId);

  socketState.set(socketA.id, {
    userId: userA,
    matchMode: mode,
    status: "matched",
    roomId,
    partnerId: userB
  });

  socketState.set(socketB.id, {
    userId: userB,
    matchMode: mode,
    status: "matched",
    roomId,
    partnerId: userA
  });

  socketA.emit("matchFound", {
    roomId,
    partnerId: userB,
    matchMode: mode,
    targetLanguage,
    token: "",
    timestamp
  });

  socketB.emit("matchFound", {
    roomId,
    partnerId: userA,
    matchMode: mode,
    targetLanguage,
    token: "",
    timestamp
  });

  console.log(`MATCH FOUND ${userA} ↔ ${userB}, mode=${mode}, room=${roomId}`);
}

io.on("connection", socket => {
  console.log("User connected:", socket.id);

  socket.emit("connected", {
    socketId: socket.id,
    timestamp: Date.now()
  });

  socket.on("findMatch", (data = {}) => {
    try {
      const userId = cleanUserId(data.userId, socket.id);
      const matchMode = normalizeMode(data.matchMode);
      const targetLanguage = cleanLanguage(data.targetLanguage);

      console.log(`Finding match user=${userId}, mode=${matchMode}`);

      removeSocketFromQueues(socket.id);
      removeUserFromQueues(userId);

      const partner = findPartner(matchMode, userId);

      if (partner) {
        emitMatch(
          socket,
          userId,
          partner.socket,
          partner.userId,
          matchMode,
          targetLanguage
        );
      } else {
        addWaitingUser(socket, userId, matchMode, targetLanguage);
      }
    } catch (err) {
      console.error("Match error:", err);
      socket.emit("matchError", {
        message: "Could not start matchmaking",
        timestamp: Date.now()
      });
    }
  });

  socket.on("cancelSearch", (data = {}) => {
    const userId = cleanUserId(data.userId, socket.id);

    removeSocketFromQueues(socket.id);
    removeUserFromQueues(userId);

    socket.emit("searchCancelled", {
      ok: true,
      timestamp: Date.now()
    });

    console.log(`Search cancelled user=${userId}`);
  });

  socket.on("callEnded", data => {
    if (data && data.roomId) {
      socket.to(data.roomId).emit("partnerEndedCall", {
        roomId: data.roomId,
        timestamp: Date.now()
      });
    }
  });

  socket.on("reportAndBlockUser", data => {
    console.log("Report received:", data);

    socket.emit("reportReceived", {
      ok: true,
      timestamp: Date.now()
    });
  });

  socket.on("disconnect", reason => {
    console.log("User disconnected:", socket.id, reason);

    removeSocketFromQueues(socket.id);

    const state = socketState.get(socket.id);

    if (state && state.roomId) {
      socket.to(state.roomId).emit("partnerDisconnected", {
        roomId: state.roomId,
        partnerId: state.userId,
        reason,
        timestamp: Date.now()
      });
    }

    socketState.delete(socket.id);
  });
});

setInterval(cleanupExpiredUsers, CLEANUP_INTERVAL_MS);

server.listen(PORT, () => {
  console.log(`LingoLive Matchmaker running on port ${PORT}`);
});
