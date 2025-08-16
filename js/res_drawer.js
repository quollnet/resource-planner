/* --------------------------------------------------------------------------
 * res_drawer.js – Right‑side off‑canvas with per‑resource analytics
 * --------------------------------------------------------------------------
 * Exports
 *   • ensureResDrawer(plan)  – injects the Bootstrap off‑canvas skeleton once
 *   • showResDrawer(resId, plan) – opens the drawer populated for that resource
 *
 * Drop this file in your /js folder and **import** it in app.js:
 *   import { ensureResDrawer, showResDrawer } from './res_drawer.js';
 *   ensureResDrawer();                 // after theme init, before renderAll()
 *
 *   // Inside initResourceTable() click‑handler add:
 *   if (e.detail === 2 && !e.target.closest('.row-actions'))  // double‑click blank area
 *       showResDrawer(tr.dataset.id, plan);
 * -------------------------------------------------------------------------- */

import { $, $$ } from './ui.js';
import { buildDailyUsage, buildDailyUsageFrom } from './analytics.js';
import { getResourceHireWindow, workingHours } from './utils.js';

const HOURS_PER_DAY = 8;

/* ---------- Metrics helpers ------------------------------------------------ */
function todayISO () { return new Date().toISOString(); }
function getAllocs (plan, id) { return plan.allocations.filter(a => a.resource_id === id); }
function daysBetween (d1, d2) { return Math.max(1, (d2 - d1) / 86_400_000 + 1); }

export function resCostMetrics (plan, id, today = todayISO()) {
  const now = new Date(today);
  let actual = 0, actualBase = 0, future = 0, futureBase = 0;

  const split = (cost, start, end) => {
    if (cost === 0) return [0, 0];
    const s = new Date(start);
    const e = end ? new Date(end) : null;

    // Entirely in the future
    if (now < s) return [0, cost];
    // Milestone or already finished before today
    if (!e || now >= e) return [cost, 0];

    // In‑progress: apportion linearly by elapsed duration
    const durMs   = e - s;
    const pastMs  = now - s;
    const ratio   = durMs > 0 ? Math.min(1, pastMs / durMs) : 1;
    return [cost * ratio, cost * (1 - ratio)];
  };

  getAllocs(plan, id).forEach(a => {
    const [pastCost, futureCost] = split(a.cost ?? 0, a.start, a.end);
    const [pastBase, futureBaseCost] = split(a.baseline_cost ?? 0, a.baseline_start ?? a.start, a.baseline_end ?? a.end);

    actual      += pastCost;
    actualBase  += pastBase;
    future      += futureCost;
    futureBase  += futureBaseCost;
  });

  return {
    actual, actualBase,
    variance: actual - actualBase,
    future,  futureBase,
    futVar : future - futureBase
  };
}

