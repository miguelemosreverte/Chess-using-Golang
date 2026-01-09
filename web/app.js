/**
 * Chess UI Application
 * ====================
 *
 * Main application logic for the chess game UI. Handles:
 * - Game state management and API communication
 * - Board rendering and piece interaction
 * - Move validation and submission
 * - Special moves: promotion, castling, en passant
 * - Undo request/accept/reject flow
 * - Move history replay navigation
 * - Real-time chat between players
 *
 * Related files:
 * - board-and-background-image-sync.js: Perspective transform and background alignment
 * - style.css: All visual styling
 * - index.html: DOM structure
 */

/* =============================================================================
   CONSTANTS
   ============================================================================= */

const API_BASE = '/api';

/** Unicode symbols for chess pieces, indexed by color and piece type */
const PIECES = {
    white: { king: '♔', queen: '♕', rook: '♖', bishop: '♗', knight: '♘', pawn: '♙' },
    black: { king: '♚', queen: '♛', rook: '♜', bishop: '♝', knight: '♞', pawn: '♟' }
};

/* =============================================================================
   APPLICATION STATE
   ============================================================================= */

/** Current game ID from URL path */
let gameId = null;

/** Full game state from server (board, turn, status, moveHistory, etc.) */
let gameState = null;

/** Currently selected square position (e.g., "e4") or null */
let selectedSquare = null;

/** Array of legal moves for the selected piece [{from, to}, ...] */
let legalMoves = [];

/** Pending promotion move {from, to} while waiting for piece selection, or null */
let pendingPromotion = null;

/** Replay navigation index: -1 = live view, >= 0 = viewing historical position */
let replayIndex = -1;

/** Previous game status, used to detect status changes for animations */
let previousStatus = null;

/** Move count at last poll, used to detect new moves from opponent */
let lastMoveCount = 0;

/** Local cache of chat messages for this game */
let chatMessages = [];

/** Unique player ID for this browser tab (stored in sessionStorage) */
let playerId = null;

/**
 * The color this player is assigned to (stored in sessionStorage per game).
 * Null until the player makes their first move, then locked to that color.
 * In debug play mode (devModeIndex === 2), this restriction is bypassed.
 */
let myColor = null;

/* =============================================================================
   INITIALIZATION
   ============================================================================= */

/** Whether pieces are hidden until user clicks (from book transition) */
let piecesHidden = false;

/** Which color's pieces are revealed (null = all hidden, 'white'/'black' = that color shown, 'all' = both) */
let revealedPieces = null;

/** Whether chat is hidden until opponent joins */
let chatHiddenUntilOpponent = false;

/** Whether we've sent the auto-hello message */
let autoHelloSent = false;

/**
 * Initialize the application on page load.
 * Sets up player ID, loads game state, renders board, and starts polling.
 * Handles smooth transition reveal if coming from the book selector.
 */
