'use strict';
/**
 * The first-party catalogue: Design's built-in themes and their token files, Live's OBS scenes and alerts, and Games'
 * public worlds. The job is idempotent, keeps each thing's real home, marks it official without inventing a person,
 * retires what a source no longer lists, and never touches a person's own listing.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const fixtures = require('./helpers/fixtures');

const THEMES = {
    themes: [
        {
            id: 'vibe', name: 'Vibe', slug: 'vibe', mode: 'dark',
            description: 'The default OpenVibe theme.', is_builtin: 1,
            variables: { '--bg-primary': '#0a0f1c' }, owner_email: 'designer@example.test', api_key: 'should_never_be_listed',
        },
        { id: 'paper', name: 'Paper', slug: 'paper', mode: 'light', description: 'A quiet light theme.', is_builtin: true, variables: {} },
        { id: 'made-by-a-person', name: 'Mine', slug: 'mine', mode: 'dark', description: 'A community theme.', is_builtin: 0, variables: {} },
    ],
};

const TARGETS = {
    targets: [
        { id: 'css', label: 'CSS variables', ext: 'css', lang: 'css' },
        { id: 'json', label: 'Design tokens', ext: 'tokens.json', lang: 'json' },
    ],
};

const WORLDS = {
    worlds: [
        { id: 'wabc123def0', title: 'Floating islands', summary: 'A world of bridges in the sky.', owner: 'maker', plays: 12, online: 0, play_url: '/play?world=wabc123def0' },
    ],
    page: 1,
    more: false,
};

function fakeFetch({ themes = THEMES, targets = TARGETS, worlds = WORLDS, failGames = false, failTargets = false } = {}) {
    return async (url) => {
        const u = new URL(url);
        if (u.hostname === 'openvibe.design' && u.pathname === '/api/themes') return { ok: true, status: 200, json: async () => themes };
        if (u.hostname === 'openvibe.design' && u.pathname === '/api/v1/tokens') {
            if (failTargets) return { ok: false, status: 503, json: async () => ({}) };
            return { ok: true, status: 200, json: async () => targets };
        }
        if (u.hostname === 'openvibe.games' && u.pathname === '/api/worlds') {
            if (failGames) throw new Error('Games is restarting');
            return { ok: true, status: 200, json: async () => worlds };
        }
        return { ok: false, status: 404, json: async () => ({}) };
    };
}

(async () => {
    const t = await boot();
    const alice = t.network.addUser('alice');
    try {
        const fetch = fakeFetch();
        let themeId = null;
        let revision = null;

        await check('a first pass lists each theme once, with its token files, plus the OBS templates and a public world', async () => {
            const out = await t.ctx.firstParty.runOnce({ sources: ['design', 'obs', 'games'], fetchImpl: fetch });
            assert.strictEqual(out.sources.design.themes.ok, true, JSON.stringify(out.sources.design));
            assert.strictEqual(out.sources.design.themes.imported, 2, 'only the two built-in themes');
            assert.strictEqual(out.sources.design.removed_tokens, 0);
            assert.strictEqual(out.sources.obs.imported, 4, 'three scenes and the alerts overlay');
            assert.strictEqual(out.sources.games.imported, 1);

            const list = await t.get('/api/v1/listings?limit=50');
            assert.strictEqual(list.status, 200, list.text);
            assert.strictEqual(list.json().count, 7);
            const rows = list.json().listings;
            for (const row of rows) {
                assert.strictEqual(row.official, true, `${row.slug} is official`);
                assert.match(row.home_url, /^https:\/\//, `${row.slug} keeps a real home`);
                assert.strictEqual(row.status, 'listed');
                assert.strictEqual(row.mode, 'free');
                assert.ok(!('owner' in row), 'the public list never carries an owner');
            }

            const theme = rows.find((r) => r.slug === 'vibe-theme');
            assert.ok(theme, 'the Vibe theme is listed');
            themeId = theme.id;
            revision = theme.revision;
            assert.strictEqual(theme.kind, 'theme');
            assert.strictEqual(theme.creator, 'OpenVibe');
            assert.strictEqual(theme.home_url, 'https://openvibe.design/studio?theme=vibe');
            assert.strictEqual(theme.manifest.entry, theme.home_url);
            assert.strictEqual(theme.license, 'AGPL-3.0-only');
            assert.deepStrictEqual(theme.files, [
                { format: 'css', label: 'CSS variables', url: 'https://openvibe.design/api/v1/tokens/vibe?format=css' },
                { format: 'json', label: 'Design tokens', url: 'https://openvibe.design/api/v1/tokens/vibe?format=json' },
            ], 'the theme carries its token files');
            assert.ok(!rows.some((r) => r.home_url.includes('?format=')), 'no token file is a listing of its own');
            assert.strictEqual(await t.ctx.s.db.value("SELECT COUNT(*)::int AS n FROM exchange_listings WHERE source = 'design.tokens'"), 0);

            const world = rows.find((r) => r.slug === 'floating-islands');
            assert.ok(world, 'the public world is listed');
            assert.strictEqual(world.kind, 'game_asset');
            assert.strictEqual(world.creator, 'maker', 'the real maker is credited on a network listing');
            assert.strictEqual(world.home_url, 'https://openvibe.games/play?world=wabc123def0');

            assert.ok(rows.some((r) => r.home_url === 'https://openvibe.live/obs/scene/starting/openvibe'));
            assert.ok(rows.some((r) => r.home_url === 'https://openvibe.live/obs/scene/brb/openvibe'));
            assert.ok(rows.some((r) => r.home_url === 'https://openvibe.live/obs/scene/ending/openvibe'));
            assert.ok(rows.some((r) => r.home_url === 'https://openvibe.live/obs/alerts/openvibe?demo=1'));
            assert.ok(!rows.some((r) => r.home_url.includes('/mine')), 'a community theme is not relisted as first-party');
        });

        await check('a second pass changes nothing and creates no duplicate', async () => {
            const before = await t.ctx.s.db.value('SELECT COUNT(*)::int AS n FROM exchange_listings');
            const out = await t.ctx.firstParty.runOnce({ sources: ['design', 'obs', 'games'], fetchImpl: fetch });
            assert.strictEqual(out.sources.design.themes.imported, 2);
            assert.strictEqual(out.sources.design.removed_tokens, 0);
            assert.strictEqual(out.sources.games.imported, 1);
            assert.strictEqual(await t.ctx.s.db.value('SELECT COUNT(*)::int AS n FROM exchange_listings'), before);
            const dupes = await t.ctx.s.db.many('SELECT source, source_id, COUNT(*)::int AS n FROM exchange_listings WHERE source IS NOT NULL GROUP BY 1, 2 HAVING COUNT(*) > 1');
            assert.deepStrictEqual(dupes, []);
            const theme = await t.ctx.s.db.maybe('SELECT * FROM exchange_listings WHERE id = $1', [themeId]);
            assert.strictEqual(theme.revision, revision, 'an unchanged row is untouched');
        });

        await check('the old one-listing-per-token-file rows are removed, idempotently', async () => {
            const legacy = await t.ctx.entries.upsertFirstParty({
                source: 'design.tokens',
                sourceId: 'vibe:css',
                creator: 'OpenVibe',
                body: {
                    title: 'Vibe tokens — CSS variables', kind: 'template', mode: 'free',
                    summary: 'An old per-file listing.', license: 'AGPL-3.0-only', version: '1.0.0',
                    home_url: 'https://openvibe.design/api/v1/tokens/vibe?format=css',
                    manifest: { name: 'Vibe CSS', entry: 'https://openvibe.design/api/v1/tokens/vibe?format=css', runtime: 'css' },
                    passport: { reads: [], writes: [], spends: [], contacts: ['https://openvibe.design'] },
                },
            });
            assert.strictEqual(legacy.ok, true, JSON.stringify(legacy));
            const out = await t.ctx.firstParty.runOnce({ sources: ['design'], fetchImpl: fetch });
            assert.strictEqual(out.sources.design.removed_tokens, 1);
            assert.strictEqual(await t.ctx.s.db.value("SELECT COUNT(*)::int AS n FROM exchange_listings WHERE source = 'design.tokens'"), 0);
            const again = await t.ctx.firstParty.runOnce({ sources: ['design'], fetchImpl: fetch });
            assert.strictEqual(again.sources.design.removed_tokens, 0, 'a second run removes nothing');
        });

        await check('a token endpoint that is down leaves the theme downloads as they were', async () => {
            const before = await t.ctx.s.db.maybe('SELECT * FROM exchange_listings WHERE id = $1', [themeId]);
            const out = await t.ctx.firstParty.runOnce({ sources: ['design'], fetchImpl: fakeFetch({ failTargets: true }) });
            assert.strictEqual(out.sources.design.themes.ok, true);
            const after = await t.ctx.s.db.maybe('SELECT * FROM exchange_listings WHERE id = $1', [themeId]);
            assert.deepStrictEqual(after.files, before.files);
            assert.strictEqual(after.revision, before.revision, 'no needless rewrite');
        });

        await check('a changed theme updates the same listing and bumps its revision', async () => {
            const themes = JSON.parse(JSON.stringify(THEMES));
            themes.themes[0].description = 'The default OpenVibe theme, now with a new blurb.';
            const out = await t.ctx.firstParty.runOnce({ sources: ['design'], fetchImpl: fakeFetch({ themes }) });
            assert.strictEqual(out.sources.design.themes.changed, 1);
            const theme = await t.ctx.s.db.maybe('SELECT * FROM exchange_listings WHERE id = $1', [themeId]);
            assert.strictEqual(theme.summary, 'The default OpenVibe theme, now with a new blurb.');
            assert.strictEqual(Number(theme.revision), Number(revision) + 1);
            assert.strictEqual(await t.ctx.s.db.value('SELECT COUNT(*)::int AS n FROM exchange_listings WHERE source = $1', ['design.theme']), 2);
        });

        await check('a theme the source no longer lists is retired', async () => {
            const themes = { themes: [THEMES.themes[1]] };   // Paper only
            const out = await t.ctx.firstParty.runOnce({ sources: ['design'], fetchImpl: fakeFetch({ themes }) });
            assert.strictEqual(out.sources.design.themes.retired, 1);
            const oldTheme = await t.ctx.s.db.maybe('SELECT * FROM exchange_listings WHERE id = $1', [themeId]);
            assert.strictEqual(oldTheme.status, 'closed');
            assert.strictEqual(oldTheme.closed_reason, 'withdrawn');
            const list = await t.get('/api/v1/listings?limit=50');
            assert.ok(!list.json().listings.some((r) => r.id === themeId));
        });

        await check('a retired item that comes back is relisted under the same row', async () => {
            const out = await t.ctx.firstParty.runOnce({ sources: ['design'], fetchImpl: fakeFetch() });
            assert.strictEqual(out.sources.design.themes.imported, 2);
            const back = await t.ctx.s.db.maybe('SELECT * FROM exchange_listings WHERE id = $1', [themeId]);
            assert.strictEqual(back.status, 'listed');
            assert.strictEqual(back.id, themeId, 'same row, same home, no duplicate');
            assert.strictEqual(back.closed_at, null);
        });

        await check('a source that fails retires nothing', async () => {
            const before = await t.ctx.s.db.value("SELECT COUNT(*)::int AS n FROM exchange_listings WHERE source = 'games.world' AND status = 'listed'");
            const out = await t.ctx.firstParty.runOnce({ sources: ['games'], fetchImpl: fakeFetch({ failGames: true }) });
            assert.strictEqual(out.sources.games.ok, false);
            assert.match(out.sources.games.error, /restarting/);
            assert.strictEqual(await t.ctx.s.db.value("SELECT COUNT(*)::int AS n FROM exchange_listings WHERE source = 'games.world' AND status = 'listed'"), before);
        });

        await check('the first page is interleaved by kind, and the theme page shows its downloads', async () => {
            const page = await t.get('/api/v1/listings?limit=4');
            assert.strictEqual(page.status, 200, page.text);
            const kinds = new Set(page.json().listings.map((r) => r.kind));
            assert.ok(kinds.size >= 2, `one kind must not fill the first page: ${[...kinds].join(', ')}`);

            const html = await t.get('/listings/vibe-theme');
            assert.strictEqual(html.status, 200, html.text);
            assert.match(html.text, /Downloads/);
            assert.match(html.text, /https:\/\/openvibe\.design\/api\/v1\/tokens\/vibe\?format=css/);
            assert.match(html.text, /https:\/\/openvibe\.design\/api\/v1\/tokens\/vibe\?format=json/);
        });

        await check('a person\'s listing is never made official, and the official rows have no owner', async () => {
            const mine = await fixtures.listed(t, alice, { title: 'Alice hand-made theme', kind: 'theme' });
            await t.ctx.firstParty.runOnce({ sources: ['design', 'obs', 'games'], fetchImpl: fetch });
            const after = await t.get(`/api/v1/listings/${mine.slug}`, { as: alice });
            assert.strictEqual(after.status, 200, after.text);
            assert.strictEqual(after.json().official, false);
            assert.strictEqual(after.json().owner, alice.subject);
            assert.strictEqual(await t.ctx.s.db.value('SELECT COUNT(*)::int AS n FROM exchange_listings WHERE official AND owner IS NOT NULL'), 0);
            assert.strictEqual(await t.ctx.s.db.value('SELECT COUNT(*)::int AS n FROM exchange_listings WHERE official AND source IS NULL'), 0);
        });

        await check('nothing private from a source is stored or served', async () => {
            const row = await t.ctx.s.db.maybe('SELECT * FROM exchange_listings WHERE id = $1', [themeId]);
            const dump = JSON.stringify(row) + (await t.get(`/api/v1/listings/${row.slug}`)).text;
            assert.ok(!/designer@example\.test/.test(dump), 'no source email');
            assert.ok(!/should_never_be_listed/.test(dump), 'no source credential');
            assert.ok(!/owner_email/.test(dump));
        });

        await check('the listing page links to the real home and says who listed it', async () => {
            const paper = await t.ctx.s.db.maybe("SELECT * FROM exchange_listings WHERE slug = 'paper-theme'");
            assert.ok(paper, 'Paper is still listed');
            const page = await t.get(`/listings/${paper.slug}`);
            assert.strictEqual(page.status, 200);
            assert.match(page.text, /https:\/\/openvibe\.design\/studio\?theme=paper/);
            assert.match(page.text, /listed by OpenVibe/);
        });

        await check('the job refuses to start under drill', async () => {
            assert.strictEqual(t.ctx.firstParty.start(), false);
        });
    } finally {
        await t.close();
    }
    done();
})();
