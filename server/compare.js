'use strict';

/**
 * Compare — the comparison engine behind openvibe.compare (plan 296, 297, 300, 301).
 *
 * Why Exchange: Exchange already reads OpenVibe.AI's public catalogue (price, speed, privacy, tier) and
 * OpenVibe.Bench's boards (quality), and it is the service that serves the public site. Bench owns the runs but
 * has no prices; a separate service would only re-fetch the same two reads and add a deployment. So the join is
 * made here, and every field says which service it came from and when it was read.
 *
 * A comparison is data (plan 297): things (models), criteria (price, speed, quality, privacy, tier), sources, a
 * method, and results with dates. Nothing is estimated: a model with no public Bench rounds has no quality score,
 * and the row says why instead of showing a made-up number.
 */

const QUALITY_KINDS = Object.freeze([
    { id: 'chat.arena', name: 'Exchange arena' },
    { id: 'chat.reply', name: 'Chat replies' },
    { id: 'chat.willing', name: 'Willingness to answer (18+)' },
    { id: 'vision.answer', name: 'Vision answers' },
    { id: 'codes.patch', name: 'Code patches' },
    { id: 'codes.review', name: 'Code diff review' },
    { id: 'translate.ja', name: 'Japanese translation' },
    { id: 'search.answer', name: 'Cited answers' },
]);

const NOT_CHAT = new Set(['embedding', 'embeddings', 'stt', 'asr', 'tts', 'speech', 'image', 'images', 'rerank', 'moderation']);
const KIND = 'ai.models';

const finite = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const iso = (v, fallback = null) => {
    if (!v) return fallback;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
};
const round = (v, places = 4) => (v == null ? null : Math.round(Number(v) * 10 ** places) / 10 ** places);
const pct = (a, b) => (a == null || b == null || Number(b) === 0 ? null : round(((Number(a) - Number(b)) / Math.abs(Number(b))) * 100, 2));
const norm = (s) => String(s || '').toLowerCase().replace(/^[^/]+\//, '').replace(/[^a-z0-9]+/g, '');

/** A trailing date is a release stamp, not a version of the line: gpt-5-nano-2025-08-07 is gpt-5-nano. */
const DATE_SUFFIX = /[-_ ]20\d{2}[-_]\d{1,2}[-_]\d{1,2}$/;

function baseNameOf(model) {
    return String(model.name || model.slug || '').replace(/@.*$/, '').replace(DATE_SUFFIX, '').trim();
}

/**
 * Split a model name into the line it belongs to and its version numbers.
 *   gpt-5-nano → line "gpt-nano", version [5]
 *   gpt-5.1-nano → line "gpt-nano", version [5.1]
 *   claude-opus-4-5 → line "claude-opus", version [4,5]
 *   qwen3-32b → line "qwen-32b", version [3] (32b is a size, not a version)
 * A token that is only a number, or letters followed by a number (qwen3, o3), carries a version; anything else
 * (32b, mini, chat) stays in the line's name.
 */
function splitVersion(name) {
    const tokens = String(name || '').toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean);
    const version = [];
    const line = [];
    for (const token of tokens) {
        if (/^\d+(?:\.\d+)*$/.test(token)) {
            version.push(...token.split('.').map(Number));
            continue;
        }
        const m = /^([a-z]+)(\d+(?:\.\d+)*)$/.exec(token);
        if (m) {
            line.push(m[1]);
            version.push(...m[2].split('.').map(Number));
            continue;
        }
        line.push(token);
    }
    return { line, version, key: line.join('-') || norm(name) };
}

function compareVersions(a, b) {
    const x = a.version || [];
    const y = b.version || [];
    const len = Math.max(x.length, y.length);
    for (let i = 0; i < len; i++) {
        const d = (x[i] || 0) - (y[i] || 0);
        if (d) return d;
    }
    return String(a.name).localeCompare(String(b.name));
}

function isModel(m) {
    return Boolean(m && m.slug && !NOT_CHAT.has(String(m.kind || m.type || 'chat').toLowerCase()));
}

