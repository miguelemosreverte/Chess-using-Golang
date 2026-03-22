/**
 * Chess UI Application
 * ====================
 *
 * Main application logic for the chess game UI. Handles:
 * - Game state management via Firebase + chess.js
 * - Board rendering and piece interaction
 * - Move validation and submission
 * - Special moves: promotion, castling, en passant
 * - Undo request/accept/reject flow
 * - Move history replay navigation
 * - Real-time chat between players
 *
 * Related files:
 * - firebase-chess-engine.js: Chess logic + Firebase sync
 * - board-and-background-image-sync.js: Perspective transform and background alignment
 * - style.css: All visual styling
 * - index.html: DOM structure
 */

/* =============================================================================
   CONSTANTS
   ============================================================================= */

/** Unicode symbols for chess pieces, indexed by color and piece type */
const PIECES = {
    white: { king: '\u2654', queen: '\u2655', rook: '\u2656', bishop: '\u2657', knight: '\u2658', pawn: '\u2659' },
    black: { king: '\u265A', queen: '\u265B', rook: '\u265C', bishop: '\u265D', knight: '\u265E', pawn: '\u265F' }
};

/* =============================================================================
   APPLICATION STATE
   ============================================================================= */

/** Current game ID from URL path */
let gameId = null;

/** Full game state (board, turn, status, moveHistory, etc.) */
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

/** Move count at last update, used to detect new moves from opponent */
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
 */
let championshipState = null;

/* =============================================================================
   INITIALIZATION
   ============================================================================= */

/** Whether pieces are hidden until user clicks (from book transition) */
let piecesHidden = false;

/** Which color's pieces are revealed */
let revealedPieces = null;

/** Whether chat is hidden until opponent joins */
let chatHiddenUntilOpponent = false;

/** Whether we've sent the auto-hello message */
let autoHelloSent = false;

/** Whether this player is the game creator (came from book selector) */
let isGameCreator = false;

/**
 * Initialize the application on page load.
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
    const creatorKey = `gameCreator_${gameId}`;
    const transitionKey = `transition_${gameId}`;
    const transitionData = sessionStorage.getItem(transitionKey);

    let transitionOverlay = null;

    if (isChampionshipContinuation) {
        sessionStorage.removeItem(transitionKey);
        piecesHidden = false;
        revealedPieces = 'all';

        if (!myColor) {
            const championshipRole = sessionStorage.getItem('championshipRole');
            const ownerColor = boardIndex % 2 === 0 ? 'white' : 'black';
            const guestColor = ownerColor === 'white' ? 'black' : 'white';
            myColor = championshipRole === 'owner' ? ownerColor : guestColor;
            sessionStorage.setItem(`myColor_${gameId}`, myColor);
        }
    } else if (transitionData) {
        const transition = JSON.parse(transitionData);
        isGameCreator = true;
        sessionStorage.removeItem(transitionKey);
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

        const style = document.createElement('style');
        style.textContent = `
            @keyframes pulse {
                0%, 100% { opacity: 0.7; }
                50% { opacity: 1; }
            }
        `;
        transitionOverlay.appendChild(style);
        document.body.appendChild(transitionOverlay);

        piecesHidden = true;
        chatHiddenUntilOpponent = true;
        const chatPanel = document.querySelector('.chat-panel');
        if (chatPanel) {
            chatPanel.style.opacity = '0';
            chatPanel.style.transition = 'opacity 0.5s';
        }
    } else {
        const savedCreator = sessionStorage.getItem(creatorKey);
        if (savedCreator === playerId) {
            isGameCreator = true;
        }
    }

    // Load player color for this game (if previously set)
    myColor = sessionStorage.getItem(`myColor_${gameId}`) || null;

    renderBoard();
    setupPromotionModal();

    // Load game state
    await loadGame();

    // Load existing chat messages
    await loadChat();

    // Subscribe to real-time updates from Firebase
    subscribeToFirebaseUpdates();

    // Setup background after board is rendered
    requestAnimationFrame(() => {
        setupBackgroundToggle().then(async () => {
            initChampionshipState();

            if (transitionOverlay) {
                transitionOverlay.addEventListener('click', () => {
                    transitionOverlay.style.transition = 'opacity 0.5s ease-out';
                    transitionOverlay.style.opacity = '0';
                    setTimeout(() => {
                        transitionOverlay.remove();
                    }, 500);

                    if (!myColor) {
                        myColor = getMyColorForGame();
                        sessionStorage.setItem(`myColor_${gameId}`, myColor);
                        sessionStorage.setItem('championshipRole', 'owner');
                    }

                    revealedPieces = myColor;
                    updateUI();
                    sendAutoHello();
                    checkForOpponent();

                    setTimeout(() => {
                        if (revealedPieces !== 'all') {
                            revealedPieces = 'all';
                            updateUI();
                        }
                    }, 3000);
                });
            } else if (isGameCreator && piecesHidden) {
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
                const chapterParam = params.get('chapter');
                const boardParam = params.get('board');

                if (chapterParam && typeof currentChapter !== 'undefined' && currentChapter) {
                    await showJoinerIntro(currentChapter, boardParam);
                }

                if (!myColor) {
                    const player1Color = getPlayer1ColorForGame();
                    myColor = player1Color === 'white' ? 'black' : 'white';
                    sessionStorage.setItem(`myColor_${gameId}`, myColor);
                    sessionStorage.setItem('championshipRole', 'guest');
                }

                piecesHidden = false;
                revealedPieces = 'all';
                updateUI();
                sendAutoHello();
            }
        });
    });

    // Re-apply transforms on resize
    window.addEventListener('resize', () => {
        applyCornerTransform();
        applyBackground();
    });
}

/**
 * Subscribe to Firebase real-time updates for game state and chat.
 */
