/**
 * Chapter Asset Graph Parser
 * ==========================
 *
 * Parses a line-based markdown format for defining chapter image assets.
 * Each line defines one node (image) with its type, properties, and relationships.
 *
 * Format: type: filename | property | key:value | key:list,of,values
 *
 * Node types:
 *   board: - Chess board background images
 *   chat:  - Chat panel background images (can form rotation sequences)
 *   thumb: - Chapter thumbnail images
 *
 * Example:
 *   board: bg-01.png | cal | prefers:sunny-*,cloudy-*
 *   chat: sunny-1.png | var:sunny | next:sunny-2.png
 *   chat: sunny-2.png | var:sunny | next:sunny-1.png
 *   thumb: cover.png
 */

/**
 * Parse a single line into a node object.
 * @param {string} line - A single line from the chapter definition
 * @returns {object|null} Parsed node or null for comments/empty lines
 */
function parseLine(line) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
        return null;
    }

    // Match: type: filename | props...
    const match = trimmed.match(/^(\w+):\s*(\S+)(?:\s*\|\s*(.*))?$/);
    if (!match) {
        return null;
    }

    const [, type, file, propsStr] = match;
    const node = { type, file };

    // Parse pipe-separated properties
    if (propsStr) {
        const parts = propsStr.split(/\s*\|\s*/);
        for (const part of parts) {
            if (!part) continue;

            if (part.includes(':')) {
                // key:value or key:list,of,values
                const [key, val] = part.split(':');
                node[key] = val.includes(',') ? val.split(',') : val;
            } else {
                // Boolean flag (e.g., "cal" means calibrated)
                node[part] = true;
            }
        }
    }

    return node;
}

/**
 * Parse a full chapter definition string into a graph structure.
 * @param {string} content - Multi-line chapter definition
 * @returns {object} Graph with nodes, and indices by type and variation
 */
function parseChapter(content) {
    const lines = content.split('\n');
    const graph = {
        nodes: [],
        byType: { board: [], chat: [], thumb: [] },
        byVariation: {},
        sequences: {}
    };

    for (const line of lines) {
        const node = parseLine(line);
        if (!node) continue;

        graph.nodes.push(node);

        // Index by type
        if (graph.byType[node.type]) {
            graph.byType[node.type].push(node);
        }

        // Index chat images by variation
        if (node.type === 'chat' && node.var) {
            if (!graph.byVariation[node.var]) {
                graph.byVariation[node.var] = [];
            }
            graph.byVariation[node.var].push(node);
        }
    }

    // Build sequences from 'next' relationships
    for (const node of graph.nodes) {
        if (node.next && node.var) {
            if (!graph.sequences[node.var]) {
                graph.sequences[node.var] = [];
            }
            // Add to sequence if not already there
            if (!graph.sequences[node.var].find(n => n.file === node.file)) {
                graph.sequences[node.var].push(node);
            }
        }
    }

    return graph;
}

/**
 * Get chat images that match a board's preferences.
 * @param {object} graph - Parsed graph
 * @param {object} boardNode - A board node
 * @returns {array} Matching chat nodes
 */
function getMatchingChats(graph, boardNode) {
    const prefs = boardNode.prefers;

    // No preferences = any chat is OK
    if (!prefs) {
        return graph.byType.chat;
    }

    const prefList = Array.isArray(prefs) ? prefs : [prefs];
    const matches = [];

    for (const chat of graph.byType.chat) {
        for (const pref of prefList) {
            if (pref.includes('*')) {
                // Wildcard matching
                const pattern = new RegExp('^' + pref.replace(/\*/g, '.*') + '$');
                if (pattern.test(chat.var) || pattern.test(chat.file)) {
                    matches.push(chat);
                    break;
                }
            } else {
                // Exact match
                if (chat.var === pref || chat.file === pref) {
                    matches.push(chat);
                    break;
                }
            }
        }
    }

    return matches;
}

/**
 * Get the sequence of chat images for a variation (following 'next' links).
 * @param {object} graph - Parsed graph
 * @param {string} variation - Variation name (e.g., "sunny")
 * @returns {array} Ordered sequence of chat nodes
 */
function getChatSequence(graph, variation) {
    const chats = graph.byVariation[variation];
    if (!chats || chats.length === 0) return [];

    // Find the first node (or just start with any if it's a cycle)
    const sequence = [];
    const visited = new Set();
    let current = chats[0];

    while (current && !visited.has(current.file)) {
        sequence.push(current);
        visited.add(current.file);

        if (current.next) {
            current = chats.find(c => c.file === current.next);
        } else {
            break;
        }
    }

    return sequence;
}

/**
 * Pick a random variation from available ones, optionally filtered by board preferences.
 * @param {object} graph - Parsed graph
 * @param {object} boardNode - Optional board node to filter by preferences
 * @returns {string|null} Variation name or null if none available
 */
function pickRandomVariation(graph, boardNode = null) {
    let variations = Object.keys(graph.byVariation);

    if (boardNode && boardNode.prefers) {
        const prefList = Array.isArray(boardNode.prefers) ? boardNode.prefers : [boardNode.prefers];
        variations = variations.filter(v => {
            return prefList.some(pref => {
                if (pref.includes('*')) {
                    // Convert wildcard pattern: "sunny-*" matches "sunny", "sunny-morning", etc.
                    // Also "sunny*" matches "sunny", "sunnyDay", etc.
                    const regexStr = '^' + pref.replace(/\*/g, '.*') + '$';
                    const pattern = new RegExp(regexStr);
                    // Also try matching without the trailing part if pattern ends with .*
                    const basePattern = pref.replace(/\*$/, '').replace(/-$/, '');
                    return pattern.test(v) || v === basePattern || v.startsWith(basePattern);
                }
                return v === pref;
            });
        });
    }

    if (variations.length === 0) return null;
    return variations[Math.floor(Math.random() * variations.length)];
}

/**
 * Generate chapter markdown from a list of classified images.
 * @param {array} images - Array of {file, type, variation, next} objects
 * @returns {string} Generated markdown
 */
function generateChapterMarkdown(images) {
    const lines = [];

    for (const img of images) {
        const parts = [img.file];

        if (img.cal) parts.push('cal');
        if (img.var) parts.push(`var:${img.var}`);
        if (img.next) parts.push(`next:${img.next}`);
        if (img.prefers) {
            const prefs = Array.isArray(img.prefers) ? img.prefers.join(',') : img.prefers;
            parts.push(`prefers:${prefs}`);
        }

        lines.push(`${img.type}: ${parts.join(' | ')}`);
    }

    return lines.join('\n');
}

// Export for use in browser and tests
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        parseLine,
        parseChapter,
        getMatchingChats,
        getChatSequence,
        pickRandomVariation,
        generateChapterMarkdown
    };
}