/** An offer's price, speed, privacy and tier, exactly as AI's catalogue says them; nothing is filled in. */
function offerOf(o, catalog) {
    const price = o && o.price && Number.isFinite(Number(o.price.in)) && Number.isFinite(Number(o.price.out))
        ? {
            in: Number(o.price.in), out: Number(o.price.out),
            cached: finite(o.price.cached), per: o.price.per || '1M tokens', currency: o.price.currency || 'USD',
        }
        : null;
    const blended = price ? round((price.in + price.out) / 2, 6) : null;
    const privacy = o && o.privacy && typeof o.privacy === 'object' ? {
        label: o.privacy.label || null, retention: o.privacy.retention == null ? null : o.privacy.retention,
        training: o.privacy.training == null ? null : o.privacy.training, region: o.privacy.region || null,
        known: Boolean(o.privacy.known),
    } : null;
    return {
        provider: o.provider || null,
        provider_name: o.provider_name || o.provider || null,
        model: o.model || null,
        id: o.id || null,
        trust: o.trust || null,
        access: o.access || null,
        // The tier is whose capacity answers (the offer's trust/access), not whether it is free: a free tier on a
        // first-party model is still first-party capacity. The free flags stay beside it, where they belong.
        tier: (() => {
            if (o.trust === 'community') return 'community';
            if (o.on_our_gpus || o.trust === 'first-party') return 'first-party';
            if (o.trust === 'authorized' || o.access === 'AUTHORIZED_WHOLESALE') return 'authorized';
            return 'third-party';
        })(),
        free: Boolean(o.free), free_tier: Boolean(o.free_tier), free_now: Boolean(o.free_now),
        on_our_gpus: Boolean(o.on_our_gpus), fixed_price: Boolean(o.fixed_price),
        status: o.status || null,
        price,
        blended,
        speed: {
            p50_ms: finite(o.speed && o.speed.p50_ms),
            p95_ms: finite(o.speed && o.speed.p95_ms),
        },
        uptime: finite(o.uptime),
        error_rate: finite(o.error_rate),
        requests_7d: finite(o.requests_7d),
        requests_today: finite(o.requests_today),
        cache_hit_share_7d: finite(o.cache_hit_share_7d),
        privacy,
        data_policy: o.data_policy || null,
        refusal_rate: finite(o.refusal_rate),
        refusal_measured_on: o.refusal_measured_on || null,
        fidelity: o.fidelity == null ? null : o.fidelity,
        measured_at: iso(o.price_checked_at) || iso(o.updated_at) || iso(catalog && catalog.generated_at),
    };
}

function cheapestOffer(offers) {
    return offers.filter((o) => o.price).sort((a, b) => a.blended - b.blended)[0] || null;
}

function fastestOffer(offers) {
    return offers.filter((o) => o.speed.p50_ms != null).sort((a, b) => a.speed.p50_ms - b.speed.p50_ms)[0] || null;
}

/** The Bench board rows that name this model: an exact match, or a release date appended to the same name. */
function subjectsFor(model, rows) {
    const want = norm(model.slug || model.name);
    const tail = norm(String(model.slug || '').split('/').pop());
    return rows.filter((r) => {
        const got = norm(r.subject);
        if (!got || got.length < 5) return false;
        if (got === want || got === tail) return true;
        if (want.length >= 5 && got.startsWith(want)) return true;
        if (tail.length >= 5 && got.startsWith(tail)) return true;
        return false;
    });
}

/**
 * Quality is OpenVibe.Bench's Elo, never a guess. A line with no games has no score: the row carries `available:
 * false` and the reason, and the page prints that instead of a number.
 */
