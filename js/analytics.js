
// analytics.js - centralized KPI functions

import { isBox } from './allocations.js';
import { plannedHours, isoToInputDate, workingHours } from './utils.js';
import { getResourceHireWindow, getPlanWindow } from './utils.js';


export const countMilestones = plan =>
  plan.allocations.filter(isBox).length;

function clampRange(start, end, winStart, winEnd) {
  const s = new Date(Math.max(+start, +winStart));
  const e = new Date(Math.min(+end,   +winEnd));
  return s <= e ? [s, e] : null;
}

function* eachDay(start, end) {
  const d = new Date(start);
  d.setUTCHours(0,0,0,0);
  const last = new Date(end);
  last.setUTCHours(0,0,0,0);
  while (d <= last) {
    yield new Date(d);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

/*********************************************************************
 * buildDailyUsage(plan)
 * --------------------------------------------------
 * Returns [{ resource_id, resource_name, day:'YYYY-MM-DD', pct:Number }, …]
 * Notes:
 *  - Ignores boxes
 *  - Clamps each allocation to the resource's hire→release window
 *  - Open-ended hire uses planner end
 *********************************************************************/
export function buildDailyUsage(plan) {
  const dayMap = new Map(); // key: resId#YYYY-MM-DD → pct sum
  const planWin = getPlanWindow(plan);

  plan.allocations.forEach(a => {
    if (isBox(a)) return;

    // resource hire window (with planner fallback)
    const res = plan.resources.find(r => r.id === a.resource_id);
    if (!res) return;
    const { start: hStart, end: hEnd } = getResourceHireWindow(plan, res);

    // clamp this allocation to the hire window
    const aStart = new Date(a.start);
    const aEnd   = new Date(a.end);
    const clamped = clampRange(aStart, aEnd, hStart, hEnd);
    if (!clamped) return;

    const [s, e] = clamped;
    for (const d of eachDay(s, e)) {
      const dayKey = d.toISOString().slice(0, 10);
      const key = `${a.resource_id}#${dayKey}`;
      dayMap.set(key, (dayMap.get(key) || 0) + a.allocation_pct);
    }
  });

  // unwrap
  return Array.from(dayMap, ([key, pct]) => {
    const [resId, day] = key.split('#');
    const resName = plan.resources.find(r => r.id === resId)?.name || resId;
    return { resource_id: resId, resource_name: resName, day, pct: +pct.toFixed(1) };
  }).sort((a, b) => a.day.localeCompare(b.day) ||
                    a.resource_name.localeCompare(b.resource_name));
}

/*********************************************************************
 * Utilisation percentage per resource (hire-window based) */
export function buildUtilisation(plan) {
  const map = new Map(); // resId → { booked, available }

  // Prepare plan window for open-ended fallback (once)
  const planWin = getPlanWindow(plan);

  // Initialise map per resource using its hire window capacity
  plan.resources.forEach(r => {
    const { start: hStart, end: hEnd } = getResourceHireWindow(plan, r);

    // capacity: sum of working hours across hire window
    let capacityHrs = 0;
    for (const d of eachDay(hStart, hEnd)) {
      capacityHrs += workingHours(d);
    }
    map.set(r.id, { booked: 0, available: capacityHrs });
  });

  // Booked hours: sum calendar-aware hours for each allocation,
  // clamped to the resource's hire window.
  plan.allocations.forEach(a => {
    if (isBox(a)) return;
    const res = plan.resources.find(r => r.id === a.resource_id);
    if (!res) return;

    const { start: hStart, end: hEnd } = getResourceHireWindow(plan, res);
    const aStart = new Date(a.start);
    const aEnd   = new Date(a.end);
    const clamped = clampRange(aStart, aEnd, hStart, hEnd);
    if (!clamped) return;

    let hrs = 0;
    const [s, e] = clamped;
    for (const d of eachDay(s, e)) {
      hrs += workingHours(d);
    }
    hrs *= (a.allocation_pct / 100);

    const rec = map.get(a.resource_id);
    if (rec) rec.booked += hrs;
  });

  return Array.from(map, ([id, v]) => {
    const r = plan.resources.find(res => res.id === id);
    const available = v.available || 1; // guard divide-by-zero (no hire window)
    return {
      resource_id   : id,
      resource_name : r?.name ?? id,
      pct           : +(100 * v.booked / available).toFixed(1),
      booked        : +v.booked.toFixed(1),
      available     : +available.toFixed(1)
    };
  });
}


export function buildDailyUsageFrom(plan, fromIso){         // ← NEW
  const arr = buildDailyUsage(plan);        // existing helper
  const fromDay = isoToInputDate(fromIso);  // Extract YYYY-MM-DD part
  return arr.filter(r => r.day >= fromDay); // Compare date strings only
}

/* Idle gap detector (simple) */
export function buildIdleGaps(plan) {
  return plan.allocations
    .filter(a => !isBox(a))
    .sort((a, b) => a.start.localeCompare(b.start))
    .reduce((acc, cur, i, arr) => {
      const next = arr[i + 1];
      if (next && cur.resource_id === next.resource_id) {
        const gap = new Date(next.start) - new Date(cur.end);
        acc.push({ resource_id: cur.resource_id,
            resource_name: plan.resources.find(r => r.id === cur.resource_id)?.name ?? cur.resource_id,
            hours: +(gap / 36e5).toFixed(1) });
      }
      return acc;
    }, []);
}


