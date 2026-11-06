'use strict';

/**
 * The hard floor on OpenVibe.Exchange's companions (Opus's design, 2026-11-06).
 *
 * The design says "reuse, never copy: the house classifiers". Two of them are not published as a package:
 *
 *   - OpenVibe.AI's server/policy/floor.js holds the three hard rules (minors, non-consensual, mass harm).
 *     It is an application module of that service, not a library, so there is nothing to import here.
 *   - OpenVibe.Live's server/ai/explicit.js holds the three VIS-6 categories (fine, sex_acts, minor_sexual).
 *     OpenVibe.SDK publishes the same rules as `openvibe-sdk/explicit` (isExplicit) — that one IS imported,
 *     below, and it is the copy the house keeps in step with Live.
 *
 * So: the SDK's published classifier is imported, and the two unpublished rule sets are carried here with
 * their source named in the header of each block. When AI or Live publish theirs, this file becomes a call.
 *
 * The floor is checked in three places: on the card at save, on the person's input, and on the model's output.
 * A breach ends the chat and the account is reviewed.
 *
 *   floor.check(texts)        → { ok: true } | { ok: false, rule, label, detail }
 *   floor.checkCard(card)     → { ok: true } | { ok: false, rule, label, detail }
 *   floor.classifyText(texts) → { category: 'fine' | 'sex_acts' | 'minor_sexual', reason }
 */

// ── OpenVibe.SDK's published copy of Live's rules (openvibe-sdk/explicit, v0.85.0) ──
const { isExplicit: sdkIsExplicit } = require('openvibe-sdk/explicit');

/**
 * OpenVibe.Live, server/ai/explicit.js (2026-10-31), carried here because Live does not publish this module.
 * VIS-6's three categories: fine, sex_acts, minor_sexual. Describing people is fine; nudity is fine; a child
 * together with nudity is the hard line.
 */
const EXPLICIT = /\b(?:sexual(?:ly)?\s+(?:acts?|activity|intercourse)|sex\s+acts?|having\s+sex|(?:pornographic|sexually\s+explicit|explicit\s+adult)\s+(?:content|material|footage|scenes?|imagery|videos?|acts?)|adult\s+(?:films?|videos?)|porn(?:o|ography|ographic)?|masturbat\w*|intercourse|oral\s+sex|penetrat\w*)\b/i;
const LIVE_MINOR = /\b(?:child(?:ren)?|kids?|minors?|teen(?:age(?:rs?)?|s)?|toddlers?|bab(?:y|ies)|infants?|boys?|girls?|underage)\b/i;
const LIVE_NUDE = /\b(?:naked|nude|nudity|undress(?:ed|ing)?|topless|bottomless|genital(?:s|ia)?|penis(?:es)?|vaginas?|vulvas?|breasts?|nipples?)\b/i;
const CATEGORIES = Object.freeze(['fine', 'sex_acts', 'minor_sexual']);

/**
 * OpenVibe.AI, server/policy/floor.js (2026-11-06), carried here because AI does not publish this module.
 * The three rules, in the order they are checked. The patterns are deliberately narrow so an ordinary
 * question ("how do I kill a stuck process") is never refused.
 */
