// kpi_bar_drawer.js – Bootstrap‑powered KPI bar + off‑canvas drawer
// Rewritten to use plan‑horizon based calculations
// – Average utilisation: share of capacity across ENTIRE plan window (includes quiet days)
// – Idle hours: (100 % − daily %) × hoursPerDay across horizon
//
// Usage: import { refreshKpis } from './kpi_bar_drawer.js'; refreshKpis(plan);
// Requires Bootstrap 5 JS, plus buildDailyUsage from analytics.js.

import { buildDailyUsage, buildDailyUsageFrom } from './analytics.js';
import { resCostMetrics } from './res_drawer.js';
import { $ } from './ui.js';

const HOURS_PER_DAY = 8;  // adjust if your org defines a different "full day"
const kpiCache = new WeakMap();

// only include resources that actually appear in any allocation
function getUsedResourceIds(plan) {
  return new Set(plan.allocations.map(a => a.resource_id));
}



/*****************************************************************************************
 * Public API
 *****************************************************************************************/
let currentPlan = null;

function kpiAvgUtil(dArr, days){
  const usedCount   = getUsedResourceIds(currentPlan).size || 1;
   const totalCapPct = usedCount * days * 100;
  return totalCapPct ? dArr.reduce((s,r)=>s+r.pct,0)/totalCapPct*100 : 0;
}
function kpiIdleRows(dArr, days){
  const usedResIds = getUsedResourceIds(currentPlan);
  const idle = new Map();
  // start each used resource fully idle
  usedResIds.forEach(id => idle.set(id, days * 100));
  dArr.forEach(r=>idle.set(r.resource_id, idle.get(r.resource_id)-r.pct));
  return Array.from(idle, ([id,pct])=>({
    resource_id:id,
    resource_name:plan.resources.find(x=>x.id===id)?.name||id,
    hours:+(pct/100*8).toFixed(1)
  }));
}

export function refreshKpis (plan){
  ensureKpiBar();
  currentPlan = plan;

  /* ---------- horizon ---------- */
  const starts = plan.allocations.map(a=>new Date(a.start));
  const ends   = plan.allocations.filter(a=>a.end).map(a=>new Date(a.end));
  const horizonStart = new Date(Math.min(...starts));
  const horizonEnd   = new Date(Math.max(...ends, horizonStart));
  const horizonDays  = Math.max(1, (horizonEnd-horizonStart)/86400000+1);

  const todayIso = new Date().toISOString().slice(0,10);
  const horizonDaysF = Math.max(1, (horizonEnd-new Date(todayIso))/86400000+1);

  /* ---------- daily tables ---------- */
  const dailyAll = buildDailyUsage(plan);
  const dailyFut = buildDailyUsageFrom(plan, todayIso);

  /* ---------- core KPIs ---------- */
  const utilAll   = kpiAvgUtil(dailyAll, horizonDays);
  const utilFut   = kpiAvgUtil(dailyFut, horizonDaysF);

  const idleRowsAll = kpiIdleRows(dailyAll, horizonDays);
  const idleRowsFut = kpiIdleRows(dailyFut, horizonDaysF);
  const idleAllTot  = idleRowsAll.reduce((s,r)=>s+r.hours,0);
  const idleFutTot  = idleRowsFut.reduce((s,r)=>s+r.hours,0);

  const overAll = new Set(dailyAll.filter(r=>r.pct>100).map(r=>r.resource_id));
  const overFut = new Set(dailyFut.filter(r=>r.pct>100).map(r=>r.resource_id));

  /* ---------- schedule & budget overrun ---------- */
  let delayDays=0, budgetD=0;
  plan.allocations.forEach(a=>{
    if(a.baseline_end && a.end && new Date(a.end)>new Date(a.baseline_end))
      delayDays += (new Date(a.end)-new Date(a.baseline_end))/86400000;
    if(a.baseline_cost!=null) budgetD += (a.cost - a.baseline_cost);
  });

  /* ---------- write to UI ---------- */
  $('#kpi-util .kpi-val').textContent  = utilAll.toFixed(0)+'%';
  $('#kpi-idle .kpi-val').textContent  = idleAllTot.toFixed(0);
  $('#kpi-over .kpi-val').textContent  = overAll.size;

  $('#kpi-utilF .kpi-val').textContent = utilFut.toFixed(0)+'%';
  $('#kpi-idleF .kpi-val').textContent = idleFutTot.toFixed(0);
  $('#kpi-overF .kpi-val').textContent = overFut.size;

  $('#kpi-delay .kpi-val').textContent  = delayDays.toFixed(1);
  $('#kpi-budget .kpi-val').textContent = '$'+budgetD.toFixed(0);

  // new: total current cost for cashflow
  const cfData = buildCashflowMetrics(plan, 'month');
  const totalCurrent = cfData.reduce((sum,d) => sum + d.current, 0);
  $('#kpi-cashflow .kpi-val').textContent = '$' + totalCurrent.toFixed(0);

  /* ---------- cache ---------- */
  kpiCache.set(plan,{
    dailyAll,  idleRowsAll,  overAll,  utilAll,
    dailyFut,  idleRowsFut,  overFut,  utilFut,
    delayDays, budgetD,
  });
}


