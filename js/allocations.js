/* allocations.js – overlap checks & resource picker */
import { plannedHours } from './utils.js'
/* ---------- generic helpers ---------- */
export const isBox = a => !a.end;                    // start-only item

export function durationHours(a){
  if (isBox(a)) return 0;
  return (new Date(a.end) - new Date(a.start)+1) / 36e5;
}

export function durationDays(a){
  console.log('durationDays: hours', durationHours(a));
  return +(durationHours(a) / 24).toFixed(1);        // 1 decimal, e.g. “3.5”
}

export function hasClash(plan, resId, start, end, ignoreId) {
  const s = new Date(start), e = new Date(end);
  return plan.allocations.some(a =>
    a.resource_id === resId && a.id !== ignoreId &&
    !(e <= new Date(a.start) || s >= new Date(a.end)));
}

export function populateResourcePicker(selectEl, plan, selected) {
  selectEl.innerHTML = plan.resources.map(r =>
    `<option value="${r.id}" ${r.id===selected?'selected':''}>${r.name}</option>`).join('');
}

/**
  * Build vis-Timeline “background” items that cover any interval where the
  * **sum of allocation_pct for a resource rises above 100 %**.
  * Returns [{start, end, group, type:'background', className:'bg-overbook'}].
  */
export function buildOverbookBands(plan){
  const bands = [];

  plan.resources.forEach(r => {
    const events = [];
    plan.allocations
        .filter(a => a.resource_id === r.id)
        .forEach(a => {
          events.push({ t:new Date(a.start), d:+a.allocation_pct });   // +load
          events.push({ t:new Date(a.end  ), d:-a.allocation_pct });   // -load
        });

    events.sort((a,b)=> a.t-b.t || b.d-b.d);        // starts before ends at same ms

    let load = 0, bandStart = null;
    for (const {t,d} of events){
      const prev = load;
      load += d;
      if (prev <= 100 && load > 100)        bandStart = t; // overload begins
      if (prev > 100  && load <= 100 && bandStart){
        bands.push({ start: bandStart, end: t,
                    group: r.id, type:'background', className:'bg-overbook' });
        bandStart = null;
      }
    }
  });
  return bands;
}

export function calcCost(allocation, plan){
  console.log('calcCost called', allocation);
  const res = plan.resources.find(r => r.id === allocation.resource_id) || { cost_per_hour: 0 };
  const hours = plannedHours(allocation);         // ← NEW: calendar-aware
  console.log('productiveHours:', hours);
  console.log('returning cost:', +(hours * res.cost_per_hour).toFixed(2));
  return +(hours * res.cost_per_hour).toFixed(2);
}