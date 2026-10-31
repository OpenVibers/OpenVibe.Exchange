'use strict';

/**
 * OpenVibe.Exchange's first-party catalogue. The network makes real, free things and this job lists them where people
 * can find them: Design's built-in themes and their token files, the OBS scenes and alerts overlay on Live, and the
 * public creator worlds on Games. Each listing keeps a home_url to where the thing really lives, is owned by the
 * network (owner NULL) and is marked official, with the real maker named when the source says who made it.
 *
 * There are no invented listings and no invented people. A source that stops answering is not allowed to empty the
 * catalogue; a source that answers with items and no longer lists one retires that item. source/source_id is the
 * idempotency key, so a restart or an overlapping run updates the same row.
 *
 * Sources that were checked and do not exist yet (so nothing is listed):
 *   - Design icon kits: Design publishes themes and token exports; it has no icon-kit API.
 *   - Codes agent templates: Codes publishes a harness/agent catalog, not templates.
 * When either gains one, add a reader here and a source name to SOURCES.
 */
const SOURCES = Object.freeze(['design', 'obs', 'games']);
const DESIGN_LICENSE = 'AGPL-3.0-only';
const DESIGN_LICENSE_URL = 'https://github.com/OpenVibers/OpenVibe.Design/blob/main/LICENSE';
const LIVE_LICENSE_URL = 'https://github.com/OpenVibers/OpenVibe.Live/blob/main/LICENSE';
const MAX_TITLE = 120;
const MAX_SUMMARY = 600;
const MAX_DESCRIPTION = 4000;

const plain = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
const base = (url) => String(url || '').replace(/\/+$/, '');

