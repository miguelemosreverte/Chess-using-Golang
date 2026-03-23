/**
 * Firebase Chess Engine
 * =====================
 * Replaces Go backend with client-side chess.js + Firebase RTDB.
 * Provides the same game state format that app.js expects.
 */

// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyDEXhM7kTjCRFNdcVt_GDMk-x5QAj3LHKE",
    authDomain: "signaling-dcfad.firebaseapp.com",
    databaseURL: "https://signaling-dcfad-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "signaling-dcfad"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const firebaseDb = firebase.database();

// Local Chess instances keyed by gameId
const chessInstances = {};

// Active Firebase listeners (to avoid duplicates)
const activeListeners = {};

/* =============================================================================
   PIECE TYPE MAPPING
   ============================================================================= */

const CHESS_JS_PIECE_TYPES = {
    'p': 'pawn',
    'n': 'knight',
    'b': 'bishop',
    'r': 'rook',
    'q': 'queen',
    'k': 'king'
};

const APP_TO_CHESS_JS_TYPES = {
    'pawn': 'p',
    'knight': 'n',
    'bishop': 'b',
    'rook': 'r',
    'queen': 'q',
    'king': 'k'
};

/* =============================================================================
   BOARD CONVERSION
   ============================================================================= */

/**
 * Convert chess.js board to app.js format.
 * @param {Chess} chess - chess.js instance
 * @returns {Object} board mapping like {"e2": {type: "pawn", color: "white"}}
 */
function chessBoardToAppBoard(chess) {
    const board = {};
    const chessBoard = chess.board();
    const files = 'abcdefgh';

    for (let rank = 0; rank < 8; rank++) {
        for (let file = 0; file < 8; file++) {
            const piece = chessBoard[rank][file];
            if (piece) {
                const pos = files[file] + (8 - rank);
                board[pos] = {
                    type: CHESS_JS_PIECE_TYPES[piece.type],
                    color: piece.color === 'w' ? 'white' : 'black'
                };
            }
        }
    }
    return board;
}

/**
 * Determine game status from chess.js instance.
 * @param {Chess} chess
 * @returns {string} "active", "check", "checkmate", or "stalemate"
 */
function getStatus(chess) {
    if (chess.in_checkmate()) return 'checkmate';
    if (chess.in_stalemate() || chess.in_draw()) return 'stalemate';
    if (chess.in_check()) return 'check';
    return 'active';
}

/**
 * Find the king's square for the side in check.
 * @param {Chess} chess
 * @returns {string|null} position like "e1" or null
 */
function getCheckSquare(chess) {
    if (!chess.in_check()) return null;

    const turn = chess.turn(); // 'w' or 'b' - the side in check
    const board = chess.board();
    const files = 'abcdefgh';

    for (let rank = 0; rank < 8; rank++) {
        for (let file = 0; file < 8; file++) {
            const piece = board[rank][file];
            if (piece && piece.type === 'k' && piece.color === turn) {
                return files[file] + (8 - rank);
            }
        }
    }
    return null;
}

/**
 * Build full game state from chess.js instance + metadata.
 * @param {Chess} chess
 * @param {Array} moveHistory
 * @param {Object|null} undoRequest
 * @returns {Object} game state in app.js format
 */
function buildGameState(chess, moveHistory, undoRequest) {
    return {
        board: chessBoardToAppBoard(chess),
        turn: chess.turn() === 'w' ? 'white' : 'black',
        status: getStatus(chess),
        moveHistory: moveHistory || [],
        checkSquare: getCheckSquare(chess),
        undoRequest: undoRequest || null
    };
}

/* =============================================================================
   CHESS ENGINE FUNCTIONS
   ============================================================================= */

/**
 * Get or create a Chess instance for a game.
 * @param {string} gameId
 * @param {string} [fen] - optional FEN to load
 * @returns {Chess}
 */
function getChessInstance(gameId, fen) {
    if (fen) {
        chessInstances[gameId] = new Chess(fen);
    } else if (!chessInstances[gameId]) {
        chessInstances[gameId] = new Chess();
    }
    return chessInstances[gameId];
}

/**
 * Create a new game and write initial state to Firebase.
 * @returns {Promise<string>} game ID
 */
async function firebaseCreateGame() {
    const gameId = generateGameId();
    const chess = new Chess();
    chessInstances[gameId] = chess;

    const state = {
        fen: chess.fen(),
        turn: 'white',
        status: 'active',
        moveHistory: [],
        checkSquare: null,
        undoRequest: null
    };

    await firebaseDb.ref('games/' + gameId).set(state);
    return gameId;
}

/**
 * Get game state from Firebase.
 * @param {string} gameId
 * @returns {Promise<Object>} game state in app.js format
 */
