// Chess UI Application

const API_BASE = '';

// Unicode chess pieces
const PIECES = {
    white: { king: '♔', queen: '♕', rook: '♖', bishop: '♗', knight: '♘', pawn: '♙' },
    black: { king: '♚', queen: '♛', rook: '♜', bishop: '♝', knight: '♞', pawn: '♟' }
};

// Application state
let gameId = null;
let gameState = null;
let selectedSquare = null;
let legalMoves = [];
let pendingPromotion = null; // { from, to } when awaiting promotion choice
let replayIndex = -1; // -1 means live view, >= 0 means viewing history
let previousStatus = null; // Track status changes for animations
let singleMoveHint = null; // { from, to } when in check with only one legal move

// Initialize the app
async function init() {
    renderBoard();
    setupPromotionModal();
    document.getElementById('new-game').addEventListener('click', newGame);
    await newGame();
}

// Create a new game
async function newGame() {
    try {
        const response = await fetch(`${API_BASE}/games`, { method: 'POST' });
        const game = await response.json();
        gameId = game.id;
        gameState = game;
        selectedSquare = null;
        legalMoves = [];
        pendingPromotion = null;
        replayIndex = -1;
        previousStatus = null;
        singleMoveHint = null;
        hideGameOverModal();
        updateUI();
    } catch (error) {
        console.error('Failed to create game:', error);
    }
}

// Render the chess board
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

// Setup promotion modal click handlers
function setupPromotionModal() {
    const options = document.querySelectorAll('.promotion-option');
    options.forEach(option => {
        option.addEventListener('click', () => {
            const piece = option.dataset.piece;
            completePromotion(piece);
        });
    });
}

// Handle square click
async function onSquareClick(pos) {
    // Ignore clicks during promotion selection
    if (pendingPromotion) return;

    // Ignore clicks when viewing replay (not live)
    if (replayIndex >= 0) return;

    if (!gameState || gameState.status === 'checkmate' || gameState.status === 'stalemate') {
        return;
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

// Show promotion modal
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

// Hide promotion modal
function hidePromotionModal() {
    document.getElementById('promotion-modal').style.display = 'none';
    pendingPromotion = null;
}

// Complete promotion with selected piece
async function completePromotion(pieceType) {
    if (!pendingPromotion) return;

    const { from, to } = pendingPromotion;
    hidePromotionModal();
    await makeMove(from, to, pieceType);
}

// Fetch legal moves for a piece
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

// Fetch all legal moves and check for single move hint (when in check)
async function checkForSingleMoveHint() {
    singleMoveHint = null;

    if (gameState.status !== 'check') return;

    try {
        // Get all pieces of current player and their legal moves
        const allMoves = [];
        const board = gameState.board;

        for (const pos of Object.keys(board)) {
            const piece = board[pos];
            if (piece && piece.color === gameState.turn) {
                const response = await fetch(`${API_BASE}/games/${gameId}/moves?from=${pos}`);
                const data = await response.json();
                if (data.moves && data.moves.length > 0) {
                    allMoves.push(...data.moves);
                }
            }
        }

        // If exactly one legal move exists, set the hint
        if (allMoves.length === 1) {
            singleMoveHint = { from: allMoves[0].from, to: allMoves[0].to };
        }
    } catch (error) {
        console.error('Failed to check for single move hint:', error);
    }
}

// Make a move
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

        const oldStatus = gameState?.status;
        gameState = await response.json();
        selectedSquare = null;
        legalMoves = [];
        replayIndex = -1; // Return to live view

        // Show check banner if newly in check
        if (gameState.status === 'check' && oldStatus !== 'check') {
            showCheckBanner();
        }

        // Check for single move hint when in check
        if (gameState.status === 'check') {
            await checkForSingleMoveHint();
        } else {
            singleMoveHint = null;
        }

        // Show game over modal
        if (gameState.status === 'checkmate' || gameState.status === 'stalemate') {
            showGameOverModal();
        }

        updateUI();
    } catch (error) {
        console.error('Failed to make move:', error);
    }
}

