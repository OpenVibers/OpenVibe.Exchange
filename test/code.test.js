'use strict';
// /code and the public code API: the tabs, the language chips, a card's fields, search, the API shapes and
// cache headers, the per-actor search limit, and an honest page when Sources does not answer.
const assert = require('assert');
const { boot } = require('./helpers/boot');

const NOW = Date.now();
const ITEMS = [
    {
        full_name: 'acme/hot-repo', url: 'https://github.com/acme/hot-repo', description: 'A tiny tool that does one thing well.',
        language: 'Rust', topics: ['ai', 'tools'], stars: 123456, stars_gained_1d: 300, stars_gained_7d: 1200,
        forks: 42, open_issues: 7, license: 'MIT', created: new Date(NOW - 3 * 86400000).toISOString(),
        pushed: new Date(NOW - 3 * 86400000).toISOString(), owner_avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
        homepage: 'https://acme.example', source: 'github',
    },
    {
        full_name: 'beta/young', url: 'https://github.com/beta/young', description: '<b>bold</b> & new',
        language: 'Python', topics: [], stars: 250, stars_gained_1d: null, stars_gained_7d: null,
        forks: 2, open_issues: 0, license: null, created: new Date(NOW - 3600000).toISOString(),
        pushed: new Date(NOW - 3600000).toISOString(), owner_avatar_url: null, homepage: null, source: 'github',
    },
];

function fakeCode() {
    const calls = { repos: [], search: [], allow: 0 };
    const code = {
        configured: true,
        calls,
        allow: () => { calls.allow++; return { allowed: true }; },
        async repos(args) {
            calls.repos.push(args);
            return { generated_at: new Date(NOW).toISOString(), list: args.list, lang: args.lang, count: ITEMS.length, source: { key: 'github', status: 'healthy', stale: false }, items: ITEMS, cached: false };
        },
        async search(args) {
            calls.search.push(args);
            return { items: [ITEMS[0]], total: 9341, incomplete: false, page: args.page, sort: args.sort, q: args.q, lang: args.lang, cached: false, stale: false };
        },
    };
    return code;
}