async function firebaseGetGameState(gameId) {
    const snapshot = await firebaseDb.ref('games/' + gameId).once('value');
    const data = snapshot.val();
    if (!data) return null;

    const chess = getChessInstance(gameId, data.fen);
    return buildGameState(chess, data.moveHistory || [], data.undoRequest || null);
}

/**
 * Get legal moves for a piece (synchronous, local computation).
 * @param {string} gameId
 * @param {string} from - square like "e2"
 * @returns {Array} moves like [{from: "e2", to: "e4"}, ...]
 */
function firebaseGetLegalMoves(gameId, from) {
    const chess = chessInstances[gameId];
    if (!chess) return [];

    const moves = chess.moves({ square: from, verbose: true });
    return moves.map(m => ({ from: m.from, to: m.to }));
}

/**
 * Make a move, validate with chess.js, update Firebase.
 * @param {string} gameId
 * @param {string} from
 * @param {string} to
 * @param {string|null} promotion - piece type like "queen"
 * @returns {Promise<Object|null>} updated game state or null if invalid
 */
async function firebaseMakeMove(gameId, from, to, promotion) {
    const chess = chessInstances[gameId];
    if (!chess) return null;

    const moveObj = { from, to };
    if (promotion) {
        moveObj.promotion = APP_TO_CHESS_JS_TYPES[promotion] || promotion;
    }

    const result = chess.move(moveObj);
    if (!result) return null; // Illegal move

    // Get current state from Firebase to preserve moveHistory
    const snapshot = await firebaseDb.ref('games/' + gameId).once('value');
    const data = snapshot.val() || {};
    const moveHistory = data.moveHistory || [];

    const historyEntry = { from, to };
    if (promotion) historyEntry.promotion = promotion;
    moveHistory.push(historyEntry);

    const newState = {
        fen: chess.fen(),
        turn: chess.turn() === 'w' ? 'white' : 'black',
        status: getStatus(chess),
        moveHistory: moveHistory,
        checkSquare: getCheckSquare(chess),
        undoRequest: null
    };

    await firebaseDb.ref('games/' + gameId).update(newState);
    return buildGameState(chess, moveHistory, null);
}

/**
 * Request undo.
 * @param {string} gameId
 * @param {string} color - "white" or "black"
 * @returns {Promise<Object>} updated game state
 */
async function firebaseRequestUndo(gameId, color) {
    const undoRequest = { requestedBy: color };
    await firebaseDb.ref('games/' + gameId + '/undoRequest').set(undoRequest);

    const chess = chessInstances[gameId];
    const snapshot = await firebaseDb.ref('games/' + gameId).once('value');
    const data = snapshot.val();
    return buildGameState(chess, data.moveHistory || [], undoRequest);
}

/**
 * Accept undo - undo last move.
 * @param {string} gameId
 * @returns {Promise<Object>} updated game state
 */
async function firebaseAcceptUndo(gameId) {
    const chess = chessInstances[gameId];
    if (!chess) return null;

    chess.undo();

    const snapshot = await firebaseDb.ref('games/' + gameId).once('value');
    const data = snapshot.val() || {};
    const moveHistory = data.moveHistory || [];
    moveHistory.pop();

    const newState = {
        fen: chess.fen(),
        turn: chess.turn() === 'w' ? 'white' : 'black',
        status: getStatus(chess),
        moveHistory: moveHistory,
        checkSquare: getCheckSquare(chess),
        undoRequest: null
    };

    await firebaseDb.ref('games/' + gameId).update(newState);
    return buildGameState(chess, moveHistory, null);
}

/**
 * Reject undo - clear the request.
 * @param {string} gameId
 * @returns {Promise<Object>} updated game state
 */
async function firebaseRejectUndo(gameId) {
    await firebaseDb.ref('games/' + gameId + '/undoRequest').set(null);

    const chess = chessInstances[gameId];
    const snapshot = await firebaseDb.ref('games/' + gameId).once('value');
    const data = snapshot.val();
    return buildGameState(chess, data.moveHistory || [], null);
}

/* =============================================================================
   FIREBASE REAL-TIME LISTENERS
   ============================================================================= */

/**
 * Subscribe to game state changes.
 * @param {string} gameId
 * @param {Function} callback - called with game state in app.js format
 */
function firebaseSubscribeGame(gameId, callback) {
    if (activeListeners['game_' + gameId]) return;

    const ref = firebaseDb.ref('games/' + gameId);
    const listener = ref.on('value', (snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        const chess = getChessInstance(gameId, data.fen);
        const state = buildGameState(chess, data.moveHistory || [], data.undoRequest || null);
        callback(state);
    });

    activeListeners['game_' + gameId] = { ref, listener };
}

/**
 * Subscribe to chat messages.
 * @param {string} gameId
 * @param {Function} callback - called with each new message {player, message, time}
 */
