/* timeline.js – now editable */
import { Timeline } from '../assets/vendor/vis-timeline-graph2d.esm.min.js';
import { DataSet } from '../assets/vendor/vis-data.esm.min.js';
import { hasClash, buildOverbookBands } from './allocations.js';
import { isBox, durationDays } from './allocations.js';

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
  const items  = new DataSet();

  timeline = new Timeline(container, items, groups, {
    orientation: 'top',
    // configure: true,

    editable: {
      updateTime : true,   // drag / resize
      updateGroup: true,   // drag to another row
      add        : false,
      remove     : false,
    },
  //   template: function (item) {
  //   // This function returns the HTML content for each item
  //   return `
  //     <div>${item.content}</div>
  //     <a class="my-custom-button" data-item-id="${item.id}">Edit</a>
  //   `;
  // },
    snap: function (date, scale, step) {
        // This function will be called when an item is being dragged or resized.
        // 'date' is the current date/time being considered for snapping.
        // 'scale' and 'step' represent the current visible time scale (e.g., 'day', 'hour', 'minute')
        // and the step size of that scale.

        // To snap to days, we'll round the date to the nearest day.
        var snappedDate = new Date(date);
        snappedDate.setHours(0, 0, 0, 0); // Set to the beginning of the day

        // If the time is past noon, round up to the next day for better user experience
        if (date.getHours() >= 12) {
          snappedDate.setDate(snappedDate.getDate() + 1);
        }

        return snappedDate.getTime(); // Return the snapped timestamp
      },
    stack: true,
    zoomMin : 9e5, // 15 min
    zoomMax : 3.1e10, // 1 year
  });

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
  items.add(plan.allocations.map(a => ({
    id: a.id,
    group: a.resource_id,
    start: a.start,
    end: a.end,
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
      start: a.baseline_start,
      end: a.baseline_end,
      type: 'range',
      className: 'baseline'
    }
  ));
  items.add(buildOverbookBands(plan));
  timeline.fit();                                  // always land on visible window
}

export function redraw() {
  timeline && timeline.redraw();
}

