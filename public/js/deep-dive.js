/* /deep-dive/:id while it runs (the owner, 11-15: "doesn't show enough info/metrics and breakdown drop-down type shit and
 * more animations and effects that make it feel alive"). Drawn from the run's state and redrawn in place every two
 * seconds: the numbers count up, each step is a fold that says what it did and how long it took (the running one open,
 * with its breakdown: the sites chosen and why, each site's captures as they land), new rows and chips arrive with a
 * little motion, the bar shimmers while it works. Nothing reloads until the run ends (then the report). Text is always
 * set with textContent. Motion follows html[data-ov-motion] and prefers-reduced-motion. */
(function () {
    'use strict';
    var root = document.querySelector('[data-dd-run]');
    var seed = document.getElementById('dd-state');
    if (!root || !seed) return;
    var S;
    try { S = JSON.parse(seed.textContent); } catch (e) { return; }
    var LABEL = S.labels || {}, NOTE = S.notes || {}, ORDER = S.order || Object.keys(LABEL);
    var id = S.id, state = S.state;
    var ENDED = { succeeded: 1, failed: 1, cancelled: 1, expired: 1 };

    function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return String(u || ''); } }
    function secs(a, b) { var x = Date.parse(a), y = b ? Date.parse(b) : Date.now(); return isNaN(x) || isNaN(y) ? null : Math.max(0, Math.round((y - x) / 1000)); }
    function dur(s) { if (s == null) return ''; return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + (s % 60 ? (s % 60) + ' s' : ''); }
    function clock(s) { return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
    function num(re, text) { var m = re.exec(String(text || '')); return m ? Number(m[1]) : null; }
    var still = function () { return document.documentElement.getAttribute('data-ov-motion') === 'off' || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); };

    /** A number that counts up to its new value (never down: a value that drops is set at once). */
    function count(el, to) {
        var from = Number(el.getAttribute('data-n'));
        el.setAttribute('data-n', to == null ? '' : String(to));
        if (to == null) { el.textContent = '—'; return; }
        if (isNaN(from) || from >= to || still()) { el.textContent = String(to); return; }
        var t0 = performance.now(), ms = 600;
        el.classList.remove('is-bump'); void el.offsetWidth; el.classList.add('is-bump');
        (function step(t) { var k = Math.min(1, (t - t0) / ms); var e = 1 - Math.pow(1 - k, 3); el.textContent = String(Math.round(from + (to - from) * e)); if (k < 1) requestAnimationFrame(step); })(t0);
    }

    // ── The skeleton, built once ──
    root.textContent = '';
    var hero = h('div', 'ddl-hero');
    var chip = h('span', 'ddl-chip'); var dot = h('i', 'ddl-dot'); var chipText = h('span'); chip.append(dot, chipText);
    var nowLine = h('span', 'ddl-now');
    var elapsed = h('span', 'ddl-time');
    var pctEl = h('b', 'ddl-pct');
    var top = h('div', 'ddl-top'); top.append(chip, nowLine, elapsed, pctEl);
    var bar = h('div', 'ddl-bar'); bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100');
    var fill = h('span', 'ddl-fill'); bar.append(fill);
    ORDER.forEach(function (k, i) { var tick = h('i', 'ddl-tick'); tick.style.left = (100 * (i + 1) / ORDER.length) + '%'; bar.append(tick); });
    hero.append(top, bar);

    var tiles = h('div', 'ddl-tiles');
    function tile(label) { var t = h('div', 'ddl-tile'); var v = h('b', 'ddl-v', '—'); var l = h('span', 'ddl-l', label); var s = h('small', 'ddl-s'); t.append(v, l, s); tiles.append(t); return { v: v, s: s }; }
    var tSources = tile('Sources found'), tSites = tile('Sites chosen'), tCaps = tile('Screenshots'), tTime = tile('Time');

    var list = h('ol', 'ddl-steps');
    var rows = {};
    var touched = {};
    ORDER.forEach(function (key, i) {
        var li = h('li', 'ddl-step is-pending'); li.setAttribute('data-key', key);
        var d = h('details');
        var sum = h('summary');
        var ic = h('span', 'ddl-ic'); ic.setAttribute('aria-hidden', 'true');
        var n = h('span', 'ddl-n', String(i + 1));
        var name = h('strong', 'ddl-name', LABEL[key] || key);
        var det = h('span', 'ddl-det');
        var tm = h('span', 'ddl-dur');
        sum.append(ic, n, name, det, tm);
        var body = h('div', 'ddl-body');
        body.append(h('p', 'ddl-note', NOTE[key] || ''));
        var more = h('div', 'ddl-more');
        body.append(more);
        d.append(sum, body);
        d.addEventListener('toggle', function () { if (d.__auto) { d.__auto = false; return; } touched[key] = true; });
        li.append(d);
        list.append(li);
        rows[key] = { li: li, d: d, det: det, tm: tm, more: more };
    });
    var gapsBox = h('div', 'ddl-gaps');
    var err = h('p', 'dd-error'); err.setAttribute('role', 'alert'); err.hidden = true;
    root.append(hero, tiles, list, gapsBox, err);

    // ── Breakdowns ──
    var siteRows = {};
    function sitesBreakdown(box, st, withCaps) {
        var sites = (st.candidates || []).filter(function (c) { return c && c.url && c.chosen !== false; });
        if (!sites.length) { if (!box.firstChild) box.append(h('p', 'ddl-empty', 'The sites appear here once they are chosen.')); return; }
        var ul = box.querySelector('ul.ddl-sites');
        if (!ul) { box.textContent = ''; ul = h('ul', 'ddl-sites'); box.append(ul); }
        var caps = st.captures || [];
        var firstOpen = null;
        sites.forEach(function (site, i) {
            var key = (withCaps ? 'c:' : 's:') + (site.source_id || site.url);
            var r = siteRows[key];
            if (!r) {
                var li = h('li', 'ddl-site is-new');
                var mark = h('span', 'ddl-site-mark', host(site.url).slice(0, 1).toUpperCase());
                var main = h('div', 'ddl-site-main');
                var a = h('a', 'ddl-site-name', site.title || host(site.url)); a.href = site.url; a.rel = 'noopener noreferrer'; a.target = '_blank';
                var sub = h('small', 'ddl-site-host', host(site.url) + (site.kind === 'named' ? ' · you named it' : ''));
                main.append(a, sub);
                if (!withCaps && site.reason) main.append(h('p', 'ddl-site-why', site.reason));
                var chips = h('div', 'ddl-caps');
                var state2 = h('span', 'ddl-site-state');
                li.append(mark, main, state2);
                if (withCaps) main.append(chips);
                ul.append(li);
                setTimeout(function () { li.classList.remove('is-new'); }, 500);
                r = siteRows[key] = { li: li, chips: chips, state: state2, seen: {} };
            }
            if (!withCaps) return;
            var mine = caps.filter(function (c) { return c.source_id === site.source_id || c.url === site.url; });
            mine.forEach(function (c) {
                if (r.seen[c.id]) return;
                r.seen[c.id] = 1;
                var label = (c.viewport ? String(c.viewport) : 'page') + (c.theme ? ' ' + c.theme : '') + (c.skip ? ' ✕' : '');
                var chipEl = h('span', 'ddl-cap is-new' + (c.skip ? ' is-skip' : ''), label);
                chipEl.title = (c.viewport ? (c.viewport < 700 ? 'Phone, ' : 'Computer, ') + c.viewport + ' px' : 'The page') + (c.theme ? ', ' + c.theme : '') + (c.cached ? ', kept from an earlier capture' : '') + (c.skip ? ': skipped (' + String(c.skip) + ')' : '');
                r.chips.append(chipEl);
                setTimeout(function () { chipEl.classList.remove('is-new'); }, 450);
            });
            var done = mine.length > 0;
            var running = st.step === 'capture' && !done && firstOpen === null && rowsState.capture === 'running';
            if (running) firstOpen = i;
            r.li.classList.toggle('is-done', done);
            r.li.classList.toggle('is-now', running);
            r.state.textContent = done ? (mine.filter(function (c) { return !c.skip; }).length + ' shot' + (mine.length === 1 ? '' : 's')) : running ? 'Capturing…' : 'Waiting';
        });
    }
    var rowsState = {};

    // ── One redraw from a state ──
    function draw(st) {
        state = st;
        var steps = {}; (st.steps || []).forEach(function (s) { if (s && s.key) steps[s.key] = s; });
        var live = !ENDED[st.status];
        chip.className = 'ddl-chip is-' + st.status;
        chipText.textContent = st.status === 'choosing' ? 'Choosing' : st.status === 'queued' ? 'Waiting to start' : st.status.charAt(0).toUpperCase() + st.status.slice(1);
        var cur = steps[st.step] || {};
        nowLine.textContent = st.step ? (LABEL[st.step] || st.step) + (cur.detail ? ' · ' + cur.detail : '') : '';
        var p = Math.max(0, Math.min(100, Math.round((Number(st.progress) || 0) * 100)));
        pctEl.textContent = p + '%';
        bar.setAttribute('aria-valuenow', String(p));
        fill.style.width = p + '%';
        bar.classList.toggle('is-live', live);

        ORDER.forEach(function (key) {
            var s = steps[key] || { status: 'pending' };
            var r = rows[key];
            var was = rowsState[key];
            rowsState[key] = s.status || 'pending';
            r.li.className = 'ddl-step is-' + (s.status || 'pending') + (st.step === key && live ? ' is-current' : '');
            // The running step wears the mark at work (ov-mark.js busy), never a borrowed spinner.
            var ic = r.li.querySelector('.ddl-ic');
            var busyMark = ic.querySelector('.ov-mark');
            if (s.status === 'running' && !busyMark) { var m = h('span', 'ov-mark'); m.setAttribute('data-size', '22'); m.setAttribute('data-state', 'busy'); ic.append(m); }
            else if (s.status !== 'running' && busyMark) busyMark.remove();
            if (was && was !== s.status && s.status === 'done') { r.li.classList.add('is-just-done'); setTimeout(function () { r.li.classList.remove('is-just-done'); }, 900); }
            r.det.textContent = s.detail || (s.status === 'pending' ? 'Waiting' : '');
            r.tm.textContent = s.started_at ? dur(secs(s.started_at, s.finished_at)) : '';
            r.tm.setAttribute('data-from', s.status === 'running' && s.started_at ? s.started_at : '');
            // The running step opens itself (until the person opens or closes a step themselves).
            var shouldOpen = st.step === key && live;
            if (!touched[key] && r.d.open !== shouldOpen) { r.d.__auto = true; r.d.open = shouldOpen; }
        });
        rowsState.capture = (steps.capture || {}).status;
        sitesBreakdown(rows.choose.more, st, false);
        sitesBreakdown(rows.capture.more, st, true);
        if (!rows.search.more.firstChild && steps.search && steps.search.detail) rows.search.more.append(h('p', 'ddl-empty', 'MegaSource, the web engines, GitHub and OpenVibe’s own rules were asked; the best are ranked in the next step.'));

        count(tSources.v, num(/(\d+) sources?/, (steps.search || {}).detail));
        var engines = num(/from (\d+) engines?/, (steps.search || {}).detail);
        tSources.s.textContent = engines ? 'from ' + engines + ' engines' : '';
        var chosen = (st.candidates || []).filter(function (c) { return c && c.chosen !== false; }).length;
        count(tSites.v, chosen || null);
        tSites.s.textContent = st.site_limit ? 'of up to ' + st.site_limit : '';
        var shots = (st.captures || []).filter(function (c) { return !c.skip; }).length;
        var siteDone = {}; (st.captures || []).forEach(function (c) { siteDone[c.source_id || c.url] = 1; });
        count(tCaps.v, shots || (rowsState.capture === 'running' || rowsState.capture === 'done' ? 0 : null));
        tCaps.s.textContent = chosen ? Object.keys(siteDone).length + ' of ' + chosen + ' sites done' : '';

        gapsBox.textContent = '';
        if (st.gaps && st.gaps.length) { var g = h('details', 'ddl-gapfold'); g.append(h('summary', null, 'What it could not do (' + st.gaps.length + ')')); st.gaps.forEach(function (x) { g.append(h('p', 'ddl-note', String(x))); }); gapsBox.append(g); }
        err.hidden = !st.error;
        if (st.error) err.textContent = st.error.detail || st.error.code || 'The deep dive stopped';
    }

    // The clock: the run's time and the running step's, every second.
    var t0 = Date.parse(S.since || '');
    function ticking() {
        if (!ENDED[state.status] && !isNaN(t0)) { var s = Math.max(0, Math.floor((Date.now() - t0) / 1000)); elapsed.textContent = clock(s) + ' so far'; tTime.v.textContent = clock(s); tTime.s.textContent = S.minutes ? 'about ' + S.minutes + ' min in all' : ''; }
        ORDER.forEach(function (k) { var tm = rows[k].tm; var from = tm.getAttribute('data-from'); if (from) tm.textContent = dur(secs(from)); });
    }
    setInterval(ticking, 1000);

    draw(state);
    ticking();

    // The poll: every 2 s, one read at a time (8 s at most each), for an hour; an end, or a pause to choose sites,
    // brings the server's page (the report, or the choice form).
    var busy = false, ticks = 0;
    var timer = setInterval(function () {
        if (++ticks > 1800) { clearInterval(timer); return; }
        if (busy || document.hidden) return;
        busy = true;
        var ctl = typeof AbortController === 'function' ? new AbortController() : null;
        var stop = ctl ? setTimeout(function () { ctl.abort(); }, 8000) : 0;
        fetch('/deep-dive/' + encodeURIComponent(id) + '/state', { headers: { Accept: 'application/json' }, signal: ctl ? ctl.signal : undefined })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) {
                var d = j && j.deep_dive;
                if (!d) return;
                if (ENDED[d.status] || (d.status === 'choosing') !== (state.status === 'choosing')) { location.reload(); return; }
                d.site_limit = d.site_limit || state.site_limit;
                draw(d);
            })
            .catch(function () {})
            .then(function () { busy = false; clearTimeout(stop); });
    }, 2000);
})();