async function init() {
    // Get game ID from URL path
    const path = window.location.pathname;
    gameId = path.substring(1); // Remove leading slash

    // If no game ID (home page), show the book selector
    if (!gameId || gameId === '') {
        openBook();
        return;
    }

    // Check if we're coming from a transition (book selector)
    const transitionActive = sessionStorage.getItem('transitionActive');
    const transitionBoardImage = sessionStorage.getItem('transitionBoardImage');
    const hidePieces = sessionStorage.getItem('hidePiecesUntilClick');
    const hideChat = sessionStorage.getItem('hideChatUntilOpponent');
    let transitionOverlay = null;

    if (transitionActive === 'true' && transitionBoardImage) {
        // Create fullscreen overlay showing the board image from the transition
        transitionOverlay = document.createElement('div');
        transitionOverlay.id = 'transition-overlay';
        transitionOverlay.style.cssText = `
            position: fixed;
            inset: 0;
            z-index: 9999;
            background: #000;
            cursor: pointer;
        `;
        transitionOverlay.innerHTML = `
            <img src="${transitionBoardImage}" style="
                width: 100vw;
                height: 100vh;
                object-fit: cover;
            ">
            <div style="
                position: absolute;
                bottom: 20%;
                left: 50%;
                transform: translateX(-50%);
                color: white;
                font-family: Georgia, serif;
                font-size: 1.5em;
                text-shadow: 0 2px 10px rgba(0,0,0,0.8);
                animation: pulse 2s infinite;
            ">Click to start</div>
        `;

        // Add pulse animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes pulse {
                0%, 100% { opacity: 0.7; }
                50% { opacity: 1; }
            }
        `;
        transitionOverlay.appendChild(style);

        document.body.appendChild(transitionOverlay);

        // Clear the transition state
        sessionStorage.removeItem('transitionActive');
        sessionStorage.removeItem('transitionBoardImage');
    }

    // Handle hidden pieces until click
    if (hidePieces === 'true') {
        piecesHidden = true;
        sessionStorage.removeItem('hidePiecesUntilClick');
    }

    // Handle hidden chat until opponent joins
    if (hideChat === 'true') {
        chatHiddenUntilOpponent = true;
        sessionStorage.removeItem('hideChatUntilOpponent');
        // Hide the chat panel initially
        const chatPanel = document.querySelector('.chat-panel');
        if (chatPanel) {
            chatPanel.style.opacity = '0';
            chatPanel.style.transition = 'opacity 0.5s';
        }
    }

    // Generate unique player ID for this tab session
    playerId = sessionStorage.getItem('playerId');
    if (!playerId) {
        playerId = Math.random().toString(36).substr(2, 9);
        sessionStorage.setItem('playerId', playerId);
    }

    // Load player color for this game (if previously set)
    myColor = sessionStorage.getItem(`myColor_${gameId}`) || null;

    renderBoard();
    setupPromotionModal();

    // Load game state
    await loadGame();

    // Load existing chat messages
    await loadChat();

    // Setup background after board is rendered
    requestAnimationFrame(() => {
        setupBackgroundToggle().then(() => {
            // Background is fully loaded and rendered
            if (transitionOverlay) {
                // Wait for click to reveal pieces
                transitionOverlay.addEventListener('click', () => {
                    // Fade out overlay
                    transitionOverlay.style.transition = 'opacity 0.5s ease-out';
                    transitionOverlay.style.opacity = '0';
                    setTimeout(() => {
                        transitionOverlay.remove();
                    }, 500);

                    // Reveal only MY pieces (based on assigned color or default to white if first player)
                    // Keep piecesHidden = true so opponent pieces stay hidden until they join
                    const myPieceColor = myColor || 'white';
                    revealedPieces = myPieceColor;
                    // piecesHidden stays true - only revealedPieces color shows
                    updateUI();

                    // Send auto-hello to signal we're ready
                    sendAutoHello();
                });
            } else if (piecesHidden) {
                // No overlay but pieces hidden - reveal on any board click
                document.getElementById('board').addEventListener('click', function onBoardClick() {
                    const myPieceColor = myColor || 'white';
                    revealedPieces = myPieceColor;
                    // piecesHidden stays true
                    updateUI();
                    sendAutoHello();
                    this.removeEventListener('click', onBoardClick);
                }, { once: true });
            }
        });
    });

    // Re-apply transforms on resize
    window.addEventListener('resize', () => {
        applyCornerTransform();
        applyBackground();
    });

    // Start polling for updates
    setInterval(pollGameState, 1000);
    setInterval(pollChat, 1000);
}

/**
 * Send an automatic "hello" message when entering the game.
 * This signals to the opponent that we've joined.
 */
async function sendAutoHello() {
    if (autoHelloSent) return;
    autoHelloSent = true;

    try {
        await fetch(`${API_BASE}/games/${gameId}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                player: playerId,
                message: '👋 Hello!'
            })
        });
    } catch (e) {
        console.error('Failed to send auto-hello:', e);
    }
}

/**
 * Check if opponent has joined (by looking at chat messages).
 * If so, reveal the chat panel and their pieces.
 */
function checkForOpponent() {
    // Look for messages from other players
    const otherPlayerMessages = chatMessages.filter(msg => msg.player !== playerId);

    if (otherPlayerMessages.length > 0) {
        // Opponent has joined!

        // Reveal chat panel if hidden
        if (chatHiddenUntilOpponent) {
            chatHiddenUntilOpponent = false;
            const chatPanel = document.querySelector('.chat-panel');
            if (chatPanel) {
                chatPanel.style.opacity = '1';
            }
        }

        // Reveal opponent's pieces if we're in partial reveal mode
        if (piecesHidden && revealedPieces && revealedPieces !== 'all') {
            // Both players are now ready - show all pieces
            revealedPieces = 'all';
            updateUI();
        }
    }
}

