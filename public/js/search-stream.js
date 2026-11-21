'use strict';
/**
 * /search, streamed (plan AD.34 item 4; the owner: "faster responses … dynamic loading"). A web search with one engine
 * setting posts the form to /search/stream and fills the page as the search goes: the first merged list as soon as the
 * engines answer, then the merged list, the passages read from the top pages, and the answer with its sources. Each
 * event is HTML the server rendered with the same views as the full page; this script only puts it in place.
 *
 * Without this script, or when the stream cannot open, the form posts to /search and the page comes back whole.
 */
(() => {
    const form = document.getElementById('xs-form');
    const live = document.getElementById('xs-live');
    if (!form || !live || !form.dataset.stream || typeof ReadableStream === 'undefined' || typeof TextDecoder === 'undefined') return;
    let running = null;
    let bypass = false;
    // A success line the page came back with (a watch saved) stays above the results while the linked search reruns.
    let pinned = (() => { const n = typeof live.querySelector === 'function' ? live.querySelector('.xs-note.is-ok') : null; return n && n.outerHTML ? n.outerHTML : ''; })();

    const streamable = (data) => (data.get('kind') || 'web') === 'web' && (data.get('mode') || 'single') === 'single';

    /** Results already on the page, by address, so only the new ones enter (a whole list redrawn never flashes). */
    function seen() {
        return new Set([...live.querySelectorAll('.xs-hit > a')].map((a) => a.getAttribute('href')));
    }
    // The first answer of a search is brought into view under the bar that rides at the top (on a phone the results
    // start below the fold); after that the page stays where the person put it.
    let reveal = false;
    function bringIntoView() {
        if (!reveal || typeof live.getBoundingClientRect !== 'function') return;
        reveal = false;
        const top = live.getBoundingClientRect().top;
        // Under the bar only when it rides along (sticky); otherwise to the top of the screen.
        const bar = document.querySelector('.xs-bar');
        const pos = bar ? getComputedStyle(bar).position : '';
        const under = bar && (pos === 'sticky' || pos === 'fixed') ? bar.getBoundingClientRect().height : 0;
        if (top > window.innerHeight * 0.55 || top < under) {
            const calm = document.documentElement.dataset && document.documentElement.dataset.ovMotion === 'off';
            window.scrollTo({ top: window.scrollY + top - under - 12, behavior: calm ? 'auto' : 'smooth' });
        }
    }
    function put(html, before) {
        live.innerHTML = pinned + html;
        live.classList.add('is-streamed');
        bringIntoView();
        for (const li of live.querySelectorAll('.xs-hit')) {
            const a = li.querySelector(':scope > a');
            if (a && !before.has(a.getAttribute('href'))) li.classList.add('is-new');
        }
    }
    function busy(on, button) {
        live.toggleAttribute('aria-busy', on);
        form.toggleAttribute('aria-busy', on);
        if (button) button.disabled = on;
    }

    /** The search in the address bar (q, depth, answer, more, sites, date), so it can be linked, refreshed or shared. */
    function remember(data) {
        if (typeof history === 'undefined' || typeof history.replaceState !== 'function' || typeof location === 'undefined') return;
        const u = new URLSearchParams();
        u.set('q', String(data.get('q') || '').trim());
        const depth = data.get('depth');
        if (depth && depth !== 'fast') u.set('depth', depth);
        if (data.get('answer')) u.set('answer', '1');
        if (data.get('free_only')) u.set('free', '1');
        if (data.get('time_limit')) u.set('time', String(data.get('time_limit')));
        u.set('run', '1');
        try { history.replaceState(null, '', `${location.pathname}?${u.toString()}`); } catch { /* the address stays */ }
    }

    /**
     * Stop, while the search runs (the owner, 11-21: "searches can be cancelled or stopped to save on cost"): it asks the
     * server to end the search, which still finishes with what it found and what it cost; if that cannot be asked, the
     * connection is dropped, which stops it too.
     */
    function showStop(id, ctl) {
        const working = document.getElementById('xs-working');
        if (!working || typeof document.createElement !== 'function') return;
        const row = document.createElement('div');
        row.className = 'xs-stop-row';
        const words = document.createElement('span');
        words.textContent = 'Found enough? Stop here and pay only for what ran.';
        const stop = document.createElement('button');
        stop.type = 'button';
        stop.className = 'xs-stop';
        stop.textContent = 'Stop';
        stop.addEventListener('click', async () => {
            stop.disabled = true;
            stop.textContent = 'Stopping…';
            try {
                // A form body: the search routes read forms (a JSON body arrived empty, 11-21, and Stop fell back to hanging up).
                const res = await fetch('/search/stop', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ id }) });
                if (!res.ok && res.status !== 404) throw new Error('not stopped');
            } catch {
                // The stop could not be asked: dropping the connection stops the search too; the results stay.
                ctl.abort();
                const out = live.querySelector('.xs-out');
                if (out) { const note = document.createElement('p'); note.className = 'xs-note is-ok'; note.setAttribute('role', 'status'); note.textContent = 'Stopped: these are the results so far, and only what ran was charged.'; out.prepend(note); }
            }
        });
        row.append(words, stop);
        working.replaceChildren(row);
    }
    function hideStop() {
        const working = document.getElementById('xs-working');
        if (working && working.querySelector && working.querySelector('.xs-stop-row')) working.replaceChildren();
    }

    async function run(data, button) {
        if (running) running.abort();
        remember(data);
        const ctl = new AbortController();
        running = ctl;
        busy(true, button);
        reveal = true;
        const working = document.getElementById('xs-working');
        if (working) working.replaceChildren();
        let finished = false;
        try {
            const res = await fetch(form.dataset.stream, {
                method: 'POST', credentials: 'same-origin', signal: ctl.signal,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/event-stream' },
                body: new URLSearchParams(data),
            });
            if (!res.ok || !/^text\/event-stream/.test(res.headers.get('content-type') || '') || !res.body) throw new Error('no stream');
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            const handle = (block) => {
                const event = (block.match(/^event: ?(.*)$/m) || [])[1] || 'message';
                const raw = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.replace(/^data: ?/, '')).join('\n');
                if (!raw) return;
                let value;
                try { value = JSON.parse(raw); } catch { return; }
                if (event === 'started' && typeof value.id === 'string') showStop(value.id, ctl);
                if (value.live != null) put(value.live, seen());
                if (value.code != null) { const code = document.getElementById('xs-code'); if (code) code.innerHTML = value.code; }
                if (event === 'done' || event === 'failed') { finished = true; hideStop(); }
            };
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                let at;
                while ((at = buffer.indexOf('\n\n')) !== -1) { handle(buffer.slice(0, at)); buffer = buffer.slice(at + 2); }
            }
            if (buffer.trim()) handle(buffer);
            if (!finished) put('<section class="xs-out"><p class="xs-note">The search stopped before it finished. Try again.</p></section>', seen());
        } catch (err) {
            if (ctl.signal.aborted) return;
            // The stream could not open (an old browser, a proxy, a sign-in that expired): the whole page instead.
            if (!finished && !live.querySelector('.xs-hit')) { bypass = true; form.requestSubmit ? form.requestSubmit(button || undefined) : form.submit(); return; }
            const out = live.querySelector('.xs-out');
            if (out) { const note = document.createElement('p'); note.className = 'xs-note'; note.textContent = 'The connection dropped before the search finished; these are the results so far.'; out.prepend(note); }
        } finally {
            hideStop();
            if (running === ctl) { running = null; busy(false, button); }
        }
    }

    // The depths show what they cost and took lately: the answer's numbers while the answer switch is on.
    const deep = document.querySelector('.xs-deep');
    const answerSwitch = document.querySelector('input[name="answer"][form="xs-form"]');
    if (deep && answerSwitch && typeof answerSwitch.addEventListener === 'function') {
        answerSwitch.addEventListener('change', () => deep.classList.toggle('is-answer', answerSwitch.checked));
    }

    // A linked search (/search?q=…&run=1, the server set data-autorun for a signed-in person) runs itself once.
    if (form.dataset.autorun === '1' && typeof FormData !== 'undefined') {
        const data = new FormData(form);
        if (String(data.get('q') || '').trim() && streamable(data)) run(data, document.querySelector('button[type=submit][form="xs-form"]'));
    }

    // Capture on window: before exchange.js's document-level "Searching…" handler, which then sees the default prevented.
    window.addEventListener('submit', (e) => {
        if (e.target !== form || bypass) { bypass = false; return; }
        const data = new FormData(form, e.submitter || undefined);
        if (!streamable(data) || !String(data.get('q') || '').trim()) return;
        e.preventDefault();
        pinned = '';   // a new search of the person's own: the old line has said its piece
        run(data, e.submitter || document.querySelector('button[type=submit][form="xs-form"]'));
    }, true);
})();
