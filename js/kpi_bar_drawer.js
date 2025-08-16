// kpi_bar_drawer.js – Bootstrap‑powered KPI bar + off‑canvas drawer
// Rewritten to use plan‑horizon based calculations
// – Average utilization: share of capacity across ENTIRE plan window (includes quiet days)
// – Idle hours: (100 % − daily %) × hoursPerDay across horizon
//
// Usage: import { refreshKpis } from './kpi_bar_drawer.js'; refreshKpis(plan);
// Requires Bootstrap 5 JS, plus buildDailyUsage from analytics.js.

import { buildDailyUsage, buildDailyUsageFrom } from './analytics.js';
import { resCostMetrics } from './res_drawer.js';
import { $ } from './ui.js';
import { daysBetween, workingHours, getPlanWindow, getResourceHireWindow, utcIsoToLocalDate } from './utils.js';
import { getFutureCapacity } from './utils.js';

const kpiCache = new WeakMap();

function clampRange(aStart, aEnd, bStart, bEnd){
  const s = new Date(Math.max(+aStart, +bStart));
  const e = new Date(Math.min(+aEnd,   +bEnd));
  return s <= e ? [s, e] : null;
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

/* -------------------------------------------------------------- *
 *  Sum working hours across an entire horizon.
 *  @param {Date} horizonStart  first calendar day of the horizon
 *  @param {number} days        how many consecutive days
 *  @returns {number}           total working hours in the span
 * -------------------------------------------------------------- */
function horizonWorkingHours(horizonStart, days){
  let hrs = 0;
  for (let i = 0; i < days; i++){
    const d = new Date(horizonStart);
    d.setUTCDate(horizonStart.getUTCDate() + i);
    hrs += workingHours(d);              // today 8h; later calendar driven
  }
  return hrs;
}


function groupAvgH(plan, dailyArr, clampStart=null, clampEnd=null){
  const byRes = new Map();

  console.log('groupAvgH', dailyArr.length, 'records');
  console.log('is Array', Array.isArray(dailyArr));
  dailyArr.forEach(r=>{
    const rec = byRes.get(r.resource_id)
      || { resource_id:r.resource_id, resource_name:r.resource_name, usedHrs:0 };
    rec.usedHrs += workingHours(new Date(r.day)) * (r.pct / 100);
    byRes.set(r.resource_id, rec);
  });

  return Array.from(byRes.values()).map(r=>{
    const res = plan.resources.find(x=>x.id === r.resource_id);
    if (!res) return { ...r, pct: 0 };

    const { start: hStart, end: hEnd } = getResourceHireWindow(plan, res);

    let spanStart = hStart;
    let spanEnd   = hEnd;
    if (clampStart) spanStart = new Date(Math.max(spanStart, clampStart));
    if (clampEnd)   spanEnd   = new Date(Math.min(spanEnd, clampEnd));

    let capHrs = 0;
    for (let d = new Date(spanStart); d <= spanEnd; d.setUTCDate(d.getUTCDate()+1)){
      capHrs += workingHours(d);
    }

    const pct = capHrs > 0 ? (r.usedHrs / capHrs) * 100 : 0;
    return { ...r, pct };
  });
}

// this function calculates the total hours booked by a resource
// across the entire plan horizon, if a resource has multiple allocations, 
// it sums the hours across all allocations
// incase future is true, it will only count hours from today onwards
function getResourceBookedHours(plan, resId, future = false) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0); // strip time for today
  let bookedHours = 0;
  for (const allocation of plan.allocations) {
    if (allocation.resource_id !== resId) continue;

    // If future is true, skip allocations before today
    let start = new Date(allocation.start);
    let end = new Date(allocation.end);

    if (future) {
      if (end < today) continue; // skip allocations ending before today
      if (start < today) start = new Date(today); // clamp start to today
    }

    // If allocation has no end date, skip it
    if (!allocation.end) continue;

    bookedHours += sumWorkingHours(start, end) * (allocation.allocation_pct / 100);
  }
  console.log(`Total booked hours for resource ${resId}:`, bookedHours);
  return bookedHours;
}


