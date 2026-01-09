/**
 * Photo Book - Chapter Selector with Cinematic Transitions
 * =========================================================
 * A book-style UI for browsing chapters.
 * Click a chapter to enter with a cinematic page-turn and zoom transition.
 */

// Book state
let bookPages = [];
let currentPageIndex = 0;
let bookOverlay = null;
let chapterData = {}; // Store chapter info for transitions

/**
 * Build the book pages from chapters data.
 */
async function buildBookPages() {
    bookPages = [];
    chapterData = {};

    // Load chapters.json
    let chapters;
    try {
        const response = await fetch('/chapters.json');
        const data = await response.json();
        chapters = data.chapters;
    } catch (e) {
        console.error('Failed to load chapters:', e);
        return;
    }

    for (const chapter of chapters) {
        // Load chapter.md for chat images
        let chapterGraph = null;
        try {
            const mdResponse = await fetch(`chapters/${chapter.id}/chapter.md`);
            if (mdResponse.ok) {
                const content = await mdResponse.text();
                chapterGraph = parseChapter(content);
            }
        } catch (e) {
            console.log('No chapter.md for', chapter.id);
        }

        // Store chapter data for transitions
        chapterData[chapter.id] = {
            ...chapter,
            graph: chapterGraph
        };

        // Chapter title page (clickable - enters the game)
        const thumbPath = chapter.thumbnail || `chapters/${chapter.id}/board/${chapter.boardImages[0]?.file}`;
        bookPages.push({
            type: 'chapter',
            chapterId: chapter.id,
            title: chapter.name,
            description: chapter.description,
            image: thumbPath,
            clickable: true
        });

        // Get chat images from chapter graph
        let chatImages = [];
        if (chapterGraph && chapterGraph.byType.chat) {
            chatImages = chapterGraph.byType.chat.map(c => ({
                file: c.file,
                path: `chapters/${chapter.id}/chat/${c.file}`,
                variation: c.var
            }));
        }

        // Create album pages (4 images per page)
        for (let i = 0; i < chatImages.length; i += 4) {
            const pageImages = chatImages.slice(i, i + 4);
            bookPages.push({
                type: 'album',
                chapterId: chapter.id,
                chapterName: chapter.name,
                images: pageImages
            });
        }

        // Store chat images for this chapter
        chapterData[chapter.id].chatImages = chatImages;
    }
}

/**
 * Create the book DOM structure.
 */
function createBookDOM() {
    if (bookOverlay) {
        bookOverlay.remove();
    }

    bookOverlay = document.createElement('div');
    bookOverlay.className = 'book-overlay';
    bookOverlay.innerHTML = `
        <div class="book-container" id="book-container">
            <div class="book">
                <div class="book-left">
                    <div class="page-content" id="book-left-content"></div>
                </div>
                <div id="book-pages"></div>
            </div>
            <div class="book-nav">
                <span>← Previous</span>
                <span>Next →</span>
            </div>
        </div>
        <div class="cinematic-layer" id="cinematic-layer"></div>
    `;

    document.body.appendChild(bookOverlay);
    document.addEventListener('keydown', handleBookKeydown);
}

/**
 * Render the current page spread.
 */
function renderBookPages() {
    const pagesContainer = document.getElementById('book-pages');
    const leftContent = document.getElementById('book-left-content');

    if (!pagesContainer || !leftContent) return;

    pagesContainer.innerHTML = '';

    // Left page
    const leftPageData = bookPages[currentPageIndex];
    if (leftPageData) {
        leftContent.innerHTML = createPageContent(leftPageData, currentPageIndex);
    } else {
        leftContent.innerHTML = '';
    }

    // Right page (flippable)
    const rightPageData = bookPages[currentPageIndex + 1];
    if (rightPageData) {
        const page = document.createElement('div');
        page.className = 'page';
        page.id = 'current-page';

        // Next page content for back of flipped page
        const nextPageData = bookPages[currentPageIndex + 2];

        page.innerHTML = `
            <div class="page-front">
                <div class="page-content">
                    ${createPageContent(rightPageData, currentPageIndex + 1)}
                </div>
                <div class="page-number">${currentPageIndex + 2}</div>
            </div>
            <div class="page-back">
                <div class="page-content">
                    ${nextPageData ? createPageContent(nextPageData, currentPageIndex + 2) : ''}
                </div>
                <div class="page-number">${currentPageIndex + 3}</div>
            </div>
        `;

        page.addEventListener('click', (e) => {
            if (!e.target.closest('.chapter-clickable')) {
                nextPage();
            }
        });

        pagesContainer.appendChild(page);
    }
}

/**
 * Create HTML content for a page.
 */
function createPageContent(pageData, pageIndex) {
    if (pageData.type === 'chapter') {
        return `
            <div class="chapter-page chapter-clickable" onclick="enterChapter('${pageData.chapterId}')">
                <img class="chapter-image" src="${pageData.image}" alt="${pageData.title}">
                <h2>${pageData.title}</h2>
                <p>${pageData.description || ''}</p>
                <div class="chapter-hint">Click to enter</div>
            </div>
        `;
    } else if (pageData.type === 'album') {
        const imagesHtml = pageData.images.map((img, idx) => `
            <div class="album-photo-wrapper" data-img-path="${img.path}">
                <img class="album-photo" src="${img.path}" alt="${img.file}">
            </div>
        `).join('');

        return `
            <div class="album-page" data-chapter="${pageData.chapterId}">
                ${imagesHtml}
            </div>
        `;
    }
    return '';
}

