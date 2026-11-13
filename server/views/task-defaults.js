'use strict';
/**
 * The owner's AI defaults (plan §1, owner rank): one row per task with the model inline and the fallback order.
 * Owner defaults name OpenVibe supply only (AI enforces that), so each picker is a plain model list rather than the
 * person-facing chip: the chip carries "your keys" and "your machines", which an owner default may never use.
 * Design and layout come from the Kit; Opus restyles on review.
 */
const { esc } = require('../render/html');
const glyphs = require('openvibe-shared/glyphs');

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
    </select><button type="button" class="ovk-btn ovk-btn--quiet" data-move="-1" aria-label="Move fallback up">${glyphs.svg('arrow-up', { size: 16 })}</button><button type="button" class="ovk-btn ovk-btn--quiet" data-move="1" aria-label="Move fallback down">${glyphs.svg('arrow-down', { size: 16 })}</button><button type="button" class="ovk-btn ovk-btn--quiet" data-remove>Remove</button></li>`;
}

/**
 * One task as one row (Opus's design, 11-09: "one row per task, the model inline"): the task and what it is for, the
 * signed-out and signed-in models side by side, Save at the end; the fallback order, the image model, the search
 * engines and the cost ceiling in a counted fold under the row.
 */
function taskForm(task, options) {
    const d = options.current || { signed_out: task.default, signed_in: task.default, fallbacks: [], search_engines: [], image_model: null, max_cost_usd: null };
    const models = options.models || [];
    const more = [`${d.fallbacks.length} fallback${d.fallbacks.length === 1 ? '' : 's'}`, task.kind === 'image' ? 'image model' : '', task.kind === 'search' ? 'search engines' : '', d.max_cost_usd != null ? `ceiling $${Number(d.max_cost_usd).toFixed(4)}` : 'no ceiling'].filter(Boolean).join(' · ');
    return `<form class="ex-dt-row ovk-form" method="post" action="/console/defaults" data-task-default>
    <input type="hidden" name="task" value="${esc(task.name)}">
    <div class="ex-dt-task"><h2>${esc(task.name)}</h2><p>${esc(task.sentence)}</p><span class="ovk-badge">${esc(task.kind)}</span></div>
    <div class="ex-dt-picks">
      ${picker('signed_out', 'Signed out', d.signed_out, models)}
      ${picker('signed_in', 'Signed in', d.signed_in, models)}
    </div>
    <div class="ex-dt-go"><button class="ovk-btn ovk-btn--primary" type="submit" aria-label="Save ${esc(task.name)}">Save</button></div>
    <details class="ex-dt-more">
      <summary>More <span>${esc(more)}</span></summary>
      <div class="ex-dt-more-body">
      ${task.kind === 'image' ? picker('image_model', 'Image model', d.image_model || d.signed_in, options.imageModels || []) : ''}
      <section class="ex-dt-fallbacks"><h3>Fallback order</h3><p>The first available model answers. Drag to reorder, or use the arrows.</p>
      <ol data-fallback-list data-models="${esc(JSON.stringify(models))}">${d.fallbacks.map((c) => fallbackRow(c, models)).join('')}</ol>
      <div class="ex-default-pick ex-dt-add"><span class="ex-dt-sr">Add a fallback</span><select name="fallback_new" aria-label="A model to add as a fallback">
        ${models.map((m) => option({ model: m.model, source: m.source }, m.name || m.model, false)).join('')}
      </select><button type="button" class="ovk-btn ovk-btn--quiet" data-add-fallback>Add fallback</button></div></section>
      ${task.kind === 'search' ? `<fieldset class="ex-dt-engines"><legend>Search engines</legend><p>Enabled engines are tried in this order.</p><textarea name="search_engines" rows="4" aria-label="Search engines in order; prefix a disabled engine with a minus">${esc(d.search_engines.map((e) => (e.enabled ? '' : '-') + e.engine).join('\n'))}</textarea></fieldset>` : ''}
      <label class="ex-default-cost">Per-run cost ceiling (USD)<input name="max_cost_usd" type="number" min="0" max="1000" step="0.0001" value="${esc(d.max_cost_usd ?? '')}" placeholder="No task ceiling"></label>
      </div>
    </details>
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
  <div class="ex-default-tasks ex-dt-list">${tasks.map((task) => taskForm(task, { current: defaults[task.name] || null, ...(optionsByTask[task.name] || {}) })).join('')}</div>
</div>`;
}

module.exports = { defaultsPage };
