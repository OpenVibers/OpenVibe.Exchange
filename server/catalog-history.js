'use strict';

/**
 * The model changelog behind /status: one row per model per UTC day, taken from the live catalogue. The next
 * day's rows are compared with the last recorded day, so the page can say what arrived, what went away and what
 * changed its price, with the dates it happened. Nothing is ever deleted or rewritten in place.
 */
const NOT_CHAT = new Set(['embedding', 'embeddings', 'stt', 'asr', 'tts', 'speech', 'image', 'images', 'rerank', 'moderation']);
const blended = (price) => (Number(price.in) + Number(price.out)) / 2;

function cheapestOffer(model) {
    const offers = (model.offers || []).filter((o) => o.price && Number.isFinite(Number(o.price.in)) && Number.isFinite(Number(o.price.out)));
    return offers.sort((a, b) => blended(a.price) - blended(b.price))[0] || (model.offers || [])[0] || null;
}

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const samePrice = (a, b) => (a == null ? null : Number(a)) === (b == null ? null : Number(b));

function createCatalogHistory({ s, log = console }) {
    const db = s.db;
    let capturedFor = null;

    /** Record today's catalogue once; a page view and a restart both cost at most one insert batch a day. */
    async function capture(catalog) {
        if (!catalog || catalog.unavailable || !Array.isArray(catalog.models) || !catalog.models.length) return;
        const day = dayOf(s.now());
        if (capturedFor === day) return;
        const existing = await db.prepare('SELECT COUNT(*) AS n FROM exchange_model_snapshots WHERE day = ?').get(day);
        if (Number(existing && existing.n) > 0) { capturedFor = day; return; }

        const statement = db.prepare(`INSERT INTO exchange_model_snapshots
            (day, slug, name, family, price_in, price_out, context, provider, community)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (day, slug) DO NOTHING`);
        let written = 0;
        for (const model of catalog.models) {
            if (!model || !model.slug) continue;
            if (NOT_CHAT.has(String(model.kind || model.type || 'chat').toLowerCase())) continue;
            const offer = cheapestOffer(model);
            const price = offer && offer.price ? offer.price : null;
            await statement.run(day, String(model.slug).slice(0, 120), String(model.name || model.slug).slice(0, 200),
                model.family ? String(model.family).slice(0, 80) : null,
                price ? Number(price.in) : null, price ? Number(price.out) : null,
                Number.isFinite(Number(model.context)) ? Number(model.context) : null,
                offer ? String(offer.provider_name || offer.provider || '').slice(0, 80) : null,
                Boolean(offer && offer.trust === 'community'));
            written++;
        }
        capturedFor = day;
        if (written) log.info(`[OpenVibe.Exchange] catalogue snapshot for ${day}: ${written} models`);
    }

    /** What changed between the last two recorded days. `available` is false when there is only one day yet. */
    async function changes() {
        const days = (await db.prepare('SELECT DISTINCT day FROM exchange_model_snapshots ORDER BY day DESC LIMIT 2').all())
            .map((r) => String(r.day).slice(0, 10));
        if (!days.length) return { available: false, from: null, to: null, added: [], gone: [], repriced: [] };
        if (days.length === 1) return { available: false, from: days[0], to: days[0], added: [], gone: [], repriced: [] };
        const [to, from] = days;
        const current = await db.prepare('SELECT * FROM exchange_model_snapshots WHERE day = ?').all(to);
        const before = await db.prepare('SELECT * FROM exchange_model_snapshots WHERE day = ?').all(from);
        const nowBy = new Map(current.map((r) => [r.slug, r]));
        const oldBy = new Map(before.map((r) => [r.slug, r]));

        const added = current.filter((r) => !oldBy.has(r.slug)).map((r) => ({
            slug: r.slug, name: r.name, family: r.family, provider: r.provider, community: Boolean(r.community),
            price_in: r.price_in == null ? null : Number(r.price_in), price_out: r.price_out == null ? null : Number(r.price_out),
        }));
        const gone = before.filter((r) => !nowBy.has(r.slug)).map((r) => ({ slug: r.slug, name: r.name, family: r.family, provider: r.provider, community: Boolean(r.community) }));
        const repriced = [];
        for (const row of current) {
            const old = oldBy.get(row.slug);
            if (!old) continue;
            if (samePrice(row.price_in, old.price_in) && samePrice(row.price_out, old.price_out)) continue;
            repriced.push({
                slug: row.slug, name: row.name, family: row.family,
                price_in: row.price_in == null ? null : Number(row.price_in),
                price_out: row.price_out == null ? null : Number(row.price_out),
                was_in: old.price_in == null ? null : Number(old.price_in),
                was_out: old.price_out == null ? null : Number(old.price_out),
            });
        }
        repriced.sort((a, b) => Math.abs((b.price_out || 0) - (b.was_out || 0)) - Math.abs((a.price_out || 0) - (a.was_out || 0)));
        return { available: true, from, to, added, gone, repriced };
    }

    return { capture, changes };
}

module.exports = { createCatalogHistory };