/**
 * Enter a chapter with accelerating book transition.
 *
 * 1. Click chapter → page starts turning slowly
 * 2. Each page turn shows a chat image, getting faster each time
 * 3. Final turn reveals board image - BAM!
 * 4. Navigate to game - pieces hidden until click
 * 5. Opponent's pieces appear when they click (via hello message)
 */
async function enterChapter(chapterId) {
    console.log('Entering chapter:', chapterId);

    const chapter = chapterData[chapterId];
    if (!chapter) return;

    // Get a board image for the game
    const boardImage = chapter.boardImages[Math.floor(Math.random() * chapter.boardImages.length)];
    const boardImagePath = `chapters/${chapterId}/board/${boardImage.file}`;

    // Get chat images for the rapid page turns
    const chatImages = chapter.chatImages || [];

    // Create fullscreen book for the accelerating transition
    const fullscreenBook = createAcceleratingBook(boardImagePath, chatImages);
    document.body.appendChild(fullscreenBook);

    // Fade in fullscreen book, fade out original
    await sleep(50);
    if (bookOverlay) {
        bookOverlay.style.transition = 'opacity 0.3s';
        bookOverlay.style.opacity = '0.5';
    }
    fullscreenBook.style.transition = 'opacity 0.3s';
    fullscreenBook.style.opacity = '1';

    await sleep(300);

    // Hide original book
    if (bookOverlay) {
        bookOverlay.style.display = 'none';
    }

    // Run the accelerating page turns
    await runAcceleratingPageTurns(fullscreenBook, chatImages, boardImagePath);

    // Store state for game and navigate
    sessionStorage.setItem('transitionBoardImage', boardImagePath);
    sessionStorage.setItem('transitionActive', 'true');
    sessionStorage.setItem('hidePiecesUntilClick', 'true');
    sessionStorage.setItem('hideChatUntilOpponent', 'true');

    const gameUrl = await createGameUrl(chapterId, boardImage.file);
    window.location.href = gameUrl;
}

/**
 * Create the fullscreen book element for accelerating transition.
 */
function createAcceleratingBook(boardImagePath, chatImages) {
    const container = document.createElement('div');
    container.className = 'accelerating-book-overlay';
    container.style.cssText = `
        position: fixed;
        inset: 0;
        z-index: 2000;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.95);
        opacity: 0;
    `;

    container.innerHTML = `
        <div class="accel-book" style="
            width: 70vw;
            height: 80vh;
            perspective: 2000px;
            position: relative;
        ">
            <div class="accel-page-container" style="
                position: relative;
                width: 100%;
                height: 100%;
            ">
                <!-- Pages will be dynamically added here -->
            </div>
        </div>
    `;

    return container;
}

/**
 * Run the accelerating page turn animation.
 * Starts slow, each turn gets faster, final turn reveals board.
 */
async function runAcceleratingPageTurns(container, chatImages, boardImagePath) {
    const pageContainer = container.querySelector('.accel-page-container');

    // Use up to 6 chat images, or repeat if fewer
    const imagesToShow = [];
    if (chatImages.length > 0) {
        for (let i = 0; i < 6; i++) {
            imagesToShow.push(chatImages[i % chatImages.length].path);
        }
    } else {
        // No chat images - just show board after brief delay
        await showFinalBoard(pageContainer, boardImagePath);
        return;
    }

    // Add board as final image
    imagesToShow.push(boardImagePath);

    // Timing: starts at 800ms, decreases by ~40% each turn
    // 800 → 480 → 288 → 173 → 104 → 62 → 50 (final)
    let timing = 800;
    const speedFactor = 0.6;
    const minTiming = 50;

    for (let i = 0; i < imagesToShow.length; i++) {
        const isLast = i === imagesToShow.length - 1;
        const imagePath = imagesToShow[i];

        // Create the page
        const page = document.createElement('div');
        page.className = 'accel-page';
        page.style.cssText = `
            position: absolute;
            inset: 0;
            border-radius: 8px;
            overflow: hidden;
            transform-origin: left center;
            transform-style: preserve-3d;
            transition: transform ${timing}ms ease-in-out;
            z-index: ${100 - i};
        `;

        page.innerHTML = `
            <div style="
                position: absolute;
                width: 100%;
                height: 100%;
                backface-visibility: hidden;
                background: #f5f0e6;
            ">
                <img src="${imagePath}" style="
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                ">
            </div>
            <div style="
                position: absolute;
                width: 100%;
                height: 100%;
                backface-visibility: hidden;
                transform: rotateY(180deg);
                background: #f5f0e6;
            "></div>
        `;

        pageContainer.appendChild(page);

        // Show page briefly
        await sleep(timing * 0.3);

        // If not last, flip it away
        if (!isLast) {
            page.style.transform = 'rotateY(-180deg)';
            await sleep(timing * 0.7);
        } else {
            // Last page (board) - hold and zoom
            await sleep(300);

            // Zoom effect
            page.style.transition = 'transform 0.5s ease-out';
            page.style.transform = 'scale(1.05)';
            container.style.transition = 'background 0.5s';
            container.style.background = 'transparent';

            await sleep(500);
        }

        // Decrease timing for next turn (accelerate!)
        timing = Math.max(minTiming, timing * speedFactor);
    }
}