/*****************************************************************************************
 * Drawer helper
 *****************************************************************************************/
function showDrawer(which){
  const c = kpiCache.get(currentPlan); if(!c) return;
  const body  = $('#kpiDrawerBody');
  const title = $('#kpiDrawerLabel');

  switch(which){
    case 'util':   title.textContent='Average utilisation (all)';   body.innerHTML = makeTable(groupAvg(c.dailyAll),'% Util',r=>r.pct.toFixed(1)+'%'); break;
    case 'idle':   title.textContent='Idle hours (all)';           body.innerHTML = makeTable(c.idleRowsAll,'Hours',r=>r.hours.toFixed(1)); break;
    case 'over':   title.textContent='Over-capacity resources (all)'; drawerOver(c.dailyAll,c.overAll); break;

    case 'utilF':  title.textContent='Average utilisation (future)'; body.innerHTML = makeTable(groupAvg(c.dailyFut),'% Util',r=>r.pct.toFixed(1)+'%'); break;
    case 'idleF':  title.textContent='Idle hours (future)';         body.innerHTML = makeTable(c.idleRowsFut,'Hours',r=>r.hours.toFixed(1)); break;
    case 'overF':  title.textContent='Over-capacity resources (future)'; drawerOver(c.dailyFut,c.overFut); break;

    case 'delay':  title.textContent='Schedule overrun';  body.innerHTML = `<p class="fs-4">${c.delayDays.toFixed(1)} days late</p>`; break;
    case 'budget':
      title.textContent = 'Budget Details';
      const rows = currentPlan.resources.map(r => {
        // Pull both actual & future costs, plus their baseline equivalents:
        const { actual, future, actualBase, futureBase } = resCostMetrics(currentPlan, r.id);
        // 1. Budget  = baseline (past + future)
        const budget    = actualBase + futureBase;
        // 2. Spent     = actual past portion
        const spent     = actual;
        // 3. Remaining = actual future portion
        const remaining = future;
        // 4. Variance = budget – (spent + remaining)
        const variance  = budget - (spent + remaining);
        return {
          resource_name: r.name, budget, spent, remaining, variance
        };
      });
      body.innerHTML = makeBudgetHeader(rows) + makeBudgetCards(rows)
  break;
    case 'cashflow':
      title.textContent = 'Cashflow Metrics';
      const data = buildCashflowMetrics(currentPlan, 'month');
      // totals display
      const totals = data.reduce((acc,d) => { acc.baseline+=d.baseline; acc.current+=d.current; return acc; }, {baseline:0,current:0});
      const totalsHtml = `<div class="d-flex justify-content-end mb-2" style="font-size:.9rem;"><div class="me-3"><strong>Base Total:</strong> $${totals.baseline.toFixed(0)}</div><div><strong>Current Total:</strong> $${totals.current.toFixed(0)}</div></div>`;
      const controls = makeCashflowControls('month');
      body.innerHTML = totalsHtml + controls + makeCashflowChart(data);
      // handlers
      body.querySelectorAll('[data-period]').forEach(btn => btn.addEventListener('click', () => showCashflowDrawer(currentPlan, btn.dataset.period)));
      break;
  }
  bootstrap.Offcanvas.getOrCreateInstance('#kpiDrawer').show();
}
function drawerOver(daily,set){
  const rows = groupAvg(daily.filter(r=>set.has(r.resource_id)));
  $('#kpiDrawerBody').innerHTML = rows.length ? makeTable(rows,'% Util',r=>r.pct.toFixed(1)+'%')
    : '<p class="mt-3 text-success">None 🎉</p>';
}

