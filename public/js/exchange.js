/* OpenVibe.Exchange: a sealed chat. The conversation is sealed with the person's Locker (people-locked to them) in
 * this tab; the page only ever receives and sends the envelope. OpenVibe cannot read a sealed chat. */
(function () {
    'use strict';
    var root = document.getElementById('ex-sealed');
    if (!root) return;

    var chatId = root.getAttribute('data-chat') || '';
    var subject = root.getAttribute('data-subject') || '';
    var network = root.getAttribute('data-network') || 'https://openvibe.network';
    window.OpenVibeLockerConfig = window.OpenVibeLockerConfig || { network: network };

    var statusEl = root.querySelector('[data-sealed-status]');
    var turnsEl = root.querySelector('[data-sealed-turns]');
    var form = root.querySelector('[data-sealed-form]');
    var textarea = form && form.querySelector('textarea[name="text"]');
    var modelSel = form && form.querySelector('select[name="model"]');
    var strictBox = form && form.querySelector('input[name="strict_privacy"]');
    var msg = form && form.querySelector('[data-sealed-msg]');

    var state = { title: '', models: [], messages: [] };
    var publicKey = null;

    function say(text, bad) {
        if (!msg) return;
        msg.textContent = text || '';
        msg.className = bad ? 'ovk-msg is-error' : 'ovk-msg';
    }
    function encode(text) { return new TextEncoder().encode(text); }
    function decode(bytes) { return new TextDecoder().decode(bytes); }
    function b64(bytes) {
        var s = '';
        for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return btoa(s);
    }
    function unb64(text) {
        var raw = atob(String(text || ''));
        var out = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
        return out;
    }

    /** The person's own public key, after the Locker is unlocked here (the unlock sheet when it is not). */
    async function ready() {
        if (!window.OVLocker) throw new Error('The Locker could not load. Reload the page.');
        var st = await window.OVLocker.ensure();
        if (!st || !st.unlocked) throw new Error('Unlock your Locker to use a sealed chat.');
        if (!publicKey) {
            var keys = await window.OVLocker.publicKeys();
            publicKey = keys && keys.ecdh;
        }
        if (!publicKey) throw new Error('Your Locker has no public key yet.');
    }

    /** The whole conversation, sealed for this person in this tab: only bytes leave the page. */
    async function sealNow() {
        var out = await window.OVLocker.seal(encode(JSON.stringify(state)), { lock: 'people', keys: [{ subject: subject, publicKey: publicKey }] });
        return b64(out.bytes);
    }

    function node(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }
    function pair(dl, k, v) { dl.appendChild(node('dt', null, k)); dl.appendChild(node('dd', null, v)); }
    function privacyText(label) {
        if (label === 'private') return 'Private · keeps nothing, trains on nothing';
        if (label === 'community') return 'Community · a person’s machine sees the prompt';
        if (label === 'anonymized') return 'Anonymized';
        return '—';
    }

    function render() {
        if (!turnsEl) return;
        turnsEl.replaceChildren();
        var title = root.querySelector('[data-sealed-title]');
        if (title) {
            title.textContent = state.title || 'A sealed chat';
            title.hidden = !state.title;
        }
        if (state.title) document.title = state.title + ' · OpenVibe.Exchange';
        for (var i = 0; i < state.messages.length; i++) {
            var m = state.messages[i];
            if (m.role === 'system') continue;
            var turn = node('article', 'ex-turn ex-turn--' + m.role);
            turn.appendChild(node('p', 'ex-turn-who', m.role === 'user' ? 'You' : (m.model || 'The model')));
            turn.appendChild(node('div', 'ex-turn-text', m.content || ''));
            var meta = m.meta;
            if (meta && (meta.privacy || meta.provider || meta.cost_usd != null)) {
                var d = node('details', 'ex-receipt');
                d.appendChild(node('summary', null, 'Receipt'));
                var dl = node('dl', null);
                pair(dl, 'Offer', meta.provider ? String(meta.provider) : '—');
                pair(dl, 'Privacy', privacyText(meta.privacy));
                if (meta.preset) pair(dl, 'Preset', String(meta.preset));
                pair(dl, 'Cost', meta.cost_usd == null ? '—' : '$' + Number(meta.cost_usd).toFixed(6));
                if (meta.latency_ms != null) pair(dl, 'Latency', Number(meta.latency_ms).toLocaleString('en-US') + ' ms');
                d.appendChild(dl);
                turn.appendChild(d);
            }
            turnsEl.appendChild(turn);
        }
        turnsEl.scrollTop = turnsEl.scrollHeight;
    }

    async function openExisting() {
        var res = await fetch('/chat/' + encodeURIComponent(chatId) + '/sealed', { headers: { accept: 'application/json' } });
        if (!res.ok) throw new Error('This sealed chat could not be read.');
        var body = await res.json();
        if (!body.envelope) throw new Error('This sealed chat has no envelope yet.');
        if (strictBox) strictBox.checked = body.strict_privacy !== false;
        await window.OVLocker.open(statusEl, {
            bytes: unb64(body.envelope),
            title: 'A sealed chat',
            onOpen: function (plain) {
                var parsed = JSON.parse(decode(plain));
                state = {
                    title: parsed.title || '',
                    models: Array.isArray(parsed.models) ? parsed.models : [],
                    messages: Array.isArray(parsed.messages) ? parsed.messages : [],
                };
                statusEl.hidden = true;
                render();
            },
        });
    }

    async function save() {
        var envelope = await sealNow();
        var res = await fetch('/chat/' + encodeURIComponent(chatId) + '/sealed', {
            method: 'PUT', headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ envelope: envelope }),
        });
        if (!res.ok) throw new Error('The sealed chat was not saved.');
    }

    async function send(event) {
        event.preventDefault();
        var text = String((textarea && textarea.value) || '').trim();
        if (!text) return say('Write something to send.', true);
        var model = modelSel && modelSel.value;
        if (!model) return say('Pick a model first.', true);
        var strict = Boolean(strictBox && strictBox.checked);
        say('Sealing the turn on this device…');
        try {
            await ready();
        } catch (err) { return say(err.message, true); }
        if (!state.title) state.title = text.replace(/\s+/g, ' ').slice(0, 60);
        state.messages.push({ role: 'user', content: text });
        if (state.models.indexOf(model) === -1) state.models.push(model);
        render();
        if (textarea) textarea.value = '';
        try {
            // The chat is made here, with the first envelope: the server never sees a turn before it is sealed.
            if (!chatId) {
                var made = await fetch('/chat/sealed/new', {
                    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
                    body: JSON.stringify({ envelope: await sealNow() }),
                });
                var created = await made.json().catch(function () { return {}; });
                if (!made.ok || !created.id) throw new Error(created.error || 'The sealed chat was not created.');
                chatId = created.id;
                root.setAttribute('data-chat', chatId);
                if (window.history && window.history.replaceState) window.history.replaceState(null, '', created.url || ('/chat/' + chatId));
            }
            say('Sending the turn…');
            var res = await fetch('/chat/' + encodeURIComponent(chatId) + '/sealed/send', {
                method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
                body: JSON.stringify({
                    model: model,
                    messages: state.messages.map(function (m) { return { role: m.role, content: m.content }; }),
                    strict_privacy: strict,
                }),
            });
            var body = await res.json().catch(function () { return {}; });
            if (!res.ok || !body.answer) throw new Error(body.error || 'The model did not answer.');
            var a = body.answer;
            state.messages.push({
                role: 'assistant', content: a.content, model: model,
                meta: { provider: a.provider, privacy: a.privacy, preset: a.preset, cost_usd: a.cost_usd, latency_ms: a.latency_ms },
            });
            await save();
            render();
            say('Sealed and saved on this device.');
        } catch (err) {
            state.messages.push({ role: 'assistant', content: '[No answer] ' + (err.message || 'The model did not answer.'), model: model });
            try { if (chatId) await save(); } catch (e) { /* the page says so below */ }
            render();
            say(err.message || 'The model did not answer.', true);
        }
    }

    async function start() {
        if (statusEl) statusEl.textContent = 'Opening your Locker…';
        try {
            await ready();
            if (chatId) await openExisting();
            else if (statusEl) {
                statusEl.textContent = 'Your Locker is open. The first message makes the chat, sealed before it leaves this page.';
                statusEl.classList.add('is-ready');
            }
            if (form) form.hidden = false;
            if (textarea) textarea.focus();
        } catch (err) {
            if (statusEl) statusEl.textContent = err.message || 'The Locker could not start.';
            var retry = node('button', 'ovk-btn ovk-btn--quiet', 'Try again');
            retry.type = 'button';
            retry.addEventListener('click', function () { retry.remove(); start(); });
            if (statusEl && statusEl.parentNode) statusEl.parentNode.insertBefore(retry, statusEl.nextSibling);
        }
    }

    if (form) form.addEventListener('submit', send);
    start();
})();
