'use strict';
/**
 * The owner's AI defaults (plan §1, owner rank): one row per task with the model inline and the fallback order.
 * Owner defaults name OpenVibe supply only (AI enforces that), so each picker is a plain model list rather than the
 * person-facing chip: the chip carries "your keys" and "your machines", which an owner default may never use.
 * Design and layout come from the Kit; Opus restyles on review.
 */
const { esc } = require('../render/html');

const AUTO = { model: 'openvibe/auto', source: 'openvibe' };

const LABEL = { 'openvibe/auto': 'Let OpenVibe choose' };

const option = (value, label, selected) => `<option value="${esc(JSON.stringify(value))}"${selected ? ' selected' : ''}>${esc(label)}</option>`;

/** One model picker: the current choice, and the models the task may use. */
function picker(name, label, choice, models) {
    const current = choice ? JSON.stringify(choice) : '';
    const known = models.some((m) => JSON.stringify({ model: m.model, source: m.source }) === current);
    return `<label class="ex-default-pick"><span>${esc(label)}</span><select name="${esc(name)}" required>
      ${known || !choice ? '' : option(choice, `${LABEL[choice.model] || choice.model} (not listed)`, true)}
      ${models.map((m) => option({ model: m.model, source: m.source }, `${LABEL[m.model] || m.name || m.model}${m.price_estimate_usd == null ? '' : ` · $${m.price_estimate_usd.toFixed(4)} a run`}`, !known && JSON.stringify({ model: m.model, source: m.source }) === current)).join('')}
    </select></label>`;
}

function fallbackRow(choice, models) {
    return `<li draggable="true"><span data-fallback-model>${esc(choice.model)}</span><input type="hidden" name="fallback" value="${esc(JSON.stringify(choice))}"><select data-fallback-edit aria-label="Change this fallback">
      ${models.map((m) => option({ model: m.model, source: m.source }, m.name || m.model, m.model === choice.model)).join('')}
    </select><button type="button" class="ovk-button ovk-button-quiet" data-move="-1" aria-label="Move fallback up">↑</button><button type="button" class="ovk-button ovk-button-quiet" data-move="1" aria-label="Move fallback down">↓</button><button type="button" class="ovk-button ovk-button-quiet" data-remove>Remove</button></li>`;
}

function taskForm(task, options) {
    const d = options.current || { signed_out: task.default, signed_in: task.default, fallbacks: [], search_engines: [], image_model: null, max_cost_usd: null };
    const models = options.models || [];
    return `<form class="ex-default-task ovk-form" method="post" action="/console/defaults" data-task-default>
    <input type="hidden" name="task" value="${esc(task.name)}">
    <header><div><h2>${esc(task.name)}</h2><p>${esc(task.sentence)}</p></div><span class="ovk-badge">${esc(task.kind)}</span></header>
    <div class="ex-default-picks">
      ${picker('signed_out', 'Signed out', d.signed_out, models)}
      ${picker('signed_in', 'Signed in', d.signed_in, models)}
      ${task.kind === 'image' ? picker('image_model', 'Image model', d.image_model || d.signed_in, options.imageModels || []) : ''}
    </div>
    <details>
      <summary>Fallback order${d.fallbacks.length ? ` · ${d.fallbacks.length}` : ''}</summary>
      <p>Drag to reorder, or use the arrow buttons. The first available model answers.</p>
      <ol data-fallback-list data-models="${esc(JSON.stringify(models))}">${d.fallbacks.map((c) => fallbackRow(c, models)).join('')}</ol>
      <div class="ex-default-pick"><span>Add a fallback</span><select name="fallback_new" aria-label="A model to add as a fallback">
        ${models.map((m) => option({ model: m.model, source: m.source }, m.name || m.model, false)).join('')}
      </select><button type="button" class="ovk-button ovk-button-quiet" data-add-fallback>Add fallback</button></div>
    </details>
    ${task.kind === 'search' ? `<fieldset><legend>Search engines</legend><p>Enabled engines are tried in this order.</p><textarea name="search_engines" rows="4" aria-label="Search engines in order; prefix a disabled engine with a minus">${esc(d.search_engines.map((e) => (e.enabled ? '' : '-') + e.engine).join('\n'))}</textarea><small>One engine per line. Prefix with − to turn it off.</small></fieldset>` : ''}
    <label class="ex-default-cost">Per-run cost ceiling (USD)<input name="max_cost_usd" type="number" min="0" max="1000" step="0.0001" value="${esc(d.max_cost_usd ?? '')}" placeholder="No task ceiling"></label>
    <button class="ovk-button" type="submit">Save ${esc(task.name)}</button>
  </form>`;
}

/**
 * optionsByTask: { [task]: { current, models, imageModels } } — AI's resolved options for each task. A task whose
 * options could not be read still renders, with the options it has, so one failing read never hides the page.
 */
function defaultsPage({ tasks = [], defaults = {}, optionsByTask = {}, error = null } = {}) {
    return `<div class="ex-task-defaults">
  <header><p class="ovk-eyebrow">Owner console</p><h1>AI defaults</h1><p>Choose what answers across OpenVibe. A person's own choice takes priority, and every change is audited and reaches services within a minute.</p></header>
  ${error ? `<p role="alert">${esc(error)}</p>` : ''}
  <div class="ex-default-tasks">${tasks.map((task) => taskForm(task, { current: defaults[task.name] || null, ...(optionsByTask[task.name] || {}) })).join('')}</div>
</div>`;
}

module.exports = { defaultsPage };
