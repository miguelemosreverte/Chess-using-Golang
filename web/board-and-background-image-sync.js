/**
 * Board and Background Image Sync
 * ================================
 *
 * This module handles the complex task of keeping a chess board UI perfectly
 * aligned with a background photograph of a real chess board. It solves several
 * challenging problems:
 *
 * 1. PERSPECTIVE TRANSFORM: The photo shows the board at an angle, so we apply
 *    a CSS matrix3d transform to make our flat UI overlay match the perspective.
 *
 * 2. RESPONSIVE SCALING: When the viewport changes size, both the board UI and
 *    the background image must scale together while maintaining alignment.
 *
 * 3. CALIBRATION: A dev mode allows dragging corner handles to calibrate where
 *    the board corners are in the photo, saved as JSON configs per image.
 *
 * 4. CHAT LAYOUT: When the scaled content doesn't fill the viewport, the empty
 *    space is used for an expanded chat panel (bottom or right side).
 *
 * Key Concepts:
 * - Corners are stored as percentages (0-1) of the CALIBRATION viewport size
 * - When displaying on a different viewport, we scale coordinates proportionally
 * - The background image and board transform use the SAME scale factor
 * - This ensures they stay perfectly locked together at any viewport size
 */

// =============================================================================
// GLOBAL STATE
// =============================================================================

// Chapter and image management
let chaptersData = null;          // Loaded from chapters.json
let currentChapter = null;        // Current chapter object
let currentChapterIndex = 0;      // Index in chapters array
let currentBoardImageIndex = 0;   // Index in chapter's boardImages array

// Legacy BACKGROUNDS array for backwards compatibility during transition
const BACKGROUNDS = ['wood-bg.jpg'];  // Will be populated from chapters.json
let currentBgIndex = 0;

/**
 * Debug mode index for cycling through modes with Tab:
 * 0 = Normal (no debug UI)
 * 1 = Calibration mode (corner dragging for background alignment)
 * 2 = Debug play mode (can play both sides)
 */
let devModeIndex = 0;
const DEV_MODE_COUNT = 3;
let borderHidden = false;
let checkerboardHidden = false;

// Corner positions as percentages of viewport at calibration time
// Order: [TopLeft, TopRight, BottomRight, BottomLeft]
let corners = [];

// The viewport dimensions when corners were calibrated
// Used to correctly scale coordinates on different screen sizes
let calibrationViewport = null;

// DOM elements for corner dragging in dev mode
let cornerHandles = [];
let draggingHandle = null;

// Cache for loaded image natural dimensions
const imageDimensions = {};

// =============================================================================
// CHAT BACKGROUND STATE
// =============================================================================

// Parsed chapter graph (from chapter.md)
let chapterGraph = null;

// Current chat variation (e.g., "sunny", "cloudy")
let currentChatVariation = null;

// Current chat image sequence for rotation
let chatSequence = [];
let chatSequenceIndex = 0;

// Chat rotation interval (30 seconds)
const CHAT_ROTATION_INTERVAL = 30000;
let chatRotationTimer = null;


// =============================================================================
// CHAPTER MANAGEMENT
// =============================================================================

/**
 * Load chapters configuration from server.
 * Sets up currentChapter to the default chapter.
 */
async function loadChaptersConfig() {
    try {
        const response = await fetch('/chapters.json');
        if (response.ok) {
            chaptersData = await response.json();

            // Set default chapter
            if (chaptersData.chapters && chaptersData.chapters.length > 0) {
                const defaultId = chaptersData.defaultChapter || chaptersData.chapters[0].id;
                const defaultIdx = chaptersData.chapters.findIndex(c => c.id === defaultId);
                currentChapterIndex = defaultIdx >= 0 ? defaultIdx : 0;
                currentChapter = chaptersData.chapters[currentChapterIndex];
            }
        }
    } catch (error) {
        console.error('Failed to load chapters.json:', error);
    }
}

/**
 * Get the current board image filename.
 */
function getCurrentBoardImage() {
    if (currentChapter && currentChapter.boardImages[currentBoardImageIndex]) {
        return currentChapter.boardImages[currentBoardImageIndex].file;
    }
    return null;
}

/**
 * Get the full path to the current board image.
 */
function getCurrentBoardImagePath() {
    const img = getCurrentBoardImage();
    if (img && currentChapter) {
        return `chapters/${currentChapter.id}/board/${img}`;
    }
    return null;
}

/**
 * Get the config path for the current board image.
 */
function getCurrentConfigPath() {
    const img = getCurrentBoardImage();
    if (img && currentChapter) {
        return `${currentChapter.id}/${img}`;
    }
    return null;
}

// =============================================================================
// CHAT BACKGROUND MANAGEMENT
// =============================================================================

/**
 * Load and parse the chapter.md file for the current chapter.
 * Falls back gracefully if no chapter.md exists.
 */
async function loadChapterMarkdown() {
    if (!currentChapter) return;

    try {
        const response = await fetch(`chapters/${currentChapter.id}/chapter.md`);
        if (response.ok) {
            const content = await response.text();
            chapterGraph = parseChapter(content);
            console.log('Loaded chapter.md:', chapterGraph);
        } else {
            // No chapter.md, create empty graph
            chapterGraph = { nodes: [], byType: { board: [], chat: [], thumb: [] }, byVariation: {}, sequences: {} };
        }
    } catch (e) {
        console.log('No chapter.md found, using default');
        chapterGraph = { nodes: [], byType: { board: [], chat: [], thumb: [] }, byVariation: {}, sequences: {} };
    }
}

/**
 * Initialize chat background with a random variation.
 * Called after loading chapter markdown.
 */
function initChatBackground() {
    if (!chapterGraph || Object.keys(chapterGraph.byVariation).length === 0) {
        // No chat images defined
        return;
    }

    // Pick a random variation
    const variations = Object.keys(chapterGraph.byVariation);
    currentChatVariation = variations[Math.floor(Math.random() * variations.length)];

    // Get the sequence for this variation
    chatSequence = getChatSequence(chapterGraph, currentChatVariation);
    chatSequenceIndex = 0;

    // Apply first image
    applyChatBackground();

    // Start rotation timer
    startChatRotation();
}

/**
 * Apply the current chat background image.
 */
