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
 * Enter a chapter with cinematic transition.
 * 1. Turn page to show album
 * 2. Zoom random chat image to fullscreen
 * 3. Film burn transition to board image
 * 4. Navigate with transition overlay still visible
 * 5. Game renders behind overlay, then we fade out the overlay
 */
async function enterChapter(chapterId) {
    console.log('Entering chapter:', chapterId);

    const chapter = chapterData[chapterId];
    if (!chapter) return;

    // Find the album page for this chapter
    const albumPageIndex = bookPages.findIndex(p => p.type === 'album' && p.chapterId === chapterId);

    // Step 1: Turn page to show album (if there is one)
    if (albumPageIndex > currentPageIndex) {
        const page = document.getElementById('current-page');
        if (page) {
            page.classList.add('flipped');
            await sleep(500);
            currentPageIndex += 2;
            renderBookPages();
            await sleep(300);
        }
    }

    // Get chat images for this chapter
    const chatImages = chapter.chatImages || [];

    // Step 2: Pick a random chat image (or use chapter thumbnail if no chat images)
    let zoomImagePath;
    if (chatImages.length > 0) {
        const randomChat = chatImages[Math.floor(Math.random() * chatImages.length)];
        zoomImagePath = randomChat.path;
    } else {
        zoomImagePath = chapter.thumbnail;
    }

    // Get a board image for the final reveal
    const boardImage = chapter.boardImages[Math.floor(Math.random() * chapter.boardImages.length)];
    const boardImagePath = `chapters/${chapterId}/board/${boardImage.file}`;

    // Step 3: Zoom the chat image to fullscreen
    await zoomToFullscreen(zoomImagePath);

    // Step 4: Hold while showing chat image
    await sleep(2000);

    // Step 5: Film burn transition to board image
    await splitTransition(zoomImagePath, boardImagePath);

    // Step 6: DON'T hide the WebGPU canvas yet - keep showing board image
    // Store the board image path for the game to use for reveal
    sessionStorage.setItem('transitionBoardImage', boardImagePath);
    sessionStorage.setItem('transitionActive', 'true');

    // Step 7: Navigate - the WebGPU canvas persists through navigation
    // The game will handle revealing itself when ready
    const gameUrl = await createGameUrl(chapterId, boardImage.file);
    window.location.href = gameUrl;
}

/**
 * Zoom an image from album to fullscreen.
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
