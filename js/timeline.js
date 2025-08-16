/* timeline.js – now editable */
import { Timeline } from '../assets/vendor/vis-timeline-graph2d.esm.min.js';
import { DataSet } from '../assets/vendor/vis-data.esm.min.js';
import { hasClash, buildOverbookBands } from './allocations.js';
import { isBox, durationDays } from './allocations.js';
import { utcIsoToLocalDate, getPlanWindow, getResourceHireWindow, normalWorkingHours, workingHours } from './utils.js';

export let timeline;

/* escape HTML so user-typed task can’t break markup */
const esc = s => s.replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* build innerHTML for every bar / box */
export function buildContent(a){
  const pct = `<span style="font-size: 5rem;">${a.allocation_pct}%</span>`;
  const dur = isBox(a) ? '' :
              `<span class="pill pill-dur">${durationDays(a)}d</span>`;
  return `<small>${esc(a.task)}</small>`;
}

export function initTimeline(container, onSelect) {
  const groups = new DataSet();
  const items = new DataSet();

  timeline = new Timeline(container, items, groups, {
    /* Draw the entire axis in UTC so 00:00-23:59:59Z spans the
       full visible day for every user, regardless of their locale */
    orientation: 'top',
    // configure: true,

    editable: {
      updateTime: true,   // drag / resize
      updateGroup: true,   // drag to another row
      add: false,
      remove: false,
    },
  //   template: function (item) {
  //   // This function returns the HTML content for each item
  //   return `
  //     <div>${item.content}</div>
  //     <a class="my-custom-button" data-item-id="${item.id}">Edit</a>
  //   `;
  // },
  snap: function (date) {
    const d = new Date(date);
    d.setHours(12, 0, 0, 0); // midday grid prevents day-shift
    return d.getTime();
  },

  onMoving: function (item, callback) {
    const startChanged = item._originalStart !== item.start; // we store this before move
    const endChanged   = item._originalEnd !== item.end;

    if (startChanged) {
      const s = new Date(item.start);
      s.setHours(0, 0, 0, 0); // snap to start-of-day
      item.start = s;
    }

    if (endChanged && item.end) {
      const e = new Date(item.end);
      e.setHours(23, 59, 59, 999); // snap to end-of-day
      item.end = e;
    }

    callback(item);
  },

  onMove: function (item, callback) {
    // Final save, enforce same rules as onMoving
    const s = new Date(item.start);
    s.setHours(0, 0, 0, 0);
    item.start = s;

    if (item.end) {
      const e = new Date(item.end);
      e.setHours(23, 59, 59, 999);
      item.end = e;
    }

    callback(item);
  },

    stack: true,
    zoomMin : 9e5, // 15 min
    zoomMax : 3.1e10, // 1 year
  });
  timeline.setCurrentTime(new Date().setUTCHours(0, 0, 0, 0));
  timeline.on('select', onSelect);

  return { groups, items }; // expose sets to refreshTimeline
}


export function refreshTimeline(plan, sets) {
  const { groups, items } = sets;

  /* refresh groups */
  groups.clear();
  const usedResourceIds = new Set(plan.allocations.map(a => a.resource_id));
  groups.add(
    plan.resources
      .filter(r => usedResourceIds.has(r.id))
      .map(r => {
        // Limit r.name to max 60 chars
        const name = r.name && r.name.length > 60 ? r.name.slice(0, 50) + '…' : r.name;
        return {
          id: r.id,
          content: `
            <div>
              <div>${name}</div>
              <div><small>${r.class || ''}</small></div>
            </div>
          `
        };
      })
  );

  /* refresh items */
  items.clear();
  const hireBands = buildHireBands(plan);
  if (hireBands.length) items.add(hireBands);

  items.add(plan.allocations.map(a => ({
    id: a.id,
    group: a.resource_id,
    start: utcIsoToLocalDate(a.start), // show local midnight
    end: isBox(a) ? null : utcIsoToLocalDate(a.end),     // show local day-end
    content: buildContent(a),
    title: a.task,
    allocation_pct: a.allocation_pct,            // store custom field for later
    className: 'allocation',                // Add the class property
  })));

  /* baseline shadow: point for boxes, thin range for normal allocs */
  items.add(plan.allocations.map(a =>
    isBox(a) ? {
      id: a.id + '_bl',
      group: a.resource_id,
      start: a.baseline_start,
      type: 'point',
      className: 'baseline point'
    } : {
      id: a.id + '_bl',
      group: a.resource_id,
      start: utcIsoToLocalDate(a.baseline_start),
      end: utcIsoToLocalDate(a.baseline_end),
      type: 'range',
      className: 'baseline'
    }
  ));

  items.add(buildOverbookBands(plan));
  items.add(buildLowHourBands(plan));
  // timeline.fit();                                  // always land on visible window
}

export function redraw() {
  timeline && timeline.redraw();
}

function buildLowHourBands(plan) {
  const { start, end } = getPlanWindow(plan);
  if (!start || !end) return [];

  const normHours = normalWorkingHours();
  const bands = [];

  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dayHours = workingHours(d);
    if (dayHours < normHours) {
      const diff = normHours - dayHours;
      const intensity = Math.min(diff / normHours, 1); // 0 → 1
      const alpha = (0.1 + intensity * 0.4).toFixed(2); // 0.10 to 0.50

      const dayStart = new Date(d);
      const dayEnd = new Date(d);
      dayEnd.setHours(23, 59, 59, 999);

      bands.push({
        id: `bg-low-${dayStart.toISOString().slice(0, 10)}`,
        start: dayStart,
        end: dayEnd,
        type: 'background',
        style: `background-color: rgba(255, 200, 0, ${alpha*0.5});`
      });
    }
  }

  return bands;
}

function buildHireBands(plan) {
  // Only draw for resources that have a row (same filter as groups)
  const usedIds = new Set(plan.allocations.map(a => a.resource_id));
  const bands = [];

  plan.resources
    .filter(r => usedIds.has(r.id)) // keep this aligned with how groups are built
    .forEach(r => {
      const { start, end } = getResourceHireWindow(plan, r);
      // Convert to local-axis Dates (we store UTC ISO)
      const startLocal = start.setHours(0,0,0,0);
      const endLocal   = end.setHours(0,0,0,0);

      bands.push({
        id: `hire_${r.id}`,
        group: r.id,
        start: startLocal,
        end: endLocal,
        type: 'background',
        className: 'bg-hire'
      });
    });

  return bands;
}
