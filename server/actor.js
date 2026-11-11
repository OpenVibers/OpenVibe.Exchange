'use strict';
/**
 * OpenVibe.Actor, read from OpenVibe.Exchange.
 *
 *   turn({...})  POST /api/v1/tasks with the person's own Bearer, then GET /api/v1/tasks/:id until the
 *                turn ends. The turn is the person's (their allowance, their Actor task list); Exchange names
 *                the conversation and the tools the run may call, and reads the answer, the cost and the error
 *                back from the task. When Actor is down the turn fails here in plain words: it never falls back
 *                to OpenVibe.AI or any other engine.
 *   read({...})  GET /api/v1/tasks/:id with the person's Bearer (a pending turn, reconciled on the next view).
 *
 * A turn the model cannot answer (refused, failed, cancelled) throws a TurnError whose code and detail are
 * the task's own: the product shows those words. A turn still running when the wait ends resolves
 * { pending: true, taskId } instead of throwing, so the product can reconcile it on the next view.
 */
const trim = (v) => String(v == null ? '' : v).replace(/\/+$/, '');

class TurnError extends Error {
    constructor(status, code, detail, taskId = null) {
        super(String(detail || code || 'the turn failed').slice(0, 500));
        this.name = 'TurnError';
        this.status = status;
        this.code = code;
        this.detail = String(detail || code || 'the turn failed').slice(0, 500);
        this.taskId = taskId;
    }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createActor({ config, fetchImpl = globalThis.fetch, log = console, now = () => Date.now() } = {}) {
    const a = (config && config.actor) || {};
    const base = trim(a.url || 'https://openvibe.actor');
    const timeoutMs = Math.max(2000, Number(a.timeoutMs) || 15_000);
    const waitMs = Math.max(5000, Number(a.waitMs) || 90_000);
    const pollMs = Math.max(500, Number(a.pollMs) || 2000);

    async function jsonOf(res) {
        const text = await res.text();
        try { return text ? JSON.parse(text) : null; } catch (e) { return null; }
    }

    async function call(method, path, token, body) {
        let res;
        try {
            res = await fetchImpl(`${base}${path}`, {
                method,
                headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
                ...(body ? { body: JSON.stringify(body) } : {}),
                signal: AbortSignal.timeout(timeoutMs),
            });
        } catch (err) {
            throw new TurnError(503, 'actor.unreachable', 'OpenVibe.Actor could not be reached just now. Nothing was charged. Try again in a moment.');
        }
        const out = await jsonOf(res);
        if (res.status === 401 || res.status === 403) {
            throw new TurnError(res.status, (out && out.code) || 'actor.not_allowed', 'The answer needs a fresh sign-in. Sign in again and send once more.');
        }
        if (!res.ok || !out) {
            throw new TurnError(res.status, (out && out.code) || 'actor.failed', (out && (out.detail || out.title)) || `OpenVibe.Actor answered ${res.status}`);
        }
        return out;
    }

    /** One conversation turn answered by Actor. The person's Bearer goes on the wire, nobody else's. */
    async function turn({ token, task, model = null, tier = null, budgetUsd, conversation, idempotencyKey, tools = [], poll = true, waitMs: turnWaitMs = null } = {}) {
        const limitMs = turnWaitMs != null ? Math.max(5000, Number(turnWaitMs)) : waitMs;
        if (!token) throw new TurnError(401, 'actor.not_allowed', 'The answer needs a fresh sign-in. Sign in again and send once more.');
        const started = now();
        const created = await call('POST', '/api/v1/tasks', token, {
            task: String(task),
            mode: 'cheapest',
            ...(model ? { model: String(model).slice(0, 256) } : {}),
            // The content tier (the 18+ one). Actor refuses it for a task that names nobody, and OpenVibe.AI checks
            // the person's 18+ confirmation before it answers on that tier.
            ...(tier ? { tier: String(tier).slice(0, 40) } : {}),
            ...(budgetUsd != null ? { budget: { per_task_usd: Number(budgetUsd) } } : {}),
            ...(idempotencyKey ? { idempotency_key: String(idempotencyKey) } : {}),
            ...(conversation ? { conversation } : {}),
            ...(tools ? { tools } : {}),
        });
        const taskId = created && created.id;
        if (!taskId) throw new TurnError(502, 'actor.failed', 'OpenVibe.Actor answered without a task. Nothing was charged.');
        if (!poll) return { pending: true, taskId };
        for (;;) {
            const t = await call('GET', `/api/v1/tasks/${encodeURIComponent(taskId)}`, token);
            if (t.state !== 'queued' && t.state !== 'running') {
                if (t.state === 'succeeded') {
                    const result = t.result || {};
                    return {
                        pending: false, taskId,
                        answer: typeof result.answer === 'string' && result.answer.trim() ? result.answer : '(no text)',
                        agent: result.agent || null, model: result.model || null,
                        costUsd: t.cost && t.cost.usd != null ? Number(t.cost.usd) : null,
                        explanation: Array.isArray(t.explanation) ? t.explanation : [],
                        latencyMs: now() - started,
                    };
                }
                const err = t.error || {};
                throw new TurnError(502, err.code || `actor.task.${t.state}`, err.detail || `The turn ${t.state}. Nothing more was charged.`, taskId);
            }
            if (now() - started > limitMs) return { pending: true, taskId };
            await sleep(pollMs);
        }
    }

    /** Read a task back (a pending turn, reconciled on the next view). */
    async function read({ token, taskId }) {
        return call('GET', `/api/v1/tasks/${encodeURIComponent(String(taskId))}`, token);
    }

    return { turn, read, TurnError, configured: Boolean(base) };
}

module.exports = { createActor, TurnError };
