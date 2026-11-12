'use strict';
/**
 * /decisions (2026-11-12): OpenVibe.AI's Decisions API as a public page. Closed-set questions about one input
 * (text, or content parts: text, image, audio, video, document by https link), answered in one call with
 * probabilities and a confidence: noul (yes/no), choice (one of 2-255 options) and score (a rubric level from 0).
 *
 * Google's Decisions API (gemini-decision-1) answers when OpenVibe.AI has a Gemini key: calibrated, $0.10 per 1M
 * input tokens, nothing for output. Without it the router's cheapest structured model answers text with estimated
 * probabilities, and says calibrated: false. The page copies the shapes from OpenVibe.AI's server/api/decisions.js.
 */
const kit = require('openvibe-shared/kit');
const { esc } = require('../render/html');

const ENDPOINT = 'https://ai.openvibe.services/api/v1/decisions';

/** The page's card: one section in the page's column, its body on the heading's line. */
const panel = ({ title, note = '', id, body, cls = '' }) =>
    kit.section({ title, note, id, cls: `ex-card${cls ? ` ${cls}` : ''}`, body: `<div class="ex-sec-body">${body}</div>` });

const TYPES = [
    {
        key: 'noul',
        name: 'Yes or no',
        text: 'The probability that the answer is yes, from 0 to 1.',
        code: `{ "is_spam": {
  "type": "noul", "instructions": "Is this spam?" } }`,
    },
    {
        key: 'choice',
        name: 'One of a list',
        text: 'The winning option, and a probability for each option.',
        code: `{ "kind": {
  "type": "choice", "instructions": "What is it?",
  "criteria": { "bug": "Broken.", "idea": "A suggestion." } } }`,
    },
    {
        key: 'score',
        name: 'A rubric level',
        text: 'A level from 0, and a probability for each level.',
        code: `{ "severity": {
  "type": "score", "instructions": "How bad?",
  "criteria": ["fine", "minor", "major"] } }`,
    },
];

const REQUEST = `POST ${ENDPOINT}
Authorization: Bearer $OPENVIBE_TOKEN
Content-Type: application/json

{
  "input": "The app crashes when I open the settings page.",
  "questions": {
    "is_spam": { "type": "noul", "instructions": "Is this spam?" },
    "kind": { "type": "choice", "instructions": "What is it?", "criteria": { "bug": "Something is broken.", "idea": "A suggestion." } },
    "severity": { "type": "score", "instructions": "How bad is it?", "criteria": ["fine", "minor", "major"] }
  },
  "prefer": "calibrated"
}`;

const ANSWER = `{
  "answers": {
    "is_spam": { "type": "noul", "noul": 0.03, "confidence": 0.97 },
    "kind": { "type": "choice", "choice": "bug", "probabilities": { "bug": 0.94, "idea": 0.06 }, "confidence": 0.94 },
    "severity": { "type": "score", "score": 1.8, "probabilities": { "0": 0.02, "1": 0.16, "2": 0.82 }, "legend": { "0": "fine", "1": "minor", "2": "major" }, "confidence": 0.82 }
  },
  "calibrated": true,
  "receipt": { "provider": "gemini", "model": "gemini-decision-1", "input_tokens": 120, "cost_usd": 0.000012 }
}`;

const INPUT_PARTS = `{
  "input": [
    { "type": "text", "text": "What is wrong in this screenshot?" },
    { "type": "image", "uri": "https://example.com/error.png", "mime_type": "image/png" }
  ]
}`;

function decisionsPage() {
    const types = TYPES.map((t) => `<article class="xd-type" id="xd-${esc(t.key)}">
<h3>${esc(t.name)} <code>${esc(t.key)}</code></h3>
<p>${esc(t.text)}</p>
${kit.snippet({ code: t.code, id: `xd-${t.key}-snippet` })}
</article>`).join('');

    const rows = [
        {
            when: 'A Gemini key is set',
            who: "Google's Decisions API (gemini-decision-1)",
            what: 'Calibrated. Text, pictures, audio, video and PDFs by link.',
            price: '$0.10 per 1M input tokens. Output is free.',
        },
        {
            when: 'No Gemini key, or Google is away',
            who: "The router's cheapest structured model",
            what: 'Text only, up to 100 questions. Estimated, and marked calibrated: false.',
            price: 'Metered like any request.',
        },
    ];

    return `<div class="ex-wrap ex-page xd">
${kit.head({ title: 'Decisions', sub: 'Yes/no, choice and rubric answers about one input, in one call, with how sure.', actions: [kit.button({ href: '/api', label: 'The API', kind: 'quiet', icon: 'code' })] })}
${panel({ title: 'What it is', id: 'what', body: `<p class="ex-prose">Ask yes/no, one-of-a-list and rubric questions about one input: text, a picture, audio, video or a PDF by link. One call answers every question and says how sure it is.</p>
<p class="ex-prose">Use it for routing, moderation checks, grading and tool choice when no model needs to write an answer.</p>` })}
${panel({ title: 'One input', id: 'input', body: `<p class="ex-prose"><code>input</code> is a string, or up to 50 content parts. A part is <code>text</code>, <code>image</code>, <code>audio</code>, <code>video</code> or <code>document</code>. A picture, a recording, a video or a PDF is a public <code>https</code> link; nothing is uploaded.</p>
${kit.snippet({ code: INPUT_PARTS, id: 'xd-input-snippet' })}` })}
${panel({ title: 'The three question types', id: 'types', body: `<p class="ex-prose">Name each question, say what type it is, and give its instructions. A <code>choice</code> names its options in <code>criteria</code>; a <code>score</code> lists its levels from 0. Every answer carries a confidence from 0 to 1.</p>
<div class="xd-types">${types}</div>` })}
${panel({ title: 'One request, one answer', id: 'request', body: `<p class="ex-prose">Send a POST to <code>${esc(ENDPOINT)}</code> with an OpenVibe token that can make a run, or a person's own token. Up to 1,000 questions and 50 input parts; a choice has 2 to 255 options and a score has 2 to 20 levels. Question names are lowercase letters, digits and <code>_</code>.</p>
<p class="ex-prose"><code>prefer</code> is <code>"calibrated"</code> by default. <code>"cheap"</code> asks for the router's cheap structured model first when the input is text.</p>
<div class="xd-pair"><div><h3>Request</h3>${kit.snippet({ code: REQUEST, id: 'xd-request-snippet' })}</div><div><h3>Answer</h3>${kit.snippet({ code: ANSWER, id: 'xd-answer-snippet' })}</div></div>` })}
${panel({ title: 'Who answers', id: 'who', body: `<p class="ex-prose">Google's Decisions API answers when OpenVibe.AI has a Gemini key. Otherwise the router's cheapest structured model answers text, and the answer says <code>calibrated: false</code>.</p>
${kit.table({ columns: [{ key: 'when', label: 'When', primary: true }, { key: 'who', label: 'Who answers' }, { key: 'what', label: 'What you get' }, { key: 'price', label: 'Price' }], rows, label: 'Who answers Decisions', stack: true })}
${kit.notice({ kind: 'info', text: "Google's free tier may use what it reads to improve its models. Send public or synthetic data only." })}
<p class="ex-prose">Without a Gemini key, pictures, audio, video and PDFs cannot be answered. Every call is metered like any request, and the <code>receipt</code> says which provider and model ran and what it cost.</p>` })}
</div>`;
}

module.exports = { decisionsPage, ENDPOINT };
