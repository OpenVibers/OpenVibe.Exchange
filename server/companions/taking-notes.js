'use strict';
/**
 * Taking notes (Opus's design, 2026-11-06, stage 3): after every few turns the chat writes short memory
 * notes with a cheap model.
 *
 * The cheap model: the router's economy alias (openvibe/economy - the alias whose policy is "cheapest"), under
 * the person's own allowance and the free-use price ceiling every companion answer stays under
 * (config.companions.maxCostUsd). The notes are short, and they are about the person: a fact, a preference or
 * an event. They are written into the person's own memory (the M2 store), through the notes store, so the hard
 * floor is checked on them like on everything else.
 *
 * The model is asked for a small JSON array and nothing else. Anything it says that is not a note is dropped: a
 * note that cannot be read is not written.
 */

const floor = require('./floor');

const MAX_NOTES = 6;
const MAX_TEXT = 300;

const SYSTEM = [
    'You keep short notes about the person you are talking with, for a companion app.',
    'Write down only what is worth remembering: facts about them (who they are, what they do, what they like),',
    'their preferences (how they want to be spoken to, what they like to talk about), and events that happened',
    'in the conversation (what they said they did, what they asked for).',
    'Never write down anything about the character, anything about the rules of the app, or anything sexual.',
    'Answer with a JSON array only, no text around it, like [{"kind":"fact","text":"..."}].',
    'kind is one of: fact, preference, event. If there is nothing worth remembering, answer [].',
].join(' ');

/** The notes in a model's answer: the array it promised, or nothing. */
function parseNotes(text) {
    const raw = String(text == null ? '' : text).trim();
    if (!raw) return [];
    let body = raw;
    const start = body.indexOf('[');
    const end = body.lastIndexOf(']');
    if (start >= 0 && end > start) body = body.slice(start, end + 1);
    let parsed = null;
    try { parsed = JSON.parse(body); } catch (e) { parsed = null; }
    if (!Array.isArray(parsed)) return [];
    const out = [];
    for (const item of parsed) {
        if (!item || typeof item !== 'object') continue;
        const text2 = String(item.text == null ? '' : item.text).trim().slice(0, MAX_TEXT);
        if (!text2) continue;
        const kind = ['fact', 'preference', 'event'].includes(String(item.kind)) ? String(item.kind) : 'fact';
        // The hard floor holds on a note, whoever wrote it.
        if (!floor.check(text2).ok) continue;
        out.push({ kind, text: text2 });
        if (out.length >= MAX_NOTES) break;
    }
    return out;
}

/** The transcript the cheap model reads: the last few turns, plainly. */
function transcriptOf(turns, max = 2400) {
    const parts = [];
    for (const t of turns || []) {
        if (t.user && t.user.content) parts.push('The person: ' + String(t.user.content).slice(0, 600));
        if (t.answer && t.answer.content) parts.push('The companion: ' + String(t.answer.content).slice(0, 600));
    }
    const text = parts.join('\n');
    return text.length > max ? text.slice(text.length - max) : text;
}

function createNoteTaker({ ai, notes, config, log = console } = {}) {
    const every = Math.max(1, Number((config && config.companions && config.companions.notesEveryTurns) || 4));
    const model = String((config && config.companions && config.companions.noteModel) || 'openvibe/economy');
    const maxCost = (config && config.companions && config.companions.maxCostUsd) || 0.05;

    /**
     * Whether it is time to take notes: every few turns, and never more than once per turn.
     */
    function due(turnCount) {
        return Number(turnCount) > 0 && Number(turnCount) % every === 0;
    }

    /**
     * Take the notes of a chat. The notes are the model's own suggestions, written as suggestions: the person
     * reads them in the Memory panel and edits, pins or deletes them. `protect` seals each note before it reaches
     * the memory store, for a character locked with the person's Locker keys.
     */
    async function take({ owner, characterId, token, turns, protect = null }) {
        const transcript = transcriptOf(turns);
        if (!transcript.trim()) return { notes: [] };
        let out = null;
        try {
            out = await ai.chat({
                model,
                messages: [
                    { role: 'system', content: SYSTEM },
                    { role: 'user', content: transcript },
                ],
                subject: owner,
                policy: 'standard',
                max_cost_usd: maxCost,
                maxTokens: 600,
            });
        } catch (err) {
            log.warn('[Companions] the notes were not taken:', String((err && err.message) || err).slice(0, 200));
            return { notes: [] };
        }
        const parsed = parseNotes(out && out.content);
        const written = [];
        for (const note of parsed) {
            try {
                written.push(await notes.add(owner, characterId, { kind: note.kind, text: note.text, origin: 'model' }, token, protect));
            } catch (err) {
                log.warn('[Companions] a note was refused:', String((err && err.message) || err).slice(0, 160));
            }
        }
        return { notes: written };
    }

    return { take, due, parseNotes, transcriptOf, every, model };
}

module.exports = { createNoteTaker, parseNotes, transcriptOf, MAX_NOTES };
