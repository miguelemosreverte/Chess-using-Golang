// Chess UI Application

const API_BASE = '/api';

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
let lastMoveCount = 0; // Track moves for polling
let chatMessages = []; // Local cache of chat messages
let playerId = null; // Unique player ID for this session

// Background images for testing
const BACKGROUNDS = [
    'wood-bg.jpg',
    'bg-01.png', 'bg-02.png', 'bg-03.png', 'bg-04.png',
    'bg-05.png', 'bg-06.png', 'bg-07.png', 'bg-08.png',
    'bg-09.png', 'bg-10.png', 'bg-11.png'
];
let currentBgIndex = 0;

// Saved configurations per background image
// corners are stored as percentages of window size (0-1)
const BG_CONFIGS = {
    'bg-09.png': {
        corners: [
            {x: 0.3069, y: 0.1311},
            {x: 0.2996, y: 0.8175},
            {x: 0.7050, y: 0.8239},
            {x: 0.7011, y: 0.1362}
        ],
        border: false
    }
};

// Dev controls for board positioning
let devMode = false;
let borderHidden = false;
let corners = []; // [{x, y}, ...] as percentages of viewport at calibration time
let calibrationViewport = null; // {width, height} - viewport size when corners were calibrated
let cornerHandles = []; // DOM elements for dragging
let draggingHandle = null;

// Initialize the app
async function init() {
    // Generate unique player ID for this tab session
    // Use sessionStorage so each tab gets its own ID (important for same-browser testing)
    playerId = sessionStorage.getItem('playerId');
    if (!playerId) {
        playerId = Math.random().toString(36).substr(2, 9);
        sessionStorage.setItem('playerId', playerId);
    }

    // Get game ID from URL path
    const path = window.location.pathname;
    gameId = path.substring(1); // Remove leading slash

    renderBoard();
    setupPromotionModal();

    // Load game state
    await loadGame();

    // Load existing chat messages
    await loadChat();

    // Setup background after board is rendered
    requestAnimationFrame(() => {
        setupBackgroundToggle();
    });

    // Re-apply background on resize to keep it locked to the board
    window.addEventListener('resize', () => {
        applyBackground();
    });

    // Start polling for updates
    setInterval(pollGameState, 1000);
    setInterval(pollChat, 1000);
}

// Load existing chat messages from server
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

