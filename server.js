const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

const waitingQueues = {};

io.on('connection', (socket) => {
    console.log(`User Connected: ${socket.id}`);

    socket.on('findMatch', (selectedLanguage) => {
        console.log(`User ${socket.id} searching for: ${selectedLanguage}`);

        if (!waitingQueues[selectedLanguage]) {
            waitingQueues[selectedLanguage] = [];
        }

        if (waitingQueues[selectedLanguage].includes(socket)) return;

        if (waitingQueues[selectedLanguage].length > 0) {
            const peerSocket = waitingQueues[selectedLanguage].shift();

            if (peerSocket.connected) {
                const roomId = `room_${socket.id}_${peerSocket.id}`;
                socket.join(roomId);
                peerSocket.join(roomId);

                console.log(`Match Found! Room: ${roomId}`);
                io.to(roomId).emit('matchFound', { roomId: roomId });
                return;
            }
        }

        waitingQueues[selectedLanguage].push(socket);
    });

    socket.on('disconnect', () => {
        console.log(`User Disconnected: ${socket.id}`);
        for (const lang in waitingQueues) {
            waitingQueues[lang] = waitingQueues[lang].filter(s => s.id !== socket.id);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