const MINOR = /\b(?:child(?:ren)?|kids?|minors?|minor|teen(?:age(?:rs?)?|s)?|toddlers?|bab(?:y|ies)|infants?|boys?|girls?|underage|pre-?teen(?:s)?|schoolboy|schoolgirl|loli|shota)\b/i;
const NUDE = /\b(?:naked|nude|nudity|undress(?:ed|ing)?|topless|bottomless|genital(?:s|ia)?|penis(?:es)?|vaginas?|vulvas?|breasts?|boobs?|nipples?|erotic(?:a)?|orgasm|cunnilingus|fellatio)\b/i;
const CSAM = /\b(?:child\s?(?:porn|porno|abuse|sexual)|cp\s(?:content|video|series)\b|kiddie\s?(?:porn|porno)|pedophile|pedophilia|paedophile|paedophilia)\b/i;
const NONCONSENSUAL = /\b(?:rape|raped|rapes|raping|rapist|sexual assault|sexual abuse|molest(?:ed|ing|s)?|incest|statutory rape|non-?consensual|without (?:her|his|their|my) consent|she (?:said|said no|didn't consent|did not consent)|he (?:said no|didn't consent|did not consent)|they (?:said no|didn't consent|did not consent)|took advantage of (?:her|him|them)|she was (?:drugged|drunk|asleep|unconscious)|drugged (?:her|him|them)|unconscious (?:sex|woman|girl|man)|forced (?:sex|himself|herself|them)|coerc(?:e|ed|ing|ion)|groom(?:ed|ing)?|traffick(?:ed|ing)?|deepfake(?:s|d)?|revenge porn|nude photos? of (?:her|him|them)|sexual(?:ly)? explicit (?:photos?|pictures?|images?|videos?) of (?:her|him|them))\b/i;
const MASS_HARM = /\b(?:nerve agent|sarin|vx gas|tabun|soman|mustard gas|chlorine gas|anthrax|ricin|botulinum|cyanide|nerve gas|bioweapon|biological weapon|chemical weapon|dirty bomb|nuclear (?:bomb|device|weapon)|radiological (?:bomb|device|weapon)|weapons? of mass destruction|\bwmd\b|germ warfare|biological warfare|pathogen (?:strain|weapon)|weaponized? (?:virus|pathogen|bacillus))\b/i;
const WEAPON_INTENT = /\b(?:(?:make|build|construct|synthesi[sz]e|manufactur(?:e|ing)|assembl\w+|acquire|obtain|buy|purchase|deploy|detonat\w+|ignit\w+|use|plant|rig)\w*\b[^.?!]{0,60}\b(?:bomb|explosive|ied\b|pipe bomb|dirty bomb|grenade|molotov|napalm|thermite|shrapnel|untraceable (?:gun|firearm)|ghost gun|suppressor|silencer)|(?:bomb|explosive|ied\b|pipe bomb|grenade|molotov|napalm|thermite)\b[^.?!]{0,60}\b(?:make|build|construct|synthesi[sz]e|manufactur\w+|how to|recipe|instructions?|detonat\w+|ignit\w+))/i;
const ATTACK_INTENT = /\b(?:(?:how (?:do|can|would) (?:i|we|you|one))\s+[^.?!]{0,40}\b(?:kill|murder|assassinate|poison|hurt|attack|stab|shoot)\b[^.?!]{0,40}\b(?:him|her|them|someone|somebody|people|my \w+|a person|people I|people at)|(?:kill|murder|assassinate|poison|stab|shoot)\s+(?:him|her|them|someone|somebody|people|my \w+|a person)|mass shooting|school shooting|terrorist attack|suicide attack|car bomb|truck bomb)\b/i;

/** The three rules, in the order they are checked. */
const RULES = [
    { rule: 'minors', label: 'sexual content involving minors', test: (t) => CSAM.test(t) || (MINOR.test(t) && NUDE.test(t)) },
    { rule: 'non_consensual', label: 'non-consensual sexual content (fiction included) or incest', test: (t) => NONCONSENSUAL.test(t) },
    { rule: 'mass_harm', label: 'weapons of mass harm or attacks on others', test: (t) => MASS_HARM.test(t) || WEAPON_INTENT.test(t) || ATTACK_INTENT.test(t) },
];

/** The version of the rules, written on every refusal and in the changelog. */
const VERSION = 'floor-2026-11-06';

/** The floor on a text: { ok: true } or { ok: false, rule, label, detail }. */
function check(texts) {
    const list = (Array.isArray(texts) ? texts : [texts]).filter((t) => t != null && String(t).trim());
    for (const t of list) {
        const text = String(t);
        for (const r of RULES) if (r.test(text)) {
            return { ok: false, rule: r.rule, label: r.label, version: VERSION, detail: `this breaks the hard floor (${r.label})` };
        }
    }
    return { ok: true, version: VERSION };
}

/** The floor on the way in and on the way out: one text, a list of texts, or a request's messages. */
function checkRequest(input) {
    if (typeof input === 'string') return check([input]);
    if (Array.isArray(input)) return check(input);
    const texts = [];
    if (input && typeof input.system === 'string') texts.push(input.system);
    for (const m of (input && input.messages) || []) {
        if (!m) continue;
        if (typeof m.content === 'string') texts.push(m.content);
        else if (Array.isArray(m.content)) for (const p of m.content) if (p && p.text) texts.push(String(p.text));
    }
    return check(texts);
}

/** Live's classifier, in the three categories VIS-6 uses. */
function classifyText(...texts) {
    const all = texts.filter((t) => t != null).map(String).join('\n').trim();
    if (!all) return { category: 'fine', reason: 'there is no text to judge' };
    if (LIVE_MINOR.test(all) && LIVE_NUDE.test(all)) return { category: 'minor_sexual', reason: 'the text puts a child together with nudity' };
    if (EXPLICIT.test(all)) return { category: 'sex_acts', reason: 'the text describes sex acts or pornography' };
    return { category: 'fine', reason: 'the text describes neither sex acts nor a child with nudity' };
}

/** True when the text is not fine under Live's classifier (the SDK's published copy answers the same). */
function isExplicit(...texts) {
    return classifyText(...texts).category !== 'fine' || sdkIsExplicit(...texts);
}

/** The card's own words: every field a person wrote, read as one text. */
function cardTexts(card) {
    if (!card) return [];
    const fields = ['name', 'description', 'personality', 'scenario', 'first_message', 'example_dialogue'];
    return fields.map((f) => String(card[f] || '')).filter((t) => t.trim());
}

/**
 * The floor on a card at save. Two extra rules of the design:
 *   - a card rated 18+ whose stated age is under 18 is refused at save;
 *   - "aged-up" framing is refused like any other minor content (a card that says a child is older is a
 *     minor card: the age field is not the only place an age is written).
 */
function checkCard(card) {
    const texts = cardTexts(card);
    const floor = check(texts);
    if (!floor.ok) return floor;
    const rating = String((card && card.rating) || 'everyone');
    const age = card && card.age != null && card.age !== '' ? Number(card.age) : null;
    if (rating === 'adult' && age != null && Number.isFinite(age) && age < 18) {
        return {
            ok: false, rule: 'minors', label: 'sexual content involving minors', version: VERSION,
            detail: 'a card rated 18+ may not state an age under 18',
        };
    }
    const live = classifyText(...texts);
    if (live.category === 'minor_sexual') {
        return { ok: false, rule: 'minors', label: 'sexual content involving minors', version: VERSION, detail: live.reason };
    }
    return { ok: true, version: VERSION };
}

module.exports = {
    VERSION, RULES, CATEGORIES, check, checkRequest, checkCard, classifyText, isExplicit,
    cardTexts, EXPLICIT, MINOR, NUDE, CSAM, NONCONSENSUAL, MASS_HARM, WEAPON_INTENT, ATTACK_INTENT,
    SOURCES: [
        'OpenVibe.AI server/policy/floor.js (2026-11-06) — the three hard rules',
        'OpenVibe.Live server/ai/explicit.js (2026-10-31) — VIS-6 categories fine / sex_acts / minor_sexual',
        'openvibe-sdk/explicit (v0.85.0) — the published copy of Live rules, imported',
    ],
};
