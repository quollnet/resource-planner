/* ui.js – thematic toggles, global DOM helpers */
import { calcCost, durationDays, isBox } from './allocations.js';
import { startIso, endIso } from './app.js';

export const $  = (sel, root=document) => root.querySelector(sel);
export const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];

export function setTheme(theme) {
  document.documentElement.dataset.bsTheme = theme;
  localStorage.setItem('planner.theme', theme);
}

export function initTheme() {
  const stored = localStorage.getItem('planner.theme');
  const prefersDark = matchMedia('(prefers-color-scheme:dark)').matches;
  setTheme(stored || (prefersDark ? 'dark' : 'light'));
}

export function toggleTheme() {
  setTheme(document.documentElement.dataset.bsTheme === 'light' ? 'dark' : 'light');
}

['alloc-start','alloc-end','alloc-pct','alloc-res']
  .forEach(id => document.getElementById(id).addEventListener('input', refreshNumbers));

export function refreshNumbers(){
  const tmp = {
    resource_id: $('#alloc-res').value || (window.plan.resources[0]?.id ?? ''),
    start: startIso($('#alloc-start').value),
    end:   endIso($('#alloc-end').value) || null,
    allocation_pct: +$('#alloc-pct').value || 0
  };

  // cost
  $('#alloc-cost').textContent = calcCost(tmp, window.plan).toFixed(2);

  // duration pill
  const pill = $('#alloc-dur-pill');
  if (isBox(tmp)){
    pill.classList.add('d-none');
  } else {
    pill.textContent = `${durationDays(tmp)} d`;
    pill.classList.remove('d-none');
  }
}

export function showAlert(message) {
  return new Promise((resolve) => {
    const modal = new bootstrap.Modal(document.getElementById('app-modal'));
    document.getElementById('app-modal-title').textContent = 'Alert';
    document.getElementById('app-modal-body').textContent = message;
    document.getElementById('app-modal-cancel').style.display = 'none';
    const okButton = document.getElementById('app-modal-ok');
    okButton.textContent = 'OK';
    okButton.className = 'btn btn-primary me-1';
    okButton.onclick = () => {
      modal.hide();
      resolve();
    };
    modal.show();
  });
}

export function showConfirm(message, bsClass='btn-primary') {
  return new Promise((resolve) => {
    const modal = new bootstrap.Modal(document.getElementById('app-modal'));
    document.getElementById('app-modal-title').textContent = 'Confirm';
    document.getElementById('app-modal-body').textContent = message;
    document.getElementById('app-modal-cancel').style.display = 'inline-block';
    const okButton = document.getElementById('app-modal-ok');
    okButton.textContent = 'OK';
    okButton.className = `btn ${bsClass} me-1`;
    okButton.onclick = () => {
      modal.hide();
      resolve(true);
    };
    const cancelButton = document.getElementById('app-modal-cancel');
    cancelButton.onclick = () => {
      modal.hide();
      resolve(false);
    };
    modal.show();
  });
}
