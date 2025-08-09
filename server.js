// server.js
// Authoritative game server for multiplayer treasure hunt

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// --- Socket.IO with CORS enabled ---
const io = socketIo(server, {
    cors: {
        origin: "*", // Change "*" to your client URL for production security
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// --- Game State ---
let players = {};
let treasures = [];
let gameInProgress = false;
let gameTimer = 60; // 60 seconds per round
let countdownInterval;
let gameLoopInterval;
let treasureSpawnInterval;

const GAME_TICK_RATE = 1000 / 30; // 30 updates/sec
const TREASURE_SPAWN_RATE = 2000; // spawn every 2 sec
const GAME_AREA_WIDTH = 50;
const GAME_AREA_HEIGHT = 50;

// Serve client from /public
app.use(express.static(path.join(__dirname, 'public')));

// --- Game Logic ---
function startGame() {
    console.log("Starting new game...");
    gameInProgress = true;
    gameTimer = 60;
    treasures = [];

    // Reset scores
    for (const id in players) {
        players[id].score = 0;
    }

    // Start loops
    gameLoopInterval = setInterval(gameLoop, GAME_TICK_RATE);
    treasureSpawnInterval = setInterval(spawnTreasure, TREASURE_SPAWN_RATE);
    spawnTreasure(); // one right away

    countdownInterval = setInterval(() => {
        gameTimer--;
        if (gameTimer <= 0) {
            endGame();
        }
    }, 1000);
}

function endGame() {
    console.log("Game Over!");
    gameInProgress = false;
    clearInterval(gameLoopInterval);
    clearInterval(treasureSpawnInterval);
    clearInterval(countdownInterval);

    // Determine winner
    let winner = null;
    let highScore = -1;
    for (const id in players) {
        if (players[id].score > highScore) {
            highScore = players[id].score;
            winner = players[id];
        }
    }

    io.emit('gameOver', winner ? { name: winner.name, score: winner.score } : { name: 'No one', score: 0 });

    // Prepare for next game
    setTimeout(() => {
        const connectedSocketIds = Object.keys(io.sockets.sockets);
        players = Object.keys(players)
            .filter(key => connectedSocketIds.includes(key))
            .reduce((obj, key) => {
                obj[key] = players[key];
                return obj;
            }, {});
        if (Object.keys(players).length > 0) {
            startGame();
        }
    }, 10000);
}

function spawnTreasure() {
    if (treasures.length >= 20) return;
    const treasure = {
        id: `treasure-${Date.now()}-${Math.random()}`,
        x: (Math.random() - 0.5) * GAME_AREA_WIDTH,
        y: 0.5,
        z: (Math.random() - 0.5) * GAME_AREA_HEIGHT,
    };
    treasures.push(treasure);
}

function getLeaderboard() {
    return Object.values(players)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(p => ({ name: p.name, score: p.score }));
}

function gameLoop() {
    // Collision detection
    for (const playerId in players) {
        const player = players[playerId];
        treasures.forEach((treasure, index) => {
            const distance = Math.sqrt(
                Math.pow(player.x - treasure.x, 2) +
                Math.pow(player.z - treasure.z, 2)
            );
            if (distance < 1.5) {
                player.score += 1;
                treasures.splice(index, 1);
            }
        });
    }

    // Broadcast state
    io.emit('gameState', {
        players,
        treasures,
        gameTimer,
        leaderboard: getLeaderboard()
    });
}

// --- Socket.IO events ---
io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    socket.on('joinGame', (playerName) => {
        console.log(`Player ${socket.id} joined as ${playerName}`);
        players[socket.id] = {
            id: socket.id,
            name: playerName || 'Player ' + Math.floor(Math.random() * 1000),
            x: (Math.random() - 0.5) * 10,
            y: 0.5,
            z: (Math.random() - 0.5) * 10,
            score: 0,
        };

        if (!gameInProgress && Object.keys(players).length > 0) {
            startGame();
        }

        socket.emit('gameJoined', {
            id: socket.id,
            gameState: { players, treasures, gameTimer, leaderboard: getLeaderboard() }
        });
    });

    socket.on('move', (position) => {
        const player = players[socket.id];
        if (player) {
            player.x = position.x;
            player.y = position.y;
            player.z = position.z;
        }
    });

    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        delete players[socket.id];
        if (Object.keys(players).length === 0) {
            console.log("Last player left. Stopping game.");
            gameInProgress = false;
            clearInterval(gameLoopInterval);
            clearInterval(treasureSpawnInterval);
            clearInterval(countdownInterval);
            treasures = [];
        }
    });
});

// --- Start server ---
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Serving static files from /public`);
});