function qualityOf(model, quality) {
    const rows = subjectsFor(model, quality.rows || []);
    if (!rows.length) {
        return {
            available: false, score: null, games: 0, provisional: true, ci: null,
            by_benchmark: [], read_at: quality.at || null,
            reason: quality.unavailable ? 'Bench is not reachable right now.' : 'No public Bench rounds for this model yet.',
        };
    }
    const byKind = new Map();
    for (const r of rows) {
        const prev = byKind.get(r.kind_id);
        if (!prev || (Number(r.games) || 0) > (Number(prev.games) || 0)) byKind.set(r.kind_id, r);
    }
    const byBenchmark = [...byKind.values()].map((r) => ({
        kind_id: r.kind_id,
        name: (QUALITY_KINDS.find((k) => k.id === r.kind_id) || {}).name || r.kind_id,
        elo: finite(r.elo), games: finite(r.games) || 0, wins: finite(r.wins), losses: finite(r.losses), ties: finite(r.ties),
        win_rate: finite(r.win_rate),
        ci_lower: finite(r.ci_lower), ci_upper: finite(r.ci_upper),
        provisional: r.provisional !== false,
        read_at: quality.at || null,
    })).sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
    const games = byBenchmark.reduce((n, r) => n + (r.games || 0), 0);
    if (!games) {
        return {
            available: false, score: null, games: 0, provisional: true, ci: null,
            by_benchmark: byBenchmark, read_at: quality.at || null,
            reason: 'Bench has rounds listed for this model, but no judged games yet.',
        };
    }
    const score = round(byBenchmark.reduce((n, r) => n + (r.elo || 0) * (r.games || 0), 0) / games, 1);
    return {
        available: true, score, games, provisional: byBenchmark.some((r) => r.provisional || r.games < 10),
        // A pooled interval across different boards would be invented; each board keeps its own interval below.
        ci: null,
        by_benchmark: byBenchmark, read_at: quality.at || null,
        reason: null,
    };
}

function privacyOf(offers) {
    const labels = new Map();
    for (const o of offers) {
        const label = o.privacy && o.privacy.label;
        if (label) labels.set(label, (labels.get(label) || 0) + 1);
    }
    if (!labels.size) return { label: null, labels: [], known: false, reason: 'No offer states a privacy label.' };
    const sorted = [...labels.entries()].sort((a, b) => b[1] - a[1]);
    return {
        label: sorted[0][0], labels: sorted.map(([label, count]) => ({ label, offers: count })),
        known: true, reason: null,
    };
}

function summaryOf(model, catalog, quality) {
    const offers = (model.offers || []).map((o) => offerOf(o, catalog));
    const best = cheapestOffer(offers);
    const fastest = fastestOffer(offers);
    const priced = offers.filter((o) => o.price);
    const line = splitVersion(baseNameOf(model));
    return {
        slug: model.slug,
        name: model.name || model.slug,
        family: model.family || null,
        kind: String(model.kind || model.type || 'chat').toLowerCase(),
        variant: model.variant || null,
        open_weights: Boolean(model.open_weights),
        uncensored: Boolean(model.uncensored),
        context: finite(model.context),
        max_output: finite(model.max_output),
        capabilities: model.capabilities || null,
        modalities: Array.isArray(model.modalities) ? model.modalities : [],
        line: { key: line.key, version: line.version, version_label: line.version.join('.') || null },
        offers_count: offers.length,
        priced_offers: priced.length,
        providers: [...new Set(offers.map((o) => o.provider_name).filter(Boolean))],
        requests_7d: finite(model.requests_7d),
        requests_today: finite(model.requests_today),
        price: best ? {
            in: best.price.in, out: best.price.out, cached: best.price.cached, blended: best.blended,
            per: best.price.per, currency: best.price.currency, provider: best.provider_name,
        } : { available: false, reason: offers.length ? 'No offer has a per-token price.' : 'No live offer.' },
        price_range: priced.length ? {
            min_in: Math.min(...priced.map((o) => o.price.in)), max_in: Math.max(...priced.map((o) => o.price.in)),
            min_out: Math.min(...priced.map((o) => o.price.out)), max_out: Math.max(...priced.map((o) => o.price.out)),
        } : null,
        speed: fastest ? {
            p50_ms: fastest.speed.p50_ms, p95_ms: fastest.speed.p95_ms, provider: fastest.provider_name,
            measured_at: fastest.measured_at,
        } : { available: false, reason: 'No measured speed yet.' },
        uptime: offers.length ? Math.max(...offers.map((o) => (o.uptime == null ? 0 : o.uptime))) : null,
        free: offers.some((o) => o.free || o.free_now || (o.price && o.price.in === 0 && o.price.out === 0)),
        privacy: privacyOf(offers),
        tiers: {
            'first-party': offers.filter((o) => o.tier === 'first-party').length,
            community: offers.filter((o) => o.tier === 'community').length,
            authorized: offers.filter((o) => o.tier === 'authorized').length,
            other: offers.filter((o) => o.tier === 'third-party').length,
            free_offers: offers.filter((o) => o.free || o.free_tier || o.free_now).length,
        },
        quality: qualityOf(model, quality),
        measured_at: iso(catalog && catalog.generated_at),
    };
}

