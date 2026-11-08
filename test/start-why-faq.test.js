'use strict';
/**
 * The pages that moved from ai.openvibe.services: /start (the guide), /why (the router's own explain, on a real
 * run) and /faq (the merged questions), plus their Markdown twins, sitemap/llms entries and IndexNow's key file.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { createFakeAi } = require('./helpers/ai');

(async () => {
    const ai = createFakeAi();
    const t = await boot({ ai });
    try {
        await check('/start: the endpoint, the four steps, both SDKs, the six AI operations and the sandbox table', async () => {
            const r = await t.get('/start');
            assert.strictEqual(r.status, 200, r.text);
            assert.ok(r.text.includes('https://api.openvibe.exchange/v1/chat/completions'), 'the endpoint');
            assert.ok(r.text.includes('/v1/messages') && r.text.includes('ANTHROPIC_BASE_URL'), 'Anthropic compatibility');
            assert.ok(r.text.includes('Four steps') && r.text.includes('Make a key') && r.text.includes('Read the receipt'));
            assert.ok(r.text.includes('import OpenAI from') && r.text.includes('openai') && r.text.includes('client.chat.completions.create'), 'the SDK samples');
            assert.ok(r.text.includes('chat, generate, summarize, classify, extract and embed'), 'AI’s six operations stay described');
            assert.ok(r.text.includes('Sandbox') && r.text.includes('Production') && r.text.includes('Never used'), 'the sandbox and production limits');
            assert.ok(r.text.includes('openvibe.network/developers') && r.text.includes('/own') && r.text.includes('/faq'), 'keys, own endpoints and the questions');
            assert.ok(r.text.includes('href="/privacy/keys"'), 'own provider keys stay on Exchange');
        });

        await check('/why signed out: the rule, the live offers and a sign-in gate, never a fake answer', async () => {
            const r = await t.get('/why');
            assert.strictEqual(r.status, 200, r.text);
            assert.ok(r.text.includes('Why this model') && r.text.includes('The rule'));
            assert.ok(r.text.includes('Sign in to ask one question') && r.text.includes('/auth/login?next=%2Fwhy'));
            assert.ok(r.text.includes('DeepSeek Chat') && r.text.includes('$0.20 in'), 'the live offers');
            assert.ok(r.text.includes('every candidate with its estimated cost'), 'what explain carries');
            assert.ok(!r.text.includes('An answer from'), 'no invented run');
        });

        await check('POST /why signed out answers the sign-in page, and does not call AI', async () => {
            const before = ai.calls.length;
            const r = await t.get('/why', { form: { text: 'Why you?' } });
            assert.strictEqual(r.status, 401);
            assert.ok(r.text.includes('Sign in with OpenVibe'));
            assert.strictEqual(ai.calls.length, before, 'no run was made');
        });

        await check('POST /why signed in: one auto run, the answer, the chosen offer and every candidate with its reason', async () => {
            const user = t.network.addUser('why-user');
            const r = await t.get('/why', { as: user, form: { text: 'Which model should answer this?' } });
            assert.strictEqual(r.status, 200, r.text);
            assert.ok(r.text.includes('An answer from openvibe/auto.'), 'the answer');
            assert.ok(r.text.includes('Chosen') && r.text.includes('deepseek/deepseek-chat'), 'the selected offer');
            assert.ok(r.text.includes('cheapest healthy offer within your ceiling'), 'the router’s reason');
            assert.ok(r.text.includes('deepinfra') && r.text.includes('over your price ceiling'), 'an excluded candidate and why');
            assert.ok(r.text.includes('run_TEST') && r.text.includes('https://ai.openvibe.services/runs/run_TEST'), 'the run receipt stays on AI, with the session');
            const call = ai.calls[ai.calls.length - 1];
            assert.strictEqual(call.model, 'openvibe/auto');
            assert.strictEqual(call.messages[0].content, 'Which model should answer this?');
            assert.ok(call.subject, 'the run is made on the person, so it is their allowance');
        });

        await check('POST /why with no question: 422, and no run', async () => {
            const user = t.network.addUser('why-empty');
            const before = ai.calls.length;
            const r = await t.get('/why', { as: user, form: { text: '   ' } });
            assert.strictEqual(r.status, 422);
            assert.ok(r.text.includes('Write something to send.'));
            assert.strictEqual(ai.calls.length, before);
        });

        await check('/faq: the merged questions and their FAQPage JSON-LD', async () => {
            const r = await t.get('/faq');
            assert.strictEqual(r.status, 200, r.text);
            assert.ok(r.text.includes('What is OpenVibe.Exchange for?'));
            assert.ok(r.text.includes('Can I use the OpenAI SDK?'));
            assert.ok(r.text.includes('Is ai.openvibe.services still a site of its own?'), 'the move is answered');
            assert.ok(r.text.includes('Where did AI’s prices and latency page go?'));
            const blocks = [...r.text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
            const faq = blocks.find((b) => b['@type'] === 'FAQPage');
            assert.ok(faq && faq.mainEntity.length >= 10, 'FAQPage JSON-LD');
            assert.ok(r.text.includes('The public pages of OpenVibe.AI live here now'), 'the moved answer is on the page');
        });

        await check('the Markdown twins of the new pages', async () => {
            for (const [path, needle] of [['/start.md', 'Start building'], ['/why.md', 'Why this model'], ['/faq.md', 'What is OpenVibe.Exchange for?']]) {
                const r = await t.get(path);
                assert.strictEqual(r.status, 200, `${path}: ${r.status}`);
                assert.match(r.headers.get('content-type'), /text\/markdown/);
                assert.ok(r.text.startsWith('---\ntitle:'), path);
                assert.ok(r.text.includes(needle), `${path} has ${needle}`);
            }
        });

        await check('sitemap and llms.txt carry the new pages', async () => {
            const map = await t.get('/sitemap.xml');
            assert.strictEqual(map.status, 200);
            for (const p of ['/start', '/why', '/faq']) assert.ok(map.text.includes(`https://openvibe.exchange${p}</loc>`), `sitemap ${p}`);
            const llms = await t.get('/llms.txt');
            assert.ok(llms.text.includes('/start.md') && llms.text.includes('/why.md') && llms.text.includes('/faq.md'), 'llms.txt links the twins');
            const full = await t.get('/llms-full.txt');
            for (const p of ['/start', '/why', '/faq']) assert.ok(full.text.includes(`https://openvibe.exchange${p}`), `llms-full ${p}`);
        });
    } finally {
        await t.close();
    }

    const KEY = 'abc12345';
    const on = await boot({ ai: createFakeAi(), env: { INDEXNOW_KEY: KEY } });
    try {
        await check('IndexNow: the key file is served when INDEXNOW_KEY is set', async () => {
            assert.strictEqual(on.ctx.indexnow.enabled, true);
            const r = await on.get(`/${KEY}.txt`);
            assert.strictEqual(r.status, 200);
            assert.strictEqual(r.text.trim(), KEY);
        });
    } finally {
        await on.close();
    }

    const off = await boot({ ai: createFakeAi(), env: { INDEXNOW_KEY: '' } });
    try {
        await check('IndexNow: off without a key', async () => {
            assert.strictEqual(off.ctx.indexnow.enabled, false);
            const r = await off.get(`/${KEY}.txt`);
            assert.strictEqual(r.status, 404);
        });
    } finally {
        await off.close();
        done();
    }
})();
