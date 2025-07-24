import { buildUtilisation, buildIdleGaps, countMilestones } from './analytics.js';

export function refreshAnalytics(plan){
  /* existing utilisation & idle code … */

  /* ─ Milestone badge ─ */
    document.getElementById('kpi-milestones').textContent =
        `${countMilestones(plan)} milestones`;
}
