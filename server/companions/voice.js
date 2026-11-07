'use strict';
/**
 * The character's voice (Opus's design, 2026-11-06, step 6): an answer is read aloud in the voice the card
 * names. The voice field on a card was there from the start and was never used; this is where it is used.
 *
 * The sound comes from OpenVibe.Chat's TTS - the same engine the agent voice uses - called with the
 * person's own Network token. That is the token Exchange already holds for that person (the same one the
 * M2 memory notes and the 18+ flag are read with), so the read-aloud spends the person's own allowance
 * and counts on Chat's per-person rate limit. No service token of ours is involved, and Chat's service
 * token never speaks for a person.
 *
 * The site's own voices only: a cloned voice is never asked for here (a cloned voice needs its owner's
 * opt-in, which is a separate thing and is not this route's business).
 */

// The contract's chat.tts-speak-request@1 caps the text at 220 characters, and Chat's route takes the same
// cap, so a long answer is spoken as its first line.
const MAX_CHARS = 220;

function createVoiceClient({ config, fetchImpl = globalThis.fetch, log = console } = {}) {
    const base = String((config && config.tts && config.tts.url) || '').replace(/\/+$/, '');
    const timeoutMs = (config && config.tts && config.tts.timeoutMs) || 20_000;

    /**
     * The line that is spoken: the first 220 characters, cut at a sentence when there is one inside them.
     */
    function line(text) {
        const body = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
        if (body.length <= MAX_CHARS) return body;
        const cut = body.slice(0, MAX_CHARS);
        const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
        return (stop > 40 ? cut.slice(0, stop + 1) : cut).trim();
    }

    /**
     * Speak one line in one voice.
     *   → { ok: true, audio, mimeType, rate, voiceId, text }
     *   → { ok: false, code, error, rateLimited }   (never throws: a silent answer is better than a broken chat)
     */
    async function speak(token, text, voice) {
        const spoken = line(text);
        if (!spoken) return { ok: false, code: 'voice.nothing_to_say', error: 'There is nothing to read aloud.' };
        if (!token) {
            return { ok: false, code: 'voice.no_token', error: 'The person has to sign in to hear the answer.' };
        }
        try {
            const res = await fetchImpl(base + '/api/tts/speak', {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer ' + token,
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ text: spoken, voice: voice ? String(voice).slice(0, 120) : '' }),
                signal: AbortSignal.timeout(timeoutMs),
            });
            const raw = await res.text();
            let out = null;
            try { out = raw ? JSON.parse(raw) : null; } catch (e) { out = null; }
            if (!res.ok) {
                const err = new Error((out && (out.error || out.detail)) || ('the voice answered ' + res.status));
                err.code = (out && out.code) || 'voice.failed';
                err.status = res.status;
                err.rateLimited = res.status === 429;
                throw err;
            }
            if (!out || !out.audio) {
                const err = new Error('the voice answered without audio');
                err.code = 'voice.no_audio';
                err.status = 502;
                throw err;
            }
            return {
                ok: true,
                audio: String(out.audio),
                mimeType: String(out.mime_type || 'audio/mpeg'),
                rate: Number(out.rate) || 48000,
                voiceId: out.voice_id || voice || null,
                text: spoken,
            };
        } catch (err) {
            log.warn('[Companions] the answer could not be read aloud:', String((err && err.message) || err).slice(0, 200));
            return {
                ok: false,
                code: (err && err.code) || 'voice.failed',
                error: String((err && err.message) || 'the voice is unavailable').slice(0, 200),
                rateLimited: Boolean(err && err.rateLimited),
            };
        }
    }

    return { speak, line, MAX_CHARS };
}

module.exports = { createVoiceClient, MAX_CHARS };