// this function calculates the capacity of a resource from:
// 1. start to end dates specified in the resource
// 2. planner start if no start date is specified
// 3. planner end if no end date is specified
// 4. future capacity is returned if required in the args
// 5. if future capacity is requested, the start date is clamped to the current date
// 6. if planner dates are all in the past, future capacity is zero
function getResourceCapacity(plan, res, future = false) {
  const { start: plannerStart, end: plannerEnd } = getPlanWindow(plan);
  let start = res.start ? new Date(res.start) : new Date(plannerStart);
  let end = res.end ? new Date(res.end) : new Date(plannerEnd);

  // ensure dates are in UTC
  start.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(0, 0, 0, 0);

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // if planner window is entirely in the past, future capacity is zero
  if (future && plannerEnd < today) {
    return 0;
  }

  // if future capacity is requested, clamp the start date to today
  if (future && start < today) {
    start = new Date(today);
  }

  // if start is after end, capacity is zero
  if (start > end) {
    return 0;
  }

  return sumWorkingHours(start, end);
}

let currentPlan = null;

function kpiAvgUtil(plan, future = false) {
  const usedIds = new Set(plan.allocations.map(a => a.resource_id));

  // 1) capacity hours across all used resources
  let capHrsTotal = 0;
  let usedHrsTotal = 0;
  usedIds.forEach(id => {
      const res = plan.resources.find(r => r.id === id);
      if (!res) return;

      // total capacity days
      console.debug('capacity days:', daysBetween(res.start, res.end));
      // capacity using getResourceCapacity
      console.debug('capacity using getResourceCapacity:', getResourceCapacity(plan, res));

      // total capacity hours
      const capHrs = getResourceCapacity(plan, res, future);
      const usedHrs = getResourceBookedHours(plan, res.id, future);

      usedHrsTotal += usedHrs;
      capHrsTotal += capHrs;
  });

  return (usedHrsTotal / capHrsTotal) * 100;
}

 // this function returns the sum number of working hours not used by any allocation
 // this is calculated by taking the total capacity of each resource and subtracting the used hours
 // returns an array of objects with resource_id, resource_name, and hours
function kpiIdleRows(plan, future = false) {
  const idleHours = new Array(); // resource_id → used hours
  for (const res of plan.resources) {
    // check if resource has at least one allocation
    if (!res.id || !plan.allocations.some(a => a.resource_id === res.id)) continue;
    const bookedHours = getResourceBookedHours(plan, res.id, future);
    const capacityHours = getResourceCapacity(plan, res, future);
    console.log(`Resource ${res.name} (${res.id}): booked ${bookedHours}, capacity ${capacityHours}`);
    idleHours.push({ resource_id: res.id, resource_name: res.name, hours: capacityHours - bookedHours });
  }

  return idleHours;
}

// this function returns the schedule variance
// earliest start date and latest end date of all allocations vs.
// earliest baseline start date and latest baseline end date
function kpiScheduleVariance(plan) {
  let earliestStart = new Date(Math.min(...plan.allocations.map(a => new Date(a.start))));
  let latestEnd = new Date(Math.max(...plan.allocations.map(a => new Date(a.end))));
  let earliestBaselineStart = new Date(Math.min(...plan.allocations.map(a => a.baseline_start ? new Date(a.baseline_start) : Infinity)));
  let latestBaselineEnd = new Date(Math.max(...plan.allocations.map(a => a.baseline_end ? new Date(a.baseline_end) : -Infinity)));
  const scheduleVariance = {
    earliestStart: utcIsoToLocalDate(earliestStart.toISOString()),
    latestEnd: utcIsoToLocalDate(latestEnd.toISOString()),
    earliestBaselineStart: utcIsoToLocalDate(earliestBaselineStart.toISOString()),
    latestBaselineEnd: utcIsoToLocalDate(latestBaselineEnd.toISOString()),
    varianceDays: Math.max(0, (latestEnd - latestBaselineEnd) / 86400000) // in days
  };

  return scheduleVariance;
}