/* =============================================================================
   GAME STATE & POLLING
   ============================================================================= */

/**
 * Load existing chat messages from server.
 * Called once during initialization to populate chat history.
 */
async function loadChat() {
    if (!gameId) return;
    try {
        const response = await fetch(`${API_BASE}/games/${gameId}/chat`);
        if (!response.ok) return;
        const messages = await response.json();

        chatMessages = messages;
        messages.forEach(msg => {
            const type = msg.player === playerId ? 'sent' : 'received';
            addChatMessageToUI(msg.message, type);
        });
    } catch (error) {
        console.error('Failed to load chat:', error);
    }
}

/**
 * Load game state from server.
 * Fetches the full game state and resets local UI state.
 */
async function loadGame() {
    try {
        const response = await fetch(`${API_BASE}/games/${gameId}`);
        if (!response.ok) {
            console.error('Game not found');
            return;
        }
        gameState = await response.json();
        lastMoveCount = gameState.moveHistory?.length || 0;
        selectedSquare = null;
        legalMoves = [];
        pendingPromotion = null;
        replayIndex = -1;
        previousStatus = null;
        updateUI();
    } catch (error) {
        console.error('Failed to load game:', error);
    }
}

/**
 * Poll for game state updates (for multiplayer sync).
 * Runs on 1-second interval to detect opponent moves.
 * Triggers check banner animation and auto-restart on game over.
 */
async function pollGameState() {
    if (!gameId) return;
    try {
        const response = await fetch(`${API_BASE}/games/${gameId}`);
        if (!response.ok) return;
        const game = await response.json();

        const newMoveCount = game.moveHistory?.length || 0;
        if (newMoveCount !== lastMoveCount) {
            lastMoveCount = newMoveCount;
            const oldStatus = gameState?.status;
            gameState = game;

            // Show check banner if newly in check
            if (gameState.status === 'check' && oldStatus !== 'check') {
                showCheckBanner();
            }

            // Auto-restart on game over
            if (gameState.status === 'checkmate' || gameState.status === 'stalemate') {
                setTimeout(() => {
                    window.location.href = '/';
                }, 2000);
            }

            updateUI();
        }
    } catch (error) {
        // Silently ignore polling errors
    }
}

/**
 * Poll for new chat messages from opponent.
 * Runs on 1-second interval to sync chat in real-time.
 */
async function pollChat() {
    if (!gameId) return;
    try {
        const response = await fetch(`${API_BASE}/games/${gameId}/chat`);
        if (!response.ok) return;
        const messages = await response.json();

        if (messages.length > chatMessages.length) {
            const newMessages = messages.slice(chatMessages.length);
            chatMessages = messages;
            newMessages.forEach(msg => {
                if (msg.player !== playerId) {
                    addChatMessageToUI(msg.message, 'received');
                }
            });

            // Check if opponent has joined (reveals chat panel)
            checkForOpponent();
        }
    } catch (error) {
        // Silently ignore polling errors
    }
}

/* =============================================================================
   NAVIGATION & CONTROLS
   ============================================================================= */

/**
 * Create a new game by redirecting to root URL.
 * The server will generate a new game ID and redirect.
 */
function newGame() {
    window.location.href = '/';
}

/**
 * Cycle to the next background image.
 * Saves preference to localStorage and reloads config.
 */
function cycleBackground() {
    if (currentChapter && currentChapter.boardImages.length > 0) {
        currentBoardImageIndex = (currentBoardImageIndex + 1) % currentChapter.boardImages.length;
        localStorage.setItem(`lastBgIndex_${currentChapter.id}`, currentBoardImageIndex.toString());
        loadBgConfig();
        applyBackground();
    }
}

/* =============================================================================
   BOARD RENDERING
   ============================================================================= */

/**
 * Render the 8x8 chess board grid.
 * Creates 64 square divs with click handlers and position data attributes.
 * Called once during initialization.
 */
