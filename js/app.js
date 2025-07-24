import { $, $$, toggleTheme, initTheme, refreshNumbers, showConfirm } from './ui.js';
import { STORAGE_KEY, loadJSON, saveJSON, downloadPlan, openFile } from './storage.js';
import { renderResources } from './resources.js';
import { initTimeline, refreshTimeline,
        redraw , timeline, buildContent } from './timeline.js';
import { hasClash, populateResourcePicker, calcCost } from './allocations.js';
import { isBox } from './allocations.js';  
import { showAlert } from './ui.js';
import { refreshKpis } from './kpi_bar_drawer.js';
import { initCrypto } from './utils.js';
import { ensureResDrawer, showResDrawer } from './res_drawer.js';

/* ---------- boot ---------- */
initCrypto();  // initialize crypto for UUIDs

initTheme();
ensureResDrawer();  // ensure the resource drawer is initialized


$('#btn-theme').onclick = toggleTheme;

let plan = loadJSON(STORAGE_KEY) || { meta:{planner_name:'Untitled'}, resources:[], allocations:[] };
window.plan = plan;  // expose to console

/* ---------- planner-name helpers ---------- */
function renderPlannerName(){
  $('#planner-display').textContent = plan.meta.planner_name || 'Untitled';
}

$('#btn-edit-name').onclick = () => {
  $('#planner-input').value = plan.meta.planner_name || '';
  bootstrap.Modal.getOrCreateInstance('#modal-planner').show();
};

$('#modal-planner form').onsubmit = e => {
  e.preventDefault();
  plan.meta.planner_name = $('#planner-input').value.trim() || 'Untitled';
  saveAndRender();                                           // persist + redraw header
  bootstrap.Modal.getInstance('#modal-planner').hide();
};


let selectedAllocId = null;  // for timeline selection

// ---- timeline boot ----
function handleSelect (evt) {                // single select handler
  selectedAllocId = evt.items[0] || null;
  $('#btn-edit-alloc').disabled = !selectedAllocId;
  $('#btn-del-alloc').disabled  = !selectedAllocId;
}

$('#btn-del-alloc').onclick = async () => {
  if (!selectedAllocId) return;
  if (!await showConfirm("Are you sure you want to delete this allocation?", 'btn-danger')) return;
  plan.allocations = plan.allocations.filter(a => a.id !== selectedAllocId);
  selectedAllocId  = null;
  saveAndRender();                 // redraw tables & timeline
  $('#btn-edit-alloc').disabled = $('#btn-del-alloc').disabled = true;
};

const sets = initTimeline(
  $('#timeline'),        // container
  handleSelect           // onSelect  – keeps the button in sync
);
const {items} = sets;

/**
 * Create a 1-day “box” allocation at the given spot and open the modal.
 * @param {Object} props  vis-timeline event props
 */
export function quickAddBox(props) {
  if (props.what !== 'background') return;     // only blank space
  const resId = props.group;
  if (!resId) return; // clicked in empty margin

  const startIso = props.time.toISOString();
  const alloc = {
    id: crypto.randomUUID().slice(0, 8),
    resource_id: resId,
    task: '(new)',
    notes: '',
    start: startIso,
    end: null, // ← box!
    allocation_pct: 100,
    baseline_start: startIso,
    baseline_end: null,
    cost: 0
  };

  /* 1 – store in plan */
  plan.allocations.push(alloc);

  /* 2 – draw immediately */
  items.add([
    { id: alloc.id,        group: resId, start: alloc.start,
      content: buildContent(alloc), title: alloc.task, className:'allocation' },
    { id: alloc.id + '_bl', group: resId, start: alloc.baseline_start,
      type:'point', className:'baseline point' }
  ]);

  /* 3 – let user edit */
  openAllocModal(alloc);
}


timeline.on('contextmenu', props => {
  if (!props.item) return;                          // ignore empty space
    const ev = props.event;            // vis wrapper
  ev.preventDefault();
  ev.stopPropagation();

  // ⬇ ALSO kill its original DOM event if present
  if (ev.srcEvent) {                 // Hammer / PointerEvent wrapper
    ev.srcEvent.preventDefault();
    ev.srcEvent.stopPropagation();
  }
  const alloc = plan.allocations.find(a => a.id === props.item);
  if (alloc) openAllocModal(alloc);
});

timeline.on('doubleClick', quickAddBox); // add box on double-click

timeline.on('hold', quickAddBox);   

timeline.on('click', props => {
  console.log('timeline click', props);
  if (props.what !== 'group-label') return; // only labels
  const resId = props.group;
  if (!resId) return; // clicked in empty margin
  showResDrawer(resId);
});

renderAll();

