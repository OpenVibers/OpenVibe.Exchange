'use strict';

/**
 * Free and swap safety rules, shared by the form and the API so a thing cannot be listed through one and refused
 * by the other.
 *
 * v1 has no money anywhere: a listing is free or a swap, the passport's `spends` is empty, and a title, body or
 * offer that asks for payment is refused. A short prohibited-items list covers what a marketplace must never
 * carry: weapons, illegal drugs, malware and stolen credentials, sexual services, forged documents, live animals.
 * This is a fixed list, not a classifier: it catches the plain cases and staff can hide anything else.
 *
 * `SAFETY` is the note every listing page carries word for word (the plan's "Rent's listing engine and safety
 * rules"): see the person first where the swap is physical, never send money, keep the passport visible.
 */

const SAFETY = 'OpenVibe.Exchange v1 has no payments: a listing is free or a swap, and nobody should send money. Meet in a public place for a local swap, keep the conversation on the listing, and check the permission passport before you install anything.';

const PROHIBITED = Object.freeze([
    { code: 'weapons', label: 'weapons or ammunition', re: /\b(?:firearms?|guns?|shotguns?|rifles?|pistols?|ammunition|explosives?|silencers?|untraceable weapons?)\b/i },
    { code: 'drugs', label: 'illegal drugs', re: /\b(?:cocaine|heroin|fentanyl|methamphetamine|mdma|ecstasy|illegal drugs?)\b/i },
    { code: 'malware', label: 'malware or stolen access', re: /\b(?:malware|ransomware|keyloggers?|spyware|botnets?|credential dumps?|stolen (?:accounts?|credentials?|data|access))\b/i },
    { code: 'sexual', label: 'sexual services or content', re: /\b(?:csam|child sexual|sexual services?|escort services?|pornography)\b/i },
    { code: 'forged', label: 'forged or counterfeit documents', re: /\b(?:fake ids?|forged (?:ids?|passports?|documents?)|counterfeit (?:money|currency|documents?))\b/i },
    { code: 'animals', label: 'live animals', re: /\b(?:live animals?|pupp(?:y|ies)|kittens?)\b/i },
    { code: 'money', label: 'money or a payment', re: /\b(?:send cash|pay in cash|cash only|wire transfer|bank transfer|western union|moneygram|venmo|paypal|zelle|gift cards?|bitcoin|cryptocurrency|crypto payment|usd|eur|gbp)\b/i },
]);

const MONEY_AMOUNT = /(?:[£$€¥]\s?\d|\b\d+(?:[.,]\d{1,2})?\s?(?:usd|eur|gbp|vibes?|dollars?|euros?|pounds?)\b)/i;

/** Plain text as it will be stored: CRLF normalised, no control characters (keeping tab and newline), trimmed. */
function cleanText(value, max) {
    const s = String(value == null ? '' : value)
        .replace(/\r\n?/g, '\n')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
        .trim();
    return max != null ? s.slice(0, max) : s;
}

/** The first prohibited rule a set of public texts trips, or null. */
function findProhibited(...texts) {
    const haystack = texts.filter(Boolean).join('\n');
    if (!haystack) return null;
    for (const rule of PROHIBITED) if (rule.re.test(haystack)) return rule;
    if (MONEY_AMOUNT.test(haystack)) return PROHIBITED.find((r) => r.code === 'money');
    return null;
}

/** A refusal shape the store returns and the API/page layers turn into a problem or a form message. */
function refusals(...texts) {
    const hit = findProhibited(...texts);
    if (!hit) return null;
    return { status: 400, code: 'exchange.prohibited', message: `A listing or offer cannot carry ${hit.label} on OpenVibe.Exchange.`, field: 'text' };
}

module.exports = { SAFETY, PROHIBITED, findProhibited, refusals, cleanText, MONEY_AMOUNT };
