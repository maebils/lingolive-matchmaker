const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*" }
});

// Store waiting users by language
const waitingQueues = {};

io.on('connection', (socket) => {
    console.log(`User Connected: ${socket.id}`);

    socket.currentLanguage = null;
    socket.partnerId = null;

    // 🔍 FIND MATCH
    socket.on('findMatch', (selectedLanguage) => {
        console.log(`User ${socket.id} searching for: ${selectedLanguage}`);

        socket.currentLanguage = selectedLanguage;

        if (!waitingQueues[selectedLanguage]) {
            waitingQueues[selectedLanguage] = [];
        }

        // Prevent duplicate entry
        if (waitingQueues[selectedLanguage].includes(socket.id)) return;

        // ✅ MATCH FOUND
        if (waitingQueues[selectedLanguage].length > 0) {
            const peerId = waitingQueues[selectedLanguage].shift();
            const peerSocket = io.sockets.sockets.get(peerId);

            if (peerSocket && peerSocket.connected) {

                const roomId = `room_${socket.id}_${peerId}`;

                socket.join(roomId);
                peerSocket.join(roomId);

                socket.partnerId = peerId;
                peerSocket.partnerId = socket.id;

                console.log(`Match Found! ${socket.id} ↔ ${peerId}`);

                // 🔥 SEND CORRECT DATA
                socket.emit('matchFound', {
                    roomId: roomId,
                    partnerId: peerId
                });

                peerSocket.emit('matchFound', {
                    roomId: roomId,
                    partnerId: socket.id
                });

                return;
            }
        }

        // ⏳ WAITING
        waitingQueues[selectedLanguage].push(socket.id);
    });

    // 🔁 NEXT USER (skip)
    socket.on('next', () => {
        console.log(`User ${socket.id} clicked NEXT`);

        const partnerId = socket.partnerId;

        if (partnerId) {
            const partnerSocket = io.sockets.sockets.get(partnerId);

            if (partnerSocket) {
                partnerSocket.emit('partnerDisconnected');
                partnerSocket.partnerId = null;
            }
        }

        socket.partnerId = null;

        // Rejoin queue
        if (socket.currentLanguage) {
            socket.emit('requeue');
        }
    });

    // ❌ DISCONNECT
    socket.on('disconnect', () => {
        console.log(`User Disconnected: ${socket.id}`);

        const partnerId = socket.partnerId;

        if (partnerId) {
            const partnerSocket = io.sockets.sockets.get(partnerId);
            if (partnerSocket) {
                partnerSocket.emit('partnerDisconnected');
                partnerSocket.partnerId = null;
            }
        }

        // Remove from queue
        for (const lang in waitingQueues) {
            waitingQueues[lang] =
                waitingQueues[lang].filter(id => id !== socket.id);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
