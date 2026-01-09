/**
 * Unit Tests for Chapter Asset Graph Parser
 * Run with: node chapter-parser.test.js
 */

const {
    parseLine,
    parseChapter,
    getMatchingChats,
    getChatSequence,
    pickRandomVariation,
    generateChapterMarkdown
} = require('./chapter-parser.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  ✓ ${name}`);
        passed++;
    } catch (e) {
        console.log(`  ✗ ${name}`);
        console.log(`    ${e.message}`);
        failed++;
    }
}

function assertEqual(actual, expected, msg = '') {
    const actualStr = JSON.stringify(actual);
    const expectedStr = JSON.stringify(expected);
    if (actualStr !== expectedStr) {
        throw new Error(`${msg}\n      Expected: ${expectedStr}\n      Actual:   ${actualStr}`);
    }
}

function assertTrue(condition, msg = 'Expected true') {
    if (!condition) throw new Error(msg);
}

// ============================================================================
// parseLine tests
// ============================================================================

console.log('\nparseLine:');

test('parses empty line as null', () => {
    assertEqual(parseLine(''), null);
    assertEqual(parseLine('   '), null);
});

test('parses comment as null', () => {
    assertEqual(parseLine('# This is a comment'), null);
    assertEqual(parseLine('  # Indented comment'), null);
});

test('parses simple board line', () => {
    const result = parseLine('board: bg-01.png');
    assertEqual(result.type, 'board');
    assertEqual(result.file, 'bg-01.png');
});

test('parses board with boolean flag', () => {
    const result = parseLine('board: bg-01.png | cal');
    assertEqual(result.type, 'board');
    assertEqual(result.file, 'bg-01.png');
    assertEqual(result.cal, true);
});

test('parses board with key:value property', () => {
    const result = parseLine('board: bg-01.png | prefers:sunny');
    assertEqual(result.prefers, 'sunny');
});

test('parses board with list property', () => {
    const result = parseLine('board: bg-01.png | prefers:sunny,cloudy,evening');
    assertEqual(result.prefers, ['sunny', 'cloudy', 'evening']);
});

test('parses board with multiple properties', () => {
    const result = parseLine('board: bg-01.png | cal | prefers:sunny-*,cloudy-*');
    assertEqual(result.type, 'board');
    assertEqual(result.file, 'bg-01.png');
    assertEqual(result.cal, true);
    assertEqual(result.prefers, ['sunny-*', 'cloudy-*']);
});

test('parses chat with variation and next', () => {
    const result = parseLine('chat: sunny-1.png | var:sunny | next:sunny-2.png');
    assertEqual(result.type, 'chat');
    assertEqual(result.file, 'sunny-1.png');
    assertEqual(result.var, 'sunny');
    assertEqual(result.next, 'sunny-2.png');
});

test('parses thumb line', () => {
    const result = parseLine('thumb: cover.png');
    assertEqual(result.type, 'thumb');
    assertEqual(result.file, 'cover.png');
});

test('handles extra whitespace', () => {
    const result = parseLine('  board:   bg-01.png   |   cal   |   prefers:sunny  ');
    assertEqual(result.type, 'board');
    assertEqual(result.file, 'bg-01.png');
    assertEqual(result.cal, true);
    assertEqual(result.prefers, 'sunny');
});

// ============================================================================
// parseChapter tests
// ============================================================================

console.log('\nparseChapter:');

const sampleChapter = `
# Basic Household Chapter
# Board backgrounds

board: bg-01.png | cal | prefers:sunny-*
board: bg-02.png | cal
board: bg-03.png

# Chat backgrounds - Sunny variation (rotates)
chat: sunny-1.png | var:sunny | next:sunny-2.png
chat: sunny-2.png | var:sunny | next:sunny-3.png
chat: sunny-3.png | var:sunny | next:sunny-1.png

# Chat backgrounds - Cloudy variation
chat: cloudy-1.png | var:cloudy | next:cloudy-2.png
chat: cloudy-2.png | var:cloudy | next:cloudy-1.png

# Single static chat
chat: evening-1.png | var:evening

# Thumbnails
thumb: cover-1.png
thumb: cover-2.png
`;

test('parses all nodes', () => {
    const graph = parseChapter(sampleChapter);
    assertEqual(graph.nodes.length, 11);
});

test('indexes nodes by type', () => {
    const graph = parseChapter(sampleChapter);
    assertEqual(graph.byType.board.length, 3);
    assertEqual(graph.byType.chat.length, 6);
    assertEqual(graph.byType.thumb.length, 2);
});