function applyChatBackground() {
    const chatPanel = document.querySelector('.chat-panel');
    if (!chatPanel) return;

    if (chatSequence.length === 0) {
        chatPanel.style.backgroundImage = '';
        chatPanel.classList.remove('has-background');
        return;
    }

    const chat = chatSequence[chatSequenceIndex];
    if (chat && currentChapter) {
        const imagePath = `chapters/${currentChapter.id}/chat/${chat.file}`;
        chatPanel.style.backgroundImage = `url('${imagePath}')`;
        chatPanel.classList.add('has-background');
    }
}

/**
 * Advance to the next chat image in the sequence.
 */
function rotateChatBackground() {
    if (chatSequence.length <= 1) return;

    chatSequenceIndex = (chatSequenceIndex + 1) % chatSequence.length;
    applyChatBackground();
}

/**
 * Start the chat background rotation timer.
 */
function startChatRotation() {
    stopChatRotation();
    if (chatSequence.length > 1) {
        chatRotationTimer = setInterval(rotateChatBackground, CHAT_ROTATION_INTERVAL);
    }
}

/**
 * Stop the chat background rotation timer.
 */
function stopChatRotation() {
    if (chatRotationTimer) {
        clearInterval(chatRotationTimer);
        chatRotationTimer = null;
    }
}

/**
 * Change to a different chat variation.
 * @param {string} variation - The variation name to switch to
 */
function setChatVariation(variation) {
    if (!chapterGraph || !chapterGraph.byVariation[variation]) return;

    currentChatVariation = variation;
    chatSequence = getChatSequence(chapterGraph, currentChatVariation);
    chatSequenceIndex = 0;

    applyChatBackground();
    startChatRotation();
}

// =============================================================================
// INITIALIZATION
// =============================================================================

/**
 * Sets up the background system including:
 * - Loading chapters.json for chapter/image organization
 * - Loading background from URL param or cycling through available images
 * - Loading calibration config from server
 * - Setting up keyboard controls for dev mode
 * - Setting up mouse drag handling for corner calibration
 */