/**
 * Show the final board when there are no chat images.
 */
async function showFinalBoard(pageContainer, boardImagePath) {
    const page = document.createElement('div');
    page.style.cssText = `
        position: absolute;
        inset: 0;
        border-radius: 8px;
        overflow: hidden;
    `;
    page.innerHTML = `
        <img src="${boardImagePath}" style="
            width: 100%;
            height: 100%;
            object-fit: cover;
        ">
    `;
    pageContainer.appendChild(page);
    await sleep(500);
}

/**
 * Zoom an image from album to fullscreen.
 * (Legacy - kept for potential future use)
 */
async function zoomToFullscreen(imagePath) {
    const layer = document.getElementById('cinematic-layer');
    const bookContainer = document.getElementById('book-container');

    // Find the image in the album if visible
    const albumImg = document.querySelector(`[data-img-path="${imagePath}"] img`);
    let startRect;

    if (albumImg) {
        startRect = albumImg.getBoundingClientRect();
    } else {
        // Start from center of screen
        startRect = {
            left: window.innerWidth / 2 - 100,
            top: window.innerHeight / 2 - 75,
            width: 200,
            height: 150
        };
    }

    // Create zoom image
    layer.innerHTML = `
        <img class="zoom-image" src="${imagePath}" id="zoom-image">
    `;
    layer.style.display = 'block';

    const zoomImg = document.getElementById('zoom-image');

    // Set initial position
    Object.assign(zoomImg.style, {
        position: 'fixed',
        left: startRect.left + 'px',
        top: startRect.top + 'px',
        width: startRect.width + 'px',
        height: startRect.height + 'px',
        objectFit: 'cover',
        borderRadius: '8px',
        transition: 'all 0.8s cubic-bezier(0.4, 0, 0.2, 1)',
        zIndex: '2000'
    });

    // Fade out book
    bookContainer.style.transition = 'opacity 0.5s';
    bookContainer.style.opacity = '0';

    // Trigger zoom to fullscreen
    await sleep(50);
    Object.assign(zoomImg.style, {
        left: '0',
        top: '0',
        width: '100vw',
        height: '100vh',
        borderRadius: '0'
    });

    await sleep(800);
}

/**
 * Split transition: Film burn effect - board burns through chat image.
 * Uses WebGPU shaders for the classic cinema cross-dissolve with light leaks.
 * Chat image fades OUT, board image fades IN (and stays visible).
 * No fade out at the end - we navigate directly since the board is already visible.
 */
async function splitTransition(chatImagePath, boardImagePath) {
    const layer = document.getElementById('cinematic-layer');

    // Hide the simple cinematic layer
    layer.style.display = 'none';

    // Film burn transition: chat (src) fades out, board (dst) fades in
    // The board is the DESTINATION - it's what remains after the transition
    await filmBurnTransition(chatImagePath, boardImagePath, 2000);

    // Board is now fully visible - no fade out needed
    // The navigation will happen immediately after this function returns
}

/**
 * Create a new game and return the URL.
 * Includes chapter and specific board image so the game loads with the same image shown in transition.
 */
async function createGameUrl(chapterId, boardImageFile) {
    try {
        const response = await fetch('/api/games', { method: 'POST' });
        const game = await response.json();
        return `/${game.id}?chapter=${chapterId}&board=${encodeURIComponent(boardImageFile)}`;
    } catch (e) {
        console.error('Failed to create game:', e);
        return '/';
    }
}

/**
 * Helper: sleep for ms milliseconds.
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Go to next page spread.
 */
function nextPage() {
    if (currentPageIndex + 2 < bookPages.length) {
        const page = document.getElementById('current-page');
        if (page) {
            page.classList.add('flipped');
            setTimeout(() => {
                currentPageIndex += 2;
                renderBookPages();
            }, 400);
        }
    }
}

/**
 * Go to previous page spread.
 */
function prevPage() {
    if (currentPageIndex >= 2) {
        currentPageIndex -= 2;
        renderBookPages();
    }
}

/**
 * Handle keyboard navigation.
 */
function handleBookKeydown(e) {
    if (!bookOverlay || bookOverlay.style.display === 'none') return;

    if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        nextPage();
    } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prevPage();
    }
}

/**
 * Open the book.
 */
async function openBook() {
    await buildBookPages();
    createBookDOM();
    currentPageIndex = 0;
    renderBookPages();
    bookOverlay.style.display = 'flex';
}

/**
 * Close the book.
 */
function closeBook() {
    if (bookOverlay) {
        bookOverlay.style.display = 'none';
        document.removeEventListener('keydown', handleBookKeydown);
    }
}