test('indexes chat by variation', () => {
    const graph = parseChapter(sampleChapter);
    assertEqual(graph.byVariation.sunny.length, 3);
    assertEqual(graph.byVariation.cloudy.length, 2);
    assertEqual(graph.byVariation.evening.length, 1);
});

test('skips comments and empty lines', () => {
    const graph = parseChapter(`
        # Comment
        board: test.png

        # Another comment
    `);
    assertEqual(graph.nodes.length, 1);
});

// ============================================================================
// getMatchingChats tests
// ============================================================================

console.log('\ngetMatchingChats:');

test('returns all chats when no preferences', () => {
    const graph = parseChapter(sampleChapter);
    const board = graph.byType.board.find(b => b.file === 'bg-02.png');
    const matches = getMatchingChats(graph, board);
    assertEqual(matches.length, 6);
});

test('filters by wildcard preference', () => {
    const graph = parseChapter(sampleChapter);
    const board = graph.byType.board.find(b => b.file === 'bg-01.png');
    const matches = getMatchingChats(graph, board);
    assertEqual(matches.length, 3); // Only sunny-* matches
    assertTrue(matches.every(m => m.var === 'sunny'));
});

test('filters by exact variation match', () => {
    const graph = parseChapter(`
        board: test.png | prefers:cloudy
        chat: c1.png | var:sunny
        chat: c2.png | var:cloudy
        chat: c3.png | var:cloudy
    `);
    const board = graph.byType.board[0];
    const matches = getMatchingChats(graph, board);
    assertEqual(matches.length, 2);
});

test('handles multiple preferences', () => {
    const graph = parseChapter(`
        board: test.png | prefers:sunny,evening
        chat: c1.png | var:sunny
        chat: c2.png | var:cloudy
        chat: c3.png | var:evening
    `);
    const board = graph.byType.board[0];
    const matches = getMatchingChats(graph, board);
    assertEqual(matches.length, 2);
});

// ============================================================================
// getChatSequence tests
// ============================================================================

console.log('\ngetChatSequence:');

test('returns ordered sequence following next links', () => {
    const graph = parseChapter(sampleChapter);
    const seq = getChatSequence(graph, 'sunny');
    assertEqual(seq.length, 3);
    assertEqual(seq[0].file, 'sunny-1.png');
    assertEqual(seq[1].file, 'sunny-2.png');
    assertEqual(seq[2].file, 'sunny-3.png');
});

test('returns single item for non-rotating variation', () => {
    const graph = parseChapter(sampleChapter);
    const seq = getChatSequence(graph, 'evening');
    assertEqual(seq.length, 1);
    assertEqual(seq[0].file, 'evening-1.png');
});

test('returns empty array for unknown variation', () => {
    const graph = parseChapter(sampleChapter);
    const seq = getChatSequence(graph, 'nonexistent');
    assertEqual(seq.length, 0);
});

// ============================================================================
// pickRandomVariation tests
// ============================================================================

console.log('\npickRandomVariation:');

test('picks from all variations when no board specified', () => {
    const graph = parseChapter(sampleChapter);
    const variations = new Set();
    for (let i = 0; i < 50; i++) {
        variations.add(pickRandomVariation(graph));
    }
    assertTrue(variations.has('sunny') || variations.has('cloudy') || variations.has('evening'));
});

test('filters variations by board preferences', () => {
    const graph = parseChapter(sampleChapter);
    const board = graph.byType.board.find(b => b.file === 'bg-01.png');
    for (let i = 0; i < 20; i++) {
        const v = pickRandomVariation(graph, board);
        assertTrue(v.startsWith('sunny'), `Expected sunny variation, got ${v}`);
    }
});

// ============================================================================
// generateChapterMarkdown tests
// ============================================================================

console.log('\ngenerateChapterMarkdown:');

test('generates valid markdown from classified images', () => {
    const images = [
        { type: 'board', file: 'bg-01.png', cal: true },
        { type: 'chat', file: 'sunny-1.png', var: 'sunny', next: 'sunny-2.png' },
        { type: 'thumb', file: 'cover.png' }
    ];
    const md = generateChapterMarkdown(images);
    assertTrue(md.includes('board: bg-01.png | cal'));
    assertTrue(md.includes('chat: sunny-1.png | var:sunny | next:sunny-2.png'));
    assertTrue(md.includes('thumb: cover.png'));
});

test('handles preferences list', () => {
    const images = [
        { type: 'board', file: 'bg.png', prefers: ['sunny', 'cloudy'] }
    ];
    const md = generateChapterMarkdown(images);
    assertTrue(md.includes('prefers:sunny,cloudy'));
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

if (failed > 0) {
    process.exit(1);
}