export function refreshKpis (plan){
  ensureKpiBar();
  currentPlan = plan;

  // ----- horizon (planner-wide, from allocations) -----
  const { start: horizonStart, end: horizonEnd } = getPlanWindow(plan);
  const horizonDays = daysBetween(horizonStart, horizonEnd);

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const futureStart = today < horizonStart ? horizonStart : today;
  const horizonDaysF = daysBetween(futureStart, horizonEnd);

  // ----- daily tables (already hire-window aware via analytics.js) -----
  const dailyAll = buildDailyUsage(plan);
  const dailyFut = buildDailyUsageFrom(plan, futureStart.toISOString());

  const utilAll = kpiAvgUtil(plan);
  const utilFut = kpiAvgUtil(plan, true);

  const idleRowsAll = kpiIdleRows(plan);
  const idleRowsFut = kpiIdleRows(plan, true);

  const idleAllTot  = idleRowsAll.reduce((s,r)=>s+r.hours,0);
  const idleFutTot  = idleRowsFut.reduce((s,r)=>s+r.hours,0);

  const overAll = new Set(dailyAll.filter(r=>r.pct>100).map(r=>r.resource_id));
  const overFut = new Set(dailyFut.filter(r=>r.pct>100).map(r=>r.resource_id));

  const scheduleVariance = kpiScheduleVariance(plan);

  // ----- schedule & budget overrun (unchanged) -----
  let delayDays=0, budgetD=0;
  plan.allocations.forEach(a=>{
    if(a.baseline_end && a.end && new Date(a.end)>new Date(a.baseline_end))
      delayDays += (new Date(a.end)-new Date(a.baseline_end))/86400000;
    if(a.baseline_cost!=null) budgetD += (a.cost - a.baseline_cost);
  });

  // ----- write to UI -----
  $('#kpi-util .kpi-val').textContent  = utilAll.toFixed(0)+'%';
  $('#kpi-idle .kpi-val').textContent  = idleAllTot.toFixed(0);
  $('#kpi-over .kpi-val').textContent  = overAll.size;

  $('#kpi-utilF .kpi-val').textContent = utilFut.toFixed(0)+'%';
  $('#kpi-idleF .kpi-val').textContent = idleFutTot.toFixed(0);
  $('#kpi-overF .kpi-val').textContent = overFut.size;

  $('#kpi-delay .kpi-val').textContent  = scheduleVariance.varianceDays.toFixed(1);
  $('#kpi-budget .kpi-val').textContent = '$'+budgetD.toFixed(0);

  // cashflow stays as-is…
  const cfData = buildCashflowMetrics(plan, 'month');
  const totalCurrent = cfData.reduce((sum,d) => sum + d.current, 0);
  $('#kpi-cashflow .kpi-val').textContent = '$' + totalCurrent.toFixed(0);

  // cache (unchanged types; values now hire-aware)
  kpiCache.set(plan,{
    dailyAll,  idleRowsAll,  overAll,  utilAll,
    dailyFut,  idleRowsFut,  overFut,  utilFut,
    delayDays, budgetD, idleAllTot, idleFutTot, scheduleVariance,
    horizonDays, horizonDaysF, horizonStart, horizonEnd, futureStart
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
    case 'util':
      title.textContent='Average utilisation (all)';
      body.innerHTML = `<p class="text-muted mb-2">Average utilisation is calculated as the ratio of used hours to available hours across the entire plan horizon.</p>`;
      body.innerHTML += renderKpi(c.utilAll.toFixed(0)+'%', c.utilAll < 100);
      body.innerHTML += makeTable(
        groupAvgH(currentPlan, c.dailyAll, c.horizonStart, c.horizonEnd),
        '% Util',
        r=>r.pct.toFixed(1)+'%'
      );
      break;

    case 'idle':
      title.textContent='Idle hours (all)';
      // add description to the idle hours table
      body.innerHTML = `<p class="text-muted mb-2">Idle hours are calculated as (100% - daily %) × hours per day across the entire plan horizon.</p>`;
      body.innerHTML += renderKpi(c.idleAllTot.toFixed(0) + ' hours', c.idleAllTot >= 0);
      body.innerHTML += makeTable(c.idleRowsAll,'Hours',r=>r.hours.toFixed(1));
      break;

    case 'over':
      title.textContent='Over-capacity resources (all)';
      drawerOver(c.dailyAll,c.overAll);
      break;

    case 'utilF':
      title.textContent='Average utilisation (future)';
      // add description to the utilisation table
      body.innerHTML = `<p class="text-muted mb-2">Average utilisation is calculated as the ratio of used hours to available hours across the entire plan horizon.</p>`;
      body.innerHTML += renderKpi(c.utilFut.toFixed(0) + '%', c.utilFut < 100);
      body.innerHTML += makeTable(
        groupAvgH(currentPlan, c.dailyFut, c.futureStart, c.horizonEnd),
        '% Util',
        r=>r.pct.toFixed(1)+'%'
      );
      break;

    case 'idleF':
      title.textContent='Idle hours (future)';
      // add description to the idle hours table
      body.innerHTML = `<p class="text-muted mb-2">Idle hours are calculated as (100% - daily %) × hours per day across the entire plan horizon.</p>`;
      body.innerHTML += renderKpi(c.idleFutTot.toFixed(0) + ' hours', c.idleFutTot >= 0);
      body.innerHTML += makeTable(c.idleRowsFut,'Hours',r=>r.hours.toFixed(1));
      break;

    case 'overF':
      title.textContent='Over-capacity resources (future)';
      drawerOver(c.dailyFut,c.overFut);
      break;

    case 'delay':
      title.textContent = 'Schedule overrun';
      // Description for the delay table
      body.innerHTML = `<p class="text-muted mb-2">
        Schedule overrun is calculated as the difference between the actual and baseline finish dates.
      </p>`;
      body.innerHTML += renderKpi(c.scheduleVariance.varianceDays.toFixed(1) + ' days', c.scheduleVariance.varianceDays <= 0);
      
      // Format the dates without time info
      const formatDate = dateStr => 
        new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      
      // Updated layout: Vertical groups for Start and Finish
      body.innerHTML += `
        <div class="my-3 text-muted small">
          <div class="mb-3">
            <div class="fw-bold">Start</div>
            <div class="ms-3">
              <div>Actual: ${formatDate(c.scheduleVariance.earliestStart)}</div>
              <div>Baseline: ${formatDate(c.scheduleVariance.earliestBaselineStart)}</div>
            </div>
          </div>
          <div>
            <div class="fw-bold">Finish</div>
            <div class="ms-3">
              <div>Actual: ${formatDate(c.scheduleVariance.latestEnd)}</div>
              <div>Baseline: ${formatDate(c.scheduleVariance.latestBaselineEnd)}</div>
            </div>
          </div>
        </div>
      `;
      break;

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
      body.innerHTML = makeBudgetHeader(rows) + makeBudgetCards(rows);
      break;
    case 'cashflow': 
      // Delegate to the dedicated drawer builder (defaults to month)
      showCashflowDrawer(currentPlan, 'month');
      break;
    
  }
  bootstrap.Offcanvas.getOrCreateInstance('#kpiDrawer').show();
}

function drawerOver(daily,set){
  const rows = groupAvg(daily.filter(r=>set.has(r.resource_id)));
  // add description to the over-capacity table
  $('#kpiDrawerBody').innerHTML = `<p class="text-muted mb-2">Over-capacity resources are those with average utilisation above 100%.</p>`;
  $('#kpiDrawerBody').innerHTML += rows.length ? makeTable(rows,'% Util',r=>r.pct.toFixed(1)+'%')
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

// this function returns html for the kpi value
function renderKpi(kpi, positive = true) {
  const colorClass = positive
    ? 'text-success border-success'
    : 'text-danger border-danger';
  return `<div class="kpi-value border ${colorClass} p-3 text-center fs-2 fw-bold"
    style="min-height:64px; display:block; width: fit-content; margin: 0 auto; border-width:1px; border-radius:8px;">
    ${kpi}
  </div>`;
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
  }, { resource_name: 'Total for the whole planner', budget: 0, spent: 0, remaining: 0, variance: 0 });

return `
  <div class="row g-2 budget-cards-header pt-2" style="font-size: 1rem;">
    <div class="col-12">
      <!-- Header with Resource Name and Variance -->
      <div class="mb-2">
        <div class="d-flex justify-content-between mb-2">
          <div class="fw-semibold">${totals.resource_name}</div>
          <div>
            ${
              totals.variance < 0
                ? `<span class="badge bg-danger">${totals.variance.toFixed(0)}</span>`
                : `<span class="badge bg-success">${Math.abs(totals.variance).toFixed(0)}</span>`
            }
          </div>
        </div>
        <div class="d-flex justify-content-end mb-1">
          <small class="text-muted">Total Actual Budget: ${(totals.spent + totals.remaining).toFixed(0)}</small>
        </div>
      </div>
      <!-- First Bar: Planned Budget -->
      <div class="d-flex align-items-center mb-2">
        <div class="me-2 text-muted" style="width:60px; text-align:right;">
          <small>Planned</small>
        </div>
        <div class="flex-grow-1">
          <div class="progress" style="height: 24px;">
            <div class="progress-bar bg-info" role="progressbar" style="width: 100%;" 
              aria-valuenow="${totals.budget.toFixed(0)}" aria-valuemin="0" aria-valuemax="${totals.budget.toFixed(0)}">
              ${totals.budget.toFixed(0)}
            </div>
          </div>
        </div>
      </div>
      <!-- Second Bar: Actual (Spent vs Remaining) -->
      <div class="d-flex align-items-center">
        <div class="me-2 text-muted" style="width:60px; text-align:right;">
          <small>Actual</small>
        </div>
        <div class="flex-grow-1">
          <div class="progress" style="height: 24px;">
            ${(() => {
              const budget = totals.budget;
              const spent = totals.spent;
              const remaining = totals.remaining;
              const spentPct = budget > 0 ? (spent / budget) * 100 : 0;
              const remainPct = budget > 0 ? (remaining / budget) * 100 : 0;
              return `
                <div class="progress-bar bg-primary" role="progressbar" style="width: ${spentPct.toFixed(1)}%" 
                  aria-valuenow="${spent.toFixed(0)}" aria-valuemin="0" aria-valuemax="${budget.toFixed(0)}">
                  ${spent.toFixed(0)}
                </div>
                <div class="progress-bar ${totals.variance < 0 ? 'bg-danger' : 'bg-success'}" role="progressbar" 
                  style="width: ${remainPct.toFixed(1)}%" aria-valuenow="${remaining.toFixed(0)}" 
                  aria-valuemin="0" aria-valuemax="${budget.toFixed(0)}">
                  ${remaining.toFixed(0)}
                </div>
              `;
            })()}
          </div>
        </div>
      </div>
    </div>
    <div class="text-muted mt-2" style="font-size: .7rem;">
        This summary shows the total budget, spent, and remaining amounts for all resources in the planner.
        The variance indicates how much over or under budget the planner is.
    </div>
    <hr class="mb-4">
`;

};