function groupAvg(dailyArr){
  const byRes = new Map();
  dailyArr.forEach(r=>{
    const rec = byRes.get(r.resource_id) || { resource_id:r.resource_id, resource_name:r.resource_name, sum:0, days:0 };
    rec.sum  += r.pct;
    rec.days += 1;
    byRes.set(r.resource_id, rec);
  });
  return Array.from(byRes.values()).map(r=>({ ...r, pct:r.sum/r.days }));
}

function makeTable(dataArr, valueHeader, fmt){
  const rows = dataArr.map(r=>`<tr><td>${r.resource_name??r.resource_id}</td><td class="text-end">${fmt(r)}</td></tr>`).join('');
  return `<table class="table table-sm table-hover mt-2"><thead><tr><th>Resource</th><th class="text-end">${valueHeader}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/**
 * Returns HTML for the planner-level total summary.
 * @param {Array<{resource_name:string,budget:number,spent:number,remaining:number,variance:number}>} rows
 */
function makeBudgetHeader(rows) {
  const totals = rows.reduce((acc, d) => {
    acc.budget    += d.budget;
    acc.spent     += d.spent;
    acc.remaining += d.remaining;
    acc.variance  += d.variance;
    return acc;
  }, { resource_name: '📊 Total', budget: 0, spent: 0, remaining: 0, variance: 0 });

  return `
    <div class="row g-2 budget-cards-header" style="font-size: 1rem; margin-bottom: .5rem;">
      <div class="col-12">
        <div class="d-flex justify-content-between align-items-center p-2 bg-body rounded shadow-sm border border-primary">
          <div class="flex-grow-1 pe-2">
            <div class="fw-semibold">${totals.resource_name}</div>
            <div class="text-muted small">Bud: $${totals.budget.toFixed(0)}</div>
          </div>
          <div class="text-end">
            <div>Spent: $${totals.spent.toFixed(0)}</div>
            <div>Rem: $${totals.remaining.toFixed(0)}</div>
            <div>
                ${totals.variance < 0
                  ? `<span class="badge bg-danger">${totals.variance.toFixed(0)}</span>`
                  : `<span class="badge bg-success">${Math.abs(totals.variance).toFixed(0)}</span>`}
            </div>
          </div>
        </div>
      </div>
    </div>`;
}



/**
 * Render a compact card list of budget details.
 * @param {Array<{resource_name:string,budget:number,spent:number,remaining:number,variance:number}>} data
 */
function makeBudgetCards(data) {
  return `
    <div class="row g-2" style="font-size: .75rem;">
      ${data.map(d => `
        <div class="col-12">
          <div class="d-flex justify-content-between align-items-center p-2 bg-body rounded shadow-sm">
            <div class="flex-grow-1 pe-2">
              <div class="fw-semibold">${d.resource_name}</div>
              <div class="text-muted small">Bud: $${d.budget.toFixed(0)}</div>
            </div>
            <div class="text-end">
              <div>Spent: $${d.spent.toFixed(0)}</div>
              <div>Rem: $${d.remaining.toFixed(0)}</div>
              <div>
                ${d.variance < 0
                  ? `<span class="badge bg-danger">${d.variance.toFixed(0)}</span>`
                  : `<span class="badge bg-success">${Math.abs(d.variance).toFixed(0)}</span>`}
              </div>
            </div>
          </div>
        </div>`).join('')}
    </div>`;
}

/* ---------------------- Cashflow functions ---------------------- */

/**
 * Helper to get week number for a date.
 */
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/**
 * Build cashflow metrics by period ('day', 'week', or 'month').
 */
function buildCashflowMetrics(plan, periodType='month') {
  const bucketed = {};
  plan.allocations.forEach(a => {
    const cost = a.cost || 0;
    const base = a.baseline_cost || 0;
    const start = new Date(a.start);
    const end = a.end ? new Date(a.end) : start;
    const days = Math.ceil((end - start) / 86400000) + 1;
    for (let i = 0; i < days; i++) {
      const day = new Date(start.getTime() + i * 86400000);
      let key;
      switch(periodType) {
        case 'day':
          key = day.toISOString().slice(0,10);
          break;
        case 'week':
          key = `${day.getFullYear()}-W${getWeekNumber(day)}`;
          break;
        default:
          key = `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}`;
      }
      if (!bucketed[key]) bucketed[key] = { baseline:0, current:0 };
      bucketed[key].baseline += base / days;
      bucketed[key].current  += cost / days;
    }
  });
  return Object.entries(bucketed)
    .sort(([a],[b])=> a.localeCompare(b))
    .map(([period, v])=> ({ period, baseline: v.baseline, current: v.current }));
}

/**
 * Controls for selecting cashflow period.
 */
function makeCashflowControls(periodType) {
  return `<div class="btn-group mb-3" role="group">
    <button class="btn btn-sm btn-outline-primary${periodType==='day'?' active':''}" data-period="day">Day</button>
    <button class="btn btn-sm btn-outline-primary${periodType==='week'?' active':''}" data-period="week">Week</button>
    <button class="btn btn-sm btn-outline-primary${periodType==='month'?' active':''}" data-period="month">Month</button>
  </div>`;
}

/**
 * Render cashflow chart bars per period, with values displayed.
 */
function makeCashflowChart(data) {
  const maxVal = data.reduce((m,d)=> Math.max(m, d.baseline, d.current), 0) || 1;
  return `
    <div class="cashflow-chart" style="font-size:.85rem;">
      ${data.map(d => {
        const basePct = (d.baseline / maxVal) * 100;
        const currPct = (d.current  / maxVal) * 100;
        return `
        <div class="d-flex align-items-center mb-2">
          <div class="me-2" style="width:80px;">${d.period}</div>
          <div class="progress flex-fill me-1 position-relative" style="height:16px; background-color: #343a40d5;">
            <div class="progress-bar bg-secondary" style="width:${basePct.toFixed(1)}%"></div>
            <span class="position-absolute top-50 start-50 translate-middle small text-light">${d.baseline.toFixed(0)}</span>
          </div>
          <div class="progress flex-fill position-relative" style="height:16px; background-color: #343a40d5;">
            <div class="progress-bar bg-primary" style="width:${currPct.toFixed(1)}%"></div>
            <span class="position-absolute top-50 start-50 translate-middle small text-light">${d.current.toFixed(0)}</span>
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

/**
 * Populate and show the Cashflow drawer with period toggle.
 */
function showCashflowDrawer(currentPlan, periodType = 'month') {
  const body = $('#kpiDrawerBody');
  const title = $('#kpiDrawerLabel');
  title.textContent = `Cashflow (${periodType.charAt(0).toUpperCase() + periodType.slice(1)})`;

  // period switcher
  const controls = makeCashflowControls(periodType);

  const data = buildCashflowMetrics(currentPlan, periodType);
  body.innerHTML = controls + makeCashflowChart(data);

  // attach handlers
  body.querySelectorAll('[data-period]').forEach(btn => {
    btn.addEventListener('click', () => showCashflowDrawer(currentPlan, btn.dataset.period));
  });
}


/*****************************************************************************************
 * KPI bar + Offcanvas skeleton (DOM injection)
 *****************************************************************************************/
function ensureKpiBar(){
  if (document.getElementById('kpi-bar')) return;
  const bar = document.createElement('div');
  bar.id = 'kpi-bar';
  bar.className = 'd-flex gap-2 mb-2';
  bar.setAttribute('data-bs-toggle', 'tooltip');
  bar.setAttribute('title', 'Resource utilization and KPI tracking dashboard');
  bar.innerHTML = `
    <div style="overflow-x: auto; white-space: nowrap; width: 100%;">
      <button id="kpi-util" class="btn btn-outline-primary btn-sm text-center" type="button" data-which="util">
        <span class="kpi-val">0%</span>
        <small class="d-block lh-1">Avg util</small>
      </button>
      <button id="kpi-idle" class="btn btn-outline-secondary btn-sm text-center" type="button" data-which="idle">
        <span class="kpi-val">0</span>
        <small class="d-block lh-1">Idle hrs</small>
      </button>
      <button id="kpi-over" class="btn btn-outline-danger btn-sm text-center" type="button" data-which="over">
        <span class="kpi-val">0</span>
        <small class="d-block lh-1">Over-cap</small>
      </button>
      <button id="kpi-utilF"  class="btn btn-outline-primary btn-sm text-center" data-which="utilF">
        <span class="kpi-val">0%</span><small class="d-block lh-1">Util (f)</small></button>
      <button id="kpi-idleF"  class="btn btn-outline-secondary btn-sm text-center" data-which="idleF">
        <span class="kpi-val">0</span><small class="d-block lh-1">Idle hrs (f)</small></button>
      <button id="kpi-overF"  class="btn btn-outline-danger btn-sm text-center" data-which="overF">
        <span class="kpi-val">0</span><small class="d-block lh-1">Over-cap (f)</small></button>
      <button id="kpi-delay"  class="btn btn-outline-warning btn-sm text-center" data-which="delay">
        <span class="kpi-val">0</span><small class="d-block lh-1">Delay (d)</small></button>
      <button id="kpi-budget" class="btn btn-outline-success btn-sm text-center" data-which="budget">
        <span class="kpi-val">$0</span><small class="d-block lh-1">Budget ∆</small></button>
      <button id="kpi-cashflow" class="btn btn-outline-info btn-sm text-center" data-which="cashflow">
        <span class="kpi-val">-</span><small class="d-block lh-1">Cashflow</small></button>
    </div>
  `;
  document.querySelector('#timeline').before(bar);

bar.addEventListener('click', e => {
  const btn = e.target.closest('[data-which]');   // ← finds nearest ancestor
  if (!btn) return;                               // click was outside any KPI
  const which = btn.dataset.which;                // same value, cleaner syntax
  showDrawer(which);
});
  
  // off‑canvas skeleton once
  if (!document.getElementById('kpiDrawer')){
    const oc = document.createElement('div');
    oc.className = 'offcanvas offcanvas-end';
    oc.tabIndex = -1;
    oc.id = 'kpiDrawer';
    oc.innerHTML = `
      <div class="offcanvas-header">
        <h5 id="kpiDrawerLabel" class="offcanvas-title">KPIs</h5>
        <button type="button" class="btn-close" data-bs-dismiss="offcanvas"></button>
      </div>
      <div id="kpiDrawerBody" class="offcanvas-body small"></div>`;
    document.body.appendChild(oc);
  }
}