function sumWorkingHours(start, end){
  let hrs = 0;
  const d = new Date(start);
  const last = new Date(end);
  d.setUTCHours(0,0,0,0);
  last.setUTCHours(0,0,0,0);
  while (d <= last){
    hrs += workingHours(d);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return hrs;
}


function resScheduleMetrics(plan, id, todayIso = new Date().toISOString()) {
  const now = new Date(todayIso);
  const m = {
    startLate:0, startEarly:0, finishLate:0, finishEarly:0,
    willStartLate:0, willStartEarly:0, willFinishLate:0, willFinishEarly:0
  };

  plan.allocations
    .filter(a => a.resource_id === id)
    .forEach(a => {
      const s  = new Date(a.start);
      const e  = a.end ? new Date(a.end) : null;
      const bs = a.baseline_start ? new Date(a.baseline_start) : null;
      const be = a.baseline_end   ? new Date(a.baseline_end)   : null;

      const started  = s < now;
      const finished = e && e < now;

      // ---- starts ----
      if (bs) {
        if (started) {
          if (s > bs) m.startLate++;
          else if (s < bs) m.startEarly++;
        } else {
          // in the future
          if (s > bs) m.willStartLate++;
          else if (s < bs) m.willStartEarly++;
        }
      }

      // ---- finishes ----
      if (be && e) {
        if (finished) {
          if (e > be) m.finishLate++;
          else if (e < be) m.finishEarly++;
        } else {
          // in the future (either not started yet or in‑progress)
          if (e > be) m.willFinishLate++;
          else if (e < be) m.willFinishEarly++;
        }
      }
    });

  return m;
}


export function resUtilMetrics (plan, id) {
  // Daily usage is already clamped to hire windows in analytics.js
  const daily = buildDailyUsage(plan).filter(r => r.resource_id === id);

  // If the resource never appears in daily usage, treat as 0 utilisation
  if (!daily.length) {
    return { utilAllPct: 0, utilSpanPct: 0, otAll: 0, otSpan: 0 };
  }

  // Capacity = sum of working hours across the resource's hire→release
  const res = plan.resources.find(r => r.id === id);
  const { start: hStart, end: hEnd } = getResourceHireWindow(plan, res);

  const capHrs = sumWorkingHours(hStart, hEnd);

  // Used hours = sum over days: workingHours(day) * (pct/100)
  let usedHrs = 0;
  let otHrs   = 0; // overtime: where pct > 100
  daily.forEach(r => {
    const day = new Date(r.day);     // YYYY-MM-DD from analytics
    const wh  = workingHours(day);
    usedHrs  += wh * (r.pct / 100);
    if (r.pct > 100) otHrs += wh * ((r.pct - 100) / 100);
  });

  const utilHirePct = capHrs > 0 ? (usedHrs / capHrs) * 100 : 0;

  // For backward compatibility with existing UI rendering:
  return {
    utilAllPct: +utilHirePct.toFixed(1),  // ← now “hire-window utilisation”
    utilSpanPct: +utilHirePct.toFixed(1), // keep both fields aligned to hire window
    otAll: +otHrs.toFixed(1),
    otSpan: +otHrs.toFixed(1)
  };
}

function collectMetrics (plan, id) {
  const res = plan.resources.find(r => r.id === id) || { name:id, class:'', cost_per_hour:0 };
  const m = {
    id,
    name : res.name,
    class: res.class,
    rate : res.cost_per_hour,
    cost : resCostMetrics(plan, id),
    sch  : resScheduleMetrics(plan, id),
    util : resUtilMetrics(plan, id)
  };
  return m;
}

/* ---------- Off‑canvas skeleton ------------------------------------------------ */
export function ensureResDrawer(){
  if (document.getElementById('resDrawer')) return;
  const html = `
    <div class="offcanvas offcanvas-end" tabindex="-1" id="resDrawer">
      <div class="offcanvas-header">
        <h5 id="resDrawerLabel" class="offcanvas-title">Resource</h5>
        <button type="button" class="btn-close" data-bs-dismiss="offcanvas"></button>
      </div>
      <div class="offcanvas-body small" id="resDrawerBody">
        <!-- filled dynamically -->
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

/* ---------- HTML builder ------------------------------------------------------ */
function badge (val, goodWhenNegative=false){
  const good = goodWhenNegative ? val <= 0 : val >= 0;
  const cls  = good ? 'bg-success' : 'bg-danger';
  const sign = val > 0 ? '+':'−';
  return `<span class="badge ${cls}">${sign}${Math.abs(val).toFixed(0)}</span>`;
}

function makeOverviewHTML (m){
  /* --- hero --- */
  const hero = `
    <div class="mb-3">
      <h4 class="mb-1">${m.name}</h4>
      <span class="badge bg-secondary">${m.class||'–'}</span>
      <span class="ms-2 text-muted">$${m.rate}/hr</span>
    </div>`;

  /* --- Financial snapshot --- */
  const f = m.cost;
  const fin = `
    <h6 class="mt-4">Financial Snapshot</h6>
    <div class="d-flex flex-wrap gap-2">
      <div class="card p-2 flex-fill text-center">
        <small>Spent</small><div class="fs-5">$${f.actual.toFixed(0)}</div>
        <small class="text-muted">vs $${f.actualBase.toFixed(0)}</small>
        ${badge(f.variance, true)}
      </div>
      <div class="card p-2 flex-fill text-center">
        <small>Future</small><div class="fs-5">$${f.future.toFixed(0)}</div>
        <small class="text-muted">vs $${f.futureBase.toFixed(0)}</small>
        ${badge(f.futVar, true)}
      </div>
    </div>`;

  /* --- Schedule insights --- */
  const s = m.sch;
  const sched = `
    <h6 class="mt-4">Schedule Insights</h6>
    <div class="d-grid gap-1" style="grid-template-columns: repeat(4,1fr)">
      <span class="badge bg-danger-subtle text-danger">SL ${s.startLate}</span>
      <span class="badge bg-success-subtle text-success">SE ${s.startEarly}</span>
      <span class="badge bg-danger-subtle text-danger">FL ${s.finishLate}</span>
      <span class="badge bg-success-subtle text-success">FE ${s.finishEarly}</span>
      <span class="badge bg-warning-subtle text-warning">WSL ${s.willStartLate}</span>
      <span class="badge bg-info-subtle text-info">WSE ${s.willStartEarly}</span>
      <span class="badge bg-warning-subtle text-warning">WFL ${s.willFinishLate}</span>
      <span class="badge bg-info-subtle text-info">WFE ${s.willFinishEarly}</span>
    </div>
    <small class="text-muted d-block mt-1 lh-sm">SL = started late, FE = finished early, WSE: will start early, etc.</small>`;

  /* --- Utilisation --- */
  const u = m.util;
  const util = `
    <h6 class="mt-4">Capacity Utilisation</h6>
    <div class="progress mb-1" role="progressbar" aria-label="Overall utilisation" aria-valuenow="${u.utilAllPct.toFixed(0)}" aria-valuemin="0" aria-valuemax="100">
      <div class="progress-bar bg-primary" style="width:${u.utilAllPct.toFixed(0)}%"></div>
    </div>
    <small class="d-block mb-2">Across full planner window</small>
    <div class="progress mb-1" role="progressbar" aria-label="Resource span utilisation" aria-valuenow="${u.utilSpanPct.toFixed(0)}" aria-valuemin="0" aria-valuemax="100">
      <div class="progress-bar bg-primary" style="width:${u.utilSpanPct.toFixed(0)}%"></div>
    </div>
    <small class="d-block">Across resource’s own active span</small>
    <p class="mt-2 mb-0"><small>Over‑time (all): ${u.otAll.toFixed(1)} h &nbsp;|&nbsp; Over‑time (span): ${u.otSpan.toFixed(1)} h</small></p>`;

  return hero + fin + sched + util;
}

/* ---------- Public open ------------------------------------------------------ */
export function showResDrawer (resId){
  ensureResDrawer();
  const plan = window.plan ?? window.currentPlan; // fallbacks – make sure you expose the current plan globally
  if (!plan) { console.warn('No global plan found'); return; }
  const m = collectMetrics(plan, resId);  // always fresh, no cache

  // fill UI
  $('#resDrawerLabel').textContent = m.name;
  $('#resDrawerBody').innerHTML    = makeOverviewHTML(m);
  bootstrap.Offcanvas.getOrCreateInstance('#resDrawer').show();
}
