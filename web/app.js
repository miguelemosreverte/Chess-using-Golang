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

/** WebSocket connection for real-time updates */
let ws = null;

/** Whether WebSocket is connected */
let wsConnected = false;

/** Reconnection timeout ID */
let wsReconnectTimeout = null;

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

/**
 * Championship/tournament state for tracking progress through board images.
 * Structure: {
 *   chapterId: string,           // Chapter being played
 *   currentBoardIndex: number,   // Current board image index
 *   totalBoards: number,         // Total boards in championship
 *   results: [{winner: 'white'|'black'|'draw'}], // Results per board
 *   active: boolean              // Whether championship mode is active
 * }
 */
let championshipState = null;

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

/** Whether this player is the game creator (came from book selector) */
let isGameCreator = false;

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

    // Generate unique player ID for this tab session
    playerId = sessionStorage.getItem('playerId');
    if (!playerId) {
        playerId = Math.random().toString(36).substr(2, 9);
        sessionStorage.setItem('playerId', playerId);
    }

    // Check URL params for championship continuation
    const params = new URLSearchParams(window.location.search);
    const boardIndex = parseInt(params.get('boardIndex') || '0');
    const isChampionshipContinuation = params.get('championship') === 'true' && boardIndex > 0;

    // Check if we're the game creator (came from book selector)
    // Use GAME-SPECIFIC keys to avoid sharing between tabs
    const creatorKey = `gameCreator_${gameId}`;
    const transitionKey = `transition_${gameId}`;
    const transitionData = sessionStorage.getItem(transitionKey);

    let transitionOverlay = null;

    // For championship continuation (games after the first), skip the overlay experience
    // Both players are already connected, just show the game immediately
    if (isChampionshipContinuation) {
        // Clear any transition data
        sessionStorage.removeItem(transitionKey);

        // Both players see everything immediately in continuation games
        piecesHidden = false;
        revealedPieces = 'all';

        // Determine color based on championship role (set during first game)
        // championshipRole: 'owner' = started the championship, 'guest' = joined via URL
        if (!myColor) {
            const championshipRole = sessionStorage.getItem('championshipRole');
            // Owner color alternates: game 0=white, game 1=black, game 2=white...
            const ownerColor = boardIndex % 2 === 0 ? 'white' : 'black';
            const guestColor = ownerColor === 'white' ? 'black' : 'white';
            myColor = championshipRole === 'owner' ? ownerColor : guestColor;
            sessionStorage.setItem(`myColor_${gameId}`, myColor);
        }
    } else if (transitionData) {
        // We're the game creator - parse transition data
        const transition = JSON.parse(transitionData);
        isGameCreator = true;

        // Clear immediately to prevent other tabs from seeing it
        sessionStorage.removeItem(transitionKey);

        // Mark this player as the creator of this game
        sessionStorage.setItem(creatorKey, playerId);

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
            <img src="${transition.boardImage}" style="
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

        // Game creator has hidden pieces until click
        piecesHidden = true;

        // Game creator's chat is hidden until opponent joins
        chatHiddenUntilOpponent = true;
        const chatPanel = document.querySelector('.chat-panel');
        if (chatPanel) {
            chatPanel.style.opacity = '0';
            chatPanel.style.transition = 'opacity 0.5s';
        }
    } else {
        // Check if we're the creator from a previous load (page refresh)
        const savedCreator = sessionStorage.getItem(creatorKey);
        if (savedCreator === playerId) {
            isGameCreator = true;
        }
        // If not the creator, we're joining - show everything immediately
        // No overlay, no hidden pieces, no hidden chat
    }

    // Load player color for this game (if previously set)
    myColor = sessionStorage.getItem(`myColor_${gameId}`) || null;

    renderBoard();
    setupPromotionModal();

    // Load game state
    await loadGame();

    // Initialize championship state (after background is set up)
    // We'll call this after setupBackgroundToggle to ensure currentChapter is loaded

    // Load existing chat messages
    await loadChat();

    // Setup background after board is rendered
    requestAnimationFrame(() => {
        setupBackgroundToggle().then(async () => {
            // Initialize championship state now that chapter is loaded
            initChampionshipState();

            // Background is fully loaded and rendered
            if (transitionOverlay) {
                // GAME CREATOR: Wait for click to reveal pieces
                transitionOverlay.addEventListener('click', () => {
                    // Fade out overlay
                    transitionOverlay.style.transition = 'opacity 0.5s ease-out';
                    transitionOverlay.style.opacity = '0';
                    setTimeout(() => {
                        transitionOverlay.remove();
                    }, 500);

                    // Game creator gets their color from championship (alternating) or defaults to white
                    if (!myColor) {
                        myColor = getMyColorForGame();
                        sessionStorage.setItem(`myColor_${gameId}`, myColor);
                        // Mark as championship owner for color alternation in future games
                        sessionStorage.setItem('championshipRole', 'owner');
                    }

                    // Reveal only MY pieces
                    // Keep piecesHidden = true so opponent pieces stays hidden until they join
                    revealedPieces = myColor;
                    updateUI();

                    // Send auto-hello to signal we're ready
                    sendAutoHello();

                    // Check if opponent already joined (reveals their pieces too)
                    checkForOpponent();
                });
            } else if (isGameCreator && piecesHidden) {
                // Game creator but no overlay (page refresh) - reveal on any board click
                document.getElementById('board').addEventListener('click', function onBoardClick() {
                    if (!myColor) {
                        myColor = getMyColorForGame();
                        sessionStorage.setItem(`myColor_${gameId}`, myColor);
                        sessionStorage.setItem('championshipRole', 'owner');
                    }

                    revealedPieces = myColor;
                    updateUI();
                    sendAutoHello();
                    checkForOpponent();
                    this.removeEventListener('click', onBoardClick);
                }, { once: true });
            } else if (!isGameCreator && !isChampionshipContinuation) {
                // JOINER (player 2): Show intro transition first, then reveal game
                // Get chapter info from URL to show the same intro experience
                const chapterParam = params.get('chapter');
                const boardParam = params.get('board');

                if (chapterParam && typeof currentChapter !== 'undefined' && currentChapter) {
                    // Show intro transition for joiner
                    await showJoinerIntro(currentChapter, boardParam);
                }

                // After intro, set up joiner state
                if (!myColor) {
                    // Player 2 gets opposite of player 1's color
                    const player1Color = getPlayer1ColorForGame();
                    myColor = player1Color === 'white' ? 'black' : 'white';
                    sessionStorage.setItem(`myColor_${gameId}`, myColor);
                    // Mark as guest for color alternation in future games
                    sessionStorage.setItem('championshipRole', 'guest');
                }

                // Show all pieces for joiner
                piecesHidden = false;
                revealedPieces = 'all';
                updateUI();

                // Send auto-hello to notify player 1
                sendAutoHello();
            }
        });
    });

    // Re-apply transforms on resize
    window.addEventListener('resize', () => {
        applyCornerTransform();
        applyBackground();
    });

    // Connect WebSocket for real-time updates
    connectWebSocket();

    // Start polling as fallback (less frequent when WebSocket is connected)
    setInterval(() => {
        if (!wsConnected) pollGameState();
    }, 1000);
    setInterval(() => {
        if (!wsConnected) pollChat();
    }, 1000);
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
    // Look for messages from other players (excluding system messages)
    const otherPlayerMessages = chatMessages.filter(msg =>
        msg.player !== playerId && !msg.message.startsWith('__')
    );

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

        // Check if opponent already joined (they may have sent messages before we loaded)
        checkForOpponent();
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

            // Handle game over
            if (gameState.status === 'checkmate' || gameState.status === 'stalemate') {
                setTimeout(() => {
                    handleGameEnd();
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
   WEBSOCKET CONNECTION
   ============================================================================= */

/**
 * Connect to WebSocket for real-time game updates.
 * Falls back to HTTP polling if WebSocket connection fails.
 */
function connectWebSocket() {
    if (!gameId) return;

    // Determine WebSocket URL based on current location
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/games/${gameId}/ws`;

    try {
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('WebSocket connected');
            wsConnected = true;

            // Clear any pending reconnect
            if (wsReconnectTimeout) {
                clearTimeout(wsReconnectTimeout);
                wsReconnectTimeout = null;
            }
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                handleWebSocketMessage(msg);
            } catch (e) {
                console.error('Failed to parse WebSocket message:', e);
            }
        };

        ws.onclose = () => {
            console.log('WebSocket disconnected');
            wsConnected = false;
            ws = null;

            // Attempt to reconnect after 3 seconds
            wsReconnectTimeout = setTimeout(() => {
                console.log('Attempting WebSocket reconnect...');
                connectWebSocket();
            }, 3000);
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            // Will trigger onclose, which handles reconnection
        };
    } catch (e) {
        console.error('Failed to create WebSocket:', e);
        wsConnected = false;
    }
}

/**
 * Handle incoming WebSocket messages.
 * @param {Object} msg - Parsed message with type and payload
 */
function handleWebSocketMessage(msg) {
    switch (msg.type) {
        case 'game_update':
            handleGameUpdate(msg.game);
            break;

        case 'chat':
            handleChatMessage(msg.message);
            break;

        case 'moves':
            // Response to get_moves request
            if (msg.moves && msg.moves.moves) {
                legalMoves = msg.moves.moves;
                updateUI();
            }
            break;

        case 'error':
            console.error('Server error:', msg.error);
            break;

        default:
            console.log('Unknown WebSocket message type:', msg.type);
    }
}

/**
 * Handle game state update from WebSocket.
 * @param {Object} game - Updated game state
 */
function handleGameUpdate(game) {
    const newMoveCount = game.moveHistory?.length || 0;
    const hadNewMove = newMoveCount !== lastMoveCount;

    if (hadNewMove) {
        lastMoveCount = newMoveCount;
        const oldStatus = gameState?.status;
        gameState = game;

        // Show check banner if newly in check
        if (gameState.status === 'check' && oldStatus !== 'check') {
            showCheckBanner();
        }

        // Handle game over
        if (gameState.status === 'checkmate' || gameState.status === 'stalemate') {
            setTimeout(() => {
                handleGameEnd();
            }, 2000);
        }
    } else {
        // Update state even without new moves (e.g., undo request changes)
        gameState = game;
    }

    updateUI();
}

/**
 * Handle chat message from WebSocket.
 * @param {Object} msg - Chat message with player, message, time
 */
function handleChatMessage(msg) {
    // Check if message is already in our local cache
    const isDuplicate = chatMessages.some(m =>
        m.player === msg.player &&
        m.message === msg.message &&
        m.time === msg.time
    );

    if (!isDuplicate) {
        chatMessages.push(msg);

        // Only add to UI if from another player
        if (msg.player !== playerId) {
            addChatMessageToUI(msg.message, 'received');
        }

        // Check if opponent has joined
        checkForOpponent();
    }
}

/**
 * Send a move via WebSocket.
 * Falls back to HTTP if WebSocket is not connected.
 * @param {string} from - Source square
 * @param {string} to - Destination square
 * @param {string|null} promotion - Promotion piece type
 * @returns {Promise<boolean>} - Whether the move was sent
 */
async function sendMoveWS(from, to, promotion = null) {
    if (wsConnected && ws && ws.readyState === WebSocket.OPEN) {
        const payload = { from, to };
        if (promotion) payload.promotion = promotion;

        ws.send(JSON.stringify({
            type: 'move',
            payload
        }));
        return true;
    }

    // Fall back to HTTP
    return false;
}

/**
 * Request legal moves via WebSocket.
 * Falls back to HTTP if WebSocket is not connected.
 * @param {string} pos - Square position
 * @returns {Promise<boolean>} - Whether request was sent via WebSocket
 */
async function requestMovesWS(pos) {
    if (wsConnected && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'get_moves',
            payload: { from: pos }
        }));
        return true;
    }
    return false;
}

/**
 * Send chat message via WebSocket.
 * Falls back to HTTP if WebSocket is not connected.
 * @param {string} message - Chat message
 * @returns {Promise<boolean>} - Whether sent via WebSocket
 */
async function sendChatWS(message) {
    if (wsConnected && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'chat',
            payload: {
                player: playerId,
                message: message,
                time: Date.now()
            }
        }));
        return true;
    }
    return false;
}

/**
 * Request undo via WebSocket.
 * Falls back to HTTP if WebSocket is not connected.
 * @param {string} color - Color requesting undo
 * @returns {Promise<boolean>} - Whether sent via WebSocket
 */
async function requestUndoWS(color) {
    if (wsConnected && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'undo_request',
            payload: { color }
        }));
        return true;
    }
    return false;
}

/**
 * Accept undo via WebSocket.
 * @returns {Promise<boolean>} - Whether sent via WebSocket
 */
async function acceptUndoWS() {
    if (wsConnected && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'undo_accept',
            payload: {}
        }));
        return true;
    }
    return false;
}

/**
 * Reject undo via WebSocket.
 * @returns {Promise<boolean>} - Whether sent via WebSocket
 */
async function rejectUndoWS() {
    if (wsConnected && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'undo_reject',
            payload: {}
        }));
        return true;
    }
    return false;
}

/* =============================================================================
   JOINER INTRO TRANSITION
   ============================================================================= */

/**
 * Show the intro transition for a joining player (player 2).
 * Displays the same accelerating image sequence that player 1 saw.
 * @param {Object} chapter - The chapter data
 * @param {string} boardFile - The board image filename
 */
async function showJoinerIntro(chapter, boardFile) {
    return new Promise(async (resolve) => {
        // Get chat images from chapter graph (if loaded)
        let chatImages = [];
        if (typeof chapterGraph !== 'undefined' && chapterGraph && chapterGraph.byType && chapterGraph.byType.chat) {
            chatImages = chapterGraph.byType.chat.map(c => `chapters/${chapter.id}/chat/${c.file}`);
        }

        // Board image path
        const boardImagePath = `chapters/${chapter.id}/board/${boardFile}`;

        // Create fullscreen overlay for the transition
        const overlay = document.createElement('div');
        overlay.id = 'joiner-intro-overlay';
        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            z-index: 9999;
            background: url('wood-bg.jpg') center/cover;
        `;

        // Create image element for the sequence
        const imgEl = document.createElement('img');
        imgEl.style.cssText = `
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
        `;
        overlay.appendChild(imgEl);

        document.body.appendChild(overlay);

        // Build image sequence: chat images + board image
        const imagesToShow = [];
        if (chatImages.length > 0) {
            // Use up to 5 chat images
            for (let i = 0; i < Math.min(5, chatImages.length); i++) {
                imagesToShow.push(chatImages[i % chatImages.length]);
            }
        }
        imagesToShow.push(boardImagePath);

        // Show accelerating image sequence
        let timing = 1000;
        const minTiming = 500;
        const speedFactor = 0.85;

        for (let i = 0; i < imagesToShow.length; i++) {
            imgEl.src = imagesToShow[i];
            await new Promise(r => setTimeout(r, timing));
            timing = Math.max(minTiming, timing * speedFactor);
        }

        // Show "Click to start" prompt on final image
        const prompt = document.createElement('div');
        prompt.style.cssText = `
            position: absolute;
            bottom: 20%;
            left: 50%;
            transform: translateX(-50%);
            color: white;
            font-family: Georgia, serif;
            font-size: 1.5em;
            text-shadow: 0 2px 10px rgba(0,0,0,0.8);
            animation: pulse 2s infinite;
        `;
        prompt.textContent = 'Click to start';

        // Add pulse animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes pulse {
                0%, 100% { opacity: 0.7; }
                50% { opacity: 1; }
            }
        `;
        overlay.appendChild(style);
        overlay.appendChild(prompt);

        // Wait for click
        overlay.style.cursor = 'pointer';
        overlay.addEventListener('click', () => {
            // Fade out and remove
            overlay.style.transition = 'opacity 0.5s ease-out';
            overlay.style.opacity = '0';
            setTimeout(() => {
                overlay.remove();
                resolve();
            }, 500);
        }, { once: true });
    });
}

/* =============================================================================
   CHAMPIONSHIP MODE
   ============================================================================= */

/**
 * Get the color for the game creator (player 1) for this game.
 * In championship mode, colors alternate each game.
 * @returns {string} 'white' or 'black'
 */
function getMyColorForGame() {
    if (championshipState && championshipState.active) {
        // In championship, alternate colors each game
        // Game 0: creator=white, Game 1: creator=black, etc.
        const gameNumber = championshipState.currentBoardIndex;
        return gameNumber % 2 === 0 ? 'white' : 'black';
    }
    // Default: game creator is white
    return 'white';
}

/**
 * Get player 1's (game creator's) color for this game.
 * Used by player 2 to determine their own color.
 * @returns {string} 'white' or 'black'
 */
function getPlayer1ColorForGame() {
    // Check if there's a championship state that tells us the color
    if (championshipState && championshipState.active) {
        const gameNumber = championshipState.currentBoardIndex;
        return gameNumber % 2 === 0 ? 'white' : 'black';
    }
    // Default: player 1 (game creator) is white
    return 'white';
}

/**
 * Initialize championship state from sessionStorage or URL params.
 * Called during init to resume any active championship.
 */
function initChampionshipState() {
    // Check URL params for championship flag
    const params = new URLSearchParams(window.location.search);
    const isChampionship = params.get('championship') === 'true';
    const boardIndex = parseInt(params.get('boardIndex') || '0');

    // Load saved state
    const saved = sessionStorage.getItem('championshipState');
    if (saved) {
        try {
            championshipState = JSON.parse(saved);
            // Update board index from URL if provided
            if (isChampionship && !isNaN(boardIndex)) {
                championshipState.currentBoardIndex = boardIndex;
            }
        } catch (e) {
            championshipState = null;
        }
    }

    // If URL says championship mode but no state, create new state
    if (isChampionship && !championshipState && typeof currentChapter !== 'undefined' && currentChapter) {
        championshipState = {
            chapterId: currentChapter.id,
            currentBoardIndex: boardIndex,
            totalBoards: currentChapter.boardImages.length,
            results: [],
            active: true
        };
        saveChampionshipState();
    }
}

/**
 * Save championship state to sessionStorage.
 */
function saveChampionshipState() {
    if (championshipState) {
        sessionStorage.setItem('championshipState', JSON.stringify(championshipState));
    } else {
        sessionStorage.removeItem('championshipState');
    }
}

/**
 * Record a game result and advance to next board in championship.
 * @param {string} winner - 'white', 'black', or 'draw'
 */
function recordChampionshipResult(winner) {
    if (!championshipState || !championshipState.active) return;

    // Record the result
    championshipState.results.push({ winner });
    championshipState.currentBoardIndex++;
    saveChampionshipState();

    // Check if championship is complete
    if (championshipState.currentBoardIndex >= championshipState.totalBoards) {
        // Championship complete - show results
        showChampionshipResults();
    } else {
        // Only the championship OWNER creates the next game
        // The guest will receive the next game URL via chat message
        const role = sessionStorage.getItem('championshipRole');
        if (role === 'owner') {
            advanceToNextBoardGame();
        } else {
            // Guest: wait for next game URL from owner
            waitForNextGameUrl();
        }
    }
}

/**
 * Create a new game on the next board image in the championship.
 * Only called by the championship owner - sends URL to guest via chat.
 */
async function advanceToNextBoardGame() {
    if (!championshipState) return;

    // Create a new game via API
    try {
        const response = await fetch(`${API_BASE}/games`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });

        if (response.ok) {
            const data = await response.json();
            const newGameId = data.id;

            // Build the next game URL
            const boardFile = currentChapter.boardImages[championshipState.currentBoardIndex].file;
            const nextGameUrl = `/${newGameId}?championship=true&chapter=${championshipState.chapterId}&boardIndex=${championshipState.currentBoardIndex}&board=${boardFile}`;

            // Copy existing chat messages to the new game (excluding system messages)
            const messagesToCopy = chatMessages.filter(msg => !msg.message.startsWith('__'));
            for (const msg of messagesToCopy) {
                try {
                    await fetch(`${API_BASE}/games/${newGameId}/chat`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            player: msg.player,
                            message: msg.message,
                            time: msg.time
                        })
                    });
                } catch (e) {
                    // Ignore errors copying messages
                }
            }

            // Send the next game URL to the guest via chat (in OLD game)
            // Use a special message format that the guest will detect
            try {
                await fetch(`${API_BASE}/games/${gameId}/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        player: playerId,
                        message: `__NEXT_GAME__:${nextGameUrl}`,
                        time: Date.now()
                    })
                });
            } catch (e) {
                console.error('Failed to send next game URL:', e);
            }

            // Small delay to ensure message is sent before navigating
            await new Promise(resolve => setTimeout(resolve, 500));

            // Get the next board image for transition
            let imagePath = '';
            if (typeof currentChapter !== 'undefined' && currentChapter) {
                const nextBoardImage = currentChapter.boardImages[championshipState.currentBoardIndex];
                if (nextBoardImage) {
                    imagePath = `chapters/${currentChapter.id}/board/${nextBoardImage.file}`;
                }
            }

            // Store transition data with GAME-SPECIFIC key (for owner only)
            sessionStorage.setItem(`transition_${newGameId}`, JSON.stringify({
                boardImage: imagePath,
                chapterId: championshipState.chapterId
            }));

            // Navigate to next game
            window.location.href = nextGameUrl;
        }
    } catch (error) {
        console.error('Failed to create next championship game:', error);
    }
}