sets.items.on('update', (event, props) => {
  const ids = props.items
  let changed = false;

  ids.forEach(id => {
    const visItem = sets.items.get(id);                 // new pos
    const alloc = plan.allocations.find(a => a.id === id);
    if (!alloc) return;                                 // safety

    // OPTIONAL clash check here if you still want it
    // if (hasClash(plan, visItem.group, visItem.start, visItem.end, id)) return;

    alloc.resource_id = visItem.group;
    alloc.start = visItem.start.toISOString();
    alloc.end = visItem.end ? visItem.end.toISOString() : null;
    alloc.cost = calcCost(alloc, plan);
    changed = true;
  });

  if (changed) {
    saveJSON(STORAGE_KEY, plan);
      refreshKpis(plan);             // << update KPI bar
    refreshTimeline(plan, sets);
  }            // no redraw needed
});

/* ---------- navbar ---------- */
$('#btn-new').onclick  = async () => { 
  if (await showConfirm('Starting a new planner will reset the current one. Are you sure?', 'btn-danger')) {
    plan={meta:{planner_name:'Untitled'},resources:[],allocations:[]}; renderAll(); 
  }
};
$('#btn-save').onclick = ()=>downloadPlan(plan);
$('#btn-open').onclick = ()=>$('#file-input').click();
$('#file-input').addEventListener('change', e=>openFile(e.target, p=>{ plan=p; renderAll(); }));
$('#btn-edit-alloc').addEventListener('click', () => {
  if (!selectedAllocId) return;                     // shouldn’t happen (button disabled)
  const alloc = plan.allocations.find(a => a.id === selectedAllocId);
  if (alloc) openAllocModal(alloc);                // reuse your existing modal-fill function
});

/* ---------- resource modal (add/edit) ---------- */
let editingResId=null;
$('#btn-add-resource').onclick=()=>{editingResId=null; clearResForm(); bootstrap.Modal.getOrCreateInstance('#modal-resource').show();};


$('#modal-resource form').onsubmit=e=>{
  e.preventDefault();
  const obj = {
  name: $('#res-name').value.trim(),
  class: $('#res-class').value.trim(),
  description: $('#res-desc').value.trim(),
  cost_per_hour: +$('#res-cost').value || 0
  };
  if(!obj.name) return;

  if(editingResId){
    Object.assign(plan.resources.find(r=>r.id===editingResId), obj);
  }else{
    obj.id=crypto.randomUUID().slice(0, 8); plan.resources.push(obj);
  }
  saveAndRender(); bootstrap.Modal.getInstance('#modal-resource').hide();
};

function openResModal(id){ editingResId=id; const r=plan.resources.find(x=>x.id===id);
  $('#res-name').value=r.name; $('#res-class').value=r.class; $('#res-desc').value=r.description||'';
  $('#res-cost').value = r.cost_per_hour ?? 0;
  bootstrap.Modal.getOrCreateInstance('#modal-resource').show();
}
function removeRes(id){ showConfirm('Delete resource?', 'btn-danger').then((confirmed) => {
    if (confirmed) {
      plan.resources = plan.resources.filter(r => r.id !== id);
      plan.allocations = plan.allocations.filter(a => a.resource_id !== id);
      saveAndRender();
    }
  });
}

function clearResForm(){ 
  $('#res-name').value=$('#res-class').value=$('#res-desc').value=$('#res-cost').value='';
}

export function toLocal(iso){
  return iso ? iso.slice(0, 10) : '';          // YYYY-MM-DD
}

export function fromLocal(dateStr){
  return dateStr ? new Date(dateStr + 'T00:00:00Z').toISOString() : null;
}

export function initResourceTable() {
  const tbody      = $('#tbl-resources tbody');
  const rows       = () => tbody.querySelectorAll('tr');
  let   activeRow  = null;

  tbody.onclick = e => {
    const tr = e.target.closest('tr');
    if (!tr) return;                         // click outside rows

    /* ------- EDIT / DELETE /ALLOCATE buttons ------- */
    if (e.target.matches('.btn-alloc')) {
      newAllocForResource(tr.dataset.id);     // open allocation modal for this resource
      return;
    }
    if (e.target.matches('.btn-edit')) {
      openResModal(tr.dataset.id);
      return;
    }
    if (e.target.matches('.btn-del')) {
      removeRes(tr.dataset.id);
      renderAll();                           // table re-renders ⇒ bindings stay
      return;
    }

    /* ------- plain row click: toggle visibility ------- */
    if (activeRow && activeRow !== tr) {
      activeRow.querySelector('.row-actions').classList.add('d-none');
      activeRow.classList.remove('table-active');
    }
    activeRow = tr;
    tr.classList.toggle('table-active');
    tr.querySelector('.row-actions').classList.toggle('d-none');
  };

  tbody.ondblclick = e => {
  const tr = e.target.closest('tr');
  if (tr && !e.target.closest('.row-actions'))
    showResDrawer(tr.dataset.id);
};
}

// /* ---------- Live Cost display ---------- */
// Replaced by refreshNumbers() in ui.js
// ['#alloc-res','#alloc-start','#alloc-end','#alloc-pct'].forEach(sel =>
//   $(sel).addEventListener('input', updateCostDisplay));