async function setupBackgroundToggle() {
    // Load chapters configuration
    await loadChaptersConfig();

    const params = new URLSearchParams(window.location.search);

    // Load chapter and background from URL params (for shared links or from book transition)
    const chapterParam = params.get('chapter');
    const boardParam = params.get('board');  // Specific board image from book transition

    if (chapterParam && chaptersData) {
        const chapterIdx = chaptersData.chapters.findIndex(c => c.id === chapterParam);
        if (chapterIdx >= 0) {
            currentChapterIndex = chapterIdx;
            currentChapter = chaptersData.chapters[chapterIdx];
        }
    }

    if (boardParam && currentChapter) {
        // Use the specific board image passed from book transition
        const imgIdx = currentChapter.boardImages.findIndex(img => img.file === boardParam);
        if (imgIdx >= 0) {
            currentBoardImageIndex = imgIdx;
        }
    } else if (currentChapter && currentChapter.boardImages.length > 0) {
        // No specific image requested - cycle through backgrounds for variety
        const lastIdx = parseInt(localStorage.getItem(`lastBgIndex_${currentChapter.id}`) || '-1');
        currentBoardImageIndex = (lastIdx + 1) % currentChapter.boardImages.length;
    }

    if (currentChapter) {
        localStorage.setItem(`lastBgIndex_${currentChapter.id}`, currentBoardImageIndex.toString());
    }

    // Update chapter name display
    updateCurrentChapterName();

    // Update URL so sharing gives the same background
    updateBgUrl();

    // Load calibration config, then apply background
    await loadBgConfig();

    // Load chapter markdown for chat backgrounds
    await loadChapterMarkdown();
    initChatBackground();

    // Wait for next frame to ensure board transform is rendered before measuring
    // Return a promise that resolves when background is fully loaded
    await new Promise((resolve) => {
        requestAnimationFrame(() => {
            applyBackground();
            // Wait for the background image to load
            const bgImg = document.querySelector('.container');
            if (bgImg) {
                const bgUrl = getComputedStyle(bgImg).backgroundImage;
                if (bgUrl && bgUrl !== 'none') {
                    const img = new Image();
                    img.onload = resolve;
                    img.onerror = resolve;
                    // Extract URL from "url(...)"
                    const match = bgUrl.match(/url\(["']?(.+?)["']?\)/);
                    if (match) {
                        img.src = match[1];
                    } else {
                        resolve();
                    }
                } else {
                    resolve();
                }
            } else {
                resolve();
            }
        });
    });

    // Keyboard controls
    document.addEventListener('keydown', (e) => {
        // Escape: close chapter menu if open
        if (e.key === 'Escape') {
            const menu = document.getElementById('chapter-menu');
            if (menu && menu.style.display !== 'none') {
                closeChapterMenu();
                return;
            }
        }

        // Tab: cycle through debug modes (Normal → Calibration → Debug Play → Normal)
        if (e.key === 'Tab') {
            e.preventDefault();
            devModeIndex = (devModeIndex + 1) % DEV_MODE_COUNT;
            updateDevModeUI();
            return;
        }

        // All other controls only work in calibration mode (mode 1)
        if (devModeIndex !== 1) return;

        if (e.key === 'ArrowLeft') {
            // Previous background image in current chapter
            if (currentChapter && currentChapter.boardImages.length > 0) {
                currentBoardImageIndex = (currentBoardImageIndex - 1 + currentChapter.boardImages.length) % currentChapter.boardImages.length;
                loadBgConfig();
                applyBackground();
                updateCalibrationStatus();
            }
        } else if (e.key === 'ArrowRight') {
            // Next background image in current chapter
            if (currentChapter && currentChapter.boardImages.length > 0) {
                currentBoardImageIndex = (currentBoardImageIndex + 1) % currentChapter.boardImages.length;
                loadBgConfig();
                applyBackground();
                updateCalibrationStatus();
            }
        } else if (e.key === 'Enter') {
            // Save current calibration to server
            saveConfigToServer();
        } else if (e.key === '0') {
            // Reset corners to match current board position
            initDefaultCorners();
            updateCornerHandles();
            applyCornerTransform();
        } else if (e.key === 'b' || e.key === 'B') {
            // Toggle board border visibility
            borderHidden = !borderHidden;
            applyBorder();
        } else if (e.key === 'c' || e.key === 'C') {
            // Toggle checkerboard pattern visibility
            checkerboardHidden = !checkerboardHidden;
            applyCheckerboard();
        }
    });

    // Mouse drag handling for corner calibration (only in calibration mode)
    // Works with both circle handles and extended L-shaped arms
    let draggingCornerIndex = null;

    document.addEventListener('mousedown', (e) => {
        if (devModeIndex !== 1) return;

        // Check for circle handle
        const handle = e.target.closest('.corner-handle');
        if (handle) {
            draggingHandle = handle;
            draggingCornerIndex = parseInt(handle.dataset.index);
            e.preventDefault();
            return;
        }

        // Check for extended arm
        const arm = e.target.closest('.corner-arm');
        if (arm) {
            draggingCornerIndex = parseInt(arm.dataset.index);
            draggingHandle = cornerHandles[draggingCornerIndex];
            e.preventDefault();
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (draggingCornerIndex === null) return;

        // Store as percentage of current viewport
        corners[draggingCornerIndex] = {
            x: e.clientX / window.innerWidth,
            y: e.clientY / window.innerHeight
        };

        // Update both circle handle and extended arms
        updateCornerHandles();
        applyCornerTransform();
    });

    document.addEventListener('mouseup', () => {
        draggingHandle = null;
        draggingCornerIndex = null;
    });
}

/**
 * Update dev mode UI based on current devModeIndex.
 * Mode 0: Normal - no debug UI
 * Mode 1: Calibration - corner handles and calibration legend
 * Mode 2: Debug Play - can play both sides, shows debug play legend
 */
function updateDevModeUI() {
    const legend = document.querySelector('.dev-legend');
    const isCalibrationMode = devModeIndex === 1;
    const isDebugPlayMode = devModeIndex === 2;
    const isAnyDevMode = devModeIndex !== 0;

    // Update legend visibility and content
    if (legend) {
        if (isCalibrationMode) {
            legend.style.display = 'block';
            legend.innerHTML = `
                <div><b>Calibration Mode</b> (Tab to cycle)</div>
                <div>Drag corners to align board with photo</div>
                <div>← → Change background</div>
                <div>B Toggle border</div>
                <div>C Toggle checkerboard</div>
                <div>0 Reset corners</div>
                <div>Enter Save config</div>
            `;
        } else if (isDebugPlayMode) {
            legend.style.display = 'block';
            legend.innerHTML = `
                <div><b>Debug Play Mode</b> (Tab to cycle)</div>
                <div>You can play both sides</div>
                <div>Useful for testing moves</div>
            `;
        } else {
            legend.style.display = 'none';
        }
    }

    // Update body class and corner handles
    if (isCalibrationMode) {
        document.body.classList.add('dev-mode');
        if (corners.length !== 4) {
            initDefaultCorners();
        }
        createCornerHandles();
        updateCalibrationStatus();
        // Show all pieces in calibration mode
        if (typeof updateUI === 'function') {
            updateUI();
        }
    } else {
        document.body.classList.remove('dev-mode');
        removeCornerHandles();
        // Refresh pieces when exiting calibration mode
        if (typeof updateUI === 'function') {
            updateUI();
        }
    }
}

/**
 * Find and navigate to the first uncalibrated image in the current chapter.
 * If all images are calibrated, stays on current image.
 */
async function advanceToUncalibratedImage() {
    if (!currentChapter || !currentChapter.boardImages.length) {
        updateCalibrationStatus();
        return;
    }

    // Find first uncalibrated image
    const uncalibratedIdx = currentChapter.boardImages.findIndex(img => !img.calibrated);

    if (uncalibratedIdx >= 0 && uncalibratedIdx !== currentBoardImageIndex) {
        currentBoardImageIndex = uncalibratedIdx;
        await loadBgConfig();
        applyBackground();
    }

    updateCalibrationStatus();
}


// =============================================================================
// CONFIGURATION LOADING/SAVING
// =============================================================================

/**
 * Initialize corners to match the board's current screen position.
 * Used as a starting point for calibration.
 * Ensures corners are within visible screen bounds (10% margin).
 */
function initDefaultCorners() {
    const board = document.getElementById('board');
    if (!board) return;

    const rect = board.getBoundingClientRect();

    // Clamp to visible area with 10% margin
    const margin = 0.1;
    const clamp = (val) => Math.max(margin, Math.min(1 - margin, val));

    corners = [
        { x: clamp(rect.left / window.innerWidth), y: clamp(rect.top / window.innerHeight) },      // TL
        { x: clamp(rect.right / window.innerWidth), y: clamp(rect.top / window.innerHeight) },     // TR
        { x: clamp(rect.right / window.innerWidth), y: clamp(rect.bottom / window.innerHeight) },  // BR
        { x: clamp(rect.left / window.innerWidth), y: clamp(rect.bottom / window.innerHeight) }    // BL
    ];
}

/**
 * Load calibration config for the current background image from the server.
 * Config includes: corners array, border visibility, and calibration viewport size.
 */
async function loadBgConfig() {
    const configPath = getCurrentConfigPath();
    if (!configPath) {
        // No chapter/image selected, reset to defaults
        corners = [];
        calibrationViewport = null;
        borderHidden = false;
        checkerboardHidden = false;
        resetBoardTransform();
        applyBorder();
        applyCheckerboard();
        return;
    }

    try {
        // Try localStorage first (user-saved calibrations)
        let config = null;
        const stored = localStorage.getItem('calibration_' + configPath);
        if (stored) {
            config = JSON.parse(stored);
        } else {
            // Fall back to static .json config files shipped with the project
            const parts = configPath.split('/');
            if (parts.length === 2) {
                const staticPath = `chapters/${parts[0]}/board/${parts[1]}.json`;
                try {
                    const response = await fetch(staticPath);
                    if (response.ok) {
                        config = await response.json();
                    }
                } catch (e) { /* not found, use defaults */ }
            }
        }

        if (config) {
            corners = [...config.corners];
            borderHidden = config.border === false;
            checkerboardHidden = config.checkerboard === false;
            calibrationViewport = config.calibrationViewport || null;
            applyCornerTransform();
            applyBorder();
            applyCheckerboard();

            if (devModeIndex === 1) {
                updateCornerHandles();
            }
            return;
        }
    } catch (e) {
        // Config not found, reset to defaults
        corners = [];
        calibrationViewport = null;
        borderHidden = false;
        checkerboardHidden = false;
        resetBoardTransform();
        applyBorder();
        applyCheckerboard();
    }

    if (devModeIndex === 1) {
        if (corners.length !== 4) {
            initDefaultCorners();
        }
        updateCornerHandles();
    }
}

/**
 * Save current calibration to the server as a JSON file.
 * Includes the current viewport size so coordinates can be scaled on other screens.
 */
async function saveConfigToServer() {
    const configPath = getCurrentConfigPath();
    if (!configPath) {
        updateLegendStatus('No image selected');
        return;
    }

    const config = {
        corners: corners,
        border: !borderHidden,
        checkerboard: !checkerboardHidden,
        // IMPORTANT: Store viewport size at calibration time
        // This allows correct scaling on different screen sizes
        calibrationViewport: {
            width: window.innerWidth,
            height: window.innerHeight
        }
    };

    try {
        localStorage.setItem('calibration_' + configPath, JSON.stringify(config));

        // Mark image as calibrated in chapters data
        if (currentChapter && currentChapter.boardImages[currentBoardImageIndex]) {
            currentChapter.boardImages[currentBoardImageIndex].calibrated = true;
        }
        updateLegendStatus('Saved!');
        // Update status after a short delay
        setTimeout(() => updateCalibrationStatus(), 1500);
    } catch (e) {
        updateLegendStatus('Save error: ' + e.message);
    }

    setTimeout(() => updateLegendStatus(''), 2000);
}


// =============================================================================
// DEV MODE - CORNER HANDLES
// =============================================================================

// Store extended handle elements separately
let extendedHandles = [];

/**
 * Create draggable corner handles for calibration.
 * Each corner has:
 * - A circle handle at the corner point (labeled TL, TR, BR, BL)
 * - L-shaped red extended arms (5% offset outward, 30% length along edges)
 *   These allow manipulation even when the corner is off-screen
 */
function createCornerHandles() {
    removeCornerHandles();

    const labels = ['TL', 'TR', 'BR', 'BL'];
    // Direction offsets for each corner: [horizontal outward, vertical outward]
    // TL: extends left and up (-1, -1), arms go right and down
    // TR: extends right and up (1, -1), arms go left and down
    // BR: extends right and down (1, 1), arms go left and up
    // BL: extends left and down (-1, 1), arms go right and up
    const directions = [
        { outX: -1, outY: -1, armX: 1, armY: 1 },   // TL
        { outX: 1, outY: -1, armX: -1, armY: 1 },   // TR
        { outX: 1, outY: 1, armX: -1, armY: -1 },   // BR
        { outX: -1, outY: 1, armX: 1, armY: -1 }    // BL
    ];

    corners.forEach((corner, i) => {
        const dir = directions[i];
        const cornerX = corner.x * window.innerWidth;
        const cornerY = corner.y * window.innerHeight;

        // Create circle handle at corner
        const handle = document.createElement('div');
        handle.className = 'corner-handle';
        handle.dataset.index = i;
        handle.textContent = labels[i];
        handle.style.left = cornerX + 'px';
        handle.style.top = cornerY + 'px';
        document.body.appendChild(handle);
        cornerHandles.push(handle);

        // Create L-shaped extended handle
        // Offset 5% of viewport outward from corner
        const offsetPx = Math.min(window.innerWidth, window.innerHeight) * 0.05;
        // Arms extend 30% of viewport along each edge
        const armLength = Math.min(window.innerWidth, window.innerHeight) * 0.30;

        // Create container for the L-shape
        const extContainer = document.createElement('div');
        extContainer.className = 'corner-extended';
        extContainer.dataset.index = i;
        extContainer.style.cssText = `
            position: fixed;
            pointer-events: none;
            z-index: 9998;
        `;

        // Horizontal arm
        const hArm = document.createElement('div');
        hArm.className = 'corner-arm corner-arm-h';
        hArm.dataset.index = i;
        const hStartX = cornerX + dir.outX * offsetPx;
        const hStartY = cornerY + dir.outY * offsetPx;
        hArm.style.cssText = `
            position: fixed;
            left: ${dir.armX > 0 ? hStartX : hStartX - armLength}px;
            top: ${hStartY - 3}px;
            width: ${armLength}px;
            height: 6px;
            background: rgba(255, 50, 50, 0.8);
            cursor: move;
            pointer-events: auto;
            border-radius: 3px;
        `;
        extContainer.appendChild(hArm);

        // Vertical arm
        const vArm = document.createElement('div');
        vArm.className = 'corner-arm corner-arm-v';
        vArm.dataset.index = i;
        vArm.style.cssText = `
            position: fixed;
            left: ${hStartX - 3}px;
            top: ${dir.armY > 0 ? hStartY : hStartY - armLength}px;
            width: 6px;
            height: ${armLength}px;
            background: rgba(255, 50, 50, 0.8);
            cursor: move;
            pointer-events: auto;
            border-radius: 3px;
        `;
        extContainer.appendChild(vArm);

        document.body.appendChild(extContainer);
        extendedHandles.push(extContainer);
    });
}

function updateCornerHandles() {
    const directions = [
        { outX: -1, outY: -1, armX: 1, armY: 1 },   // TL
        { outX: 1, outY: -1, armX: -1, armY: 1 },   // TR
        { outX: 1, outY: 1, armX: -1, armY: -1 },   // BR
        { outX: -1, outY: 1, armX: 1, armY: -1 }    // BL
    ];

    const offsetPx = Math.min(window.innerWidth, window.innerHeight) * 0.05;
    const armLength = Math.min(window.innerWidth, window.innerHeight) * 0.30;

    corners.forEach((corner, i) => {
        const cornerX = corner.x * window.innerWidth;
        const cornerY = corner.y * window.innerHeight;
        const dir = directions[i];

        // Update circle handle
        if (cornerHandles[i]) {
            cornerHandles[i].style.left = cornerX + 'px';
            cornerHandles[i].style.top = cornerY + 'px';
        }

        // Update extended arms
        if (extendedHandles[i]) {
            const hStartX = cornerX + dir.outX * offsetPx;
            const hStartY = cornerY + dir.outY * offsetPx;

            const hArm = extendedHandles[i].querySelector('.corner-arm-h');
            const vArm = extendedHandles[i].querySelector('.corner-arm-v');

            if (hArm) {
                hArm.style.left = `${dir.armX > 0 ? hStartX : hStartX - armLength}px`;
                hArm.style.top = `${hStartY - 3}px`;
            }
            if (vArm) {
                vArm.style.left = `${hStartX - 3}px`;
                vArm.style.top = `${dir.armY > 0 ? hStartY : hStartY - armLength}px`;
            }
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
    extendedHandles.forEach(h => h.remove());
    extendedHandles = [];
}


// =============================================================================
// BOARD PERSPECTIVE TRANSFORM
// =============================================================================

/**
 * Remove any transform from the board container
 */
function resetBoardTransform() {
    const container = document.querySelector('.board-container');
    if (container) {
        container.style.transform = '';
    }
}

/**
 * Apply perspective transform to make the flat board UI match the photo's perspective.
 *
 * This is the core of the alignment system. It:
 * 1. Takes the calibrated corner positions (where the board corners are in the photo)
 * 2. Scales them appropriately for the current viewport size
 * 3. Computes a homography matrix to transform the flat board to match
 * 4. Applies the transform as a CSS matrix3d
 *
 * SCALING LOGIC:
 * - We calculate a scale factor based on how the current viewport compares to calibration
 * - The scale is the MINIMUM of:
 *   a) Board size ratio (how the CSS board size changed)
 *   b) Viewport width ratio
 *   c) Viewport height ratio
 * - Using the minimum ensures everything fits on narrow/small screens
 *
 * POSITIONING LOGIC:
 * - Normally, content is centered in the viewport
 * - If scaled content doesn't fill the viewport, we push it to top-left
 * - This leaves room at bottom/right for the chat panel to expand
 */
function applyCornerTransform() {
    if (corners.length !== 4) return;

    const container = document.querySelector('.board-container');
    const board = document.getElementById('board');
    if (!container || !board) return;

    // Reset transform first to get the board's natural (un-transformed) position
    container.style.transform = '';
    container.style.transformOrigin = '0 0';

    // Force reflow to get accurate measurements
    void board.offsetHeight;

    const rect = board.getBoundingClientRect();

    // SOURCE: The board's corners in its local coordinate space
    // These are the points we're transforming FROM
    const src = [
        { x: 0, y: 0 },                          // TL
        { x: rect.width, y: 0 },                 // TR
        { x: rect.width, y: rect.height },       // BR
        { x: 0, y: rect.height }                 // BL
    ];

    // DESTINATION: Where these corners should end up on screen
    let dst;

    if (calibrationViewport) {
        // === SCALED COORDINATE CONVERSION ===
        // Corners were stored as percentages of the calibration viewport.
        // We need to convert them to the current viewport while maintaining
        // the same visual relationship.

        const calCenterX = calibrationViewport.width / 2;
        const calCenterY = calibrationViewport.height / 2;

        // Calculate how much the board size has changed
        // Board CSS: min(480px, 88vw) - we replicate this calculation
        const calBoardSize = Math.min(480, calibrationViewport.width * 0.88);
        const curBoardSize = rect.width;
        const scaleByBoard = curBoardSize / calBoardSize;

        // Also calculate scale based on viewport size change
        const scaleByViewportW = window.innerWidth / calibrationViewport.width;
        const scaleByViewportH = window.innerHeight / calibrationViewport.height;

        // Use the SMALLEST scale to ensure everything fits
        // This is crucial for narrow mobile screens
        const scale = Math.min(scaleByBoard, scaleByViewportW, scaleByViewportH);

        // Calculate the scaled content dimensions
        const scaledWidth = calibrationViewport.width * scale;
        const scaledHeight = calibrationViewport.height * scale;

        // Determine where to center the content
        // Default: center of viewport
        let curCenterX = window.innerWidth / 2;
        let curCenterY = window.innerHeight / 2;

        // If content doesn't fill viewport, push to top-left for chat space
        if (scaledWidth < window.innerWidth) {
            curCenterX = scaledWidth / 2;  // Push left, chat goes right
        }
        if (scaledHeight < window.innerHeight) {
            curCenterY = scaledHeight / 2;  // Push up, chat goes bottom
        }

        // Convert each corner from calibration coordinates to current coordinates
        dst = corners.map(c => {
            // Position in calibration viewport (pixels)
            const calX = c.x * calibrationViewport.width;
            const calY = c.y * calibrationViewport.height;

            // Position relative to calibration center
            const relX = calX - calCenterX;
            const relY = calY - calCenterY;

            // Scale and position relative to current center
            const curX = curCenterX + relX * scale;
            const curY = curCenterY + relY * scale;

            // Convert to board-relative coordinates (what the transform needs)
            return {
                x: curX - rect.left,
                y: curY - rect.top
            };
        });
    } else {
        // Fallback: use viewport percentages directly (no scaling)
        dst = corners.map(c => ({
            x: c.x * window.innerWidth - rect.left,
            y: c.y * window.innerHeight - rect.top
        }));
    }

    // Compute and apply the perspective transform
    const matrix = computeTransformMatrix(src, dst);
    if (matrix) {
        container.style.transform = matrix;
    }
}


// =============================================================================
// PERSPECTIVE TRANSFORM MATHEMATICS
// =============================================================================

/**
 * Compute a CSS matrix3d transform that maps source corners to destination corners.
 *
 * This uses a HOMOGRAPHY - a projective transformation that can represent any
 * perspective distortion. It's the mathematical foundation for making a flat
 * rectangle appear to match a photographed quadrilateral.
 *
 * @param {Array} src - Source corners [{x, y}, ...] in element coordinates
 * @param {Array} dst - Destination corners [{x, y}, ...] in screen coordinates
 * @returns {string|null} CSS matrix3d() value, or null if computation fails
 */
function computeTransformMatrix(src, dst) {
    // Sort corners to consistent order: TL, TR, BR, BL
    const sortCorners = (corners) => {
        const sorted = [...corners].sort((a, b) => a.y - b.y);
        const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
        const bottom = sorted.slice(2, 4).sort((a, b) => a.x - b.x);
        return [top[0], top[1], bottom[1], bottom[0]];
    };

    const s = sortCorners(src);
    const d = sortCorners(dst);

    // Compute the 3x3 homography matrix
    const H = computeHomography(
        s[0].x, s[0].y, s[1].x, s[1].y, s[2].x, s[2].y, s[3].x, s[3].y,
        d[0].x, d[0].y, d[1].x, d[1].y, d[2].x, d[2].y, d[3].x, d[3].y
    );

    if (!H) return null;

    // Convert 3x3 homography to 4x4 CSS matrix3d
    // The mapping is: matrix3d(a1,b1,0,c1, a2,b2,0,c2, 0,0,1,0, a3,b3,0,c3)
    // Where the 3x3 homography H is:
    //   [h0 h1 h2]   [a1 a2 a3]
    //   [h3 h4 h5] = [b1 b2 b3]
    //   [h6 h7 h8]   [c1 c2 c3]
    const matrix3d = `matrix3d(
        ${H[0]}, ${H[3]}, 0, ${H[6]},
        ${H[1]}, ${H[4]}, 0, ${H[7]},
        0, 0, 1, 0,
        ${H[2]}, ${H[5]}, 0, ${H[8]}
    )`;

    return matrix3d;
}

/**
 * Compute a 3x3 homography matrix from 4 point correspondences.
 *
 * MATHEMATICAL BACKGROUND:
 * A homography H transforms points (x,y) to (X,Y) via:
 *   [X']   [h0 h1 h2] [x]
 *   [Y'] = [h3 h4 h5] [y]
 *   [W']   [h6 h7 h8] [1]
 *
 * Where X = X'/W' and Y = Y'/W' (homogeneous coordinates).
 *
 * Expanding: X = (h0*x + h1*y + h2) / (h6*x + h7*y + h8)
 *            Y = (h3*x + h4*y + h5) / (h6*x + h7*y + h8)
 *
 * Rearranging with h8=1 (we can normalize), we get 8 linear equations
 * from 4 point correspondences, which we solve using Gaussian elimination.
 *
 * @param {number} x0,y0,x1,y1,x2,y2,x3,y3 - Source corner coordinates
 * @param {number} X0,Y0,X1,Y1,X2,Y2,X3,Y3 - Destination corner coordinates
 * @returns {Array|null} 9-element array [h0..h8] or null if singular
 */
function computeHomography(x0, y0, x1, y1, x2, y2, x3, y3, X0, Y0, X1, Y1, X2, Y2, X3, Y3) {
    // Build the system of equations: A * h = b
    // Each point correspondence gives us 2 equations
    const A = [
        [x0, y0, 1, 0, 0, 0, -X0*x0, -X0*y0],  // X0 equation
        [0, 0, 0, x0, y0, 1, -Y0*x0, -Y0*y0],  // Y0 equation
        [x1, y1, 1, 0, 0, 0, -X1*x1, -X1*y1],  // X1 equation
        [0, 0, 0, x1, y1, 1, -Y1*x1, -Y1*y1],  // Y1 equation
        [x2, y2, 1, 0, 0, 0, -X2*x2, -X2*y2],  // X2 equation
        [0, 0, 0, x2, y2, 1, -Y2*x2, -Y2*y2],  // Y2 equation
        [x3, y3, 1, 0, 0, 0, -X3*x3, -X3*y3],  // X3 equation
        [0, 0, 0, x3, y3, 1, -Y3*x3, -Y3*y3]   // Y3 equation
    ];
    const b = [X0, Y0, X1, Y1, X2, Y2, X3, Y3];

    // Solve the linear system
    const h = solveLinearSystem(A, b);
    if (!h) return null;

    // Return as 3x3 matrix with h8=1 (normalized)
    return [...h, 1];
}

/**
 * Solve a system of linear equations using Gaussian elimination with partial pivoting.
 *
 * Solves Ax = b for x.
 *
 * ALGORITHM:
 * 1. Form augmented matrix [A|b]
 * 2. Forward elimination: reduce to upper triangular form
 *    - Use partial pivoting for numerical stability
 * 3. Back substitution: solve for unknowns from bottom up
 *
 * @param {Array} A - n×n coefficient matrix
 * @param {Array} b - n×1 right-hand side vector
 * @returns {Array|null} Solution vector x, or null if singular
 */
function solveLinearSystem(A, b) {
    const n = A.length;

    // Create augmented matrix [A|b]
    const aug = A.map((row, i) => [...row, b[i]]);

    // Forward elimination with partial pivoting
    for (let col = 0; col < n; col++) {
        // Find the row with largest absolute value in this column (pivot)
        let maxRow = col;
        for (let row = col + 1; row < n; row++) {
            if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) {
                maxRow = row;
            }
        }

        // Swap rows to put pivot in place
        [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

        // Check for singular matrix
        if (Math.abs(aug[col][col]) < 1e-10) return null;

        // Eliminate entries below pivot
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


// =============================================================================
// BACKGROUND IMAGE POSITIONING
// =============================================================================

/**
 * Apply the background image, scaled and positioned to match the board.
 *
 * Uses two layers:
 * 1. Chess photo on top - scaled to match board transform
 * 2. Wood texture behind - covers full viewport (prevents empty space)
 */
function applyBackground() {
    const bgPath = getCurrentBoardImagePath();
    if (!bgPath) {
        // No image selected, use wood texture
        document.body.style.backgroundImage = `url('wood-bg.jpg')`;
        document.body.style.backgroundSize = 'cover';
        document.body.style.backgroundPosition = 'center';
        return;
    }

    // Two-layer background: chess photo on top, wood texture behind
    document.body.style.backgroundImage = `url('${bgPath}'), url('wood-bg.jpg')`;
    document.body.style.backgroundRepeat = 'no-repeat, no-repeat';

    if (corners.length === 4) {
        // Need image dimensions to calculate correct aspect ratio
        if (imageDimensions[bgPath]) {
            applyBackgroundWithDimensions(imageDimensions[bgPath]);
        } else {
            // Load image to get its natural dimensions
            const img = new Image();
            img.onload = () => {
                imageDimensions[bgPath] = { width: img.naturalWidth, height: img.naturalHeight };
                applyBackgroundWithDimensions(imageDimensions[bgPath]);
            };
            img.src = bgPath;

            // Fallback while loading
            document.body.style.backgroundSize = 'cover, cover';
            document.body.style.backgroundPosition = 'center, center';
        }
        return;
    }

    // Fallback when no calibration
    document.body.style.backgroundSize = 'cover, cover';
    document.body.style.backgroundPosition = 'center, center';
    updateChatLayout(window.innerWidth, window.innerHeight);
}

/**
 * Position the background image to match the board transform exactly.
 *
 * This is the most complex part of the sync system. The key insight is:
 * - At calibration time, the image was displayed at "cover" size (filling viewport)
 * - We calculate where the board center was ON THE IMAGE at that time
 * - When scaling, we scale the image by the same factor as the board
 * - We position the image so that point still aligns with the board center
 *
 * This ensures the background and board stay perfectly locked together
 * at any viewport size.
 *
 * @param {Object} imgDim - Image dimensions {width, height}
 */
function applyBackgroundWithDimensions(imgDim) {
    const board = document.getElementById('board');
    if (!board || corners.length !== 4) return;

    // Force reflow to ensure transform is applied before measuring
    void board.offsetHeight;
    const boardRect = board.getBoundingClientRect();

    if (!calibrationViewport) {
        document.body.style.backgroundSize = 'cover, cover';
        document.body.style.backgroundPosition = 'center, center';
        updateChatLayout(window.innerWidth, window.innerHeight);
        return;
    }

    const calVW = calibrationViewport.width;
    const calVH = calibrationViewport.height;

    // Calculate the same scale factor used by the board transform
    // (Must match applyCornerTransform exactly!)
    const calBoardSize = Math.min(480, calVW * 0.88);
    const curBoardSize = Math.min(480, window.innerWidth * 0.88);
    const scaleByBoard = curBoardSize / calBoardSize;
    const scaleByViewportW = window.innerWidth / calVW;
    const scaleByViewportH = window.innerHeight / calVH;
    const scale = Math.min(scaleByBoard, scaleByViewportW, scaleByViewportH);

    // === CALCULATE IMAGE SIZE ===
    // At calibration, image was displayed with "cover" sizing
    // cover = scale to fill viewport while maintaining aspect ratio
    const calCoverScale = Math.max(calVW / imgDim.width, calVH / imgDim.height);
    const calDisplayWidth = imgDim.width * calCoverScale;
    const calDisplayHeight = imgDim.height * calCoverScale;

    // Scale the image by the same factor as the board
    const displayWidth = calDisplayWidth * scale;
    const displayHeight = calDisplayHeight * scale;

    // === CALCULATE BOARD CENTER ON IMAGE ===
    // Find the center of the calibrated corners
    const minX = Math.min(...corners.map(c => c.x));
    const maxX = Math.max(...corners.map(c => c.x));
    const minY = Math.min(...corners.map(c => c.y));
    const maxY = Math.max(...corners.map(c => c.y));

    // Corner center in calibration viewport pixels
    const calCornersCenterX = ((minX + maxX) / 2) * calVW;
    const calCornersCenterY = ((minY + maxY) / 2) * calVH;

    // At calibration, image was centered, so it overflowed equally on each side
    const calImgOffsetX = (calDisplayWidth - calVW) / 2;
    const calImgOffsetY = (calDisplayHeight - calVH) / 2;

    // Board center position ON THE IMAGE at calibration (image coordinates)
    const calBoardOnImgX = calCornersCenterX + calImgOffsetX;
    const calBoardOnImgY = calCornersCenterY + calImgOffsetY;

    // Scale this position for current display
    const boardOnImgX = calBoardOnImgX * scale;
    const boardOnImgY = calBoardOnImgY * scale;

    // === POSITION IMAGE ===
    // Current board center on screen
    const boardCenterX = boardRect.left + boardRect.width / 2;
    const boardCenterY = boardRect.top + boardRect.height / 2;

    // Position image so boardOnImg point aligns with board center
    let bgPosX = boardCenterX - boardOnImgX;
    let bgPosY = boardCenterY - boardOnImgY;

    // === ADJUST FOR CHAT SPACE ===
    // If content doesn't fill viewport, push to top-left (matching board transform)
    const scaledWidth = calVW * scale;
    const scaledHeight = calVH * scale;

    if (scaledHeight < window.innerHeight) {
        // Push up for chat at bottom
        bgPosY = boardCenterY - (calCornersCenterY * scale + (calDisplayHeight * scale - scaledHeight) / 2);
    }

    if (scaledWidth < window.innerWidth) {
        // Push left for chat at right
        bgPosX = boardCenterX - (calCornersCenterX * scale + (calDisplayWidth * scale - scaledWidth) / 2);
    }

    // Apply: chess photo sized and positioned, wood texture covering viewport
    document.body.style.backgroundSize = `${displayWidth}px ${displayHeight}px, cover`;
    document.body.style.backgroundPosition = `${bgPosX}px ${bgPosY}px, center`;

    // Update chat layout based on available space
    updateChatLayout(scaledWidth, scaledHeight);
}


// =============================================================================
// RESPONSIVE CHAT LAYOUT
// =============================================================================

/**
 * Update chat panel layout based on available empty space.
 *
 * When the scaled content doesn't fill the viewport, we expand the chat
 * to use that space. This provides a better experience on narrow/tall screens.
 *
 * RULES:
 * - Only expand when empty space > 30% of content dimension (threshold)
 * - Prefer bottom expansion (for portrait/narrow viewports)
 * - Use right expansion for landscape with extra width
 * - Scale font size based on available space (0.9rem to 1.3rem)
 *
 * @param {number} contentWidth - Width of scaled content
 * @param {number} contentHeight - Height of scaled content
 */
function updateChatLayout(contentWidth, contentHeight) {
    const chatPanel = document.querySelector('.chat-panel');
    if (!chatPanel) return;

    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    // Calculate empty space on each side
    const emptyRight = viewportW - contentWidth;
    const emptyBottom = viewportH - contentHeight;

    // Threshold: only expand when there's significant empty space (>30%)
    // This prevents jarring layout changes for small differences
    const rightThreshold = contentWidth * 0.3;
    const bottomThreshold = contentHeight * 0.3;

    // Reset any previous expansion
    chatPanel.classList.remove('expand-bottom', 'expand-right');

    if (emptyBottom > bottomThreshold && emptyBottom >= emptyRight) {
        // EXPAND BOTTOM: Full width bar at bottom of screen
        chatPanel.classList.add('expand-bottom');
        chatPanel.style.width = `${viewportW}px`;
        chatPanel.style.left = '0px';
        chatPanel.style.right = '0px';
        chatPanel.style.setProperty('--chat-height', `${emptyBottom}px`);

        // Scale font based on available height
        const fontScale = Math.min(1.3, Math.max(0.9, emptyBottom / 200));
        chatPanel.style.setProperty('--chat-font-size', `${fontScale}rem`);

    } else if (emptyRight > rightThreshold) {
        // EXPAND RIGHT: Sidebar on right side of screen
        chatPanel.classList.add('expand-right');
        chatPanel.style.setProperty('--chat-width', `${emptyRight}px`);

        // Scale font based on available width
        const fontScale = Math.min(1.3, Math.max(0.9, emptyRight / 250));
        chatPanel.style.setProperty('--chat-font-size', `${fontScale}rem`);

    } else {
        // DEFAULT: Small overlay in corner
        chatPanel.style.removeProperty('--chat-height');
        chatPanel.style.removeProperty('--chat-width');
        chatPanel.style.removeProperty('--chat-font-size');
        chatPanel.style.removeProperty('width');
        chatPanel.style.removeProperty('left');
        chatPanel.style.removeProperty('right');
    }
}


// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Toggle the board's decorative border visibility
 */
function applyBorder() {
    const container = document.querySelector('.board-container');
    if (container) {
        container.classList.toggle('no-border', borderHidden);
    }
}

/**
 * Toggle the board's checkerboard pattern visibility.
 * When hidden, the board becomes transparent to show the background image's pattern.
 */
function applyCheckerboard() {
    const board = document.getElementById('board');
    if (board) {
        board.classList.toggle('no-checkerboard', checkerboardHidden);
    }
}

/**
 * Show a status message in the dev legend
 */
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

/**
 * Update URL with current background for sharing
 */
function updateBgUrl() {
    const url = new URL(window.location);
    const img = getCurrentBoardImage();
    if (currentChapter) {
        url.searchParams.set('chapter', currentChapter.id);
    }
    if (img) {
        url.searchParams.set('bg', img);
    }
    window.history.replaceState({}, '', url);
}

/**
 * Update calibration status display in legend.
 * Shows current image index, calibration status, and uncalibrated count.
 */
function updateCalibrationStatus() {
    if (!currentChapter || devModeIndex !== 1) return;

    const total = currentChapter.boardImages.length;
    const current = currentBoardImageIndex + 1;
    const img = currentChapter.boardImages[currentBoardImageIndex];
    const calibrated = img ? img.calibrated : false;
    const uncalibratedCount = currentChapter.boardImages.filter(i => !i.calibrated).length;

    let status = `Image ${current}/${total}`;
    if (calibrated) {
        status += ' (calibrated)';
    } else {
        status += ' (NEEDS CALIBRATION)';
    }
    if (uncalibratedCount > 0) {
        status += ` | ${uncalibratedCount} uncalibrated`;
    }

    updateLegendStatus(status);
}

/**
 * Update URL with full dev config (background, corners, border, checkerboard)
 */
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
    if (checkerboardHidden) {
        url.searchParams.set('checkerboard', '0');
    } else {
        url.searchParams.delete('checkerboard');
    }
    window.history.replaceState({}, '', url);
}


// =============================================================================
// CHAPTER SELECTION MENU
// =============================================================================

/**
 * Open the chapter selection menu and populate it with available chapters.
 */
function openChapterMenu() {
    const menu = document.getElementById('chapter-menu');
    if (!menu) return;

    populateChapterList();
    menu.style.display = 'flex';

    // Close menu when clicking on overlay (outside content)
    menu.onclick = (e) => {
        if (e.target === menu) {
            closeChapterMenu();
        }
    };
}

/**
 * Close the chapter selection menu.
 */
function closeChapterMenu() {
    const menu = document.getElementById('chapter-menu');
    if (menu) {
        menu.style.display = 'none';
    }
}

/**
 * Populate the chapter list with cards for each available chapter.
 */
function populateChapterList() {
    const list = document.getElementById('chapter-list');
    if (!list || !chaptersData || !chaptersData.chapters) return;

    list.innerHTML = '';

    chaptersData.chapters.forEach((chapter, index) => {
        const card = document.createElement('div');
        card.className = 'chapter-card';
        if (index === currentChapterIndex) {
            card.classList.add('active');
        }

        // Thumbnail
        const thumbnail = document.createElement('div');
        thumbnail.className = 'chapter-thumbnail';
        if (chapter.thumbnail) {
            thumbnail.style.backgroundImage = `url('${chapter.thumbnail}')`;
        }
        card.appendChild(thumbnail);

        // Info section
        const info = document.createElement('div');
        info.className = 'chapter-info';

        const name = document.createElement('div');
        name.className = 'chapter-name';
        name.textContent = chapter.name;
        info.appendChild(name);

        if (chapter.description) {
            const desc = document.createElement('div');
            desc.className = 'chapter-description';
            desc.textContent = chapter.description;
            info.appendChild(desc);
        }

        // Game count (number of boards = number of games in championship)
        const count = document.createElement('div');
        count.className = 'chapter-count';
        const boardCount = chapter.boardImages ? chapter.boardImages.length : 0;
        count.textContent = `${boardCount} game${boardCount !== 1 ? 's' : ''}`;
        info.appendChild(count);

        card.appendChild(info);

        // Click handler
        card.addEventListener('click', () => selectChapter(chapter.id));

        list.appendChild(card);
    });
}

/**
 * Select a chapter and switch to it.
 * @param {string} chapterId - The ID of the chapter to select
 */
async function selectChapter(chapterId) {
    if (!chaptersData || !chaptersData.chapters) return;

    const chapterIdx = chaptersData.chapters.findIndex(c => c.id === chapterId);
    if (chapterIdx < 0) return;

    // Update current chapter
    currentChapterIndex = chapterIdx;
    currentChapter = chaptersData.chapters[chapterIdx];
    currentBoardImageIndex = 0;

    // Update chapter name display
    updateCurrentChapterName();

    // Save to localStorage
    if (currentChapter) {
        localStorage.setItem('lastChapter', currentChapter.id);
    }

    // Update URL
    updateBgUrl();

    // Load the first image of this chapter
    await loadBgConfig();
    applyBackground();

    // Reload chat backgrounds for new chapter
    stopChatRotation();
    await loadChapterMarkdown();
    initChatBackground();

    // Close menu
    closeChapterMenu();

    // If in calibration mode, show status
    if (devModeIndex === 1) {
        updateCalibrationStatus();
    }
}

/**
 * Update the chapter name displayed in the menu button.
 */
function updateCurrentChapterName() {
    const nameSpan = document.getElementById('current-chapter-name');
    if (nameSpan && currentChapter) {
        nameSpan.textContent = currentChapter.name;
    }
}
