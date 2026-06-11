socket.on("findMatch", (data = {}) => {

    const userId = data.userId || socket.id;
    const matchMode = data.matchMode === "VIDEO" ? "VIDEO" : "TEXT";
    const targetLanguage = data.targetLanguage || "English";

    console.log(
        `Finding match: ${userId} (${matchMode})`
    );

    const queue = waitingQueues[matchMode];

    // Remove duplicate entries
    for (let i = queue.length - 1; i >= 0; i--) {
        if (queue[i].userId === userId) {
            queue.splice(i, 1);
        }
    }

    let partner = null;

    while (queue.length > 0) {

        const candidate = queue.shift();

        if (
            candidate &&
            candidate.socket &&
            candidate.socket.connected &&
            candidate.userId !== userId
        ) {
            partner = candidate;
            break;
        }
    }

    if (partner) {

        const roomId =
            "room_" +
            Date.now() +
            "_" +
            Math.random().toString(36).substring(2, 8);

        socket.join(roomId);
        partner.socket.join(roomId);

        const payloadA = {
            roomId,
            partnerId: partner.userId,
            token: "",
            timestamp: Date.now()
        };

        const payloadB = {
            roomId,
            partnerId: userId,
            token: "",
            timestamp: Date.now()
        };

        socket.emit("matchFound", payloadA);
        partner.socket.emit("matchFound", payloadB);

        console.log(
            `MATCHED ${userId} ↔ ${partner.userId} (${roomId})`
        );

    } else {

        queue.push({
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
            `WAITING ${userId} (${matchMode}) queue=${queue.length}`
        );
    }
});