function subscribeToFirebaseUpdates() {
    if (!gameId) return;

    // Subscribe to game state changes
    firebaseSubscribeGame(gameId, (state) => {
        const newMoveCount = state.moveHistory?.length || 0;
        if (newMoveCount !== lastMoveCount) {
            lastMoveCount = newMoveCount;
            const oldStatus = gameState?.status;
            gameState = state;

            if (gameState.status === 'check' && oldStatus !== 'check') {
                showCheckBanner();
            }

            if (gameState.status === 'checkmate' || gameState.status === 'stalemate') {
                setTimeout(() => {
                    handleGameEnd();
                }, 2000);
            }
        } else {
            // Update state even without new moves (e.g., undo request changes)
            gameState = state;
        }
        updateUI();
    });

    // Subscribe to chat messages
    const seenChatKeys = new Set();
    firebaseSubscribeChat(gameId, (msg) => {
        // Deduplicate
        const key = msg.player + '_' + msg.message + '_' + msg.time;
        if (seenChatKeys.has(key)) return;
        seenChatKeys.add(key);

        // Check if already in local cache
        const isDuplicate = chatMessages.some(m =>
            m.player === msg.player &&
            m.message === msg.message &&
            m.time === msg.time
        );

        if (!isDuplicate) {
            chatMessages.push(msg);
            if (msg.player !== playerId) {
                addChatMessageToUI(msg.message, 'received');
            }
            checkForOpponent();
        }
    });
}

/**
 * Send an automatic "hello" message when entering the game.
 */
async function sendAutoHello() {
    if (autoHelloSent) return;
    autoHelloSent = true;

    try {
        await firebaseSendChat(gameId, playerId, '\u{1F44B} Hello!');
    } catch (e) {
        console.error('Failed to send auto-hello:', e);
    }
}

/**
 * Check if opponent has joined (by looking at chat messages).
 */
