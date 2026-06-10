const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
});

app.get("/", (req, res) => {
  res.send("LingoLive Matchmaker is running");
});

const waitingUsers = {
  TEXT: null,
  VIDEO: null
};

function cleanWaitingUser(mode, socket) {
  if (waitingUsers[mode] && waitingUsers[mode].socket.id === socket.id) {
    waitingUsers[mode] = null;
  }
}

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("findMatch", (data = {}) => {
    try {
      const userId = data.userId || socket.id;
      const matchMode = data.matchMode === "VIDEO" ? "VIDEO" : "TEXT";
      const targetLanguage = data.targetLanguage || "English";

      console.log(
        `Finding match: user=${userId}, mode=${matchMode}, language=${targetLanguage}`
      );

      const waitingUser = waitingUsers[matchMode];

      if (
        waitingUser &&
        waitingUser.userId !== userId &&
        waitingUser.socket.connected
      ) {
        const roomId = "room_" + Date.now();

        socket.join(roomId);
        waitingUser.socket.join(roomId);

        socket.emit("matchFound", {
          roomId,
          partnerId: waitingUser.userId,
          token: ""
        });

        waitingUser.socket.emit("matchFound", {
          roomId,
          partnerId: userId,
          token: ""
        });

        console.log(`Match found: ${userId} with ${waitingUser.userId}, room=${roomId}`);

        waitingUsers[matchMode] = null;
      } else {
        waitingUsers[matchMode] = {
          socket,
          userId,
          matchMode,
          targetLanguage
        };

        console.log(`User waiting: ${userId}, mode=${matchMode}`);
      }
    } catch (err) {
      console.error("Match error:", err);
      socket.emit("matchError", {
        message: "Could not start matchmaking"
      });
    }
  });

  socket.on("cancelSearch", (data = {}) => {
    const userId = data.userId;

    ["TEXT", "VIDEO"].forEach((mode) => {
      if (
        waitingUsers[mode] &&
        (!userId || waitingUsers[mode].userId === userId || waitingUsers[mode].socket.id === socket.id)
      ) {
        waitingUsers[mode] = null;
        console.log(`Search cancelled: ${userId || socket.id}`);
      }
    });
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    cleanWaitingUser("TEXT", socket);
    cleanWaitingUser("VIDEO", socket);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