function renderBoard() {
    const board = document.getElementById('board');
    board.innerHTML = '';

    // Render from rank 8 (top) to rank 1 (bottom)
    for (let rank = 7; rank >= 0; rank--) {
        for (let file = 0; file < 8; file++) {
            const square = document.createElement('div');
            const pos = fileRankToNotation(file, rank);
            const isLight = (file + rank) % 2 === 1;

            square.className = `square ${isLight ? 'light' : 'dark'}`;
            square.dataset.pos = pos;
            square.addEventListener('click', () => onSquareClick(pos));

            board.appendChild(square);
        }
    }
}

/* =============================================================================
   PAWN PROMOTION
   ============================================================================= */

/**
 * Setup click handlers for promotion piece selection.
 * Called once during initialization.
 */
function setupPromotionModal() {
    const options = document.querySelectorAll('.promotion-option');
    options.forEach(option => {
        option.addEventListener('click', () => {
            const piece = option.dataset.piece;
            completePromotion(piece);
        });
    });
}

/* =============================================================================
   SQUARE INTERACTION & MOVES
   ============================================================================= */

/**
 * Handle click on a board square.
 * Selects pieces, shows legal moves, or executes moves.
 *
 * @param {string} pos - Square position in algebraic notation (e.g., "e4")
 */
async function onSquareClick(pos) {
    // Ignore clicks during promotion selection
    if (pendingPromotion) return;

    // Ignore clicks when viewing replay (not live)
    if (replayIndex >= 0) return;

    if (!gameState || gameState.status === 'checkmate' || gameState.status === 'stalemate') {
        return;
    }

    // Block moves if it's not your color's turn (unless in debug play mode)
    // devModeIndex is defined in board-and-background-image-sync.js
    const isDebugPlayMode = typeof devModeIndex !== 'undefined' && devModeIndex === 2;
    if (myColor && myColor !== gameState.turn && !isDebugPlayMode) {
        return; // Not your turn
    }

    // If clicking on a legal move destination, make the move
    if (selectedSquare && legalMoves.some(m => m.to === pos)) {
        const move = { from: selectedSquare, to: pos };

        // Check if this is a promotion move
        const piece = gameState.board[selectedSquare];
        if (piece && piece.type === 'pawn') {
            const targetRank = parseInt(pos[1]);
            if ((piece.color === 'white' && targetRank === 8) ||
                (piece.color === 'black' && targetRank === 1)) {
                // Show promotion modal
                showPromotionModal(move, piece.color);
                return;
            }
        }

        await makeMove(move.from, move.to);
        return;
    }

    // If clicking on own piece, select it
    const piece = gameState.board[pos];
    if (piece && piece.color === gameState.turn) {
        selectedSquare = pos;
        await fetchLegalMoves(pos);
    } else {
        // Deselect
        selectedSquare = null;
        legalMoves = [];
    }

    updateUI();
}

/**
 * Show the promotion modal with piece options.
 *
 * @param {Object} move - The move {from, to} that triggered promotion
 * @param {string} color - "white" or "black" for piece icons
 */
function showPromotionModal(move, color) {
    pendingPromotion = move;
    const modal = document.getElementById('promotion-modal');
    const options = modal.querySelectorAll('.promotion-option');

    options.forEach(option => {
        const pieceType = option.dataset.piece;
        option.textContent = PIECES[color][pieceType];
    });

    modal.style.display = 'flex';
}

/** Hide the promotion modal and clear pending state. */
function hidePromotionModal() {
    document.getElementById('promotion-modal').style.display = 'none';
    pendingPromotion = null;
}

/**
 * Complete a promotion move with the selected piece type.
 *
 * @param {string} pieceType - One of: "queen", "rook", "bishop", "knight"
 */
async function completePromotion(pieceType) {
    if (!pendingPromotion) return;

    const { from, to } = pendingPromotion;
    hidePromotionModal();
    await makeMove(from, to, pieceType);
}

/**
 * Fetch legal moves for a piece at the given position.
 * Updates the legalMoves state variable.
 *
 * @param {string} pos - Square position in algebraic notation
 */
async function fetchLegalMoves(pos) {
    try {
        const response = await fetch(`${API_BASE}/games/${gameId}/moves?from=${pos}`);
        const data = await response.json();
        legalMoves = data.moves || [];
    } catch (error) {
        console.error('Failed to fetch moves:', error);
        legalMoves = [];
    }
}