/**
 * Read the Bench boards once: one read per board, cached by the Bench client. Quality is only ever taken from
 * these rows, and a board that cannot be read is said to be unavailable, never replaced by an estimate.
 */
async function readQuality(bench, now) {
    const reads = await Promise.all(QUALITY_KINDS.map(async (kind) => {
        try {
            const board = await bench.board({ kind: kind.id, category: 'all' });
            return { kind, board: board || { unavailable: true, rows: [] } };
        } catch (err) {
            return { kind, board: { unavailable: true, rows: [], reason: String((err && err.message) || err).slice(0, 200) } };
        }
    }));
    const rows = [];
    let unavailable = 0;
    for (const { kind, board } of reads) {
        if (board.unavailable) unavailable++;
        for (const row of board.rows || []) rows.push({ ...row, kind_id: kind.id, board_name: kind.name });
    }
    return { rows, at: new Date(now()).toISOString(), unavailable: unavailable === reads.length, unread_boards: unavailable };
}

function qualityDelta(previous, current) {
    const oldRows = new Map((previous.quality.by_benchmark || []).map((r) => [r.kind_id, r]));
    const rows = [];
    for (const now of current.quality.by_benchmark || []) {
        const before = oldRows.get(now.kind_id);
        if (!before || before.elo == null || now.elo == null) continue;
        const overlap = before.ci_lower != null && before.ci_upper != null && now.ci_lower != null && now.ci_upper != null
            && before.ci_lower <= now.ci_upper && now.ci_lower <= before.ci_upper;
        rows.push({
            kind_id: now.kind_id, name: now.name, from: before.elo, to: now.elo,
            delta: round(now.elo - before.elo, 1), interval_overlaps: overlap,
        });
    }
    if (!rows.length) return null;
    const clear = rows.filter((r) => !r.interval_overlaps);
    return {
        from: previous.quality.score, to: current.quality.score,
        delta: previous.quality.score == null || current.quality.score == null ? null : round(current.quality.score - previous.quality.score, 1),
        meaningful: clear.length > 0,
        by_benchmark: rows,
        reason: clear.length ? null : 'Every changed score is inside its own interval, so this is not a clear quality change.',
    };
}

function change(key, label, from, to, { better = 'lower', unit = '', note = null } = {}) {
    if (from == null || to == null) {
        return { key, label, available: false, from, to, delta: null, pct: null, direction: 'unknown', unit, note: note || 'Not measured on one of the versions.' };
    }
    const delta = round(Number(to) - Number(from), 4);
    const direction = delta === 0 ? 'same' : (better === 'lower' ? (delta < 0 ? 'better' : 'worse') : (delta > 0 ? 'better' : 'worse'));
    return {
        key, label, available: true, from, to, delta, pct: pct(to, from), direction, unit,
        note: note || null,
    };
}

function versionDiff(previous, current) {
    const changes = [
        change('price_in', 'Price in, per 1M', previous.price && previous.price.in, current.price && current.price.in, { unit: 'USD' }),
        change('price_out', 'Price out, per 1M', previous.price && previous.price.out, current.price && current.price.out, { unit: 'USD' }),
        change('p50_ms', 'Typical response, p50', previous.speed && previous.speed.p50_ms, current.speed && current.speed.p50_ms, { unit: 'ms' }),
        change('context', 'Context', previous.context, current.context, { better: 'higher', unit: 'tokens' }),
        change('elo', 'Bench Elo', previous.quality && previous.quality.score, current.quality && current.quality.score, { better: 'higher', unit: 'Elo' }),
    ];
    const quality = qualityDelta(previous, current);
    if (quality && !quality.meaningful) {
        const elo = changes.find((c) => c.key === 'elo');
        if (elo && elo.available) elo.note = quality.reason;
    }
    const known = changes.filter((c) => c.available);
    return {
        from: previous.slug, to: current.slug,
        from_name: previous.name, to_name: current.name,
        changes,
        quality,
        summary: known.length
            ? known.filter((c) => c.direction !== 'same').map((c) => `${c.label}: ${c.direction}`).join('; ') || 'No measured change.'
            : 'No criterion is measured on both versions.',
    };
}

