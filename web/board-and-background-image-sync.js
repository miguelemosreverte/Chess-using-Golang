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

// Background images available for selection
const BACKGROUNDS = [
    'wood-bg.jpg',  // Index 0: wood texture (used as fallback layer)
    'bg-01.png', 'bg-02.png', 'bg-03.png', 'bg-04.png',
    'bg-05.png', 'bg-06.png', 'bg-07.png', 'bg-08.png',
    'bg-09.png', 'bg-10.png', 'bg-11.png'
];
let currentBgIndex = 0;

// Dev mode state for calibration
let devMode = false;
let borderHidden = false;

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
// INITIALIZATION
// =============================================================================

/**
 * Sets up the background system including:
 * - Loading background from URL param or cycling through available images
 * - Loading calibration config from server
 * - Setting up keyboard controls for dev mode
 * - Setting up mouse drag handling for corner calibration
 */
async function setupBackgroundToggle() {
    const params = new URLSearchParams(window.location.search);

    // Load background from URL param (for shared links) or cycle to next
    const bgParam = params.get('bg');
    if (bgParam) {
        const index = BACKGROUNDS.indexOf(bgParam);
        if (index >= 0) {
            currentBgIndex = index;
        }
    } else {
        // Cycle through backgrounds on each page load for variety
        const lastBgIndex = parseInt(localStorage.getItem('lastBgIndex') || '-1');
        currentBgIndex = (lastBgIndex + 1) % BACKGROUNDS.length;
        // Skip wood-bg.jpg (index 0) as it's just a texture, not a chess photo
        if (currentBgIndex === 0) currentBgIndex = 1;
    }
    localStorage.setItem('lastBgIndex', currentBgIndex.toString());

    // Update URL so sharing gives the same background
    updateBgUrl();

    // Load calibration config, then apply background
    await loadBgConfig();

    // Wait for next frame to ensure board transform is rendered before measuring
    requestAnimationFrame(() => {
        applyBackground();
    });

    // Keyboard controls
    document.addEventListener('keydown', (e) => {
        // Tab: toggle dev mode for calibration
        if (e.key === 'Tab') {
            e.preventDefault();
            devMode = !devMode;
            toggleDevMode();
            return;
        }

        // All other controls only work in dev mode
        if (!devMode) return;

        if (e.key === 'ArrowLeft') {
            // Previous background image
            currentBgIndex = (currentBgIndex - 1 + BACKGROUNDS.length) % BACKGROUNDS.length;
            loadBgConfig();
            applyBackground();
        } else if (e.key === 'ArrowRight') {
            // Next background image
            currentBgIndex = (currentBgIndex + 1) % BACKGROUNDS.length;
            loadBgConfig();
            applyBackground();
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
        }
    });

    // Mouse drag handling for corner calibration
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
        // Store as percentage of current viewport
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

/**
 * Toggle dev mode UI - shows/hides corner handles and legend
 */
function toggleDevMode() {
    const legend = document.querySelector('.dev-legend');
    if (legend) {
        legend.style.display = devMode ? 'block' : 'none';
    }
    if (devMode) {
        document.body.classList.add('dev-mode');
        if (corners.length !== 4) {
            initDefaultCorners();
        }
        createCornerHandles();
    } else {
        document.body.classList.remove('dev-mode');
        removeCornerHandles();
    }
}


// =============================================================================
// CONFIGURATION LOADING/SAVING
// =============================================================================

/**
 * Initialize corners to match the board's current screen position.
 * Used as a starting point for calibration.
 */
function initDefaultCorners() {
    const board = document.getElementById('board');
    if (!board) return;

    const rect = board.getBoundingClientRect();
    corners = [
        { x: rect.left / window.innerWidth, y: rect.top / window.innerHeight },      // TL
        { x: rect.right / window.innerWidth, y: rect.top / window.innerHeight },     // TR
        { x: rect.right / window.innerWidth, y: rect.bottom / window.innerHeight },  // BR
        { x: rect.left / window.innerWidth, y: rect.bottom / window.innerHeight }    // BL
    ];
}

/**
 * Load calibration config for the current background image from the server.
 * Config includes: corners array, border visibility, and calibration viewport size.
 */
async function loadBgConfig() {
    const bgName = BACKGROUNDS[currentBgIndex];

    try {
        const response = await fetch('/config/' + bgName);
        if (response.ok) {
            const config = await response.json();
            corners = [...config.corners];
            borderHidden = config.border === false;
            calibrationViewport = config.calibrationViewport || null;
            applyCornerTransform();
            applyBorder();

            if (devMode) {
                updateCornerHandles();
            }
            return;
        }
    } catch (e) {
        // Server config not found, reset to defaults
        corners = [];
        calibrationViewport = null;
        borderHidden = false;
        resetBoardTransform();
        applyBorder();
    }

    if (devMode) {
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
    const bgName = BACKGROUNDS[currentBgIndex];
    const config = {
        corners: corners,
        border: !borderHidden,
        // IMPORTANT: Store viewport size at calibration time
        // This allows correct scaling on different screen sizes
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
        } else {
            updateLegendStatus('Save failed');
        }
    } catch (e) {
        updateLegendStatus('Save error: ' + e.message);
    }

    setTimeout(() => updateLegendStatus(''), 2000);
}


// =============================================================================
// DEV MODE - CORNER HANDLES
// =============================================================================

/**
 * Create draggable corner handles for calibration.
 * Labels show position: TL (top-left), TR, BR, BL
 */
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
    const bgUrl = BACKGROUNDS[currentBgIndex];

    // Two-layer background: chess photo on top, wood texture behind
    document.body.style.backgroundImage = `url('${bgUrl}'), url('wood-bg.jpg')`;
    document.body.style.backgroundRepeat = 'no-repeat, no-repeat';

    if (corners.length === 4) {
        // Need image dimensions to calculate correct aspect ratio
        if (imageDimensions[bgUrl]) {
            applyBackgroundWithDimensions(imageDimensions[bgUrl]);
        } else {
            // Load image to get its natural dimensions
            const img = new Image();
            img.onload = () => {
                imageDimensions[bgUrl] = { width: img.naturalWidth, height: img.naturalHeight };
                applyBackgroundWithDimensions(imageDimensions[bgUrl]);
            };
            img.src = bgUrl;

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
    url.searchParams.set('bg', BACKGROUNDS[currentBgIndex]);
    window.history.replaceState({}, '', url);
}

/**
 * Update URL with full dev config (background, corners, border)
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
    window.history.replaceState({}, '', url);
}
