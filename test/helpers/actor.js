'use strict';
/**
 * A stand-in OpenVibe.Actor for the page tests: one turn per answer, recorded calls, and a small task
 * store for the reconcile path. Script the answers (`answers`: texts or (call, n) => text), fail every
 * turn (`fail`: a TurnError), or hold turns pending (`pending: true`, released by flipping it back).
 */
const { TurnError } = require('../../server/actor');

function createFakeActor({ answers = null, fail = null, pending = false } = {}) {
    const turns = [];
    const reads = [];
    const tasks = new Map();
    const behavior = { fail, pending, holdReads: false };
    const textOf = (call, n) => {
        if (Array.isArray(answers) && answers.length) return answers.shift();
        if (typeof answers === 'function') return answers(call, n);
        return `An answer from Actor ${n}.`;
    };
    return {
        turns, reads, tasks, behavior, TurnError,
        async turn(args) {
            turns.push(args);
            const fail = typeof behavior.fail === 'function' ? behavior.fail(args) : behavior.fail;
            if (fail) throw fail;
            const n = turns.length;
            const taskId = `tsk_test_${n}`;
            if (behavior.pending) {
                tasks.set(taskId, { state: 'running', answer: `Late answer ${n}.`, model: 'stand-in-model', costUsd: 0.00009 });
                return { pending: true, taskId };
            }
            return {
                pending: false, taskId,
                answer: textOf(args, n), agent: 'openvibe-runtime', model: 'stand-in-model',
                costUsd: 0.00012, explanation: [{ selected: 'openvibe-runtime', reasons: ['the cheapest healthy offer for your ceiling'] }],
                latencyMs: 1500,
            };
        },
        async read({ token, taskId }) {
            reads.push({ token, taskId });
            const t = tasks.get(String(taskId));
            if (!t) throw new TurnError(404, 'actor.task.not_found', 'No such task.', String(taskId));
            if (t.state === 'running' && !behavior.holdReads) {
                t.state = 'succeeded';
                return { id: taskId, state: 'succeeded', result: { answer: t.answer, agent: 'openvibe-runtime', model: t.model }, cost: { usd: t.costUsd, free_allowance_used: t.costUsd }, explanation: [{ selected: 'openvibe-runtime', reasons: ['the cheapest healthy offer for your ceiling'] }] };
            }
            return { id: taskId, state: t.state, result: t.result || null, cost: t.cost || null, error: t.error || null, explanation: [] };
        },
    };
}

module.exports = { createFakeActor };