// Show check banner briefly
function showCheckBanner() {
    const banner = document.getElementById('check-banner');
    banner.style.display = 'block';
    setTimeout(() => {
        banner.style.display = 'none';
    }, 2000);
}

// Show game over modal
function showGameOverModal() {
    const modal = document.getElementById('game-over-modal');
    const title = document.getElementById('game-over-title');
    const message = document.getElementById('game-over-message');

    if (gameState.status === 'checkmate') {
        const winner = gameState.turn === 'white' ? 'Black' : 'White';
        title.textContent = 'Checkmate!';
        message.textContent = `${winner} wins!`;
    } else if (gameState.status === 'stalemate') {
        title.textContent = 'Stalemate';
        message.textContent = 'The game is a draw.';
    }

    modal.style.display = 'flex';
}

// Hide game over modal
function hideGameOverModal() {
    document.getElementById('game-over-modal').style.display = 'none';
}

// Close game over modal (to review game)
function closeGameOverModal() {
    hideGameOverModal();
}

// Undo functions
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

// Replay functions
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
        replayIndex = -1; // Go back to live
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

// Reconstruct board state at a given move index
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

// Update the UI based on game state
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
        square.className = square.className.replace(/ selected| legal-move| legal-capture| last-move| in-check| white-piece| black-piece| hint-from| hint-to/g, '');

        // Set piece
        if (piece) {
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

            // Show single move hint when in check with only one legal move
            if (singleMoveHint) {
                if (pos === singleMoveHint.from) {
                    square.classList.add('hint-from');
                }
                if (pos === singleMoveHint.to) {
                    square.classList.add('hint-to');
                }
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

    // Update turn indicator
    const turnEl = document.getElementById('turn');
    const displayTurn = isLive ? gameState.turn : (displayMoveIndex % 2 === 0 ? 'black' : 'white');
    turnEl.textContent = capitalize(displayTurn);
    turnEl.style.color = displayTurn === 'white' ? '#4ade80' : '#a78bfa';

    // Update status
    const statusEl = document.getElementById('status');
    const displayStatus = isLive ? gameState.status : 'ongoing';
    statusEl.textContent = isLive ? capitalize(gameState.status) : `Move ${displayMoveIndex + 1}/${gameState.moveHistory.length}`;

    // Update container class for status styling
    document.body.className = isLive ? `status-${gameState.status}` : '';

    // Update move history
    const historyEl = document.getElementById('history');
    historyEl.innerHTML = gameState.moveHistory
        .map((move, i) => {
            const isActive = i === displayMoveIndex;
            const className = isActive ? 'style="background: rgba(59, 130, 246, 0.5)"' : '';
            const prom = move.promotion ? `=${move.promotion[0].toUpperCase()}` : '';
            return `<span ${className} onclick="goToMove(${i})">${Math.floor(i/2) + 1}${i % 2 === 0 ? '.' : '...'} ${move.from}-${move.to}${prom}</span>`;
        })
        .join('');

    // Update undo panel
    const undoPanel = document.getElementById('undo-panel');
    const undoMessage = document.getElementById('undo-message');
    if (gameState.undoRequest) {
        undoPanel.style.display = 'block';
        undoMessage.textContent = `${capitalize(gameState.undoRequest.requestedBy)} requested to undo the last move.`;
    } else {
        undoPanel.style.display = 'none';
    }

    // Update live button indicator
    const liveBtn = document.getElementById('live-btn');
    if (isLive) {
        liveBtn.classList.add('live-indicator');
        liveBtn.textContent = '●';
    } else {
        liveBtn.classList.remove('live-indicator');
        liveBtn.textContent = '○';
    }
}

// Go to a specific move in history
function goToMove(index) {
    replayIndex = index;
    updateUI();
}

// Convert file (0-7) and rank (0-7) to notation like "e4"
function fileRankToNotation(file, rank) {
    return String.fromCharCode(97 + file) + (rank + 1);
}

// Capitalize first letter
function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// Start the app
init();