// Background toggle with arrow keys and draggable corner dev controls
function setupBackgroundToggle() {
    const params = new URLSearchParams(window.location.search);

    // Load background from URL or cycle to next
    const bgParam = params.get('bg');
    if (bgParam) {
        const index = BACKGROUNDS.indexOf(bgParam);
        if (index >= 0) {
            currentBgIndex = index;
        }
    } else {
        // Cycle through backgrounds on each load
        const lastBgIndex = parseInt(localStorage.getItem('lastBgIndex') || '-1');
        currentBgIndex = (lastBgIndex + 1) % BACKGROUNDS.length;
        // Skip wood-bg.jpg (index 0) for the cycle, start from bg-01
        if (currentBgIndex === 0) currentBgIndex = 1;
    }
    localStorage.setItem('lastBgIndex', currentBgIndex.toString());

    // Load config from server or saved config
    loadBgConfig();
    applyBackground();

    // Key listeners
    document.addEventListener('keydown', (e) => {
        // Tab: toggle dev mode
        if (e.key === 'Tab') {
            e.preventDefault();
            devMode = !devMode;
            toggleDevMode();
            return;
        }

        // Dev mode controls only
        if (!devMode) return;

        // Arrow keys: change background
        if (e.key === 'ArrowLeft') {
            currentBgIndex = (currentBgIndex - 1 + BACKGROUNDS.length) % BACKGROUNDS.length;
            loadBgConfig();
            applyBackground();
        } else if (e.key === 'ArrowRight') {
            currentBgIndex = (currentBgIndex + 1) % BACKGROUNDS.length;
            loadBgConfig();
            applyBackground();
        }
        // Enter: save config to server
        else if (e.key === 'Enter') {
            saveConfigToServer();
        }
        // 0: reset corners to default board position
        else if (e.key === '0') {
            initDefaultCorners();
            updateCornerHandles();
            applyCornerTransform();
        }
        // B: toggle border
        else if (e.key === 'b' || e.key === 'B') {
            borderHidden = !borderHidden;
            applyBorder();
        }
    });

    // Drag handling
    document.addEventListener('mousedown', (e) => {
        if (!devMode) return;
        const handle = e.target.closest('.corner-handle');
        if (handle) {
            draggingHandle = handle;
            e.preventDefault();
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (!draggingHandle) return;
        const index = parseInt(draggingHandle.dataset.index);
        corners[index] = {
            x: e.clientX / window.innerWidth,
            y: e.clientY / window.innerHeight
        };
        updateHandlePosition(draggingHandle, e.clientX, e.clientY);
        applyCornerTransform();
    });

    document.addEventListener('mouseup', () => {
        draggingHandle = null;
    });
}

function toggleDevMode() {
    const legend = document.querySelector('.dev-legend');
    if (legend) {
        legend.style.display = devMode ? 'block' : 'none';
    }
    if (devMode) {
        document.body.classList.add('dev-mode');
        // Initialize corners if empty
        if (corners.length !== 4) {
            initDefaultCorners();
        }
        createCornerHandles();
    } else {
        document.body.classList.remove('dev-mode');
        removeCornerHandles();
    }
}

// Initialize corners to current board position
function initDefaultCorners() {
    const board = document.getElementById('board');
    if (!board) return;

    const rect = board.getBoundingClientRect();
    corners = [
        { x: rect.left / window.innerWidth, y: rect.top / window.innerHeight },
        { x: rect.right / window.innerWidth, y: rect.top / window.innerHeight },
        { x: rect.right / window.innerWidth, y: rect.bottom / window.innerHeight },
        { x: rect.left / window.innerWidth, y: rect.bottom / window.innerHeight }
    ];
}

// Load saved config for current background
async function loadBgConfig() {
    const bgName = BACKGROUNDS[currentBgIndex];

    // Try to load from server first
    try {
        const response = await fetch('/config/' + bgName);
        if (response.ok) {
            const config = await response.json();
            corners = [...config.corners];
            borderHidden = config.border === false;
            calibrationViewport = config.calibrationViewport || null;
            applyCornerTransform();
            applyBorder();

            // Update handles if in dev mode
            if (devMode) {
                updateCornerHandles();
            }
            return;
        }
    } catch (e) {
        // Server config not found, try local
    }

    // Fall back to local BG_CONFIGS
    const config = BG_CONFIGS[bgName];
    if (config) {
        corners = [...config.corners];
        borderHidden = config.border === false;
        calibrationViewport = config.calibrationViewport || null;
        applyCornerTransform();
        applyBorder();
    } else {
        corners = [];
        calibrationViewport = null;
        borderHidden = false;
        resetBoardTransform();
        applyBorder();
    }

    // Update handles if in dev mode
    if (devMode) {
        if (corners.length !== 4) {
            initDefaultCorners();
        }
        updateCornerHandles();
    }
}

// Create draggable corner handles
function createCornerHandles() {
    removeCornerHandles();

    const labels = ['TL', 'TR', 'BR', 'BL'];
    corners.forEach((corner, i) => {
        const handle = document.createElement('div');
        handle.className = 'corner-handle';
        handle.dataset.index = i;
        handle.textContent = labels[i];
        handle.style.left = (corner.x * window.innerWidth) + 'px';
        handle.style.top = (corner.y * window.innerHeight) + 'px';
        document.body.appendChild(handle);
        cornerHandles.push(handle);
    });
}

function updateCornerHandles() {
    corners.forEach((corner, i) => {
        if (cornerHandles[i]) {
            cornerHandles[i].style.left = (corner.x * window.innerWidth) + 'px';
            cornerHandles[i].style.top = (corner.y * window.innerHeight) + 'px';
        }
    });
}

function updateHandlePosition(handle, x, y) {
    handle.style.left = x + 'px';
    handle.style.top = y + 'px';
}

function removeCornerHandles() {
    cornerHandles.forEach(h => h.remove());
    cornerHandles = [];
}

// Save config to server
async function saveConfigToServer() {
    const bgName = BACKGROUNDS[currentBgIndex];
    const config = {
        corners: corners,
        border: !borderHidden,
        // Store calibration viewport size so we can convert coordinates correctly on different screens
        calibrationViewport: {
            width: window.innerWidth,
            height: window.innerHeight
        }
    };

    try {
        const response = await fetch('/config/' + bgName, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });

        if (response.ok) {
            updateLegendStatus('Saved!');
            // Update local config too
            BG_CONFIGS[bgName] = {
                corners: [...corners],
                border: !borderHidden,
                calibrationViewport: { ...config.calibrationViewport }
            };
        } else {
            updateLegendStatus('Save failed');
        }
    } catch (e) {
        updateLegendStatus('Save error: ' + e.message);
    }

    setTimeout(() => updateLegendStatus(''), 2000);
}