function firebaseSubscribeChat(gameId, callback) {
    if (activeListeners['chat_' + gameId]) return;

    const ref = firebaseDb.ref('games/' + gameId + '/chat');
    const listener = ref.on('child_added', (snapshot) => {
        const msg = snapshot.val();
        if (msg) callback(msg);
    });

    activeListeners['chat_' + gameId] = { ref, listener };
}

/**
 * Send a chat message to Firebase.
 * @param {string} gameId
 * @param {string} player
 * @param {string} message
 * @returns {Promise<void>}
 */
async function firebaseSendChat(gameId, player, message) {
    await firebaseDb.ref('games/' + gameId + '/chat').push({
        player: player,
        message: message,
        time: Date.now()
    });
}

/**
 * Load all existing chat messages.
 * @param {string} gameId
 * @returns {Promise<Array>}
 */
async function firebaseLoadChat(gameId) {
    const snapshot = await firebaseDb.ref('games/' + gameId + '/chat').once('value');
    const data = snapshot.val();
    if (!data) return [];
    return Object.values(data);
}

/* =============================================================================
   UTILITY
   ============================================================================= */

/**
 * Claim a seat (white or black) in a game using a Firebase transaction.
 * First player gets white, second gets black.
 * @param {string} gameId
 * @param {string} playerId
 * @returns {Promise<string>} "white" or "black"
 */
async function claimSeat(gameId, playerId) {
    const seatsRef = firebaseDb.ref('games/' + gameId + '/seats');
    const result = await seatsRef.transaction((seats) => {
        if (!seats) seats = {};
        if (seats.white === playerId) return seats; // already white
        if (seats.black === playerId) return seats; // already black
        if (!seats.white) {
            seats.white = playerId;
        } else if (!seats.black) {
            seats.black = playerId;
        }
        return seats;
    });

    const seats = result.snapshot.val() || {};
    if (seats.white === playerId) return 'white';
    if (seats.black === playerId) return 'black';
    // Fallback: spectator gets white view
    return 'white';
}

/**
 * Find or create a game for a chapter (matchmaking).
 * If someone is already waiting in this chapter, join their game.
 * Otherwise, create a new game and register as waiting.
 * @param {string} chapterId
 * @param {string} playerId
 * @returns {Promise<{gameId: string, isHost: boolean}>}
 */
async function firebaseMatchmake(chapterId, playerId) {
    const waitingRef = firebaseDb.ref('waiting_games/' + chapterId);

    // Try to atomically claim an existing waiting game
    const result = await waitingRef.transaction((current) => {
        if (current && current.hostId !== playerId) {
            // Someone is waiting — remove the listing (we're joining)
            return null;
        }
        // No one waiting or it's our own listing — don't change
        return current;
    });

    if (!result.committed) {
        // Transaction aborted — shouldn't happen, but fall back to hosting
        return await hostNewGame(chapterId, playerId);
    }

    // If we cleared the waiting entry, we're joining that game
    const beforeVal = result.snapshot.val();
    if (beforeVal === null) {
        // We successfully consumed a waiting game — but we need the data
        // Re-read won't work since we deleted it. Use a different approach.
    }

    // Simpler approach: read first, then try to delete atomically
    const snapshot = await waitingRef.once('value');
    const waiting = snapshot.val();

    if (waiting && waiting.hostId !== playerId) {
        // Someone is waiting — try to claim it
        const claimed = await waitingRef.transaction((current) => {
            if (current && current.hostId === waiting.hostId) {
                return null; // Delete — we're joining
            }
            return current; // Changed, abort
        });

        if (claimed.committed && claimed.snapshot.val() === null) {
            // Successfully joined
            return { gameId: waiting.gameId, isHost: false };
        }
    }

    // No one waiting or claim failed — host a new game
    return await hostNewGame(chapterId, playerId);
}

/**
 * Create a new game and register it as waiting.
 * @param {string} chapterId
 * @param {string} playerId
 * @returns {Promise<{gameId: string, isHost: boolean}>}
 */
async function hostNewGame(chapterId, playerId) {
    const gameId = await firebaseCreateGame();
    // Claim white seat
    await claimSeat(gameId, playerId);
    // Register as waiting
    await firebaseDb.ref('waiting_games/' + chapterId).set({
        gameId: gameId,
        hostId: playerId,
        timestamp: Date.now()
    });
    return { gameId, isHost: true };
}

/**
 * Listen for an opponent joining a waiting game.
 * Resolves when the waiting entry is removed (opponent claimed it).
 * @param {string} chapterId
 * @returns {Promise<void>}
 */
function firebaseWaitForOpponent(chapterId) {
    return new Promise((resolve) => {
        const ref = firebaseDb.ref('waiting_games/' + chapterId);
        const listener = ref.on('value', (snapshot) => {
            if (!snapshot.val()) {
                // Waiting entry removed — opponent joined!
                ref.off('value', listener);
                resolve();
            }
        });
    });
}

/**
 * Generate a random game ID.
 * @returns {string}
 */
function generateGameId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 8; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
}