(async () => {
    const code = fakeCode();
    const t = await boot({ code });
    try {
        // The page: search box, five tabs, twelve languages and All, three-column-capable cards.
        let r = await t.get('/code');
        assert.strictEqual(r.status, 200);
        assert.match(r.text, /Search repositories: stars:&gt;500 topic:ai|Search repositories: stars:>500 topic:ai/);
        for (const label of ['Trending today', 'This week', 'Hot', 'New', 'Top']) assert.ok(r.text.includes(label), label);
        for (const l of ['JavaScript', 'TypeScript', 'Python', 'Go', 'Rust', 'Java', 'C++', 'C#', 'PHP', 'Ruby', 'Swift', 'Kotlin', 'All languages']) assert.ok(r.text.includes(l), l);
        assert.match(r.text, /acme\/hot-repo/);
        assert.match(r.text, /A tiny tool that does one thing well\./);
        assert.match(r.text, /123,456/);
        assert.match(r.text, /\+1,200 this week/);
        assert.match(r.text, /42<\/b> forks/);
        assert.match(r.text, /3 d ago/);
        assert.match(r.text, /class="cd-dot"/);
        assert.match(r.text, /https:\/\/avatars\.githubusercontent\.com\/u\/1/);
        assert.match(r.text, /class="cd-topics"[^>]*><li>ai<\/li><li>tools<\/li>/);
        assert.match(r.text, /href="https:\/\/github\.com\/acme\/hot-repo"/);
        assert.match(r.text, /&lt;b&gt;bold&lt;\/b&gt; &amp; new/, 'a description is escaped');
        assert.match(r.text, /href="\/code\?list=week"/);
        assert.deepStrictEqual(code.calls.repos[0], { list: 'trending', lang: null, topic: null, limit: 24 });

        // A tab and a language filter are links, not client state.
        r = await t.get('/code?list=hot&lang=Rust');
        assert.strictEqual(r.status, 200);
        assert.match(r.text, /list=hot&amp;lang=Rust|list=hot&lang=Rust/);
        assert.deepStrictEqual(code.calls.repos.at(-1), { list: 'hot', lang: 'Rust', topic: null, limit: 24 });

        // Search is GitHub's own syntax, passed through; the results keep the card shape.
        r = await t.get('/code?q=stars:>500%20topic:ai&lang=Rust');
        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual(code.calls.search.at(-1), { q: 'stars:>500 topic:ai', lang: 'Rust', sort: 'best', page: 1 });
        assert.match(r.text, /Search results/);
        assert.match(r.text, /9,341 GitHub matches/);
        assert.match(r.text, /Clear search/);

        // Public API: list, filters, cache header and shape.
        r = await t.get('/api/v1/code/repos?list=week&lang=Rust&limit=3');
        assert.strictEqual(r.status, 200);
        const body = r.json();
        assert.deepStrictEqual([body.list, body.count], ['week', 2]);
        assert.strictEqual(body.items[0].full_name, 'acme/hot-repo');
        assert.strictEqual(body.items[0].stars_gained_7d, 1200);
        assert.match(r.headers.get('cache-control'), /max-age=60/);
        assert.strictEqual((await t.get('/api/v1/code/repos?list=weather')).status, 422);
        r = await t.get('/api/v1/code/repos?list=month&lang=Rust&topic=ai&limit=200');
        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual(code.calls.repos.at(-1), { list: 'month', lang: 'Rust', topic: 'ai', limit: 100 });

        // Public search: cached ten minutes, same shape, and a missing q is a 422.
        r = await t.get('/api/v1/code/search?q=stars:>500%20topic:ai&sort=stars&page=2');
        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual(code.calls.search.at(-1), { q: 'stars:>500 topic:ai', lang: null, sort: 'stars', page: 2 });
        assert.strictEqual(r.json().total, 9341);
        assert.match(r.headers.get('cache-control'), /max-age=600/);
        assert.strictEqual((await t.get('/api/v1/code/search')).status, 422);
        assert.strictEqual((await t.get('/api/v1/code/search?q=ai&sort=fame')).status, 422);

        // Per-actor limit: the route answers 429 with Retry-After, never a GitHub call.
        const before = code.calls.search.length;
        code.allow = () => ({ allowed: false, retryAfter: 17 });
        r = await t.get('/api/v1/code/search?q=ai');
        assert.strictEqual(r.status, 429);
        assert.strictEqual(r.headers.get('retry-after'), '17');
        assert.strictEqual(r.json().code, 'code.rate_limited');
        assert.strictEqual(code.calls.search.length, before);

        // Sources unavailable: the page says so and the API answers 503, never an empty list dressed as live.
        code.repos = async () => { throw new Error('down'); };
        r = await t.get('/api/v1/code/repos?list=trending');
        assert.strictEqual(r.status, 503);
        assert.strictEqual(r.json().code, 'code.unavailable');
        r = await t.get('/code');
        assert.strictEqual(r.status, 200);
        assert.match(r.text, /repository list is not reachable right now/);

        // The deep dive names repositories as a source and links the same search.
        r = await t.get('/deep-dive');
        assert.strictEqual(r.status, 200);
        assert.match(r.text, /Code and tools/);
        assert.match(r.text, /Repositories are cited like any other source/);
        assert.match(r.text, /action="\/code"/);

        // Discovery carries the page and the two endpoints.
        r = await t.get('/llms.txt');
        assert.strictEqual(r.status, 200);
        assert.match(r.text, /\/code/);
        assert.match(r.text, /\/api\/v1\/code\/repos/);
        r = await t.get('/sitemap.xml');
        assert.match(r.text, /https:\/\/openvibe\.exchange\/code/);
        process.stdout.write('code: 32 checks passed\n');
    } finally { await t.close(); }
})().catch((e) => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1); });
