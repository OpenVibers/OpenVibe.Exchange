'use strict';
/**
 * A stand-in OpenVibe.Bench client for the Arena tests: it records every round, vote and board read, and answers
 * in the shape of server/bench.js. A test may pass its own `createRound`, `vote` or `board` to make one fail.
 */
function createFakeBench({ createRound = null, vote = null, board = null, boards = null } = {}) {
    const calls = { rounds: [], votes: [], boards: [] };
    let n = 0;
    return {
        configured: true,
        kind: 'chat.arena',
        calls,
        async createRound(args) {
            calls.rounds.push(args);
            if (createRound) return createRound(args);
            n += 1;
            return {
                round: { id: `brd_TEST${n}`, status: 'finished', kind_id: 'chat.arena' },
                category: args.category,
                entries: args.entries.map((e, i) => ({
                    id: `bte_TEST${n}${i}`, side: i === 0 ? 'left' : 'right', provider: e.provider, model: e.model,
                })),
            };
        },
        async vote(args) {
            calls.votes.push(args);
            if (vote) return vote(args);
            return { judgement: { id: `bju_TEST${n}`, outcome: args.outcome, method: 'human_pairwise' }, revealed: {} };
        },
        async board(args) {
            calls.boards.push(args);
            if (board) return board(args);
            const rows = boards && Object.prototype.hasOwnProperty.call(boards, args.kind) ? boards[args.kind] : null;
            return { unavailable: false, kind_id: args.kind || 'chat.arena', category: args.category, rows: rows || [] };
        },
    };
}

module.exports = { createFakeBench };