/**
 * Render a compact card list of budget details using progress bars,
 * that visually differs from the header.
 * @param {Array<{resource_name:string,budget:number,spent:number,remaining:number,variance:number}>} data
 */
function makeBudgetCards(data) {
  return `
    <div class="row g-1" style="font-size: .75rem;">
      ${data.map(d => {
        const spentPct = d.budget > 0 ? (d.spent / d.budget) * 100 : 0;
        const remainPct = d.budget > 0 ? (d.remaining / d.budget) * 100 : 0;
        return `
        <div class="col-12">
          <div class="bg-body shadow-sm">
            <div class="d-flex justify-content-between mb-1">
              <div class="fw-semibold">${d.resource_name}</div>
              <div>
                ${d.variance < 0
                  ? `<span class="text-danger">Variance: ${d.variance.toFixed(0)}</span>`
                  : `<span class="text-success">Variance: ${Math.abs(d.variance).toFixed(0)}</span>`}
              </div>
            </div>
            <div class="progress" style="height: 16px;">
              <div class="progress-bar bg-primary" role="progressbar" style="width: ${spentPct.toFixed(1)}%" aria-valuenow="${d.spent.toFixed(0)}" aria-valuemin="0" aria-valuemax="${d.budget}">
                ${d.spent.toFixed(0)}
              </div>
              <div class="progress-bar ${d.variance < 0 ? 'bg-danger' : 'bg-success'}" role="progressbar" style="width: ${remainPct.toFixed(1)}%" aria-valuenow="${d.remaining.toFixed(0)}" aria-valuemin="0" aria-valuemax="${d.budget}">
                ${d.remaining.toFixed(0)}
              </div>
            </div>
            <div class="text-muted small mb-1">Budget: ${d.budget.toFixed(0)} | Actual: ${(d.spent + d.remaining).toFixed(0)}</div>
          </div>
        </div>
      `;
      }).join('')}
    </div>
  `;
}

