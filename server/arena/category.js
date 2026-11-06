'use strict';

/**
 * Which kind of work a person's arena prompt is: code, writing, chat, reasoning, translation or analysis. The
 * category is recorded as the Bench task's class, so the leaderboard can say which models are worth it for the
 * kind of thing the person actually asked. No model call: a few strong words and the shape of the text are
 * enough, and a wrong guess only moves one vote between two honest boards.
 */
const CATEGORIES = Object.freeze(['code', 'writing', 'chat', 'reasoning', 'translation', 'analysis']);
const DEFAULT = 'chat';

const SIGNALS = {
    translation: [
        /\btranslat(e|ion|ed|ing)\b/, /\binto (french|spanish|german|italian|portuguese|japanese|korean|chinese|russian|arabic|dutch|polish|turkish|hindi)\b/,
        /\bin (french|spanish|german|italian|portuguese|japanese|korean|chinese|russian|arabic|dutch|polish|turkish|hindi)\b/,
        /\blocali[sz](e|ation)\b/, /\bsubtitles?\b/,
    ],
    code: [
        /```/, /\bcode\b/, /\bfunction\b/, /\bclass\b/, /\bmethod\b/, /\bregex\b/, /\bapi\b/, /\bbug\b/,
        /\bdebug\b/, /\bstack trace\b/, /\bcompile[rs]?\b/, /\b(refactor|unit test|sql query|query|typescript|javascript|python|rust|golang|java|c\+\+|react|node\.js|docker|kubernetes|git)\b/,
        /\b(write|fix|review|explain) (a |the |this )?(code|script|function|query|program)\b/,
        /(^|\n)\s*(const|let|var|def|class|function|import|from|select|create table|#include|public static)\b/i,
        /[{};]\s*$/m,
    ],
    reasoning: [
        /\bstep by step\b/, /\bprove\b/, /\bproof\b/, /\btheorem\b/, /\bcalculate\b/, /\bcompute\b/, /\bhow many\b/,
        /\bprobability\b/, /\blogic(al)?\b/, /\bpuzzle\b/, /\bmath(s|ematics)?\b/, /\bequation\b/, /\bintegral\b/,
        /\bwhy (does|do|is|are|would)\b/, /\bwhat happens if\b/, /\bdeduce\b/, /\binfer\b/,
    ],
    writing: [
        /\bwrite (a|an|the|me)\b/, /\bessay\b/, /\bpoem\b/, /\bstory\b/, /\bemail\b/, /\bblog\b/, /\barticle\b/,
        /\bcopy\b/, /\bslogan\b/, /\brewrite\b/, /\bedit\b/, /\bsummar(y|ise|ize)\b/, /\bheadline\b/, /\bcaption\b/,
        /\bscript for (a|the)\b/, /\bcover letter\b/, /\bproduct description\b/,
    ],
    analysis: [
        /\banaly[sz]e\b/, /\banalysis\b/, /\bcompare\b/, /\bcomparison\b/, /\bpros and cons\b/, /\btrade-?offs?\b/,
        /\bstrateg(y|ies)\b/, /\bdecision\b/, /\bdata\b/, /\bevaluate\b/, /\bassess\b/, /\bbusiness\b/,
        /\bmarket\b/, /\brisks?\b/, /\bchart\b/,
    ],
    chat: [
        /\bhello\b/, /\bhi\b/, /\bthanks\b/, /\bwhat do you think\b/, /\btell me about\b/, /\bchat\b/,
        /\bhow are you\b/, /\bopinion\b/,
    ],
};

function classify(text) {
    const source = String(text || '');
    if (!source.trim()) return DEFAULT;
    const lower = source.toLowerCase();
    const scores = {};
    for (const [name, patterns] of Object.entries(SIGNALS)) {
        scores[name] = patterns.reduce((n, re) => n + (re.test(lower) ? 1 : 0), 0);
    }
    // A prompt that carries code is code, unless it is plainly a translation request.
    if (scores.translation >= 2) return 'translation';
    if (scores.code >= 2) return 'code';
    if (scores.translation >= 1 && scores.translation >= scores.code) return 'translation';
    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const [best, score] = ranked[0];
    if (score >= 2 || (best !== 'chat' && score >= 1)) return best;
    return DEFAULT;
}

module.exports = { classify, CATEGORIES, DEFAULT };
