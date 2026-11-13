'use strict';
/**
 * /code: GitHub repositories through OpenVibe.Sources. A deep search box, the rankings as tabs, the twelve
 * languages as chips, and one card per repository: owner avatar, name, a two-line description, the language
 * with its dot, stars with the week's gain, forks, when it was last pushed, topics and a link to GitHub.
 *
 * The cards are a CSS grid, one column on a phone and three on a desktop; every name and description wraps
 * or is clamped, so no card pushes the page sideways at 320–430 px. The page is complete without JavaScript.
 */
const kit = require('openvibe-shared/kit');
const glyphs = require('openvibe-shared/glyphs');
const { esc } = require('../render/html');

// The same twelve GitHub searches Sources keeps (server/adapters/github.js in OpenVibe.Sources). A chip
// that filters a list and a search alike; a language not here is still in a card's own language line.
const LANGUAGES = Object.freeze(['JavaScript', 'TypeScript', 'Python', 'Go', 'Rust', 'Java', 'C++', 'C#', 'PHP', 'Ruby', 'Swift', 'Kotlin']);
const LANG_COLOR = {
    JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5', Go: '#00ADD8', Rust: '#dea584', Java: '#b07219',
    'C++': '#f34b7d', 'C#': '#178600', PHP: '#4F5D95', Ruby: '#701516', Swift: '#F05138', Kotlin: '#A97BFF',
};
const TABS = Object.freeze([
    { key: 'trending', label: 'Trending today', fa: 'fa-fire' },
    { key: 'week', label: 'This week', fa: 'fa-calendar' },
    { key: 'hot', label: 'Hot', fa: 'fa-arrow-trend-up' },
    { key: 'new', label: 'New', fa: 'fa-plus' },
    { key: 'top', label: 'Top', fa: 'fa-star' },
]);

/** The glyph for a Font Awesome name, or nothing when the registry has none. */
const icon = (fa) => { const name = glyphs.fromFa(fa); return name ? glyphs.svg(name) : ''; };
const count = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-US') : '—');
const when = (iso, now) => {
    const t = Date.parse(iso || '');
    if (!Number.isFinite(t)) return 'date not listed';
    const s = Math.max(0, Math.round((now - t) / 1000));
    if (s < 90) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    if (s < 30 * 86400) return `${Math.round(s / 86400)} d ago`;
    return new Date(t).toISOString().slice(0, 10);
};

function avatar(repo) {
    const owner = String(repo.full_name || '').split('/')[0] || '?';
    if (repo.owner_avatar_url) return `<img class="cd-avatar" src="${esc(repo.owner_avatar_url)}" alt="" width="40" height="40" loading="lazy" decoding="async">`;
    return `<span class="cd-avatar cd-avatar--letter" aria-hidden="true">${esc(owner.slice(0, 1).toUpperCase())}</span>`;
}