function resetBoardTransform() {
    const container = document.querySelector('.board-container');
    if (container) {
        container.style.transform = '';
    }
    resetUITransform();
}

function resetUITransform() {
    const uiElements = [
        document.querySelector('.controls'),
        document.querySelector('.chat-panel')
    ];

    uiElements.forEach(el => {
        if (el) {
            el.style.transform = '';
        }
    });
}

function applyCornerTransform() {
    if (corners.length !== 4) return;

    const container = document.querySelector('.board-container');
    const board = document.getElementById('board');
    if (!container || !board) return;

    // Reset transform first to get natural position
    container.style.transform = '';
    container.style.transformOrigin = '0 0';

    // Force reflow to get accurate rect
    void board.offsetHeight;

    // Get the board's natural position and size
    const rect = board.getBoundingClientRect();

    // Source corners relative to element (0,0 is top-left of board)
    const src = [
        { x: 0, y: 0 },                          // TL
        { x: rect.width, y: 0 },                 // TR
        { x: rect.width, y: rect.height },       // BR
        { x: 0, y: rect.height }                 // BL
    ];

    // Convert percentage corners to pixels, relative to board's original position
    const dst = corners.map(c => ({
        x: c.x * window.innerWidth - rect.left,
        y: c.y * window.innerHeight - rect.top
    }));

    // Calculate perspective transform
    const matrix = computeTransformMatrix(src, dst);
    if (matrix) {
        container.style.transform = matrix;
    }

    // Apply perspective to UI elements
    applyUITransform(rect);
}

// Apply perspective transform to UI elements based on board's transform
function applyUITransform(boardRect) {
    if (corners.length !== 4) return;

    // Calculate scale and skew from corners
    const dstPixels = corners.map(c => ({
        x: c.x * window.innerWidth,
        y: c.y * window.innerHeight
    }));

    // Sort to get TL, TR, BR, BL
    const sorted = [...dstPixels].sort((a, b) => a.y - b.y);
    const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
    const bottom = sorted.slice(2, 4).sort((a, b) => a.x - b.x);
    const tl = top[0], tr = top[1], br = bottom[1], bl = bottom[0];

    // Calculate average scale
    const topWidth = tr.x - tl.x;
    const bottomWidth = br.x - bl.x;
    const leftHeight = bl.y - tl.y;
    const rightHeight = br.y - tr.y;

    const avgWidth = (topWidth + bottomWidth) / 2;
    const avgHeight = (leftHeight + rightHeight) / 2;
    const scaleX = avgWidth / boardRect.width;
    const scaleY = avgHeight / boardRect.height;
    const scale = (scaleX + scaleY) / 2;

    // Calculate center of destination
    const centerX = (tl.x + tr.x + br.x + bl.x) / 4;
    const centerY = (tl.y + tr.y + br.y + bl.y) / 4;

    // Calculate skew (perspective hint)
    const skewX = ((tr.x - tl.x) - (br.x - bl.x)) / avgHeight * 10; // degrees approximation
    const skewY = ((bl.y - tl.y) - (br.y - tr.y)) / avgWidth * 10;

    // Apply to UI elements
    const uiElements = [
        { el: document.querySelector('.controls'), pos: 'bottom' },
        { el: document.querySelector('.chat-panel'), pos: 'side' }
    ];

    uiElements.forEach(({ el, pos }) => {
        if (!el) return;
        el.style.transformOrigin = 'center center';
        el.style.transform = `scale(${scale}) skew(${skewX}deg, ${skewY}deg)`;
    });
}

