const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Simple health check
app.get("/", (req, res) => {
  res.send("Lingolive Matchmaker is running 🚀");
});

// Store waiting user
let waitingUser = null;

io.on("connection", (socket) => {
  console.log("✅ User connected:", socket.id);

  // =========================
  // FIND MATCH
  // =========================
  socket.on("findMatch", (data) => {
    try {
      console.log("📩 FIND MATCH DATA:", data);

      const userId = data?.userId || socket.id;
      const matchMode = data?.matchMode || "TEXT";
      const targetLanguage = data?.targetLanguage || "English";

      console.log(`🔎 User ${userId} searching | Mode=${matchMode} | Lang=${targetLanguage}`);

      // If someone is already waiting
      if (
        waitingUser &&
        waitingUser.userId !== userId &&
        waitingUser.matchMode === matchMode
      ) {
        const roomId = "room_" + Date.now();

        console.log(`🤝 MATCH FOUND: ${userId} ↔ ${waitingUser.userId}`);
        console.log(`🏠 Room created: ${roomId}`);

        // Join room
        socket.join(roomId);
        waitingUser.socket.join(roomId);

        // Send match to current user
        socket.emit("matchFound", {
          roomId: roomId,
          partnerId: waitingUser.userId,
          token: "" // (optional for Agora)
        });

        // Send match to waiting user
        waitingUser.socket.emit("matchFound", {
          roomId: roomId,
          partnerId: userId,
          token: ""
        });

        // Clear waiting
        waitingUser = null;

      } else {
        // Put current user in waiting queue
        waitingUser = {
          socket: socket,
          userId: userId,
          matchMode: matchMode,
          targetLanguage: targetLanguage
        };

        console.log(`⏳ User waiting: ${userId}`);
      }

    } catch (err) {
      console.error("❌ Match error:", err);
    }
  });

  // =========================
  // CANCEL SEARCH
  // =========================
  socket.on("cancelSearch", (data) => {
    const userId = data?.userId;

    if (waitingUser && waitingUser.userId === userId) {
      console.log(`❌ Search cancelled: ${userId}`);
      waitingUser = null;
    }
  });

  // =========================
  // DISCONNECT
  // =========================
  socket.on("disconnect", () => {
    console.log("🔌 User disconnected:", socket.id);

    if (waitingUser && waitingUser.socket === socket) {
      console.log("🧹 Removed waiting user (disconnect)");
      waitingUser = null;
    }
  });
});

// =========================
// START SERVER
// =========================
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
