
// analytics.js - centralized KPI functions

import { isBox } from './allocations.js';
import { plannedHours, isoToInputDate } from './utils.js';

/*********************************************************************
 * buildDailyUsage(plan)
 * --------------------------------------------------
 * Returns [{ resource_id, resource_name, day:'YYYY-MM-DD', pct:Number }, …]
 * --------------------------------------------------
 * - “day” is in the plan’s timezone (ISO slice 0-10 uses UTC consistency;
 *    if you store local dates, adjust accordingly).
 * - Milestones (boxes) are ignored.
 * - Overlapping allocations stack (e.g. 70 % + 40 % = 110 % for that day).
 *********************************************************************/
export function buildDailyUsage(plan) {
  const dayMap = new Map();                // key: resId#YYYY-MM-DD → pct sum

  /* walk each allocation, distribute its % across calendar days */
  plan.allocations.forEach(a => {
    if (isBox(a)) return;

    const start = new Date(a.start);
    const end   = new Date(a.end);
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const dayKey = d.toISOString().slice(0, 10);            // YYYY-MM-DD
      const key = `${a.resource_id}#${dayKey}`;
      dayMap.set(key, (dayMap.get(key) || 0) + a.allocation_pct);
    }
  });

  /* unwrap to handy array, add the friendly resource name */
  return Array.from(dayMap, ([key, pct]) => {
    const [resId, day] = key.split('#');
    const resName      = plan.resources.find(r => r.id === resId)?.name || resId;
    return { resource_id: resId, resource_name: resName, day, pct: +pct.toFixed(1) };
  }).sort((a, b) => a.day.localeCompare(b.day) ||
                    a.resource_name.localeCompare(b.resource_name));
}
/*********************************************************************


/* Utilisation percentage per resource */
export function buildUtilisation(plan) {
  // 1. Determine the overall time-frame of this plan
  const starts = plan.allocations.map(a => new Date(a.start));
  const ends   = plan.allocations.filter(a => a.end)
                                  .map(a => new Date(a.end));
  const planStart = new Date(Math.min(...starts));
  const planEnd   = new Date(Math.max(...ends, planStart));

  // Approx. months spanned (≥ 1)
  const months = Math.max(1,
    (planEnd.getFullYear()  - planStart.getFullYear()) * 12 +
    (planEnd.getMonth()     - planStart.getMonth()) + 1);

  const map = new Map();             // resourceId → { booked, available }
  plan.resources.forEach(r => {
    // Capacity ≈ 160 h per month of plan duration
    map.set(r.id, { booked: 0, available: 160 * months });
  });

  plan.allocations.forEach(a => {
    if (isBox(a)) return;
    const m = map.get(a.resource_id);
    m.booked += plannedHours(a);
  });

  return Array.from(map, ([id, v]) => {
    const r = plan.resources.find(res => res.id === id);
    return {
      resource_id   : id,
      resource_name : r?.name ?? id,                   // ← new
      pct           : +(100 * v.booked / v.available).toFixed(1),
      booked        : v.booked,
      available     : v.available
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

/* Count milestones (boxes) */
export const countMilestones = plan =>
  plan.allocations.filter(isBox).length;
