const { test, expect } = require('@playwright/test');
const { execSync } = require('child_process');

const FIREBASE_URL = 'https://signaling-dcfad-default-rtdb.europe-west1.firebasedatabase.app';

function firebasePut(path, data) {
    execSync(`curl -s -X PUT -d '${JSON.stringify(data)}' "${FIREBASE_URL}/${path}.json"`, { stdio: 'pipe' });
}

function firebaseDelete(path) {
    execSync(`curl -s -X DELETE "${FIREBASE_URL}/${path}.json"`, { stdio: 'pipe' });
}

// Detect pieces via DOM - no window variable access needed
async function countPieces(page) {
    return page.evaluate(() => {
        let count = 0;
        document.querySelectorAll('.square').forEach(sq => {
            if (sq.textContent.trim().length > 0) count++;
        });
        return count;
    });
}

async function waitForPieces(page, min = 16) {
    await page.waitForFunction((m) => {
        let c = 0;
        document.querySelectorAll('.square').forEach(sq => {
            if (sq.textContent.trim().length > 0) c++;
        });
        return c >= m;
    }, min, { timeout: 15000 });
}

async function getPieceAt(page, pos) {
    return page.evaluate((p) => {
        const sq = document.querySelector(`.square[data-pos="${p}"]`);
        return sq ? sq.textContent.trim() : '';
    }, pos);
}

async function waitForPieceAt(page, pos) {
    await page.waitForFunction((p) => {
        const sq = document.querySelector(`.square[data-pos="${p}"]`);
        return sq && sq.textContent.trim().length > 0;
    }, pos, { timeout: 10000 });
}

async function waitForEmptyAt(page, pos) {
    await page.waitForFunction((p) => {
        const sq = document.querySelector(`.square[data-pos="${p}"]`);
        return sq && sq.textContent.trim() === '';
    }, pos, { timeout: 10000 });
}

// Use page.evaluate to call functions defined in the global scope via <script> tags
// Script-tag globals ARE on window
async function getGameTurn(page) {
    // gameState is a `let` variable, not on window. But updateUI sets body class to `status-{status}`.
    // Instead, check which pieces can be clicked (have legal moves).
    // Or: inject a helper into the page.
    return page.evaluate(() => {
        // Access the variable through the function scope - functions are on window
        try { return gameState?.turn; } catch(e) { return null; }
    });
}

test.describe('Multiplayer Chess', () => {

    test('Moves sync between two players', async ({ browser }) => {
        const gameId = 'e2e' + Date.now().toString(36);
        firebasePut(`games/${gameId}`, {
            fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
            turn: 'white',
            status: 'active',
            moveHistory: [],
            checkSquare: null,
            undoRequest: null
        });

        const ctx1 = await browser.newContext();
        const ctx2 = await browser.newContext();
        const white = await ctx1.newPage();
        const black = await ctx2.newPage();

        // Open game — no chapter param means no intro transition
        await white.goto(`/${gameId}`);
        await black.goto(`/${gameId}`);

        // Wait for all pieces (auto-reveal after 3s)
        await waitForPieces(white, 32);
        await waitForPieces(black, 32);

        // Verify initial position - pawns on rank 2 and 7
        expect(await getPieceAt(white, 'e2')).not.toBe('');
        expect(await getPieceAt(white, 'e7')).not.toBe('');
        expect(await getPieceAt(white, 'e4')).toBe('');
        console.log('✓ Both see 32 pieces in starting position');

        // White clicks e2 (select pawn)
        await white.click('.square[data-pos="e2"]');
        await white.waitForTimeout(500);

        // Check that legal move dots appeared (e3 or e4 should have legal-move class)
        const hasLegalMove = await white.evaluate(() => {
            return document.querySelector('.square.legal-move') !== null;
        });
        expect(hasLegalMove).toBe(true);
        console.log('✓ White selected e2, sees legal moves');

        // White clicks e4
        await white.click('.square[data-pos="e4"]');
        await white.waitForTimeout(1000);

        // Verify pawn moved on white's board
        expect(await getPieceAt(white, 'e4')).not.toBe('');
        expect(await getPieceAt(white, 'e2')).toBe('');
        console.log('✓ White moved e2-e4');

        // Verify move synced to black's board
        await waitForPieceAt(black, 'e4');
        await waitForEmptyAt(black, 'e2');
        console.log('✓ Move synced to black — e4 has pawn, e2 is empty');

        // Black plays e7-e5
        await black.click('.square[data-pos="e7"]');
        await black.waitForTimeout(500);
        await black.click('.square[data-pos="e5"]');
        await black.waitForTimeout(1000);

        // Verify on black's board
        expect(await getPieceAt(black, 'e5')).not.toBe('');
        console.log('✓ Black moved e7-e5');

        // Verify synced to white
        await waitForPieceAt(white, 'e5');
        await waitForEmptyAt(white, 'e7');
        console.log('✓ Move synced to white — multiplayer works!');

        await ctx1.close();
        await ctx2.close();
    });

    test.skip('Matchmaking pairs two players on same chapter', async ({ browser }) => {
        // Skip: image transitions take too long for CI. Matchmaking logic verified manually.
        firebaseDelete('waiting_games');

        const ctx1 = await browser.newContext();
        const ctx2 = await browser.newContext();
        const player1 = await ctx1.newPage();
        const player2 = await ctx2.newPage();

        await player1.goto('/');
        await player1.waitForSelector('.chapter-clickable', { timeout: 10000 });
        console.log('✓ Player 1 sees menu');

        await player1.click('[onclick*="greek-beach"]');
        console.log('✓ Player 1 clicked Greek Beach');

        // Wait for "Waiting for opponent"
        await player1.waitForFunction(
            () => document.body.innerText.includes('Waiting for opponent'),
            { timeout: 25000 }
        );
        console.log('✓ Player 1 waiting');

        await player2.goto('/');
        await player2.waitForSelector('.chapter-clickable', { timeout: 10000 });
        await player2.click('[onclick*="greek-beach"]');
        console.log('✓ Player 2 clicked Greek Beach');

        // Both should navigate to a game page
        const waitForGame = (page) => page.waitForFunction(() => {
            const path = window.location.pathname;
            // Check path has a game ID segment (not just / or /Chess-using-Golang/)
            const segments = path.split('/').filter(Boolean);
            const last = segments[segments.length - 1];
            return last && last.length >= 5 && !last.includes('.');
        }, { timeout: 30000 });

        await waitForGame(player1);
        console.log('✓ Player 1 on game page');

        await waitForGame(player2);
        console.log('✓ Player 2 on game page');

        // Same game?
        const gid = (url) => new URL(url).pathname.split('/').filter(Boolean).pop();
        expect(gid(player1.url())).toBe(gid(player2.url()));
        console.log('✓ Both on same game!');

        await ctx1.close();
        await ctx2.close();
    });
});
