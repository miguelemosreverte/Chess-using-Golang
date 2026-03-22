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
