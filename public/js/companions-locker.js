/* OpenVibe.Exchange: the Locker, in the browser.
 *
 * A locked chat keeps its notes and its history sealed with the person's own keys (openvibe-shared's
 * ov-locker.js opens them; openvibe-sdk/locker is the cryptography behind it). This file asks for the locker,
 * opens every sealed thing on the page, and sends what it opened with the next message, for that turn only.
 *
 * What travels with the turn: the turns it opened (in order), the text of each message (so a regenerate can
 * answer the same message), and the notes it opened. The server uses them to build this one answer and stores
 * nothing in the clear.
 *
 * The page is complete without this file: a locked chat asks for the unlock, and says so.
 */
(function () {
    'use strict';
    var doc = document;
    var root = window;
    var FIELD = 'locker_context';

    function b64ToBytes(text) {
        var bin = atob(String(text || ''));
        var out = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }
    function bytesToText(bytes) {
        if (typeof bytes === 'string') return bytes;
        try { return new TextDecoder('utf-8').decode(bytes); } catch (e) { return String(bytes || ''); }
    }

    function sealedNodes() {
        return Array.prototype.slice.call(doc.querySelectorAll('[data-locker-sealed]'));
    }

    /** What the browser opened: the history, the message texts, and the notes. */
    function opened() {
        var history = [];
        var messages = {};
        var notes = [];
        Array.prototype.forEach.call(doc.querySelectorAll('[data-locker-opened]'), function (el) {
            var text = el.getAttribute('data-locker-text') || '';
            var role = el.getAttribute('data-locker-role');
            var message = el.getAttribute('data-locker-message');
            var note = el.getAttribute('data-locker-note');
            if (role === 'user' || role === 'assistant') history.push({ role: role, content: text });
            if (message) messages[message] = text;
            if (note) {
                notes.push({
                    id: note,
                    m2_id: note,
                    kind: el.getAttribute('data-locker-kind') || 'fact',
                    pinned: el.getAttribute('data-locker-pinned') === '1',
                    text: text,
                });
            }
        });
        return { history: history, messages: messages, notes: notes };
    }

    function fill(el, text) {
        el.removeAttribute('data-locker-sealed');
        el.setAttribute('data-locker-opened', '1');
        el.setAttribute('data-locker-text', text);
        el.textContent = text;
    }

    function openOne(el) {
        var locker = root.OVLocker;
        if (!locker) return Promise.resolve(null);
        var bytes = b64ToBytes(el.getAttribute('data-locker-sealed'));
        var holder = doc.createElement('div');
        holder.style.display = 'none';
        doc.body.appendChild(holder);
        return locker.open(holder, {
            bytes: bytes,
            onOpen: function (plain) { fill(el, bytesToText(plain)); },
        }).then(function (plain) {
            if (plain) fill(el, bytesToText(plain));
            holder.remove();
            return plain;
        }).catch(function () { holder.remove(); return null; });
    }

    function field() {
        var form = doc.getElementById('ovt-composer');
        if (!form) return null;
        var f = doc.getElementById('ex-locker-context');
        if (!f) {
            f = doc.createElement('input');
            f.type = 'hidden';
            f.id = 'ex-locker-context';
            f.name = FIELD;
            form.appendChild(f);
        }
        return f;
    }

    function sendContext() {
        var f = field();
        if (!f) return;
        f.value = JSON.stringify(opened());
    }

    function start() {
        var nodes = sealedNodes();
        var lockedPage = Boolean(doc.querySelector('[data-locker-chat]'));
        var locker = root.OVLocker;
        if (!locker || (!nodes.length && !lockedPage)) return;
        var form = doc.getElementById('ovt-composer');
        var button = doc.getElementById('ex-locker-unlock');
        // One gate for every submit: while a sealed turn is still closed, the form does not go (the history
        // would be lost); once every node is open, the bundle travels with the message, for that turn only.
        // A locked chat with no sealed turn yet (the first message) sends the empty bundle.
        if (form) {
            form.addEventListener('submit', function (event) {
                if (sealedNodes().length) {
                    event.preventDefault();
                    if (button) button.removeAttribute('hidden');
                    return;
                }
                sendContext();
            });
        }
        if (!nodes.length) return;
        var open = function () {
            return Promise.all(nodes.map(openOne)).then(function () {
                if (button) button.setAttribute('hidden', 'hidden');
            });
        };
        if (locker.state && locker.state().unlocked) { open(); return; }
        if (!button) {
            button = doc.createElement('button');
            button.type = 'button';
            button.id = 'ex-locker-unlock';
            button.className = 'ex-btn ex-btn-primary';
            button.textContent = 'Unlock your locker';
            var note = doc.getElementById('ex-locker-note');
            (note || doc.body).appendChild(button);
        }
        button.removeAttribute('hidden');
        button.addEventListener('click', function () {
            button.setAttribute('hidden', 'hidden');
            locker.unlock().then(function (st) {
                if (st && st.unlocked) return open();
                button.removeAttribute('hidden');
                return null;
            });
        });
    }

    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
    else start();
})();