/* ---------------------- Cashflow functions (revised) ---------------------- */

function getWeekNumber(d) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7; // 1..7 (Mon..Sun)
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function periodKeyAndBounds(day, periodType) {
  const d = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  let start, end, key;

  if (periodType === 'day') {
    start = new Date(d);
    end   = new Date(d); end.setUTCHours(23,59,59,999);
    key = start.toISOString().slice(0,10);
  } else if (periodType === 'week') {
    const dow = d.getUTCDay() || 7; // Mon=1..Sun=7
    start = new Date(d); start.setUTCDate(d.getUTCDate() - (dow - 1));
    end   = new Date(start); end.setUTCDate(start.getUTCDate() + 6); end.setUTCHours(23,59,59,999);
    key = `${start.getUTCFullYear()}-W${String(getWeekNumber(d)).padStart(2,'0')}`;
  } else {
    start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    end   = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+1, 0, 23,59,59,999));
    key = `${start.getUTCFullYear()}-${String(start.getUTCMonth()+1).padStart(2,'0')}`;
  }
  return { key, start, end };
}

function periodStatus(start, end, todayUtc) {
  if (end   < todayUtc) return 'past';
  if (start > todayUtc) return 'future';
  return 'mixed';
}


/* Build empty buckets covering the full plan horizon */
function buildEmptyBuckets(plan, periodType) {
  const { start: hStart, end: hEnd } = getPlanWindow(plan);
  // snap horizon edges to exact period bounds
  const first = periodKeyAndBounds(hStart, periodType).start;
  const last  = periodKeyAndBounds(hEnd,   periodType).end;

  const buckets = new Map();
  const cursor = new Date(first);
  while (cursor <= last) {
    const { key, start, end } = periodKeyAndBounds(cursor, periodType);
    if (!buckets.has(key)) buckets.set(key, { start, end, baseline: 0, current: 0 });
    // advance by one period
    if (periodType === 'day') {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    } else if (periodType === 'week') {
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    } else {
      cursor.setUTCMonth(cursor.getUTCMonth() + 1, 1);
    }
  }
  return buckets;
}

