// resource_modal.js
import { $, $$ } from './ui.js';
import { isoToInputDate } from './utils.js';

let _plan = null;
let _res  = null;
let _modal = null;

// Public API (optional export if you want)
export function openResourceModal(resource, plan) {
  _plan = plan; _res = resource;
  ensureModal();
  fillHeader(resource);
  fillOverview(resource);
  fillKpis(resource, plan);
  fillAllocations(resource, plan);
  hookButtons(resource, plan);
  _modal.show();
}

function ensureModal() {
  const el = $('#resourceModal');
  if (!el) return console.error('Resource modal element not found');
  _modal = _modal || new bootstrap.Modal(el);
}

function fillHeader(r) {
  $('#resourceModalLabel').textContent = r.name || '—';
  $('#res-class').textContent = r.class || 'Unclassified';
  $('#res-cost').textContent  = r.cost_per_hour != null ? `(${Number(r.cost_per_hour).toFixed(2)} / hr)` : '';
  const start = r.start ? isoToInputDate(r.start) : '—';
  const end   = r.end   ? isoToInputDate(r.end)   : '—';
  $('#res-period').textContent = `${start} → ${end}`;
  $('#res-id').textContent = `ID: ${r.id}`;
  $('#res-avatar-initials').textContent = (r.name || 'R').trim().slice(0,2).toUpperCase();
}

function fillOverview(r) {
  $('#res-desc').textContent  = r.description || '—';
  $('#res-start').textContent = r.start ? isoToInputDate(r.start) : '—';
  $('#res-end').textContent   = r.end   ? isoToInputDate(r.end)   : '—';
  // Notes placeholder (wire to your notes model if available)
  $('#res-notes').textContent = r.notes || 'No notes.';
}

function fillKpis(r, plan) {
  // Safe placeholders; replace with your real analytics if desired
  $('#kpi-rate').textContent = r.cost_per_hour != null ? Number(r.cost_per_hour).toFixed(2) : '—';

  // Basic allocated/capacity hours demo (non-blocking, schema-agnostic):
  const allocs = (plan.allocations || []).filter(a => a.resource_id === r.id);
  const allocHrs = allocs.reduce((sum, a) => sum + (Number(a.hours || a.total_hours || 0)), 0);
  $('#kpi-alloc-hrs').textContent = allocHrs ? allocHrs.toFixed(1) : '—';

  const capHrs = Number(r.capacity_hours || 0); // if you track this; else leave blank
  $('#kpi-cap-hrs').textContent = capHrs ? capHrs.toFixed(1) : '—';

  let util = '—';
  if (capHrs > 0) util = Math.round((allocHrs / capHrs) * 100) + '%';
  $('#kpi-util').textContent = util;
}

function fillAllocations(r, plan) {
  const tbody = $('#res-allocs');
  tbody.innerHTML = '';
  const rows = (plan.allocations || []).filter(a => a.resource_id === r.id);

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="3" class="text-muted">No allocations.</td></tr>`;
    return;
  }

  rows.forEach(a => {
    const s = a.start ? isoToInputDate(a.start) : '—';
    const e = a.end   ? isoToInputDate(a.end)   : '—';
    const label = a.name || a.title || a.task || `Allocation`;
    const note  = a.note || a.comment || '';
    tbody.insertAdjacentHTML('beforeend', `
      <tr>
        <td>${label}</td>
        <td class="text-nowrap">${s} &rarr; ${e}</td>
        <td class="text-end text-muted small">${note}</td>
      </tr>
    `);
  });
}

function hookButtons(r, plan) {
  const bind = (sel, fn) => { const el = $(sel); if (el) { el.onclick = (e)=>{ e.preventDefault(); fn(); }; } };

  bind('#res-btn-allocate', () => {
    document.dispatchEvent(new CustomEvent('resource:allocate', { detail: { resource: r, resourceId: r.id } }));
  });
  bind('#res-btn-allocate-2', () => {
    document.dispatchEvent(new CustomEvent('resource:allocate', { detail: { resource: r, resourceId: r.id } }));
  });

  bind('#res-btn-edit', () => {
    document.dispatchEvent(new CustomEvent('resource:edit', { detail: { resource: r } }));
  });
  bind('#res-btn-edit-2', () => {
    document.dispatchEvent(new CustomEvent('resource:edit', { detail: { resource: r } }));
  });

  bind('#res-btn-delete', () => {
    document.dispatchEvent(new CustomEvent('resource:delete', { detail: { resource: r } }));
  });
}

// Listen to generic open events from anywhere in the app
document.addEventListener('resource:view', (e) => {
  const { resource, plan } = e.detail || {};
  if (!resource || !plan) return;
  openResourceModal(resource, plan);
});