function checkForOpponent() {
    const otherPlayerMessages = chatMessages.filter(msg =>
        msg.player !== playerId && !msg.message.startsWith('__')
    );

    if (otherPlayerMessages.length > 0) {
        if (chatHiddenUntilOpponent) {
            chatHiddenUntilOpponent = false;
            const chatPanel = document.querySelector('.chat-panel');
            if (chatPanel) {
                chatPanel.style.opacity = '1';
            }
        }

        if (piecesHidden && revealedPieces && revealedPieces !== 'all') {
            revealedPieces = 'all';
            updateUI();
        }
    }
}

/* =============================================================================
   GAME STATE
   ============================================================================= */

/**
 * Load existing chat messages from Firebase.
 */
async function loadChat() {
    if (!gameId) return;
    try {
        const messages = await firebaseLoadChat(gameId);
        chatMessages = messages;
        messages.forEach(msg => {
            const type = msg.player === playerId ? 'sent' : 'received';
            addChatMessageToUI(msg.message, type);
        });
        checkForOpponent();
    } catch (error) {
        console.error('Failed to load chat:', error);
    }
}

/**
 * Load game state from Firebase.
 */
async function loadGame() {
    try {
        const state = await firebaseGetGameState(gameId);
        if (!state) {
            // Game doesn't exist in Firebase yet - create it
            const chess = getChessInstance(gameId);
            const initialState = {
                fen: chess.fen(),
                turn: 'white',
                status: 'active',
                moveHistory: [],
                checkSquare: null,
                undoRequest: null
            };
            await firebaseDb.ref('games/' + gameId).set(initialState);
            gameState = buildGameState(chess, [], null);
        } else {
            gameState = state;
        }
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

/* =============================================================================
   JOINER INTRO TRANSITION
   ============================================================================= */

/**
 * Show the intro transition for a joining player (player 2).
 */
async function showJoinerIntro(chapter, boardFile) {
    return new Promise(async (resolve) => {
        let chatImages = [];
        if (typeof chapterGraph !== 'undefined' && chapterGraph && chapterGraph.byType && chapterGraph.byType.chat) {
            chatImages = chapterGraph.byType.chat.map(c => `chapters/${chapter.id}/chat/${c.file}`);
        }

        const boardImagePath = `chapters/${chapter.id}/board/${boardFile}`;

        const overlay = document.createElement('div');
        overlay.id = 'joiner-intro-overlay';
        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            z-index: 9999;
            background: url('wood-bg.jpg') center/cover;
        `;

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

        const imagesToShow = [];
        if (chatImages.length > 0) {
            for (let i = 0; i < Math.min(5, chatImages.length); i++) {
                imagesToShow.push(chatImages[i % chatImages.length]);
            }
        }
        imagesToShow.push(boardImagePath);

        let timing = 1000;
        const minTiming = 500;
        const speedFactor = 0.85;

        for (let i = 0; i < imagesToShow.length; i++) {
            imgEl.src = imagesToShow[i];
            await new Promise(r => setTimeout(r, timing));
            timing = Math.max(minTiming, timing * speedFactor);
        }

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

        const style = document.createElement('style');
        style.textContent = `
            @keyframes pulse {
                0%, 100% { opacity: 0.7; }
                50% { opacity: 1; }
            }
        `;
        overlay.appendChild(style);
        overlay.appendChild(prompt);

        overlay.style.cursor = 'pointer';
        overlay.addEventListener('click', () => {
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

function getMyColorForGame() {
    if (championshipState && championshipState.active) {
        const gameNumber = championshipState.currentBoardIndex;
        return gameNumber % 2 === 0 ? 'white' : 'black';
    }
    return 'white';
}

function getPlayer1ColorForGame() {
    if (championshipState && championshipState.active) {
        const gameNumber = championshipState.currentBoardIndex;
        return gameNumber % 2 === 0 ? 'white' : 'black';
    }
    return 'white';
}

function initChampionshipState() {
    const params = new URLSearchParams(window.location.search);
    const isChampionship = params.get('championship') === 'true';
    const boardIndex = parseInt(params.get('boardIndex') || '0');

    const saved = sessionStorage.getItem('championshipState');
    if (saved) {
        try {
            championshipState = JSON.parse(saved);
            if (isChampionship && !isNaN(boardIndex)) {
                championshipState.currentBoardIndex = boardIndex;
            }
        } catch (e) {
            championshipState = null;
        }
    }

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

function saveChampionshipState() {
    if (championshipState) {
        sessionStorage.setItem('championshipState', JSON.stringify(championshipState));
    } else {
        sessionStorage.removeItem('championshipState');
    }
}

function recordChampionshipResult(winner) {
    if (!championshipState || !championshipState.active) return;

    championshipState.results.push({ winner });
    championshipState.currentBoardIndex++;
    saveChampionshipState();

    if (championshipState.currentBoardIndex >= championshipState.totalBoards) {
        showChampionshipResults();
    } else {
        const role = sessionStorage.getItem('championshipRole');
        if (role === 'owner') {
            advanceToNextBoardGame();
        } else {
            waitForNextGameUrl();
        }
    }
}

/**
 * Create a new game on the next board image in the championship.
 */
async function advanceToNextBoardGame() {
    if (!championshipState) return;

    try {
        const newGameId = await firebaseCreateGame();
        const boardFile = currentChapter.boardImages[championshipState.currentBoardIndex].file;
        const nextGameUrl = `/${newGameId}?championship=true&chapter=${championshipState.chapterId}&boardIndex=${championshipState.currentBoardIndex}&board=${boardFile}`;

        // Copy existing chat messages to the new game
        const messagesToCopy = chatMessages.filter(msg => !msg.message.startsWith('__'));
        for (const msg of messagesToCopy) {
            try {
                await firebaseSendChat(newGameId, msg.player, msg.message);
            } catch (e) {
                // Ignore errors copying messages
            }
        }

        // Send the next game URL to the guest via chat (in OLD game)
        try {
            await firebaseSendChat(gameId, playerId, `__NEXT_GAME__:${nextGameUrl}`);
        } catch (e) {
            console.error('Failed to send next game URL:', e);
        }

        await new Promise(resolve => setTimeout(resolve, 500));

        let imagePath = '';
        if (typeof currentChapter !== 'undefined' && currentChapter) {
            const nextBoardImage = currentChapter.boardImages[championshipState.currentBoardIndex];
            if (nextBoardImage) {
                imagePath = `chapters/${currentChapter.id}/board/${nextBoardImage.file}`;
            }
        }

        sessionStorage.setItem(`transition_${newGameId}`, JSON.stringify({
            boardImage: imagePath,
            chapterId: championshipState.chapterId
        }));

        window.location.href = nextGameUrl;
    } catch (error) {
        console.error('Failed to create next championship game:', error);
    }
}

/**
 * Wait for the championship owner to send the next game URL via chat.
 */
async function waitForNextGameUrl() {
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

    // Firebase listener will pick up the __NEXT_GAME__ message automatically
    // We just need to watch chatMessages for it
    const checkForNextGame = () => {
        for (const msg of chatMessages) {
            if (msg.message && msg.message.startsWith('__NEXT_GAME__:')) {
                const nextGameUrl = msg.message.replace('__NEXT_GAME__:', '');
                window.location.href = nextGameUrl;
                return;
            }
        }
        setTimeout(checkForNextGame, 500);
    };
    checkForNextGame();
}

function getChampionshipScore(color) {
    if (!championshipState) return 0;
    return championshipState.results.reduce((score, result) => {
        if (result.winner === color) return score + 1;
        if (result.winner === 'draw') return score + 0.5;
        return score;
    }, 0);
}

function showChampionshipResults() {
    if (!championshipState) return;

    const myScore = getChampionshipScore(myColor || 'white');
    const oppScore = getChampionshipScore(myColor === 'white' ? 'black' : 'white');
    const total = championshipState.totalBoards;

    const isVictory = myScore > oppScore;
    const isDraw = myScore === oppScore;

    const resultText = isVictory ? 'Victory!' : (isDraw ? 'Draw!' : 'Defeat');
    const scoreText = `${myScore} out of ${total}`;

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

                const indicator = document.createElement('div');
                const isWin = result.winner === myColor;
                const isLoss = result.winner !== myColor && result.winner !== 'draw';
                indicator.textContent = isWin ? '\u2713' : (isLoss ? '\u2717' : '\u00BD');
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

    championshipState.active = false;
    saveChampionshipState();
}

function returnToMenu() {
    sessionStorage.removeItem('championshipState');
    sessionStorage.removeItem('championshipRole');
    window.location.href = '/';
}

/* =============================================================================
   NAVIGATION & CONTROLS
   ============================================================================= */

function newGame() {
    window.location.href = '/';
}

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

function renderBoard() {
    const board = document.getElementById('board');
    board.innerHTML = '';

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

async function onSquareClick(pos) {
    if (pendingPromotion) return;
    if (replayIndex >= 0) return;

    if (!gameState || gameState.status === 'checkmate' || gameState.status === 'stalemate') {
        return;
    }

    const isDebugPlayMode = typeof devModeIndex !== 'undefined' && devModeIndex === 2;
    if (myColor && myColor !== gameState.turn && !isDebugPlayMode) {
        return;
    }

    if (selectedSquare && legalMoves.some(m => m.to === pos)) {
        const move = { from: selectedSquare, to: pos };

        const piece = gameState.board[selectedSquare];
        if (piece && piece.type === 'pawn') {
            const targetRank = parseInt(pos[1]);
            if ((piece.color === 'white' && targetRank === 8) ||
                (piece.color === 'black' && targetRank === 1)) {
                showPromotionModal(move, piece.color);
                return;
            }
        }

        await makeMove(move.from, move.to);
        return;
    }

    const piece = gameState.board[pos];
    if (piece && piece.color === gameState.turn) {
        selectedSquare = pos;
        await fetchLegalMoves(pos);
    } else {
        selectedSquare = null;
        legalMoves = [];
    }

    updateUI();
}

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

function hidePromotionModal() {
    document.getElementById('promotion-modal').style.display = 'none';
    pendingPromotion = null;
}

async function completePromotion(pieceType) {
    if (!pendingPromotion) return;

    const { from, to } = pendingPromotion;
    hidePromotionModal();
    await makeMove(from, to, pieceType);
}

/**
 * Fetch legal moves for a piece (local computation via chess.js).
 */
async function fetchLegalMoves(pos) {
    legalMoves = firebaseGetLegalMoves(gameId, pos);
}

/**
 * Submit a move via chess.js + Firebase.
 */
async function makeMove(from, to, promotion) {
    const movedColor = gameState.turn;

    const isDebugPlayMode = typeof devModeIndex !== 'undefined' && devModeIndex === 2;
    if (!myColor && !isDebugPlayMode) {
        myColor = movedColor;
        sessionStorage.setItem(`myColor_${gameId}`, myColor);
    }

    selectedSquare = null;
    legalMoves = [];
    replayIndex = -1;

    try {
        const oldStatus = gameState?.status;
        const newState = await firebaseMakeMove(gameId, from, to, promotion || null);

        if (!newState) {
            console.error('Move failed: illegal move');
            return;
        }

        gameState = newState;
        lastMoveCount = gameState.moveHistory?.length || 0;

        if (gameState.status === 'check' && oldStatus !== 'check') {
            showCheckBanner();
        }

        if (gameState.status === 'checkmate' || gameState.status === 'stalemate') {
            setTimeout(() => handleGameEnd(), 2000);
        }

        updateUI();
    } catch (error) {
        console.error('Failed to make move:', error);
    }
}

function handleGameEnd() {
    if (!gameState) return;

    let winner;
    if (gameState.status === 'stalemate') {
        winner = 'draw';
    } else if (gameState.status === 'checkmate') {
        winner = gameState.turn === 'white' ? 'black' : 'white';
    }

    if (championshipState && championshipState.active) {
        recordChampionshipResult(winner);
    } else {
        newGame();
    }
}

/* =============================================================================
   UI FEEDBACK
   ============================================================================= */

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

async function requestUndo() {
    if (!gameId || gameState.moveHistory.length === 0) return;

    try {
        gameState = await firebaseRequestUndo(gameId, gameState.turn);
        updateUI();
    } catch (error) {
        console.error('Failed to request undo:', error);
    }
}

async function acceptUndo() {
    if (!gameId) return;

    try {
        gameState = await firebaseAcceptUndo(gameId);
        replayIndex = -1;
        lastMoveCount = gameState.moveHistory?.length || 0;
        updateUI();
    } catch (error) {
        console.error('Failed to accept undo:', error);
    }
}

async function rejectUndo() {
    if (!gameId) return;

    try {
        gameState = await firebaseRejectUndo(gameId);
        updateUI();
    } catch (error) {
        console.error('Failed to reject undo:', error);
    }
}

/* =============================================================================
   REPLAY NAVIGATION
   ============================================================================= */

function replayFirst() {
    if (gameState.moveHistory.length === 0) return;
    replayIndex = 0;
    updateUI();
}

function replayPrev() {
    if (replayIndex === -1) {
        replayIndex = gameState.moveHistory.length - 1;
    } else if (replayIndex > 0) {
        replayIndex--;
    }
    updateUI();
}

function replayNext() {
    if (replayIndex === -1) return;
    if (replayIndex < gameState.moveHistory.length - 1) {
        replayIndex++;
    } else {
        replayIndex = -1;
    }
    updateUI();
}

function replayLast() {
    replayIndex = -1;
    updateUI();
}

function replayLive() {
    replayIndex = -1;
    updateUI();
}

function getBoardAtMove(moveIndex) {
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

    for (let file = 0; file < 8; file++) {
        const f = String.fromCharCode(97 + file);
        initialBoard[f + '2'] = { type: 'pawn', color: 'white' };
        initialBoard[f + '7'] = { type: 'pawn', color: 'black' };
    }

    if (moveIndex < 0) return initialBoard;

    const board = { ...initialBoard };

    for (let i = 0; i <= moveIndex && i < gameState.moveHistory.length; i++) {
        const move = gameState.moveHistory[i];
        const piece = board[move.from];

        if (!piece) continue;

        if (piece.type === 'king') {
            const fileDiff = move.to.charCodeAt(0) - move.from.charCodeAt(0);
            if (Math.abs(fileDiff) === 2) {
                const rank = move.from[1];
                if (fileDiff > 0) {
                    board['f' + rank] = board['h' + rank];
                    delete board['h' + rank];
                } else {
                    board['d' + rank] = board['a' + rank];
                    delete board['a' + rank];
                }
            }
        }

        if (piece.type === 'pawn') {
            const fromFile = move.from.charCodeAt(0);
            const toFile = move.to.charCodeAt(0);
            const fromRank = parseInt(move.from[1]);
            const toRank = parseInt(move.to[1]);

            if (fromFile !== toFile && !board[move.to]) {
                const capturedRank = piece.color === 'white' ? toRank - 1 : toRank + 1;
                delete board[String.fromCharCode(toFile) + capturedRank];
            }
        }

        board[move.to] = piece;
        delete board[move.from];

        if (move.promotion && piece.type === 'pawn') {
            board[move.to] = { type: move.promotion, color: piece.color };
        }
    }

    return board;
}

/* =============================================================================
   UI UPDATES
   ============================================================================= */

function updateUI() {
    if (!gameState) return;

    const isLive = replayIndex === -1;
    const displayBoard = isLive ? gameState.board : getBoardAtMove(replayIndex);
    const displayMoveIndex = isLive ? gameState.moveHistory.length - 1 : replayIndex;

    const board = document.getElementById('board');
    const isDebugPlayMode = typeof devModeIndex !== 'undefined' && devModeIndex === 2;
    if (myColor === 'black' && !isDebugPlayMode) {
        board.classList.add('board-flipped');
    } else {
        board.classList.remove('board-flipped');
    }

    const squares = document.querySelectorAll('.square');
    squares.forEach(square => {
        const pos = square.dataset.pos;
        const piece = displayBoard[pos];

        square.className = square.className.replace(/ selected| legal-move| legal-capture| last-move| in-check| white-piece| black-piece/g, '');

        let shouldShowPiece = false;
        if (piece) {
            if (typeof devModeIndex !== 'undefined' && devModeIndex === 1) {
                shouldShowPiece = true;
            } else if (!piecesHidden) {
                shouldShowPiece = true;
            } else if (revealedPieces === 'all') {
                shouldShowPiece = true;
            } else if (revealedPieces === piece.color) {
                shouldShowPiece = true;
            }
        }

        if (shouldShowPiece) {
            square.textContent = PIECES[piece.color][piece.type];
            square.classList.add(piece.color + '-piece');
        } else {
            square.textContent = '';
        }

        if (isLive) {
            if (pos === selectedSquare) {
                square.classList.add('selected');
            }

            const isLegalMove = legalMoves.some(m => m.to === pos);
            if (isLegalMove) {
                if (gameState.board[pos]) {
                    square.classList.add('legal-capture');
                } else {
                    square.classList.add('legal-move');
                }
            }

            if (gameState.checkSquare === pos) {
                square.classList.add('in-check');
            }
        }

        if (displayMoveIndex >= 0 && displayMoveIndex < gameState.moveHistory.length) {
            const lastMove = gameState.moveHistory[displayMoveIndex];
            if (pos === lastMove.from || pos === lastMove.to) {
                square.classList.add('last-move');
            }
        }
    });

    document.body.className = isLive ? `status-${gameState.status}` : '';

    const undoPanel = document.getElementById('undo-panel');
    const undoMessage = document.getElementById('undo-message');
    if (gameState.undoRequest) {
        undoPanel.style.display = 'block';
        undoMessage.textContent = `${capitalize(gameState.undoRequest.requestedBy)} requested to undo the last move.`;
    } else {
        undoPanel.style.display = 'none';
    }
}

function goToMove(index) {
    replayIndex = index;
    updateUI();
}

/* =============================================================================
   UTILITY FUNCTIONS
   ============================================================================= */

function fileRankToNotation(file, rank) {
    return String.fromCharCode(97 + file) + (rank + 1);
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/* =============================================================================
   CHAT FUNCTIONS
   ============================================================================= */

async function sendChat() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message || !gameId) return;

    await sendChatMessage(message);
    input.value = '';
}

async function sendChatMessage(message) {
    if (!message || !gameId) return;

    addChatMessageToUI(message, 'sent');

    const time = Date.now();
    chatMessages.push({ player: playerId, message, time });

    try {
        await firebaseSendChat(gameId, playerId, message);
    } catch (error) {
        console.error('Failed to send chat:', error);
    }
}

function addChatMessageToUI(message, type) {
    if (message.startsWith('__')) {
        return;
    }

    const messagesContainer = document.getElementById('chat-messages');
    const messageEl = document.createElement('div');
    messageEl.className = `chat-message ${type}`;
    messageEl.textContent = message;
    messagesContainer.appendChild(messageEl);

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/* =============================================================================
   ENTRY POINT
   ============================================================================= */

init();