// function updateCostDisplay(){
//   const tmp = {
//     resource_id: $('#alloc-res').value,
//     start: fromLocal($('#alloc-start').value),
//     end: fromLocal($('#alloc-end').value),
//     allocation_pct: +$('#alloc-pct').value || 0
//   };
//   $('#alloc-cost').textContent = calcCost(tmp, plan).toFixed(2);
// }

/* ---------- allocation modal (add/edit) ---------- */
let editingAllocId=null;

// start a **new** allocation with a given resource pre-selected
function newAllocForResource(resId) {
  editingAllocId = null;                      // “create” mode
  populateResourcePicker($('#alloc-res'), plan, resId);   // pick & pre-select
  clearAllocForm();                           // blank dates / notes / pct
  bootstrap.Modal.getOrCreateInstance('#modal-allocation').show();
}

function syncHiddenFields([start, end]) {
  $('#alloc-start').value = start ? start.toISOString() : '';
  $('#alloc-end').value = end ? end.toISOString() : '';
}

$('#btn-add-allocation').onclick=()=>{
  if(!plan.resources.length) return showAlert('Add resource first');
  editingAllocId=null; populateResourcePicker($('#alloc-res'), plan);
  clearAllocForm(); bootstrap.Modal.getOrCreateInstance('#modal-allocation').show();
};

$('#btn-reset-baseline').onclick = () => {
  if (!editingAllocId) return;
  const a = plan.allocations.find(x => x.id === editingAllocId);
  a.baseline_start = a.start;
  a.baseline_end   = isBox(a) ? null : a.end;
  a.baseline_cost = a.cost;          // keep cost in sync
  saveJSON(STORAGE_KEY, plan);
  $('#alloc-bl-start').value = toLocal(a.baseline_start);
  $('#alloc-bl-end').value   = toLocal(a.baseline_end);
  timeline.redraw();                    // grey bar will move (added in item 3)
};

// on submit, save allocation
$('#modal-allocation form').onsubmit=e=>{
  console.log('submit allocation');
  e.preventDefault();

  const obj = {
    resource_id: $('#alloc-res').value,
    start: fromLocal($('#alloc-start').value),
    end: fromLocal($('#alloc-end').value) || null,
    allocation_pct: +$('#alloc-pct').value || 100,
    task: $('#alloc-notes').value.trim(),
    // task: $('#alloc-title').value.trim() || '(task)'
  };

  if (!obj.start) return showAlert('Start date is required.');
  if (obj.end && obj.start >= obj.end) return showAlert('End must be after start.');

  if ('notes' in (editingAllocId ? plan.allocations.find(a => a.id === editingAllocId) : {})) {
    obj.notes = obj.task;                                    // backward compatibility
  }

  // ---------- baseline & cost ----------
  obj.baseline_start ??= obj.start;          // set only on first save
  obj.baseline_end ??= obj.end;
  obj.cost = calcCost(obj, plan);
  obj.baseline_cost  ??= obj.cost;
  // ---------- validation ----------
  if (obj.end && obj.start >= obj.end)             // keep only basic sanity check
      return showAlert('End must be after start.');

  if(editingAllocId){
    Object.assign(plan.allocations.find(a=>a.id===editingAllocId), obj);
  }else{
    obj.baseline_start = obj.start;
    obj.baseline_end   = obj.end;           // may be null (baseline box)
    obj.id=crypto.randomUUID().slice(0, 8); plan.allocations.push(obj);
  }
  obj.cost = calcCost(obj, plan);
  saveAndRender(); bootstrap.Modal.getInstance('#modal-allocation').hide();
};

export function openAllocModal(a) {
  editingAllocId = a.id;
  populateResourcePicker($('#alloc-res'), plan, a.resource_id);
  $('#alloc-start').value = toLocal(a.start);
  $('#alloc-end').value   = a?.end ? toLocal(a.end) : '';
  // rangePicker.setDate([new Date(a.start), new Date(a.end)], true); // update flatpickr
  $('#alloc-pct').value = a.allocation_pct;
  $('#alloc-notes').value = a.task;
  $('#alloc-bl-start').value = toLocal(a?.baseline_start) || '';
  $('#alloc-bl-end').value   = toLocal(a?.baseline_end)   || '';
  $('#bl-row').classList.toggle('d-none', !a);          // hide if new
  $('#btn-reset-baseline').disabled = !a;
  $('#alloc-cost').textContent = a ? a.cost.toFixed(2) : '0.00';
  refreshNumbers();  // update cost & duration pill
  bootstrap.Modal.getOrCreateInstance('#modal-allocation').show();
}

function clearAllocForm(){ 
  $('#alloc-start').value = $('#alloc-end').value = '';
  $('#alloc-pct').value=100; $('#alloc-notes').value=''; 
  $('#alloc-bl-start').value = $('#alloc-bl-end').value = '';


}

/* ---------- helpers ---------- */
function saveAndRender(){ saveJSON(STORAGE_KEY, plan); renderAll(); }
function renderAll(){
  renderPlannerName();
  renderResources(plan, openResModal, removeRes);
  initResourceTable();
  refreshTimeline(plan, sets);
  refreshKpis(plan);  // update KPI bar
}