/**
 * Submit a move to the server.
 * Handles promotion, check detection, and game over states.
 *
 * @param {string} from - Source square (e.g., "e2")
 * @param {string} to - Destination square (e.g., "e4")
 * @param {string|null} promotion - Promotion piece type or null
 */
async function makeMove(from, to, promotion = null) {
    try {
        const body = { from, to };
        if (promotion) {
            body.promotion = promotion;
        }

        const response = await fetch(`${API_BASE}/games/${gameId}/moves`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const error = await response.json();
            console.error('Move failed:', error);
            return;
        }

        // The color that just moved is the current turn (before we update gameState)
        const movedColor = gameState.turn;

        const oldStatus = gameState?.status;
        gameState = await response.json();

        // Lock player to the color they just moved (first move determines your color)
        // Only set if not already set and not in debug play mode
        const isDebugPlayMode = typeof devModeIndex !== 'undefined' && devModeIndex === 2;
        if (!myColor && !isDebugPlayMode) {
            myColor = movedColor;
            sessionStorage.setItem(`myColor_${gameId}`, myColor);
        }
        selectedSquare = null;
        legalMoves = [];
        replayIndex = -1; // Return to live view

        // Show check banner if newly in check
        if (gameState.status === 'check' && oldStatus !== 'check') {
            showCheckBanner();
        }

        // Auto-restart on game over
        if (gameState.status === 'checkmate' || gameState.status === 'stalemate') {
            setTimeout(() => newGame(), 2000);
        }

        updateUI();
    } catch (error) {
        console.error('Failed to make move:', error);
    }
}

/* =============================================================================
   UI FEEDBACK
   ============================================================================= */

/**
 * Show the "CHECK!" banner briefly.
 * Displays for 2 seconds then auto-hides.
 */
function showCheckBanner() {
    const banner = document.getElementById('check-banner');
    banner.style.display = 'block';
    setTimeout(() => {
        banner.style.display = 'none';
    }, 2000);
}

/* =============================================================================
   UNDO FUNCTIONS
   ============================================================================= */

/**
 * Request to undo the last move.
 * Sends request to server; opponent must accept/reject.
 */
