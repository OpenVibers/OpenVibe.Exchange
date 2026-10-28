'use strict';

/**
 * No looks in public AI text (the network rule, openvibe-sdk/no-looks, shared with Live, Community, MediaHub and
 * Meme): an AI-written summary never describes a person's body, clothing, hair, face or guessed gender. Exchange
 * v1 has no AI-written copy — a listing's words are the maker's own — but noLooks is here for the day an AI
 * summary, sandbox description or catalogue line is generated. A summary that names looks is replaced by the
 * listing's title, exactly as Live and Meme do; a maker's own verbatim text is never rewritten by this module.
 */
const { noLooks, hasLooks } = require('openvibe-sdk/no-looks');

/** The summary to store for an AI-written listing summary. */
function cleanSummary(title, summary) {
    const t = String(title || '').trim() || 'Untitled listing';
    const s = String(summary == null ? '' : summary).trim();
    if (!s) return t;
    if (hasLooks(s)) return t;
    const cleaned = String(noLooks(s) || '').trim();
    return cleaned || t;
}

module.exports = { cleanSummary, noLooks, hasLooks };
