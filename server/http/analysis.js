'use strict';
const { asyncRouter } = require('./router');
function createAnalysisRoutes({ analysis, ai, bench }) {
    const router = asyncRouter();
    router.use((_req, res, next) => {
        res.set('Access-Control-Allow-Origin', '*').set('Access-Control-Allow-Methods', 'GET, OPTIONS').set('Access-Control-Allow-Headers', 'Accept, Content-Type, traceparent, X-OpenVibe-Request-Id');
        res.set('Cache-Control', 'public, max-age=60');
        next();
    });
    router.options('*', (_req, res) => res.status(204).end());
    const fail = (res, err) => res.set('Cache-Control', 'no-store').status(err instanceof TypeError || err.status === 422 ? 422 : 503).json({ error: { code: err instanceof TypeError || err.status === 422 ? 'analysis.invalid' : 'analysis.unavailable', detail: err instanceof TypeError ? err.message : 'Analysis is unavailable.' } });
    router.get('/compare', async (req, res) => {
        try {
            if (req.originalUrl.length > 2400 || Object.values(req.query).some((value) => typeof value !== 'string')) throw new TypeError('Use one value per comparison parameter.');
            return res.json(await analysis.compare({ ...req.query, models: String(req.query.models || '').split(',').filter(Boolean), measures: req.query.measures?.split(',') }));
        } catch (err) { return fail(res, err); }
    });
    router.get('/models/:model', async (req, res) => {
        try {
            const model = (await ai.catalog()).models?.find((entry) => entry.slug === req.params.model);
            if (!model) return res.status(404).json({ error: { code: 'model.not_found' } });
            return res.json(await analysis.model(model, { rating_kind: req.query.rating_kind, days: Number(req.query.days || 30) }));
        } catch (err) { return fail(res, err); }
    });
    router.get('/ratings/:kind', async (req, res) => {
        if (!/^[a-z0-9][a-z0-9_.-]{0,79}$/.test(req.params.kind)) return fail(res, new TypeError('Use a Bench task kind.'));
        const board = await bench.board({ kind: req.params.kind });
        if (board.unavailable) res.set('Cache-Control', 'no-store');
        return res.status(board.unavailable ? 503 : 200).json({ board });
    });
    return router;
}
module.exports = { createAnalysisRoutes };
