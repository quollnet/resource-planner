/* resources.js – resource CRUD & table rendering */
import { $, $$ } from './ui.js';

export function renderResources(plan, onEdit, onDelete) {
  const tbody = $('#tbl-resources tbody'); tbody.innerHTML = '';
  plan.resources.forEach(r => {
    tbody.insertAdjacentHTML('beforeend', `
      <tr data-id="${r.id}">
        <td> 
          <div class="fw-semibold">${r.name}</div>
          <div class="small text-muted d-md-none">${r.class || ''}</div>
        </td>
        <td class="d-none d-md-table-cell">${r.class || ''}</td>
        <td class="d-none d-md-table-cell">${r.description || ''}</td>

        <td class="position-relative">
          <div class="row-actions d-none position-absolute top-50 end-0 translate-middle-y">
            <button class="btn btn-success btn-sm me-1 btn-alloc" title="Allocate">⨁</button>
            <button class="btn btn-secondary btn-sm me-1 btn-edit" title="Edit">✎</button>
            <button class="btn btn-danger btn-sm btn-del" title="Delete">✕</button>
          </div>
${r.cost_per_hour.toFixed(2)}
        </td>
      </tr>`);
  });
}
