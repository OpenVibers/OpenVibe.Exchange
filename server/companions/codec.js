'use strict';

/**
 * Character Card V2 and V3, in and out (Opus's design, 2026-11-06): people bring their SillyTavern, Chub and
 * Janitor characters in, and leave with them.
 *
 * The open format:
 *   - plain JSON: { "spec": "chara_card_v2" | "chara_card_v3", "spec_version": "2.0" | "3.0", "data": { … } }
 *   - PNG: the same JSON, base64-encoded, in a tEXt chunk named "chara" (the keyword SillyTavern writes;
 *     "ccv2" and "ccv3" are read too, because older exports use them).
 *
 * The PNG is written by hand here — a chunk reader, a chunk writer and CRC-32 — so no image library is
 * needed and the picture itself is never re-encoded: the bytes are copied through and one chunk is added.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ── CRC-32 (PNG's) ──────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c;
    }
    return table;
})();

function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

/** One PNG chunk: length, type, data, crc. */
function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
}

/** The tEXt chunks of a PNG, as { keyword, text }. */
function readTexts(buffer) {
    const out = [];
    if (!buffer || buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return out;
    let at = 8;
    while (at + 8 <= buffer.length) {
        const len = buffer.readUInt32BE(at);
        const type = buffer.toString('ascii', at + 4, at + 8);
        const data = buffer.subarray(at + 8, at + 8 + len);
        if (type === 'tEXt') {
            const split = data.indexOf(0);
            if (split > 0) out.push({ keyword: data.toString('latin1', 0, split), text: data.toString('latin1', split + 1) });
        } else if (type === 'zTXt') {
            const split = data.indexOf(0);
            if (split > 0) out.push({ keyword: data.toString('latin1', 0, split), text: '' });
        } else if (type === 'IEND') break;
        at += 12 + len;
    }
    return out;
}

/** A copy of the PNG with one tEXt chunk added just before IEND. The picture bytes are untouched. */
function writeText(buffer, keyword, text) {
    if (!buffer || buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG');
    const data = Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(text, 'latin1')]);
    const tEXt = chunk('tEXt', data);
    let at = 8;
    while (at + 8 <= buffer.length) {
        const len = buffer.readUInt32BE(at);
        const type = buffer.toString('ascii', at + 4, at + 8);
        if (type === 'IEND') {
            return Buffer.concat([buffer.subarray(0, at), tEXt, buffer.subarray(at)]);
        }
        at += 12 + len;
    }
    throw new Error('the PNG has no IEND chunk');
}

const KEYWORDS = ['chara', 'ccv2', 'ccv3', 'character'];
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const unb64 = (s) => Buffer.from(String(s).replace(/\s+/g, ''), 'base64').toString('utf8');

/** The card's own fields, in the open format's words. */
function toSpec(card, spec = 'v3') {
    const data = {
        name: String(card.name || '').slice(0, 80),
        description: String(card.description || ''),
        personality: String(card.personality || ''),
        scenario: String(card.scenario || ''),
        first_mes: String(card.first_message || ''),
        mes_example: String(card.example_dialogue || ''),
        creator_notes: String(card.creator_notes || ''),
        system_prompt: '',
        post_history_instructions: '',
        alternate_greetings: [],
        tags: Array.isArray(card.tags) ? card.tags.map(String) : [],
        creator: String(card.creator || ''),
        character_version: String(card.character_version || '1'),
        extensions: {},
    };
    if (card.rating === 'adult') data.extensions = { ...(data.extensions || {}), openvibe: { rating: 'adult', age: card.age ?? null } };
    if (spec === 'v3') {
        data.assets = card.avatar_url ? [{ type: 'image', name: 'avatar', uri: String(card.avatar_url) }] : [];
        data.group_only_greetings = [];
        return { spec: 'chara_card_v3', spec_version: '3.0', data };
    }
    return { spec: 'chara_card_v2', spec_version: '2.0', data };
}

/** The open format's words back into a card. V2 and V3 differ only in the extra V3 fields, so both read here. */
function fromSpec(json) {
    if (!json || typeof json !== 'object') throw new Error('the card is not JSON');
    const data = json.data && typeof json.data === 'object' ? json.data : json;
    if (!data || typeof data !== 'object') throw new Error('the card has no data');
    const ext = (data.extensions && data.extensions.openvibe) || {};
    const tags = Array.isArray(data.tags) ? data.tags.map((t) => String(t).trim()).filter(Boolean) : [];
    const out = {
        name: String(data.name || '').trim().slice(0, 80),
        description: String(data.description || ''),
        personality: String(data.personality || ''),
        scenario: String(data.scenario || ''),
        first_message: String(data.first_mes || ''),
        example_dialogue: String(data.mes_example || ''),
        creator_notes: String(data.creator_notes || ''),
        tags: [...new Set(tags)].slice(0, 20),
        creator: String(data.creator || ''),
        character_version: String(data.character_version || '1'),
        rating: ext.rating === 'adult' ? 'adult' : 'everyone',
        age: ext.age != null ? Number(ext.age) : null,
    };
    if (!out.name) throw new Error('the card has no name');
    return out;
}

/**
 * Read a card from bytes: a PNG with the JSON in a tEXt chunk, or plain JSON.
 * Returns { card, spec } and throws with a plain reason when the bytes are not a card.
 */
function importCard(buffer, { filename = '' } = {}) {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
    const isPng = buf.length > 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE);
    if (isPng) {
        const texts = readTexts(buf);
        const hit = texts.find((t) => KEYWORDS.includes(t.keyword.toLowerCase()) && t.text);
        if (!hit) throw new Error('this PNG carries no character card');
        let json;
        try { json = JSON.parse(unb64(hit.text)); }
        catch (e) { throw new Error('the card in this PNG is not readable JSON'); }
        return { card: fromSpec(json), spec: String(json.spec || 'chara_card_v2') };
    }
    let json;
    try { json = JSON.parse(buf.toString('utf8')); }
    catch (e) { throw new Error(filename ? `${filename} is not a character card` : 'this is not a character card'); }
    return { card: fromSpec(json), spec: String(json.spec || 'chara_card_v2') };
}

/**
 * Write a card out. format: 'json' or 'png'. A PNG needs a picture to carry the card: the avatar's bytes,
 * or a 1x1 transparent PNG when there is none.
 */
function exportCard(card, { format = 'json', spec = 'v3', image = null } = {}) {
    const json = toSpec(card, spec);
    const text = JSON.stringify(json, null, 2);
    if (format === 'png') {
        const png = image && Buffer.isBuffer(image) && image.length > 8 ? image : BLANK_PNG;
        const withCard = writeText(png, 'chara', b64(text));
        return { contentType: 'image/png', buffer: withCard, filename: `${slugOf(card.name)}.png` };
    }
    return { contentType: 'application/json; charset=utf-8', buffer: Buffer.from(text, 'utf8'), filename: `${slugOf(card.name)}.json` };
}

const slugOf = (name) => String(name || 'character').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'character';

/** A 1x1 transparent PNG, for a card with no avatar. */
const BLANK_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
);

module.exports = { importCard, exportCard, toSpec, fromSpec, readTexts, writeText, crc32, slugOf, PNG_SIGNATURE };
