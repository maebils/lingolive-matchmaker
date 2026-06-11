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

const waitingQueues = {
    TEXT: [],
    VIDEO: []
};

const activeMatches = new Map();

app.get("/", (req, res) => {
    res.json({
        status: "running",
        service: "LingoLive Matchmaker",
        uptime: process.uptime(),
        textWaiting: waitingQueues.TEXT.length,
        videoWaiting: waitingQueues.VIDEO.length
    });
});

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        timestamp: Date.now(),
        textWaiting: waitingQueues.TEXT.length,
        videoWaiting: waitingQueues.VIDEO.length
    });
});

function generateRoomId(userA, userB, mode) {
    const hash = crypto
        .createHash("md5")
        .update(
            `${userA}_${userB}_${mode}_${Date.now()}_${Math.random()}`
        )
        .digest("hex")
        .substring(0, 12);

    return `room_${mode}_${hash}`;
}

function removeUserFromQueues(userId, socketId) {
    ["TEXT", "VIDEO"].forEach(mode => {
        waitingQueues[mode] =
            waitingQueues[mode].filter(
                item =>
                    item.userId !== userId &&
                    item.socket.id !== socketId
            );
    });
}

function cleanupStaleUsers() {
    const now = Date.now();

    ["TEXT", "VIDEO"].forEach(mode => {

        waitingQueues[mode] =
            waitingQueues[mode].filter(item => {

                const alive =
                    item &&
                    item.socket &&
                    item.socket.connected &&
                    now - item.createdAt < 30000;

                if (!alive) {
                    console.log(
                        `Removing stale user ${item.userId}`
                    );
                }

                return alive;
            });
    });
}

function findPartner(mode, userId) {

    cleanupStaleUsers();

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

io.on("connection", socket => {

    console.log("User connected:", socket.id);

    socket.emit("connected", {
        socketId: socket.id,
        timestamp: Date.now()
    });

    socket.on("findMatch", (data = {}) => {

        try {

            const userId =
                data.userId || socket.id;

            const matchMode =
                data.matchMode === "VIDEO"
                    ? "VIDEO"
                    : "TEXT";

            const targetLanguage =
                data.targetLanguage || "English";

            console.log(
                `Finding match user=${userId} mode=${matchMode}`
            );

            removeUserFromQueues(
                userId,
                socket.id
            );

            const partner =
                findPartner(
                    matchMode,
                    userId
                );

            if (partner) {

                const roomId =
                    generateRoomId(
                        userId,
                        partner.userId,
                        matchMode
                    );

                socket.join(roomId);
                partner.socket.join(roomId);

                activeMatches.set(roomId, {
                    roomId,
                    userA: userId,
                    userB: partner.userId,
                    createdAt: Date.now()
                });

                socket.emit("matchFound", {
                    roomId,
                    partnerId: partner.userId,
                    token: "",
                    targetLanguage,
                    timestamp: Date.now()
                });

                partner.socket.emit("matchFound", {
                    roomId,
                    partnerId: userId,
                    token: "",
                    targetLanguage,
                    timestamp: Date.now()
                });

                console.log(
                    `MATCH FOUND ${userId} ↔ ${partner.userId}`
                );

            } else {

                waitingQueues[matchMode].push({
                    socket,
                    userId,
                    matchMode,
                    targetLanguage,
                    createdAt: Date.now()
                });

                socket.emit("waiting", {
                    message: "Waiting for partner..."
                });

                console.log(
                    `WAITING ${userId} queue=${waitingQueues[matchMode].length}`
                );
            }

        } catch (err) {

            console.error(
                "Match error:",
                err
            );

            socket.emit("matchError", {
                message:
                    "Could not start matchmaking"
            });
        }
    });

    socket.on("cancelSearch", (data = {}) => {

        const userId =
            data.userId || socket.id;

        removeUserFromQueues(
            userId,
            socket.id
        );

        socket.emit("searchCancelled", {
            success: true
        });

        console.log(
            `Search cancelled ${userId}`
        );
    });

    socket.on("callEnded", data => {

        if (
            data &&
            data.roomId &&
            activeMatches.has(data.roomId)
        ) {

            activeMatches.delete(
                data.roomId
            );

            socket.to(data.roomId).emit(
                "partnerEndedCall",
                {
                    roomId: data.roomId
                }
            );

            console.log(
                `Call ended ${data.roomId}`
            );
        }
    });

    socket.on("reportAndBlockUser", data => {

        console.log(
            "Report received:",
            data
        );

        socket.emit(
            "reportReceived",
            {
                success: true
            }
        );
    });

    socket.on("disconnect", reason => {

        console.log(
            "User disconnected:",
            socket.id,
            reason
        );

        removeUserFromQueues(
            null,
            socket.id
        );

        activeMatches.forEach(match => {

            if (
                match.userA === socket.id ||
                match.userB === socket.id
            ) {

                socket.to(match.roomId).emit(
                    "partnerDisconnected",
                    {
                        roomId: match.roomId
                    }
                );
            }
        });
    });
});

setInterval(() => {
    cleanupStaleUsers();
}, 10000);

server.listen(PORT, () => {
    console.log(
        `LingoLive Matchmaker running on port ${PORT}`
    );
});