// Compute perspective transform (matrix3d) from 4 corner correspondences
function computeTransformMatrix(src, dst) {
    // Sort corners: find TL, TR, BR, BL based on position
    const sortCorners = (corners) => {
        const sorted = [...corners].sort((a, b) => a.y - b.y);
        const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
        const bottom = sorted.slice(2, 4).sort((a, b) => a.x - b.x);
        return [top[0], top[1], bottom[1], bottom[0]]; // TL, TR, BR, BL
    };

    const s = sortCorners(src);
    const d = sortCorners(dst);

    // Compute homography matrix using the general perspective transform formula
    // We need to solve for the 8 unknowns in the perspective transform
    const H = computeHomography(
        s[0].x, s[0].y, s[1].x, s[1].y, s[2].x, s[2].y, s[3].x, s[3].y,
        d[0].x, d[0].y, d[1].x, d[1].y, d[2].x, d[2].y, d[3].x, d[3].y
    );

    if (!H) return null;

    // Convert 3x3 homography to CSS matrix3d (4x4)
    // matrix3d(a1, b1, 0, c1, a2, b2, 0, c2, 0, 0, 1, 0, a3, b3, 0, c3)
    const matrix3d = `matrix3d(
        ${H[0]}, ${H[3]}, 0, ${H[6]},
        ${H[1]}, ${H[4]}, 0, ${H[7]},
        0, 0, 1, 0,
        ${H[2]}, ${H[5]}, 0, ${H[8]}
    )`;

    return matrix3d;
}

// Compute 3x3 homography matrix from 4 point correspondences
function computeHomography(x0, y0, x1, y1, x2, y2, x3, y3, X0, Y0, X1, Y1, X2, Y2, X3, Y3) {
    // Set up the system of equations Ah = b
    const A = [
        [x0, y0, 1, 0, 0, 0, -X0*x0, -X0*y0],
        [0, 0, 0, x0, y0, 1, -Y0*x0, -Y0*y0],
        [x1, y1, 1, 0, 0, 0, -X1*x1, -X1*y1],
        [0, 0, 0, x1, y1, 1, -Y1*x1, -Y1*y1],
        [x2, y2, 1, 0, 0, 0, -X2*x2, -X2*y2],
        [0, 0, 0, x2, y2, 1, -Y2*x2, -Y2*y2],
        [x3, y3, 1, 0, 0, 0, -X3*x3, -X3*y3],
        [0, 0, 0, x3, y3, 1, -Y3*x3, -Y3*y3]
    ];
    const b = [X0, Y0, X1, Y1, X2, Y2, X3, Y3];

    // Solve using Gaussian elimination
    const h = solveLinearSystem(A, b);
    if (!h) return null;

    // Return as 3x3 matrix (row-major): [h0, h1, h2, h3, h4, h5, h6, h7, 1]
    return [...h, 1];
}