async function requestUndo() {
    if (!gameId || gameState.moveHistory.length === 0) return;

    try {
        const response = await fetch(`${API_BASE}/games/${gameId}/undo/request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ color: gameState.turn })
        });

        if (response.ok) {
            gameState = await response.json();
            updateUI();
        }
    } catch (error) {
        console.error('Failed to request undo:', error);
    }
}

/** Accept the opponent's undo request. Reverts the last move. */
async function acceptUndo() {
    if (!gameId) return;

    try {
        const response = await fetch(`${API_BASE}/games/${gameId}/undo/accept`, {
            method: 'POST'
        });

        if (response.ok) {
            gameState = await response.json();
            replayIndex = -1;
            updateUI();
        }
    } catch (error) {
        console.error('Failed to accept undo:', error);
    }
}

/** Reject the opponent's undo request. Game continues unchanged. */
async function rejectUndo() {
    if (!gameId) return;

    try {
        const response = await fetch(`${API_BASE}/games/${gameId}/undo/reject`, {
            method: 'POST'
        });

        if (response.ok) {
            gameState = await response.json();
            updateUI();
        }
    } catch (error) {
        console.error('Failed to reject undo:', error);
    }
}

/* =============================================================================
   REPLAY NAVIGATION
   ============================================================================= */

/** Navigate to the first move in history (position after move 1). */
function replayFirst() {
    if (gameState.moveHistory.length === 0) return;
    replayIndex = 0;
    updateUI();
}

/** Navigate to the previous move. If at live, go to last move. */
function replayPrev() {
    if (replayIndex === -1) {
        replayIndex = gameState.moveHistory.length - 1;
    } else if (replayIndex > 0) {
        replayIndex--;
    }
    updateUI();
}

/** Navigate to the next move. If at end, return to live view. */
function replayNext() {
    if (replayIndex === -1) return;
    if (replayIndex < gameState.moveHistory.length - 1) {
        replayIndex++;
    } else {
        replayIndex = -1; // Go back to live
    }
    updateUI();
}

/** Navigate to the last move (same as live view). */
function replayLast() {
    replayIndex = -1;
    updateUI();
}

/** Return to live view (current game position). */
function replayLive() {
    replayIndex = -1;
    updateUI();
}

/**
 * Reconstruct board state at a given move index.
 * Replays all moves from initial position up to the specified index.
 *
 * @param {number} moveIndex - Index into moveHistory (-1 for initial position)
 * @returns {Object} Board state as {position: {type, color}} mapping
 */
function getBoardAtMove(moveIndex) {
    // Start with initial board
    const initialBoard = {
        'a1': { type: 'rook', color: 'white' },
        'b1': { type: 'knight', color: 'white' },
        'c1': { type: 'bishop', color: 'white' },
        'd1': { type: 'queen', color: 'white' },
        'e1': { type: 'king', color: 'white' },
        'f1': { type: 'bishop', color: 'white' },
        'g1': { type: 'knight', color: 'white' },
        'h1': { type: 'rook', color: 'white' },
        'a8': { type: 'rook', color: 'black' },
        'b8': { type: 'knight', color: 'black' },
        'c8': { type: 'bishop', color: 'black' },
        'd8': { type: 'queen', color: 'black' },
        'e8': { type: 'king', color: 'black' },
        'f8': { type: 'bishop', color: 'black' },
        'g8': { type: 'knight', color: 'black' },
        'h8': { type: 'rook', color: 'black' }
    };

    // Add pawns
    for (let file = 0; file < 8; file++) {
        const f = String.fromCharCode(97 + file);
        initialBoard[f + '2'] = { type: 'pawn', color: 'white' };
        initialBoard[f + '7'] = { type: 'pawn', color: 'black' };
    }

    if (moveIndex < 0) return initialBoard;

    const board = { ...initialBoard };

    // Apply moves up to moveIndex
    for (let i = 0; i <= moveIndex && i < gameState.moveHistory.length; i++) {
        const move = gameState.moveHistory[i];
        const piece = board[move.from];

        if (!piece) continue;

        // Handle castling
        if (piece.type === 'king') {
            const fileDiff = move.to.charCodeAt(0) - move.from.charCodeAt(0);
            if (Math.abs(fileDiff) === 2) {
                // Castling - move rook too
                const rank = move.from[1];
                if (fileDiff > 0) {
                    // Kingside
                    board['f' + rank] = board['h' + rank];
                    delete board['h' + rank];
                } else {
                    // Queenside
                    board['d' + rank] = board['a' + rank];
                    delete board['a' + rank];
                }
            }
        }

        // Handle en passant
        if (piece.type === 'pawn') {
            const fromFile = move.from.charCodeAt(0);
            const toFile = move.to.charCodeAt(0);
            const fromRank = parseInt(move.from[1]);
            const toRank = parseInt(move.to[1]);

            if (fromFile !== toFile && !board[move.to]) {
                // Diagonal move to empty square = en passant
                const capturedRank = piece.color === 'white' ? toRank - 1 : toRank + 1;
                delete board[String.fromCharCode(toFile) + capturedRank];
            }
        }

        // Move piece
        board[move.to] = piece;
        delete board[move.from];

        // Handle promotion
        if (move.promotion && piece.type === 'pawn') {
            board[move.to] = { type: move.promotion, color: piece.color };
        }
    }

    return board;
}

/* =============================================================================
   UI UPDATES
   ============================================================================= */

/**
 * Update the entire UI based on current game state.
 * Renders pieces, highlights, selection, legal moves, check indicators,
 * last move highlights, and undo panel visibility.
 */
function updateUI() {
    if (!gameState) return;

    // Determine which board to show
    const isLive = replayIndex === -1;
    const displayBoard = isLive ? gameState.board : getBoardAtMove(replayIndex);
    const displayMoveIndex = isLive ? gameState.moveHistory.length - 1 : replayIndex;

    // Update board pieces
    const squares = document.querySelectorAll('.square');
    squares.forEach(square => {
        const pos = square.dataset.pos;
        const piece = displayBoard[pos];

        // Reset classes
        square.className = square.className.replace(/ selected| legal-move| legal-capture| last-move| in-check| white-piece| black-piece/g, '');

        // Set piece (check reveal state)
        // When piecesHidden is true, only show pieces matching revealedPieces
        // When piecesHidden is false (normal mode), show all pieces
        // In calibration mode (devModeIndex === 1), always show all pieces
        let shouldShowPiece = false;
        if (piece) {
            if (typeof devModeIndex !== 'undefined' && devModeIndex === 1) {
                // Calibration mode - always show all pieces
                shouldShowPiece = true;
            } else if (!piecesHidden) {
                // Normal mode - show all pieces
                shouldShowPiece = true;
            } else if (revealedPieces === 'all') {
                // Both players ready - show all
                shouldShowPiece = true;
            } else if (revealedPieces === piece.color) {
                // Only show my color
                shouldShowPiece = true;
            }
            // If piecesHidden && revealedPieces is null or doesn't match, hide
        }

        if (shouldShowPiece) {
            square.textContent = PIECES[piece.color][piece.type];
            square.classList.add(piece.color + '-piece');
        } else {
            square.textContent = '';
        }

        // Only show interactive elements in live mode
        if (isLive) {
            // Highlight selected square
            if (pos === selectedSquare) {
                square.classList.add('selected');
            }

            // Highlight legal moves
            const isLegalMove = legalMoves.some(m => m.to === pos);
            if (isLegalMove) {
                if (gameState.board[pos]) {
                    square.classList.add('legal-capture');
                } else {
                    square.classList.add('legal-move');
                }
            }

            // Highlight king in check
            if (gameState.checkSquare === pos) {
                square.classList.add('in-check');
            }
        }

        // Highlight last move (works in both live and replay)
        if (displayMoveIndex >= 0 && displayMoveIndex < gameState.moveHistory.length) {
            const lastMove = gameState.moveHistory[displayMoveIndex];
            if (pos === lastMove.from || pos === lastMove.to) {
                square.classList.add('last-move');
            }
        }
    });

    // Update container class for status styling
    document.body.className = isLive ? `status-${gameState.status}` : '';


    // Update undo panel
    const undoPanel = document.getElementById('undo-panel');
    const undoMessage = document.getElementById('undo-message');
    if (gameState.undoRequest) {
        undoPanel.style.display = 'block';
        undoMessage.textContent = `${capitalize(gameState.undoRequest.requestedBy)} requested to undo the last move.`;
    } else {
        undoPanel.style.display = 'none';
    }

}

/**
 * Jump to a specific move in history.
 *
 * @param {number} index - Move index to display
 */
function goToMove(index) {
    replayIndex = index;
    updateUI();
}

/* =============================================================================
   UTILITY FUNCTIONS
   ============================================================================= */

/**
 * Convert file (0-7) and rank (0-7) to algebraic notation.
 *
 * @param {number} file - File index (0=a, 7=h)
 * @param {number} rank - Rank index (0=1, 7=8)
 * @returns {string} Position like "e4"
 */
function fileRankToNotation(file, rank) {
    return String.fromCharCode(97 + file) + (rank + 1);
}

/**
 * Capitalize the first letter of a string.
 *
 * @param {string} str - Input string
 * @returns {string} String with first letter capitalized
 */
function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/* =============================================================================
   CHAT FUNCTIONS
   ============================================================================= */

/**
 * Send a chat message to the server.
 * Adds message to UI immediately, then sends to server for opponent.
 */
async function sendChat() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message || !gameId) return;

    // Add to UI immediately
    addChatMessageToUI(message, 'sent');

    // Send to server
    try {
        await fetch(`${API_BASE}/games/${gameId}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                player: playerId,
                message: message,
                time: Date.now()
            })
        });
        // Add to local cache
        chatMessages.push({ player: playerId, message, time: Date.now() });
    } catch (error) {
        console.error('Failed to send chat:', error);
    }

    // Clear input
    input.value = '';
}

/**
 * Add a chat message bubble to the UI.
 *
 * @param {string} message - Message text to display
 * @param {string} type - "sent" for own messages, "received" for opponent
 */
function addChatMessageToUI(message, type) {
    const messagesContainer = document.getElementById('chat-messages');
    const messageEl = document.createElement('div');
    messageEl.className = `chat-message ${type}`;
    messageEl.textContent = message;
    messagesContainer.appendChild(messageEl);

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/* =============================================================================
   ENTRY POINT
   ============================================================================= */

// Start the application
init();
