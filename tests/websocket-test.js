#!/usr/bin/env node
/**
 * WebSocket Test Script for Chess Server
 *
 * Tests:
 * 1. Connect to WebSocket and receive initial game state
 * 2. Make a move via WebSocket and receive update
 * 3. Send chat message and receive broadcast
 * 4. Test undo request/accept flow
 * 5. Get legal moves via WebSocket
 *
 * Usage: node tests/websocket-test.js
 * Requires: npm install ws (or run with npx)
 */

const WebSocket = require('ws');
const http = require('http');

const BASE_URL = 'http://localhost:8080';
const WS_BASE = 'ws://localhost:8080';

// Helper to make HTTP requests
function httpRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const options = {
            method,
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            headers: body ? { 'Content-Type': 'application/json' } : {}
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch {
                    resolve(data);
                }
            });
        });

        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

// Test helper
let testNum = 0;
function test(name, fn) {
    testNum++;
    return fn()
        .then(() => console.log(`\x1b[32m✓\x1b[0m Test ${testNum}: ${name}`))
        .catch(err => {
            console.log(`\x1b[31m✗\x1b[0m Test ${testNum}: ${name}`);
            console.error(`  Error: ${err.message}`);
            process.exit(1);
        });
}

// Assert helper
function assert(condition, message) {
    if (!condition) throw new Error(message);
}

// Wait for WebSocket message with timeout
function waitForMessage(ws, type, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeout);

        const handler = (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === type) {
                clearTimeout(timer);
                ws.off('message', handler);
                resolve(msg);
            }
        };

        ws.on('message', handler);
    });
}

// Send WebSocket message and wait for response
function sendAndWait(ws, message, responseType) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${responseType}`)), 5000);

        const handler = (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === responseType) {
                clearTimeout(timer);
                ws.off('message', handler);
                resolve(msg);
            }
        };

        ws.on('message', handler);
        ws.send(JSON.stringify(message));
    });
}

async function runTests() {
    console.log('\n=== Chess WebSocket API Tests ===\n');

    // Create a new game via HTTP
    let gameId;
    await test('Create game via HTTP', async () => {
        const game = await httpRequest('POST', '/api/games');
        assert(game.id, 'Game should have ID');
        assert(game.turn === 'white', 'Turn should be white');
        gameId = game.id;
        console.log(`    Created game: ${gameId}`);
    });

    // Test 1: Connect to WebSocket and receive initial state
    let ws1;
    await test('Connect WebSocket and receive initial state', async () => {
        ws1 = new WebSocket(`${WS_BASE}/api/games/${gameId}/ws`);

        await new Promise((resolve, reject) => {
            ws1.on('open', resolve);
            ws1.on('error', reject);
        });

        const msg = await waitForMessage(ws1, 'game_update');
        assert(msg.game.id === gameId, 'Game ID should match');
        assert(msg.game.turn === 'white', 'Turn should be white');
        assert(msg.game.board.e2.type === 'pawn', 'e2 should have pawn');
    });

    // Test 2: Connect second client
    let ws2;
    await test('Connect second WebSocket client', async () => {
        ws2 = new WebSocket(`${WS_BASE}/api/games/${gameId}/ws`);

        await new Promise((resolve, reject) => {
            ws2.on('open', resolve);
            ws2.on('error', reject);
        });

        const msg = await waitForMessage(ws2, 'game_update');
        assert(msg.game.id === gameId, 'Game ID should match');
    });

    // Test 3: Get legal moves via WebSocket
    await test('Get legal moves via WebSocket', async () => {
        const response = await sendAndWait(ws1, {
            type: 'get_moves',
            payload: { from: 'e2' }
        }, 'moves');

        assert(response.moves.moves.length === 2, 'e2 pawn should have 2 moves');
    });

    // Test 4: Make a move via WebSocket
    await test('Make move via WebSocket (e2-e4)', async () => {
        // Set up listener on ws2 to receive the broadcast
        const ws2Promise = waitForMessage(ws2, 'game_update');

        // Send move from ws1
        ws1.send(JSON.stringify({
            type: 'move',
            payload: { from: 'e2', to: 'e4' }
        }));

        // Both clients should receive the update
        const msg1 = await waitForMessage(ws1, 'game_update');
        const msg2 = await ws2Promise;

        assert(msg1.game.turn === 'black', 'Turn should be black');
        assert(msg1.game.board.e4.type === 'pawn', 'e4 should have pawn');
        assert(msg2.game.turn === 'black', 'Both clients should see same state');
    });

    // Test 5: Send chat message via WebSocket
    await test('Send chat message via WebSocket', async () => {
        // Set up listener on ws2
        const ws2Promise = waitForMessage(ws2, 'chat');

        // Send chat from ws1
        ws1.send(JSON.stringify({
            type: 'chat',
            payload: { player: 'player1', message: 'Hello via WebSocket!', time: Date.now() }
        }));

        // Both should receive chat
        const msg1 = await waitForMessage(ws1, 'chat');
        const msg2 = await ws2Promise;

        assert(msg1.message.message === 'Hello via WebSocket!', 'Message content should match');
        assert(msg2.message.player === 'player1', 'Player should be player1');
    });

    // Test 6: Make another move (black's turn)
    await test('Make move via WebSocket (e7-e5)', async () => {
        ws2.send(JSON.stringify({
            type: 'move',
            payload: { from: 'e7', to: 'e5' }
        }));

        const msg = await waitForMessage(ws1, 'game_update');
        assert(msg.game.turn === 'white', 'Turn should be back to white');
        assert(msg.game.board.e5.type === 'pawn', 'e5 should have pawn');
        assert(msg.game.moveHistory.length === 2, 'Should have 2 moves');
    });

    // Test 7: Request undo via WebSocket
    await test('Request undo via WebSocket', async () => {
        ws2.send(JSON.stringify({
            type: 'undo_request',
            payload: { color: 'black' }
        }));

        const msg = await waitForMessage(ws1, 'game_update');
        assert(msg.game.undoRequest, 'Should have undo request');
        assert(msg.game.undoRequest.requestedBy === 'black', 'Requested by black');
    });

    // Test 8: Accept undo via WebSocket
    await test('Accept undo via WebSocket', async () => {
        ws1.send(JSON.stringify({
            type: 'undo_accept',
            payload: {}
        }));

        const msg = await waitForMessage(ws2, 'game_update');
        assert(!msg.game.undoRequest, 'Undo request should be cleared');
        assert(msg.game.moveHistory.length === 1, 'Should have 1 move after undo');
        assert(msg.game.turn === 'black', 'Turn should be black after undo');
    });

    // Test 9: Invalid move error
    await test('Invalid move returns error', async () => {
        ws1.send(JSON.stringify({
            type: 'move',
            payload: { from: 'e4', to: 'e8' }  // Invalid - not pawn's turn
        }));

        const msg = await waitForMessage(ws1, 'error');
        assert(msg.error, 'Should receive error');
    });

    // Test 10: Verify HTTP endpoints still work
    await test('HTTP endpoints still work (backward compatibility)', async () => {
        const game = await httpRequest('GET', `/api/games/${gameId}`);
        assert(game.id === gameId, 'Should get same game via HTTP');
        assert(game.moveHistory.length === 1, 'Should have 1 move');
    });

    // Cleanup
    ws1.close();
    ws2.close();

    console.log('\n\x1b[32m=== All WebSocket Tests Passed! ===\x1b[0m\n');
}

// Run tests
runTests().catch(err => {
    console.error('\x1b[31mTest suite failed:\x1b[0m', err.message);
    process.exit(1);
});
