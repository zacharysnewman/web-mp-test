// server.js
// This is the authoritative game server.

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// --- Game State ---
// This is the single source of truth for the game.
// All game logic runs on the server.
let players = {};
let treasures = [];
let gameInProgress = false;
let gameTimer = 60; // 60 seconds for a round
let countdownInterval;
let gameLoopInterval;
let treasureSpawnInterval;

const GAME_TICK_RATE = 1000 / 30; // 30 updates per second
const TREASURE_SPAWN_RATE = 2000; // New treasure every 2 seconds
const GAME_AREA_WIDTH = 50;
const GAME_AREA_HEIGHT = 50;

// Serve the client-side files
app.use(express.static(path.join(__dirname, 'public')));

// --- Game Logic ---

function startGame() {
    console.log("Starting new game...");
    gameInProgress = true;
    gameTimer = 60;
    treasures = [];
    // Reset scores for all connected players
    for (const id in players) {
        players[id].score = 0;
    }

    // Start the game loop for physics and updates
    gameLoopInterval = setInterval(gameLoop, GAME_TICK_RATE);

    // Start spawning treasures
    treasureSpawnInterval = setInterval(spawnTreasure, TREASURE_SPAWN_RATE);
    spawnTreasure(); // Spawn one immediately

    // Start the game countdown timer
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

    // Determine the winner
    let winner = null;
    let highScore = -1;
    for (const id in players) {
        if (players[id].score > highScore) {
            highScore = players[id].score;
            winner = players[id];
        }
    }

    // Announce the winner to all players
    io.emit('gameOver', winner ? winner.name : 'No one');

    // Reset for a new game after a delay
    setTimeout(() => {
        // Clear players who might have disconnected
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
    }, 10000); // Wait 10 seconds before starting a new round
}

function spawnTreasure() {
    if (treasures.length >= 20) return; // Max 20 treasures at a time
    const treasure = {
        id: `treasure-${Date.now()}-${Math.random()}`,
        x: (Math.random() - 0.5) * GAME_AREA_WIDTH,
        y: 0.5, // Fixed height for treasures
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
    // --- Collision Detection ---
    for (const playerId in players) {
        const player = players[playerId];
        treasures.forEach((treasure, index) => {
            const distance = Math.sqrt(
                Math.pow(player.x - treasure.x, 2) +
                Math.pow(player.z - treasure.z, 2)
            );
            if (distance < 1.5) { // Collision threshold
                player.score += 1;
                treasures.splice(index, 1); // Remove collected treasure
            }
        });
    }

    // --- Broadcast State ---
    // Send the updated state to all clients
    io.emit('gameState', {
        players,
        treasures,
        gameTimer,
        leaderboard: getLeaderboard()
    });
}


// --- Network Handling ---

io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    // When a player joins with their name
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

        // If this is the first player, start the game
        if (!gameInProgress && Object.keys(players).length > 0) {
            startGame();
        }
        
        // Send the current game state to the new player
        socket.emit('gameJoined', {
            id: socket.id,
            gameState: { players, treasures, gameTimer, leaderboard: getLeaderboard() }
        });
    });

    // When a player moves
    socket.on('move', (position) => {
        const player = players[socket.id];
        if (player) {
            // The server just updates the position. The client handles the interpolation.
            // A real game would have validation here.
            player.x = position.x;
            player.y = position.y;
            player.z = position.z;
        }
    });

    // When a player disconnects
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


server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`To play, create a 'public' folder with the client HTML file.`);
    console.log(`Then run 'npm install express socket.io' and 'node server.js'`);
});