/**
 * Wait for the championship owner to send the next game URL via chat.
 * Called by the guest when a game ends.
 */
async function waitForNextGameUrl() {
    // Show waiting message
    const waitingOverlay = document.createElement('div');
    waitingOverlay.id = 'waiting-overlay';
    waitingOverlay.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
    `;
    waitingOverlay.innerHTML = `
        <div style="
            color: white;
            font-family: Georgia, serif;
            font-size: 1.5em;
            text-align: center;
        ">
            <div>Preparing next game...</div>
            <div style="font-size: 0.8em; margin-top: 10px; opacity: 0.7;">
                Game ${championshipState.currentBoardIndex + 1} of ${championshipState.totalBoards}
            </div>
        </div>
    `;
    document.body.appendChild(waitingOverlay);

    // Poll for the next game URL message
    const pollForNextGame = async () => {
        try {
            const response = await fetch(`${API_BASE}/games/${gameId}/chat`);
            if (response.ok) {
                const messages = await response.json();
                // Look for the __NEXT_GAME__ message
                for (const msg of messages) {
                    if (msg.message && msg.message.startsWith('__NEXT_GAME__:')) {
                        const nextGameUrl = msg.message.replace('__NEXT_GAME__:', '');
                        // Navigate to the next game
                        window.location.href = nextGameUrl;
                        return;
                    }
                }
            }
        } catch (e) {
            console.error('Error polling for next game:', e);
        }
        // Keep polling
        setTimeout(pollForNextGame, 500);
    };

    pollForNextGame();
}

/**
 * Calculate championship score for a player.
 * @param {string} color - 'white' or 'black'
 * @returns {number} Total score (wins = 1, draws = 0.5)
 */
function getChampionshipScore(color) {
    if (!championshipState) return 0;

    return championshipState.results.reduce((score, result) => {
        if (result.winner === color) return score + 1;
        if (result.winner === 'draw') return score + 0.5;
        return score;
    }, 0);
}

/**
 * Show the championship results screen.
 * Creates a modal overlay with the final results.
 */
function showChampionshipResults() {
    if (!championshipState) return;

    const myScore = getChampionshipScore(myColor || 'white');
    const oppScore = getChampionshipScore(myColor === 'white' ? 'black' : 'white');
    const total = championshipState.totalBoards;

    const isVictory = myScore > oppScore;
    const isDraw = myScore === oppScore;

    const resultText = isVictory ? 'Victory!' : (isDraw ? 'Draw!' : 'Defeat');
    const scoreText = `${myScore} out of ${total}`;

    // Create results modal
    const modal = document.createElement('div');
    modal.id = 'championship-results';
    modal.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(20, 15, 10, 0.95);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 500;
        animation: fade-in 0.5s ease;
    `;

    modal.innerHTML = `
        <div style="
            background: url('wood-border.jpg');
            background-size: cover;
            border-radius: 12px;
            padding: 40px 60px;
            text-align: center;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
            max-width: 90vw;
            max-height: 80vh;
            overflow-y: auto;
        ">
            <h2 style="
                font-size: 2rem;
                color: #fff8e8;
                text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
                margin-bottom: 10px;
                letter-spacing: 0.1em;
            ">CHAMPIONSHIP COMPLETE</h2>

            <div style="
                font-size: 2.5rem;
                color: ${isVictory ? '#90EE90' : (isDraw ? '#FFD700' : '#FF6B6B')};
                margin: 20px 0;
                text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
            ">${resultText}</div>

            <div style="
                font-size: 1.5rem;
                color: rgba(255, 248, 232, 0.9);
                margin-bottom: 30px;
            ">${scoreText}</div>

            <div id="championship-grid" style="
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
                gap: 10px;
                margin-bottom: 30px;
                max-width: 500px;
            "></div>

            <button onclick="returnToMenu()" style="
                padding: 12px 30px;
                font-size: 1rem;
                background: rgba(200, 160, 100, 0.85);
                border: none;
                border-radius: 4px;
                color: #3d2510;
                cursor: pointer;
            ">Play Again</button>
        </div>
    `;

    document.body.appendChild(modal);

    // Populate results grid with board thumbnails
    const grid = document.getElementById('championship-grid');
    if (grid && typeof currentChapter !== 'undefined' && currentChapter) {
        championshipState.results.forEach((result, i) => {
            const boardImg = currentChapter.boardImages[i];
            if (boardImg) {
                const cell = document.createElement('div');
                cell.style.cssText = `
                    position: relative;
                    aspect-ratio: 1;
                    border-radius: 4px;
                    overflow: hidden;
                `;

                const img = document.createElement('img');
                img.src = `chapters/${currentChapter.id}/board/${boardImg.file}`;
                img.style.cssText = `
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                    opacity: 0.7;
                `;
                cell.appendChild(img);

                // Win/Loss/Draw indicator
                const indicator = document.createElement('div');
                const isWin = result.winner === myColor;
                const isLoss = result.winner !== myColor && result.winner !== 'draw';
                indicator.textContent = isWin ? '✓' : (isLoss ? '✗' : '½');
                indicator.style.cssText = `
                    position: absolute;
                    inset: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 2rem;
                    color: ${isWin ? '#90EE90' : (isLoss ? '#FF6B6B' : '#FFD700')};
                    text-shadow: 0 2px 4px rgba(0, 0, 0, 0.8);
                    background: rgba(0, 0, 0, 0.3);
                `;
                cell.appendChild(indicator);

                grid.appendChild(cell);
            }
        });
    }

    // Clear championship state
    championshipState.active = false;
    saveChampionshipState();
}