function card(repo, now) {
    const gain = Number.isFinite(Number(repo.stars_gained_7d)) && Number(repo.stars_gained_7d) > 0 ? ` <span class="cd-gain">+${count(repo.stars_gained_7d)} this week</span>` : '';
    const topics = (Array.isArray(repo.topics) ? repo.topics : []).slice(0, 5);
    const lang = repo.language || null;
    const dot = lang ? `<span class="cd-dot" style="--cd-lang:${esc(LANG_COLOR[lang] || 'var(--ovk-accent)')}" aria-hidden="true"></span>` : '';
    return `<li class="cd-card">
<header class="cd-card-head">${avatar(repo)}<div class="cd-card-id"><a class="cd-name" href="${esc(repo.url)}" rel="noopener noreferrer">${esc(repo.full_name)}</a><span class="cd-owner">${esc(String(repo.full_name || '').split('/')[0] || '')}</span></div></header>
<p class="cd-desc">${repo.description ? esc(repo.description) : '<span class="cd-muted">No description.</span>'}</p>
<p class="cd-stats"><span class="cd-stat" title="Stars">${icon('fa-star')}<b>${count(repo.stars)}</b>${gain}</span><span class="cd-stat" title="Forks">${icon('fa-code-branch') || ''}<b>${count(repo.forks)}</b> forks</span>${lang ? `<span class="cd-lang">${dot}${esc(lang)}</span>` : ''}</p>
${topics.length ? `<ul class="cd-topics" aria-label="Topics">${topics.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
<footer class="cd-foot"><span>Updated ${esc(when(repo.pushed, now))}</span><a class="cd-open" href="${esc(repo.url)}" rel="noopener noreferrer">GitHub ${glyphs.svg('arrow-right', { size: 16 })}</a></footer>
</li>`;
}

function cards(repos, now) {
    if (!repos.length) return kit.empty({ icon: 'code', title: 'No repositories here yet', text: 'The GitHub source is still filling the list, or this filter has no match. Try another language or list.' });
    return `<ul class="cd-grid">${repos.map((r) => card(r, now)).join('')}</ul>`;
}

function tabLinks(list, lang, q) {
    return TABS.map((t) => {
        const href = `/code?list=${encodeURIComponent(t.key)}${lang ? `&lang=${encodeURIComponent(lang)}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
        return `<a class="cd-tab${t.key === list ? ' is-on' : ''}" href="${href}"${t.key === list ? ' aria-current="page"' : ''}>${icon(t.fa)}${esc(t.label)}</a>`;
    }).join('');
}

function languageLinks(list, lang, q) {
    const all = `/code?list=${encodeURIComponent(list)}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
    const chips = [`<a class="cd-chip${lang ? '' : ' is-on'}" href="${all}">All languages</a>`]
        .concat(LANGUAGES.map((l) => {
            const href = `/code?list=${encodeURIComponent(list)}&lang=${encodeURIComponent(l)}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
            return `<a class="cd-chip${l === lang ? ' is-on' : ''}" href="${href}">${esc(l)}</a>`;
        }));
    return `<nav class="cd-langs" aria-label="Language">${chips.join('')}</nav>`;
}

/**
 * o: { list, lang, q, repos, total, now, stale, unavailable, search }
 */
function codePage({ list = 'trending', lang = null, q = '', repos = [], total = null, now = Date.now(), stale = false, unavailable = false, search = false, notice: extraNotice = '' }) {
    const notice = unavailable
        ? kit.notice({ kind: 'warn', text: 'The repository list is not reachable right now. It is read from OpenVibe.Sources; reload in a moment.' })
        : extraNotice ? kit.notice({ kind: 'info', text: extraNotice })
        : stale ? kit.notice({ kind: 'info', text: 'These are the last repositories read from OpenVibe.Sources; the live read did not answer just now.' }) : '';
    const title = search ? `Repositories for “${q}”` : (TABS.find((t) => t.key === list) || TABS[0]).label;
    const sub = search && total != null ? `${count(total)} GitHub matches · repositories only, no code copied` : 'Trending, new and most-starred repositories on GitHub, with the star gains that make them hot.';
    const results = `<section class="cd-results" aria-labelledby="cd-results-title"><div class="cd-results-head"><h2 id="cd-results-title">${search ? 'Search results' : esc(title)}</h2><span class="cd-count">${repos.length} shown</span>${search ? '<a class="cd-clear" href="/code">Clear search</a>' : ''}</div>${cards(repos, now)}</section>`;
    return `<div class="ex-wrap ex-page cd">
${kit.head({ title: 'Code', sub, actions: [kit.button({ href: '/api#code', label: 'Code API', kind: 'quiet', icon: 'code' })] })}
<section class="cd-find" aria-label="Search repositories">
${kit.find({ action: '/code', name: 'q', placeholder: 'Search repositories: stars:>500 topic:ai', value: q, icon: 'search', maxlength: 200, hidden: lang ? { lang } : {} })}
<p class="cd-hint">GitHub's own search syntax works: <code>stars:&gt;500 topic:ai</code>, <code>language:rust</code>, <code>pushed:&gt;2026-10-01</code>. Code is linked, never copied.</p>
</section>
<nav class="cd-tabs" aria-label="Repository list">${tabLinks(list, lang, q)}</nav>
${languageLinks(list, lang, q)}
${notice}
${results}
</div>`;
}

module.exports = { codePage, LANGUAGES, TABS };