// Gaussian elimination with partial pivoting
function solveLinearSystem(A, b) {
    const n = A.length;
    const aug = A.map((row, i) => [...row, b[i]]);

    for (let col = 0; col < n; col++) {
        // Find pivot
        let maxRow = col;
        for (let row = col + 1; row < n; row++) {
            if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) {
                maxRow = row;
            }
        }
        [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

        if (Math.abs(aug[col][col]) < 1e-10) return null;

        // Eliminate
        for (let row = col + 1; row < n; row++) {
            const factor = aug[row][col] / aug[col][col];
            for (let j = col; j <= n; j++) {
                aug[row][j] -= factor * aug[col][j];
            }
        }
    }

    // Back substitution
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
        x[i] = aug[i][n];
        for (let j = i + 1; j < n; j++) {
            x[i] -= aug[i][j] * x[j];
        }
        x[i] /= aug[i][i];
    }

    return x;
}

// Cache for loaded image dimensions
const imageDimensions = {};

function applyBackground() {
    const bgUrl = BACKGROUNDS[currentBgIndex];
    document.body.style.backgroundImage = `url('${bgUrl}')`;

    // Scale background to match board - so they stay locked together on resize
    if (corners.length === 4) {
        // Need image dimensions to calculate correct aspect ratio
        if (imageDimensions[bgUrl]) {
            applyBackgroundWithDimensions(imageDimensions[bgUrl]);
        } else {
            // Load image to get dimensions, then apply
            const img = new Image();
            img.onload = () => {
                imageDimensions[bgUrl] = { width: img.naturalWidth, height: img.naturalHeight };
                applyBackgroundWithDimensions(imageDimensions[bgUrl]);
            };
            img.src = bgUrl;
            // Fallback while loading
            document.body.style.backgroundSize = 'cover';
            document.body.style.backgroundPosition = 'center';
        }
        return;
    }

    // Fallback to cover if no corners
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundPosition = 'center';
}

function applyBackgroundWithDimensions(imgDim) {
    const board = document.getElementById('board');
    if (!board || corners.length !== 4) return;

    const boardRect = board.getBoundingClientRect();
    const imgAspect = imgDim.width / imgDim.height;

    // Convert viewport-percentage corners to image-percentage corners
    // This requires knowing how `cover` positioned the image at calibration time
    let imageCorners = corners;

    if (calibrationViewport) {
        // Calculate how `cover` scaled the image at calibration time
        const calVW = calibrationViewport.width;
        const calVH = calibrationViewport.height;
        const calScale = Math.max(calVW / imgDim.width, calVH / imgDim.height);

        // Image size when displayed with cover at calibration viewport
        const calImgDisplayW = imgDim.width * calScale;
        const calImgDisplayH = imgDim.height * calScale;

        // Offset due to centering (how much of image is cropped on each side)
        const calOffsetX = (calImgDisplayW - calVW) / 2;
        const calOffsetY = (calImgDisplayH - calVH) / 2;

        // Convert viewport percentages to image percentages
        imageCorners = corners.map(c => ({
            // viewport pixel = c.x * calVW
            // image pixel = viewport pixel + calOffsetX
            // image percentage = image pixel / calImgDisplayW
            x: (c.x * calVW + calOffsetX) / calImgDisplayW,
            y: (c.y * calVH + calOffsetY) / calImgDisplayH
        }));
    }

    // Now imageCorners are percentages of the full image (0-1)
    const minX = Math.min(...imageCorners.map(c => c.x));
    const maxX = Math.max(...imageCorners.map(c => c.x));
    const minY = Math.min(...imageCorners.map(c => c.y));
    const maxY = Math.max(...imageCorners.map(c => c.y));

    // What percentage of the image does the board occupy?
    const boardWidthPercent = maxX - minX;
    const boardHeightPercent = maxY - minY;

    // Calculate required scale to match board size (maintain aspect ratio)
    const scaleByWidth = boardRect.width / boardWidthPercent;
    const scaleByHeight = boardRect.height / boardHeightPercent;

    // Average the scales to balance both dimensions while maintaining aspect ratio
    const displayWidth = (scaleByWidth + scaleByHeight * imgAspect) / 2;
    const displayHeight = displayWidth / imgAspect;

    // Calculate position: the board center should align with corners center
    const cornersCenterX = (minX + maxX) / 2;
    const cornersCenterY = (minY + maxY) / 2;

    // Board center in viewport
    const boardCenterX = boardRect.left + boardRect.width / 2;
    const boardCenterY = boardRect.top + boardRect.height / 2;

    // Background position: where the image's top-left corner goes
    const bgPosX = boardCenterX - (cornersCenterX * displayWidth);
    const bgPosY = boardCenterY - (cornersCenterY * displayHeight);

    document.body.style.backgroundSize = `${displayWidth}px ${displayHeight}px`;
    document.body.style.backgroundPosition = `${bgPosX}px ${bgPosY}px`;
}