function lineagesOf(summaries) {
    const groups = new Map();
    for (const s of summaries) {
        const key = s.line.key || norm(s.name);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(s);
    }
    const out = [];
    for (const [key, models] of groups) {
        const sorted = [...models].sort(compareVersions);
        if (sorted.length < 2) continue;
        const rows = sorted.map((m, i) => ({
            ...m,
            changes: i ? versionDiff(sorted[i - 1], m) : null,
        }));
        out.push({
            key,
            label: sorted[0].line.key || key,
            family: sorted[0].family,
            models: rows,
            latest: rows[rows.length - 1],
            measured_at: sorted.map((m) => m.measured_at).filter(Boolean).sort().pop() || null,
        });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
}

const SIDES = Object.freeze([
    { key: 'price_in', label: 'Price in, per 1M', better: 'lower', unit: 'USD', get: (m) => m.price && m.price.in },
    { key: 'price_out', label: 'Price out, per 1M', better: 'lower', unit: 'USD', get: (m) => m.price && m.price.out },
    { key: 'p50_ms', label: 'Typical response, p50', better: 'lower', unit: 'ms', get: (m) => m.speed && m.speed.p50_ms },
    { key: 'p95_ms', label: 'Slow response, p95', better: 'lower', unit: 'ms', get: (m) => m.speed && m.speed.p95_ms },
    { key: 'elo', label: 'Bench Elo', better: 'higher', unit: 'Elo', get: (m) => m.quality && m.quality.score },
    { key: 'games', label: 'Judged games', better: null, unit: 'games', get: (m) => m.quality && m.quality.games },
    { key: 'context', label: 'Context', better: 'higher', unit: 'tokens', get: (m) => m.context },
    { key: 'uptime', label: 'Uptime, 7 days', better: 'higher', unit: 'share', get: (m) => m.uptime },
    { key: 'requests_7d', label: 'Requests, 7 days', better: null, unit: 'requests', get: (m) => m.requests_7d },
    { key: 'offers', label: 'Live offers', better: null, unit: 'offers', get: (m) => m.offers_count },
]);

function sideBySide(models) {
    const criteria = SIDES.map((side) => {
        const values = models.map((m) => {
            const value = side.get(m);
            return {
                slug: m.slug, name: m.name, value,
                display: value == null ? null : value,
                available: value != null,
                reason: value == null ? (side.key === 'elo' ? (m.quality && m.quality.reason) || 'No Bench evidence.' : 'Not measured.') : null,
            };
        });
        const present = values.filter((v) => v.available);
        let winner = null;
        if (side.better && present.length > 1) {
            const best = side.better === 'lower'
                ? Math.min(...present.map((v) => Number(v.value)))
                : Math.max(...present.map((v) => Number(v.value)));
            const atBest = present.filter((v) => Number(v.value) === best);
            if (atBest.length === 1) winner = atBest[0].slug;
        }
        return { key: side.key, label: side.label, better: side.better, unit: side.unit, values, winner };
    });

    const byKey = Object.fromEntries(criteria.map((c) => [c.key, c]));
    const winnerNames = (key) => {
        const c = byKey[key];
        if (!c || !c.winner) return null;
        const m = models.find((x) => x.slug === c.winner);
        return m ? m.name : null;
    };
    const cheapest = winnerNames('price_out');
    const fastest = winnerNames('p50_ms');
    const best = winnerNames('elo');
    const priced = models.filter((m) => m.price && m.price.out != null);
    const priceSpread = priced.length > 1 ? (() => {
        const sorted = [...priced].sort((a, b) => a.price.out - b.price.out);
        const low = sorted[0];
        const high = sorted[sorted.length - 1];
        return {
            cheapest: { slug: low.slug, name: low.name, price: low.price },
            dearest: { slug: high.slug, name: high.name, price: high.price },
            difference: round(high.price.out - low.price.out, 4),
            percent: pct(high.price.out, low.price.out),
        };
    })() : null;

    const qualityNote = (() => {
        const scored = models.filter((m) => m.quality && m.quality.available && m.quality.by_benchmark.length);
        if (scored.length < 2) return 'Fewer than two models have public Bench rounds, so quality is not compared.';
        const all = scored.flatMap((m) => m.quality.by_benchmark.map((r) => ({ ...r, slug: m.slug })));
        const overlap = all.some((a) => all.some((b) => a.slug !== b.slug && a.kind_id === b.kind_id
            && a.ci_lower != null && a.ci_upper != null && b.ci_lower != null && b.ci_upper != null
            && a.ci_lower <= b.ci_upper && b.ci_lower <= a.ci_upper));
        return overlap ? 'At least one Bench interval overlaps between models, so a quality difference is not clear on that board.' : null;
    })();

    return {
        kind: KIND,
        models,
        criteria,
        verdict: {
            headline: [
                cheapest ? `${cheapest} is cheapest on the output price` : null,
                fastest ? `${fastest} answers fastest at p50` : null,
                best ? `${best} has the strongest measured Bench Elo` : null,
            ].filter(Boolean).join('; ') || 'Not enough measured criteria to call a winner.',
            cheapest, fastest, best,
            quality_note: qualityNote,
            caveat: 'A winner is per criterion, never one invented overall score. Read the price against the quality row for your task.',
        },
        price_spread: priceSpread,
        sources: null,
        method: null,
    };
}

function createCompare({ s, ai, bench, config = {}, now = () => Date.now(), log = console } = {}) {
    const remarks = {
        async create({ models, comparison = null, field = null, remark, proposedPrompt = null, sourceUrl = null, subject = null }) {
            const id = s.newId('excr');
            const row = await s.db.maybe(
                `INSERT INTO exchange_compare_remarks
                   (id, kind_id, models, comparison, field, remark, proposed_prompt, source_url, status, subject, created_at)
                 VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, 'pending', $9, $10::timestamptz)
                 RETURNING *`,
                [id, KIND, JSON.stringify(models), comparison, field, remark, proposedPrompt, sourceUrl, subject, s.iso()],
            );
            return wireRemark(row);
        },
        async list({ status = 'pending', limit = 50 } = {}) {
            const rows = await s.db.many(
                'SELECT * FROM exchange_compare_remarks WHERE status = $1 ORDER BY created_at DESC, id DESC LIMIT $2',
                [status, Math.max(1, Math.min(200, Number(limit) || 50))],
            );
            return rows.map(wireRemark);
        },
        async get(id) {
            return wireRemark(await s.db.maybe('SELECT * FROM exchange_compare_remarks WHERE id = $1', [String(id || '')]));
        },
        async review({ id, decision, note = null, reviewer }) {
            const row = await s.db.maybe(
                `UPDATE exchange_compare_remarks
                    SET status = $1, reviewer_note = $2, reviewed_by = $3, reviewed_at = $4::timestamptz
                  WHERE id = $5 AND status = 'pending'
                  RETURNING *`,
                [decision, note, reviewer, s.iso(), String(id || '')],
            );
            return wireRemark(row);
        },
    };

    let qualityCache = null;
    const QUALITY_MS = 60_000;
    async function quality() {
        if (qualityCache && now() - qualityCache.atMs < QUALITY_MS) return qualityCache.value;
        const value = await readQuality(bench, now);
        qualityCache = { atMs: now(), value };
        return value;
    }

    async function catalogAndQuality() {
        const [catalog, q] = await Promise.all([ai.catalog(), quality()]);
        return { catalog, quality: q };
    }

    function sources(catalog, q) {
        return [
            {
                name: 'OpenVibe.AI catalog', service: 'OpenVibe.AI', url: `${config.ai && config.ai.url ? config.ai.url : 'https://ai.openvibe.services'}/api/v1/exchange/catalog`,
                read_at: iso(catalog && catalog.generated_at) || new Date(now()).toISOString(),
                fields: ['price', 'speed', 'uptime', 'requests', 'privacy', 'tier', 'context'],
            },
            {
                name: 'OpenVibe.Bench boards', service: 'OpenVibe.Bench', url: `${config.bench && config.bench.url ? config.bench.url : 'https://openvibe.compare'}/api/v1/boards`,
                read_at: q.at, fields: ['quality (Elo)', 'games', 'intervals'],
                unavailable: Boolean(q.unavailable),
            },
        ];
    }

    const method = {
        name: 'Measured, dated and not estimated',
        price: 'The cheapest live offer’s input and output price per million tokens; every offer’s own price is in the price book.',
        speed: 'The fastest live offer’s measured p50 and p95 from real requests over the last seven days; not a tokens/s figure.',
        quality: 'OpenVibe.Bench Elo from public pairwise or graded rounds, weighted by judged games. A model with no judged games has no score, and the row says why. Intervals are per board.',
        privacy: 'The privacy label and the provider’s data policy exactly as AI’s catalog records them; “not stated” is not a guess.',
        tier: 'First-party (OpenVibe’s own capacity), community (a person’s machine), authorized wholesale, free, or third-party, from the offer’s own trust and access fields.',
        versions: 'Versions are the same model line (the name without its version numbers). Each row is compared with the one before it on price, speed, context and Bench Elo. An Elo move whose intervals overlap is not called a change.',
        unavailable: 'When AI or Bench cannot be read, the field says it is unavailable and shows no figure.',
    };

    async function models({ q = '', family = '', kind = '', sort = 'requests', limit = 100, offset = 0 } = {}) {
        const { catalog, quality: qq } = await catalogAndQuality();
        let list = (catalog.models || []).filter(isModel).map((m) => summaryOf(m, catalog, qq));
        if (family) list = list.filter((m) => String(m.family || '').toLowerCase() === String(family).toLowerCase());
        if (kind) list = list.filter((m) => m.kind === String(kind).toLowerCase());
        if (q) {
            const needle = String(q).toLowerCase();
            list = list.filter((m) => `${m.name} ${m.slug} ${m.family || ''} ${m.providers.join(' ')}`.toLowerCase().includes(needle));
        }
        const order = {
            requests: (a, b) => (b.requests_7d || 0) - (a.requests_7d || 0) || a.name.localeCompare(b.name),
            cheap: (a, b) => (a.price.in == null ? Infinity : a.price.in) - (b.price.in == null ? Infinity : b.price.in) || a.name.localeCompare(b.name),
            price: (a, b) => (a.price.out == null ? Infinity : a.price.out) - (b.price.out == null ? Infinity : b.price.out) || a.name.localeCompare(b.name),
            fast: (a, b) => (a.speed.p50_ms == null ? Infinity : a.speed.p50_ms) - (b.speed.p50_ms == null ? Infinity : b.speed.p50_ms) || a.name.localeCompare(b.name),
            quality: (a, b) => (b.quality.score == null ? -Infinity : b.quality.score) - (a.quality.score == null ? -Infinity : a.quality.score) || a.name.localeCompare(b.name),
            name: (a, b) => a.name.localeCompare(b.name),
        };
        list.sort(order[sort] || order.requests);
        const total = list.length;
        const from = Math.max(0, Number(offset) || 0);
        const take = Math.max(1, Math.min(250, Number(limit) || 100));
        const page = list.slice(from, from + take);
        return {
            kind: KIND,
            generated_at: new Date(now()).toISOString(),
            catalog_generated_at: iso(catalog.generated_at),
            unavailable: Boolean(catalog.unavailable),
            count: page.length, total, offset: from, limit: take,
            facets: {
                families: [...new Set(list.map((m) => m.family).filter(Boolean))].sort(),
                kinds: [...new Set(list.map((m) => m.kind).filter(Boolean))].sort(),
                providers: [...new Set(list.flatMap((m) => m.providers))].sort(),
            },
            method,
            sources: sources(catalog, qq),
            models: page,
        };
    }

    async function model(slug) {
        const { catalog, quality: qq } = await catalogAndQuality();
        const found = (catalog.models || []).find((m) => String(m.slug).toLowerCase() === String(slug || '').toLowerCase());
        if (!found) return null;
        const summary = summaryOf(found, catalog, qq);
        const offers = (found.offers || []).map((o) => offerOf(o, catalog));
        const all = (catalog.models || []).filter(isModel).map((m) => summaryOf(m, catalog, qq));
        const lineage = lineagesOf(all).find((l) => l.key === summary.line.key) || null;
        const alternatives = all
            .filter((m) => m.slug !== summary.slug && m.kind === summary.kind)
            .sort((a, b) => {
                const da = a.price && a.price.in != null && summary.price.in != null ? Math.abs(a.price.in - summary.price.in) : Infinity;
                const db = b.price && b.price.in != null && summary.price.in != null ? Math.abs(b.price.in - summary.price.in) : Infinity;
                return da - db;
            })
            .slice(0, 6)
            .map((m) => ({ slug: m.slug, name: m.name, price: m.price, speed: m.speed, quality: m.quality }));
        return {
            kind: KIND,
            generated_at: new Date(now()).toISOString(),
            model: summary,
            offers,
            quality: { ...summary.quality, by_benchmark: summary.quality.by_benchmark },
            versions: lineage,
            alternatives,
            method,
            sources: sources(catalog, qq),
        };
    }

    async function compare(refs) {
        const { catalog, quality: qq } = await catalogAndQuality();
        const wanted = (Array.isArray(refs) ? refs : []).map((x) => String(x || '').trim()).filter(Boolean);
        if (wanted.length < 2 || wanted.length > 4) {
            return { error: 'compare.selection', message: 'Choose two to four models.', status: 400 };
        }
        const all = (catalog.models || []).filter(isModel);
        const found = [];
        for (const ref of wanted) {
            const m = all.find((x) => String(x.slug).toLowerCase() === ref.toLowerCase())
                || all.find((x) => String(x.name).toLowerCase() === ref.toLowerCase())
                || all.find((x) => String(x.slug).split('/').pop().toLowerCase() === ref.toLowerCase());
            if (!m) return { error: 'compare.model_not_found', message: `No such model: ${ref}`, status: 404 };
            if (!found.some((x) => x.slug === m.slug)) found.push(m);
        }
        if (found.length < 2) return { error: 'compare.selection', message: 'Choose two different models.', status: 400 };
        const summaries = found.map((m) => summaryOf(m, catalog, qq));
        const out = sideBySide(summaries);
        return {
            ...out,
            generated_at: new Date(now()).toISOString(),
            catalog_generated_at: iso(catalog.generated_at),
            method,
            sources: sources(catalog, qq),
        };
    }

    async function versions(key = null) {
        const { catalog, quality: qq } = await catalogAndQuality();
        const all = (catalog.models || []).filter(isModel).map((m) => summaryOf(m, catalog, qq));
        const list = lineagesOf(all);
        return {
            kind: `${KIND}.versions`,
            generated_at: new Date(now()).toISOString(),
            count: list.length,
            lineages: key ? list.filter((l) => l.key === String(key)) : list,
            method,
            sources: sources(catalog, qq),
        };
    }

    return { kind: KIND, methods: { models, model, compare, versions, quality, remarks }, method, qualityKinds: QUALITY_KINDS };
}

function wireRemark(row) {
    if (!row) return null;
    return {
        id: row.id,
        kind: row.kind_id,
        models: row.models || [],
        comparison: row.comparison || null,
        field: row.field || null,
        remark: row.remark,
        proposed_prompt: row.proposed_prompt || null,
        source_url: row.source_url || null,
        status: row.status,
        subject: row.subject || null,
        reviewer_note: row.reviewer_note || null,
        reviewed_by: row.reviewed_by || null,
        reviewed_at: row.reviewed_at || null,
        created_at: row.created_at,
    };
}

module.exports = { createCompare, KIND, QUALITY_KINDS, splitVersion, versionDiff, lineagesOf };