/**
 * Weighted distribution: split a total amount over days using working hours.
 * (Mon–Fri 8h, Sat 4h, Sun 0h) — Sundays naturally receive 0.
 */
function distributeByWorkingHours(total, s, e) {
  const days = [];
  const d = new Date(s); d.setUTCHours(0,0,0,0);
  const end = new Date(e); end.setUTCHours(0,0,0,0);

  while (d <= end) {
    days.push(new Date(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }

  // sum weights; skip zero-hour calendars
  let wSum = 0;
  const weights = days.map(day => {
    const w = workingHours(day); // from utils.js
    wSum += w;
    return w;
  });
  if (wSum <= 0) return []; // nothing to allocate (e.g., all Sundays)

  return days.map((day, i) => ({ day, amount: total * (weights[i] / wSum) }));
}

/**
 * Build cashflow across Day/Week/Month with:
 *  - baseline based on (baseline_start/end, baseline_cost)
 *  - actual   based on (start/end, cost)
 *  - clamped to resource hire window and plan window
 *  - allocated only on working hours
 */
function buildCashflowMetrics(plan, periodType='month') {
  const buckets = buildEmptyBuckets(plan, periodType);
  const today = new Date(); today.setUTCHours(0,0,0,0);

  const horizon = getPlanWindow(plan);

  for (const a of (plan.allocations || [])) {
    const res = (plan.resources || []).find(r => r.id === a.resource_id);
    const hire = res ? getResourceHireWindow(plan, res) : horizon;

    // --- Baseline ---
    if (a.baseline_cost && (a.baseline_start || a.start)) {
      const bs = new Date(a.baseline_start || a.start);
      const be = new Date(a.baseline_end   || a.end   || a.start);
      const cr = clampRange(bs, be, hire.start, hire.end);
      const cr2 = cr ? clampRange(cr[0], cr[1], horizon.start, horizon.end) : null;
      if (cr2) {
        for (const { day, amount } of distributeByWorkingHours(a.baseline_cost, cr2[0], cr2[1])) {
          const { key } = periodKeyAndBounds(day, periodType);
          const b = buckets.get(key);
          if (b) b.baseline += amount;
        }
      }
    }

    // --- Actual ---
    if (a.cost && a.start) {
      const as = new Date(a.start);
      const ae = new Date(a.end || a.start);
      const cr = clampRange(as, ae, hire.start, hire.end);
      const cr2 = cr ? clampRange(cr[0], cr[1], horizon.start, horizon.end) : null;
      if (cr2) {
        for (const { day, amount } of distributeByWorkingHours(a.cost, cr2[0], cr2[1])) {
          const { key } = periodKeyAndBounds(day, periodType);
          const b = buckets.get(key);
          if (b) b.current += amount;
        }
      }
    }
  }

  // -> sorted array with status
  return Array.from(buckets.entries())
    .sort(([,a],[,b]) => a.start - b.start)
    .map(([period, v]) => ({
      period,
      start: v.start,
      end: v.end,
      status: periodStatus(v.start, v.end, today),
      baseline: v.baseline,
      current: v.current
    }));
}

function makeCashflowLegend() {
  return `
    <div class="text-muted small mb-2">
      <div><strong>How to read:</strong> Two bars per period — <em>Baseline</em> (left) and <em>Actual</em> (right).
      Each bar represents the total project baseline/actual; the filled part is this period’s share.</div>
      <div class="mt-1">
        <span class="badge bg-secondary me-1">&nbsp;</span> past
        <span class="badge bg-warning ms-2 me-1 progress-bar-striped">&nbsp;</span> includes today
      </div>
    </div>`;
}

function barClassFor(status, kind) {
  if (status === 'past')  return 'bg-secondary';
  if (status === 'mixed') return 'bg-warning progress-bar-striped';
  return kind === 'baseline' ? 'bg-info' : 'bg-success';
}

/* Overlay improved to be readable on light backgrounds */
function makeCashflowChart(data) {
  const totals = data.reduce((acc, d) => {
    acc.baseline += d.baseline;
    acc.current  += d.current;
    return acc;
  }, { baseline: 0, current: 0 });

  const totalBase = Math.max(1, totals.baseline);
  const totalAct  = Math.max(1, totals.current);

  return `
    <div class="cashflow-chart" style="font-size:.85rem;">
      ${data.map(d => {
        const basePct = Math.min(100, (d.baseline / totalBase) * 100);
        const actPct  = Math.min(100, (d.current  / totalAct)  * 100);
        const baseCls = barClassFor(d.status, 'baseline');
        const actCls  = barClassFor(d.status, 'actual');

        return `
        <div class="d-flex align-items-center mb-2">
          <div class="me-2" style="width:92px; white-space:nowrap;">${d.period}</div>

          <!-- Baseline -->
          <div class="progress flex-fill me-1 position-relative" style="height:16px;">
            <div class="progress-bar ${baseCls}" style="width:${basePct.toFixed(1)}%"></div>
            <span class="position-absolute top-50 start-50 translate-middle small text-dark fw-semibold">
              ${d.baseline > 0 ? d.baseline.toFixed(0) : '0'}
            </span>
          </div>

          <!-- Actual -->
          <div class="progress flex-fill position-relative" style="height:16px;">
            <div class="progress-bar ${actCls}" style="width:${actPct.toFixed(1)}%"></div>
            <span class="position-absolute top-50 start-50 translate-middle small text-dark fw-semibold">
              ${d.current > 0 ? d.current.toFixed(0) : '0'}
            </span>
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

function makeCashflowControls(periodType) {
  return `<div class="btn-group mb-3" role="group">
    <button class="btn btn-sm btn-outline-primary${periodType==='day'?' active':''}" data-period="day">Day</button>
    <button class="btn btn-sm btn-outline-primary${periodType==='week'?' active':''}" data-period="week">Week</button>
    <button class="btn btn-sm btn-outline-primary${periodType==='month'?' active':''}" data-period="month">Month</button>
  </div>`;
}

function showCashflowDrawer(currentPlan, periodType = 'month') {
  const body  = $('#kpiDrawerBody');
  const title = $('#kpiDrawerLabel');

  const data = buildCashflowMetrics(currentPlan, periodType);
  const totals = data.reduce((acc,d) => { acc.baseline+=d.baseline; acc.current+=d.current; return acc; }, {baseline:0,current:0});

  title.textContent = `Cashflow (${periodType.charAt(0).toUpperCase() + periodType.slice(1)})`;
  const description = `
    <div class="mb-2">
      <div class="fw-semibold">Cashflow</div>
      <div class="text-muted small">Two bars per period — Baseline (left) and Actual (right). Grey = past; striped = includes today.</div>
    </div>`;

  const totalsHtml = `
    <div class="d-flex justify-content-end gap-3 mb-2" style="font-size:.9rem;">
      <div><strong>Total Baseline:</strong> $${totals.baseline.toFixed(0)}</div>
      <div><strong>Total Actual:</strong> $${totals.current.toFixed(0)}</div>
    </div>`;

  body.innerHTML = description + totalsHtml + makeCashflowControls(periodType) + makeCashflowLegend() + makeCashflowChart(data);

  body.querySelectorAll('[data-period]').forEach(btn => {
    btn.addEventListener('click', () => showCashflowDrawer(currentPlan, btn.dataset.period));
  });
}
/* -------------------- /Cashflow functions (revised) -------------------- */



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
      <div class="offcanvas-header bg-gradient bg-secondary text-white border-bottom shadow-sm" style="padding: 1rem 1.5rem;">
      <div class="d-flex align-items-center w-100">
        <div>
        <h5 id="kpiDrawerLabel" class="offcanvas-title mb-0 fw-bold" style="font-size: 1.35rem;">KPIs</h5>
        <div class="text-light small mt-1">Key Performance Indicators &amp; Resource Metrics</div>
        </div>
        <button type="button" class="btn-close btn-close-white ms-auto" data-bs-dismiss="offcanvas" aria-label="Close"></button>
      </div>
      </div>
      <div id="kpiDrawerBody" class="offcanvas-body small"></div>
    `;
    document.body.appendChild(oc);
  }
}
