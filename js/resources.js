import { $, $$ } from './ui.js';
import { isoToInputDate } from './utils.js';
let _planCache = null;
export function renderResources(plan, onEdit, onDelete) {
  _planCache = plan;
  const tbody = $('#tbl-resources tbody'); tbody.innerHTML = '';
  plan.resources.forEach(r => {
    tbody.insertAdjacentHTML('beforeend', `
      <tr data-id="${r.id}">
        <td> 
          <div class="resource-name">${r.name}</div>
          <div class="small text-muted d-md-none">${r.class || ''} - (${r.cost_per_hour.toFixed(2) || ''})</div>
        </td>
        <td class="d-none d-md-table-cell">${r.class || ''}</td>
        <td class="d-none d-md-table-cell text-muted small">${r.description || ''}</td>

        <td class="d-none d-md-table-cell text-end">
          ${r.cost_per_hour ? `$${r.cost_per_hour.toFixed(2)}` : ''}
        </td>

        <!-- NEW: hired period -->
        <td class="d-md-table-cell position-relative" style="font-size: .75rem;">
        <div class="row-actions d-none position-absolute top-50 end-0 translate-middle-y">
            <button class="btn btn-success btn-sm me-1 btn-alloc" title="Allocate">
              ⧉
            </button>
            <button class="btn btn-secondary btn-sm me-1 btn-edit" title="Edit">✎</button>
            <button class="btn btn-danger btn-sm btn-del" title="Delete">✕</button>
        </div>
        ${r.start ? isoToInputDate(r.start) : ''} → ${r.end ? isoToInputDate(r.end) : ''}</td>
      
        </tr>`);
  });
}