function applyBorder() {
    const container = document.querySelector('.board-container');
    if (container) {
        container.classList.toggle('no-border', borderHidden);
    }
}

function updateLegendStatus(text) {
    let status = document.getElementById('legend-status');
    if (!status) {
        const legend = document.querySelector('.dev-legend');
        if (legend) {
            status = document.createElement('div');
            status.id = 'legend-status';
            status.style.color = '#4f8';
            status.style.marginTop = '6px';
            legend.appendChild(status);
        }
    }
    if (status) status.textContent = text;
}

function updateDevUrl() {
    const url = new URL(window.location);
    url.searchParams.set('bg', BACKGROUNDS[currentBgIndex]);
    if (corners.length === 4) {
        url.searchParams.set('corners', JSON.stringify(corners));
    } else {
        url.searchParams.delete('corners');
    }
    if (borderHidden) {
        url.searchParams.set('border', '0');
    } else {
        url.searchParams.delete('border');
    }
    window.history.replaceState({}, '', url);
}

// Toggle menu visibility on click outside board (disabled in dev mode)
function setupMenuToggle() {
    const board = document.getElementById('board');
    document.addEventListener('click', (e) => {
        // Skip if in dev mode
        if (devMode) return;

        if (board.contains(e.target)) return;
        if (e.target.closest('.modal-overlay') || e.target.closest('.promotion-modal')) return;
        if (document.body.classList.contains('menu-visible')) {
            if (e.target.closest('button') || e.target.closest('.controls') ||
                e.target.closest('.undo-panel') || e.target.closest('.chat-panel')) return;
        }
        document.body.classList.toggle('menu-visible');
    });
}

// Load game state from server
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
        singleMoveHint = null;
        updateUI();
    } catch (error) {
        console.error('Failed to load game:', error);
    }
}

// Poll for game state updates (for multiplayer sync)
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

// Poll for chat updates
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
        }
    } catch (error) {
        // Silently ignore polling errors
    }
}

// Create a new game (redirect to root)
function newGame() {
    window.location.href = '/';
}

// Cycle to the next background image
function cycleBackground() {
    currentBgIndex = (currentBgIndex % (BACKGROUNDS.length - 1)) + 1; // Skip wood-bg.jpg (index 0)
    localStorage.setItem('lastBgIndex', currentBgIndex.toString());
    loadBgConfig();
    applyBackground();
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

        // Auto-restart on game over
        if (gameState.status === 'checkmate' || gameState.status === 'stalemate') {
            setTimeout(() => newGame(), 2000);
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

    // Update container class for status styling (preserve menu-visible)
    const menuVisible = document.body.classList.contains('menu-visible');
    document.body.className = isLive ? `status-${gameState.status}` : '';
    if (menuVisible) document.body.classList.add('menu-visible');


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

// Send chat message to server
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

// Add a chat message to the UI
function addChatMessageToUI(message, type) {
    const messagesContainer = document.getElementById('chat-messages');
    const messageEl = document.createElement('div');
    messageEl.className = `chat-message ${type}`;
    messageEl.textContent = message;
    messagesContainer.appendChild(messageEl);

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Start the app
init();