function createFirstParty({ config, s, entries, fetchImpl = globalThis.fetch, log = console, now = s.now }) {
    const stats = { last: null, running: false, started: false };
    let timer = null;
    let timeout = null;

    async function getJson(url, { fetch = fetchImpl } = {}) {
        const res = await fetch(url, {
            headers: { Accept: 'application/json', 'User-Agent': 'OpenVibe.Exchange (+https://openvibe.exchange)' },
            signal: AbortSignal.timeout(config.firstParty.timeoutMs),
        });
        if (!res.ok) {
            const err = new Error(`${new URL(url).host} answered ${res.status}`);
            err.status = res.status;
            throw err;
        }
        const body = await res.json().catch(() => null);
        if (!body || typeof body !== 'object') throw new Error(`${new URL(url).host} answered without JSON`);
        return body;
    }

    function contact(origin) {
        return { reads: [], writes: [], spends: [], contacts: [origin] };
    }

    function record({ source, sourceId, creator, body, homeUrl, runtime }) {
        const title = plain(body.title, MAX_TITLE);
        const summary = plain(body.summary, MAX_SUMMARY);
        if (!source || !sourceId || title.length < 3 || summary.length < 3 || !/^https:\/\//.test(homeUrl || '')) return null;
        return {
            source,
            sourceId,
            creator: plain(creator, 80) || 'OpenVibe',
            body: {
                title,
                kind: body.kind,
                mode: 'free',
                summary,
                description: plain(body.description, MAX_DESCRIPTION) || null,
                license: body.license,
                license_url: body.license_url || null,
                home_url: homeUrl,
                version: '1.0.0',
                manifest: { name: title, entry: homeUrl.slice(0, 200), runtime: runtime || null },
                passport: body.passport || contact(new URL(homeUrl).origin),
                files: Array.isArray(body.files) ? body.files : [],
            },
        };
    }

    async function designAll(fetch) {
        const themesBody = await getJson(`${base(config.firstParty.designUrl)}/api/themes`, { fetch });
        const all = Array.isArray(themesBody.themes) ? themesBody.themes : [];
        // First-party means the built-in themes. A community theme belongs to the person who made it.
        const themes = all.filter((t) => t && t.slug && (t.is_builtin === 1 || t.is_builtin === true));

        // One export list for every theme: the theme's own listing carries the files, not one listing per file.
        let targets = [];
        let targetsOk = false;
        try {
            const targetsBody = await getJson(`${base(config.firstParty.designUrl)}/api/v1/tokens`, { fetch });
            targets = (Array.isArray(targetsBody.targets) ? targetsBody.targets : [])
                .filter((t) => t && typeof t.id === 'string' && t.id)
                .map((t) => ({ id: plain(t.id, 40), label: plain(t.label || t.id, 80), lang: plain(t.lang, 40) }));
            targetsOk = true;
        } catch (err) {
            log.warn(`[OpenVibe.Exchange] Design token exports: ${(err && err.message) || err}`);
        }
        // A token endpoint that is briefly down must not wipe the downloads already on a theme listing.
        const priorFiles = new Map();
        if (!targetsOk) {
            const rows = await s.db.many("SELECT source_id, files FROM exchange_listings WHERE source = 'design.theme'");
            for (const row of rows) priorFiles.set(row.source_id, entries.wireListing(row).files);
        }

        const themeRecords = [];
        for (const theme of themes) {
            const slug = plain(theme.slug, 80);
            const name = plain(theme.name || theme.slug, 90);
            const home = `${base(config.firstParty.designUrl)}/studio?theme=${encodeURIComponent(slug)}`;
            const files = targetsOk ? targets.map((target) => ({
                format: target.id,
                label: target.label,
                url: `${base(config.firstParty.designUrl)}/api/v1/tokens/${encodeURIComponent(slug)}?format=${encodeURIComponent(target.id)}`,
            })) : (priorFiles.get(slug) || []);
            const rec = record({
                source: 'design.theme',
                sourceId: slug,
                creator: 'OpenVibe',
                homeUrl: home,
                runtime: 'web',
                body: {
                    title: `${name} theme`,
                    kind: 'theme',
                    summary: plain(theme.description, MAX_SUMMARY) || `A free ${theme.mode === 'light' ? 'light' : 'dark'} theme from OpenVibe.Design.`,
                    description: [plain(theme.description, 1000), `Open it in the studio to wear it on every OpenVibe site: ${home}`].filter(Boolean).join('\n\n'),
                    license: DESIGN_LICENSE,
                    license_url: DESIGN_LICENSE_URL,
                    passport: contact('https://openvibe.design'),
                    files,
                },
            });
            if (rec) themeRecords.push(rec);
        }
        return { themeRecords };
    }

    function obsRecords() {
        const live = base(config.firstParty.liveUrl);
        const scenes = [
            ['starting', 'Starting soon scene for OBS', 'A full-screen Starting soon scene in your theme, with the mark\'s intro and an optional countdown.'],
            ['brb', 'Be right back scene for OBS', 'A Be right back scene in your theme, with the mark breathing while you are away.'],
            ['ending', 'Thanks for watching scene for OBS', 'A Thanks for watching scene in your theme, with an optional next-stream line.'],
        ];
        const out = [];
        for (const [kind, title, description] of scenes) {
            const home = `${live}/obs/scene/${kind}/openvibe`;
            const rec = record({
                source: 'live.obs',
                sourceId: `scene:${kind}`,
                creator: 'OpenVibe',
                homeUrl: home,
                runtime: 'html',
                body: {
                    title, kind: 'template',
                    summary: 'A free OBS browser-source scene from OpenVibe.Live: add it as a source, size it 1920 × 1080, and it wears your theme.',
                    description: `${description}\n\nAdd the URL as an OBS browser source at 1920 × 1080. Replace the channel in the URL with your own Live username.\n\n${home}`,
                    license: DESIGN_LICENSE,
                    license_url: LIVE_LICENSE_URL,
                    passport: contact(live),
                },
            });
            if (rec) out.push(rec);
        }
        const alerts = `${live}/obs/alerts/openvibe?demo=1`;
        const alert = record({
            source: 'live.obs',
            sourceId: 'alerts',
            creator: 'OpenVibe',
            homeUrl: alerts,
            runtime: 'html',
            body: {
                title: 'Alerts overlay for OBS',
                kind: 'template',
                summary: 'A free alerts overlay from OpenVibe.Live: follows, tips, subs, raids and goals spring in, glint and leave, in your theme.',
                description: `Add the URL as an OBS browser source. The demo query lines the alerts up so you can style the source; drop it for the real feed, and replace the channel with your own Live username.\n\n${alerts}`,
                license: DESIGN_LICENSE,
                license_url: LIVE_LICENSE_URL,
                passport: contact(live),
            },
        });
        if (alert) out.push(alert);
        return out;
    }

    async function gamesRecords(fetch) {
        const out = [];
        const seen = new Set();
        for (let page = 1; page <= 10; page++) {
            const body = await getJson(`${base(config.firstParty.gamesUrl)}/api/worlds?page=${page}`, { fetch });
            const worlds = Array.isArray(body.worlds) ? body.worlds : [];
            for (const world of worlds) {
                if (!world || !world.id || seen.has(String(world.id))) continue;
                seen.add(String(world.id));
                const home = `${base(config.firstParty.gamesUrl)}${String(world.play_url || `/play?world=${encodeURIComponent(world.id)}`)}`;
                const creator = plain(world.owner, 80) || 'a maker';
                const rec = record({
                    source: 'games.world',
                    sourceId: plain(world.id, 64),
                    creator,
                    homeUrl: home,
                    runtime: 'game',
                    body: {
                        title: plain(world.title, MAX_TITLE) || 'A creator world on OpenVibe.Games',
                        kind: 'game_asset',
                        summary: plain(world.summary, MAX_SUMMARY) || 'A free creator world published on OpenVibe.Games.',
                        description: `A creator world on OpenVibe.Games${world.owner ? ` by ${plain(world.owner, 80)}` : ''}. Free to play in the browser.\n\n${home}`,
                        // The world is free to play; the map and its assets stay the maker's. This is a custom SPDX
                        // licence reference, not a claim that the maker released them under AGPL.
                        license: 'LicenseRef-OpenVibe-Games',
                        license_url: null,
                        passport: contact('https://openvibe.games'),
                    },
                });
                if (rec) out.push(rec);
            }
            if (!body.more) break;
        }
        return out;
    }

    async function apply(source, records) {
        const seen = [];
        let changed = 0;
        await s.tx(async (t) => {
            for (const rec of records) {
                const out = await entries.upsertFirstParty(rec, t);
                if (!out.ok) {
                    log.warn(`[OpenVibe.Exchange] ${source} ${rec.sourceId}: ${out.message || 'refused'}`);
                    continue;
                }
                seen.push(rec.sourceId);
                if (!out.unchanged) changed++;
            }
        });
        // An empty answer is treated as a quiet source, not as "delete the catalogue". Only a read that listed
        // something may retire what it no longer lists.
        const retired = seen.length ? (await entries.retireFirstParty({ source, seen, now: now() })).retired : 0;
        return { ok: true, imported: seen.length, changed, retired };
    }

    async function runOnce({ sources = SOURCES, fetchImpl: fetch = fetchImpl } = {}) {
        if (stats.running) return { busy: true, at: new Date(now()).toISOString(), sources: {} };
        stats.running = true;
        const out = {};
        try {
            for (const source of sources) {
                try {
                    if (source === 'design') {
                        const { themeRecords } = await designAll(fetch);
                        // The old job made one listing per token file. They were never meant to be separate
                        // listings, so remove exactly those official rows (a person's row is never touched).
                        const removed = await entries.removeFirstPartySource('design.tokens');
                        out.design = {
                            themes: await apply('design.theme', themeRecords),
                            removed_tokens: removed.removed,
                        };
                    } else if (source === 'obs') {
                        out.obs = await apply('live.obs', obsRecords());
                    } else if (source === 'games') {
                        out.games = await apply('games.world', await gamesRecords(fetch));
                    }
                } catch (err) {
                    out[source] = { ok: false, imported: 0, changed: 0, retired: 0, error: (err && err.message) || String(err) };
                    log.warn(`[OpenVibe.Exchange] first-party ${source}: ${(err && err.message) || err}`);
                }
            }
            stats.last = { at: new Date(now()).toISOString(), sources: out };
            return stats.last;
        } finally {
            stats.running = false;
        }
    }

    function start() {
        if (!config.firstParty.enabled || config.drill) return false;
        if (stats.started) return true;
        stats.started = true;
        const tick = async () => {
            try { await runOnce(); } catch (err) { log.warn('[OpenVibe.Exchange] first-party refresh:', (err && err.message) || err); }
        };
        timeout = setTimeout(tick, 15_000);
        if (timeout.unref) timeout.unref();
        timer = setInterval(tick, config.firstParty.intervalMs);
        if (timer.unref) timer.unref();
        log.log(`[OpenVibe.Exchange] first-party refresh every ${Math.round(config.firstParty.intervalMs / 60_000)} min: ${SOURCES.join(', ')}`);
        return true;
    }

    function stop() {
        if (timeout) clearTimeout(timeout);
        if (timer) clearInterval(timer);
        timeout = null;
        timer = null;
        stats.started = false;
    }

    return { runOnce, start, stop, stats, sources: SOURCES, _designAll: designAll, _obsRecords: obsRecords, _gamesRecords: gamesRecords };
}

module.exports = { createFirstParty, SOURCES };