/**
 * Return to menu (clear championship and go home).
 */
function returnToMenu() {
    sessionStorage.removeItem('championshipState');
    sessionStorage.removeItem('championshipRole');
    window.location.href = '/';
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
 * Uses WebSocket if connected, falls back to HTTP.
 * Updates the legalMoves state variable.
 *
 * @param {string} pos - Square position in algebraic notation
 */
async function fetchLegalMoves(pos) {
    // Try WebSocket first
    const sentViaWS = await requestMovesWS(pos);
    if (sentViaWS) {
        // WebSocket will update legalMoves via handleWebSocketMessage
        return;
    }

    // Fall back to HTTP
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
 * Uses WebSocket if connected, falls back to HTTP.
 * Handles promotion, check detection, and game over states.
 *
 * @param {string} from - Source square (e.g., "e2")
 * @param {string} to - Destination square (e.g., "e4")
 * @param {string|null} promotion - Promotion piece type or null
 */
async function makeMove(from, to, promotion = null) {
    // The color that just moved is the current turn (before we update gameState)
    const movedColor = gameState.turn;

    // Lock player to the color they just moved (first move determines your color)
    // Only set if not already set and not in debug play mode
    const isDebugPlayMode = typeof devModeIndex !== 'undefined' && devModeIndex === 2;
    if (!myColor && !isDebugPlayMode) {
        myColor = movedColor;
        sessionStorage.setItem(`myColor_${gameId}`, myColor);
    }

    // Clear selection immediately for responsive feel
    selectedSquare = null;
    legalMoves = [];
    replayIndex = -1; // Return to live view

    // Try WebSocket first
    const sentViaWS = await sendMoveWS(from, to, promotion);
    if (sentViaWS) {
        // WebSocket will handle response via handleGameUpdate
        return;
    }

    // Fall back to HTTP
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

        const oldStatus = gameState?.status;
        gameState = await response.json();

        // Show check banner if newly in check
        if (gameState.status === 'check' && oldStatus !== 'check') {
            showCheckBanner();
        }

        // Handle game over
        if (gameState.status === 'checkmate' || gameState.status === 'stalemate') {
            setTimeout(() => handleGameEnd(), 2000);
        }

        updateUI();
    } catch (error) {
        console.error('Failed to make move:', error);
    }
}

/**
 * Handle game end (checkmate or stalemate).
 * In championship mode, records result and advances to next board.
 * In regular mode, redirects to home.
 */
function handleGameEnd() {
    if (!gameState) return;

    // Determine the winner
    let winner;
    if (gameState.status === 'stalemate') {
        winner = 'draw';
    } else if (gameState.status === 'checkmate') {
        // The player who just moved won (it's currently the opponent's turn who is checkmated)
        winner = gameState.turn === 'white' ? 'black' : 'white';
    }

    // If in championship mode, record result and advance
    if (championshipState && championshipState.active) {
        recordChampionshipResult(winner);
    } else {
        // Regular game - go back to menu
        newGame();
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
 * Uses WebSocket if connected, falls back to HTTP.
 * Sends request to server; opponent must accept/reject.
 */
async function requestUndo() {
    if (!gameId || gameState.moveHistory.length === 0) return;

    // Try WebSocket first
    const sentViaWS = await requestUndoWS(gameState.turn);
    if (sentViaWS) {
        // WebSocket will handle response via handleGameUpdate
        return;
    }

    // Fall back to HTTP
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

/**
 * Accept the opponent's undo request.
 * Uses WebSocket if connected, falls back to HTTP.
 * Reverts the last move.
 */
async function acceptUndo() {
    if (!gameId) return;

    // Try WebSocket first
    const sentViaWS = await acceptUndoWS();
    if (sentViaWS) {
        replayIndex = -1;
        // WebSocket will handle response via handleGameUpdate
        return;
    }

    // Fall back to HTTP
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

/**
 * Reject the opponent's undo request.
 * Uses WebSocket if connected, falls back to HTTP.
 * Game continues unchanged.
 */
async function rejectUndo() {
    if (!gameId) return;

    // Try WebSocket first
    const sentViaWS = await rejectUndoWS();
    if (sentViaWS) {
        // WebSocket will handle response via handleGameUpdate
        return;
    }

    // Fall back to HTTP
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

    // Flip board for black player (unless in debug play mode)
    const board = document.getElementById('board');
    const isDebugPlayMode = typeof devModeIndex !== 'undefined' && devModeIndex === 2;
    if (myColor === 'black' && !isDebugPlayMode) {
        board.classList.add('board-flipped');
    } else {
        board.classList.remove('board-flipped');
    }

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

    await sendChatMessage(message);

    // Clear input
    input.value = '';
}

/**
 * Send a chat message programmatically (without using the input field).
 * Uses WebSocket if connected, falls back to HTTP.
 * Used for system messages like next game URL.
 * @param {string} message - The message to send
 */
async function sendChatMessage(message) {
    if (!message || !gameId) return;

    // Add to UI immediately (unless it's a system message)
    addChatMessageToUI(message, 'sent');

    // Add to local cache
    const time = Date.now();
    chatMessages.push({ player: playerId, message, time });

    // Try WebSocket first
    const sentViaWS = await sendChatWS(message);
    if (sentViaWS) {
        // WebSocket will handle broadcast
        return;
    }

    // Fall back to HTTP
    try {
        await fetch(`${API_BASE}/games/${gameId}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                player: playerId,
                message: message,
                time: time
            })
        });
    } catch (error) {
        console.error('Failed to send chat:', error);
    }
}

/**
 * Add a chat message bubble to the UI.
 *
 * @param {string} message - Message text to display
 * @param {string} type - "sent" for own messages, "received" for opponent
 */
function addChatMessageToUI(message, type) {
    // Don't display system messages (like __NEXT_GAME__)
    if (message.startsWith('__')) {
        return;
    }

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
