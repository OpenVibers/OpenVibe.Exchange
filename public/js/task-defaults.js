'use strict';
/**
 * The owner's AI defaults: the fallback order moves by drag or by its arrow buttons, "Add fallback" appends the model
 * chosen beside it, and changing a fallback's picker rewrites the value that form posts. One task posts at a time;
 * the server reads the order as the list stands.
 */
document.querySelectorAll('[data-task-default]').forEach((form) => {
    const list = form.querySelector('[data-fallback-list]');
    const models = JSON.parse(list.dataset.models || '[]');
    const byValue = new Map(models.map((m) => [JSON.stringify({ model: m.model, source: m.source }), m.model]));
    let dragged = null;

    const buttonsFor = (li) => {
        for (const [move, text, label] of [['-1', '↑', 'Move fallback up'], ['1', '↓', 'Move fallback down']]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'ovk-button ovk-button-quiet';
            button.textContent = text;
            button.setAttribute('aria-label', label);
            button.dataset.move = move;
            li.append(button);
        }
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'ovk-button ovk-button-quiet';
        remove.textContent = 'Remove';
        remove.setAttribute('aria-label', 'Remove fallback');
        remove.dataset.remove = '';
        li.append(remove);
    };

    list.addEventListener('change', (event) => {
        const select = event.target.closest('[data-fallback-edit]');
        if (!select) return;
        const li = select.closest('li');
        li.querySelector('[name=fallback]').value = select.value;
        const label = li.querySelector('[data-fallback-model]');
        if (label) label.textContent = byValue.get(select.value) || JSON.parse(select.value).model;
    });
    list.addEventListener('click', (event) => {
        const button = event.target.closest('button');
        if (!button) return;
        const li = button.closest('li');
        if (button.hasAttribute('data-remove')) li.remove();
        else if (button.dataset.move === '-1' && li.previousElementSibling) list.insertBefore(li, li.previousElementSibling);
        else if (button.dataset.move === '1' && li.nextElementSibling) list.insertBefore(li.nextElementSibling, li);
    });
    list.addEventListener('dragstart', (event) => {
        dragged = event.target.closest('li');
        event.dataTransfer.effectAllowed = 'move';
    });
    list.addEventListener('dragover', (event) => { if (dragged) event.preventDefault(); });
    list.addEventListener('drop', (event) => {
        event.preventDefault();
        const target = event.target.closest('li');
        if (dragged && target && target !== dragged) list.insertBefore(dragged, target);
        dragged = null;
    });

    form.querySelector('[data-add-fallback]').addEventListener('click', () => {
        const value = form.querySelector('[name=fallback_new]').value;
        if (!value || list.children.length >= 10) return;
        const choice = JSON.parse(value);
        const li = document.createElement('li');
        li.draggable = true;
        const label = document.createElement('span');
        label.dataset.fallbackModel = '';
        label.textContent = byValue.get(value) || choice.model;
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'fallback';
        input.value = value;
        li.append(label, input);
        buttonsFor(li);
        list.append(li);
    });
});
