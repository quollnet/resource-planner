/* storage.js – persistence helpers */
import { showAlert } from './ui.js';

export const STORAGE_KEY = 'planner.v1';
export const THEME_KEY   = 'planner.theme';

export function loadJSON(key){
  try{
    const v = localStorage.getItem(key);
    if(!v) return null;
    const p = JSON.parse(v);
    migratePlan(p);
    sanitizePlan(p);          // ⬅ NEW
    return p;
  }catch{ return null; }
}

function migratePlan(plan){
  // resources → add cost_per_hour = 0 if missing
  plan.resources?.forEach(r => { if (r.cost_per_hour == null) r.cost_per_hour = 0; });

  // allocations → add baseline_start & cost if missing
  //    - we **do NOT** touch `end` or `baseline_end` any more,
  //      so a start-only record can stay a “box”.
  plan.allocations?.forEach(a => {
    a.baseline_start ??= a.start;
    if (a.cost == null) a.cost = 0;
  });
  plan.allocations.forEach(a=>{
  if(a.cost && a.baseline_cost==null) a.baseline_cost = a.cost;
  });
  plan.meta.version = '1.2';
}

function sanitizePlan(plan){
  const before = plan.allocations?.length || 0;

  plan.allocations = (plan.allocations || []).filter(a =>
    a && a.start && typeof a.start === 'string' && a.start.length >= 10);

  // Optional: warn the user once per load
  const removed = before - plan.allocations.length;
  if (removed > 0) showAlert(`${removed} corrupted allocations were removed while loading.`);
}


export function saveJSON(key, obj) {
  localStorage.setItem(key, JSON.stringify(obj));
}

export function downloadPlan(plan) {
  const blob = new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url, download: (plan.meta.planner_name || 'planner') + '.json'
  });
  a.click(); URL.revokeObjectURL(url);
}

export function openFile(inputEl, onLoad) {
  const file = inputEl.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = e => {
    try {
      const p = JSON.parse(e.target.result);
      migratePlan(p);        // ⬅ ensures v1.0/1.1 files work & boxes allowed
      sanitizePlan(p);       // ⬅ ensures no broken allocations
      saveJSON(STORAGE_KEY, p);     // persist the cleaned version
      onLoad(p);
    } catch (err) { showAlert(err.message); }
  };
  r.readAsText(file); inputEl.value = '';
}
