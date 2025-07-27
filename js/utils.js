// utils.js

/**
 * Initializes the crypto object for generating UUIDs.
 * If the browser does not support `crypto.randomUUID`, it falls back to a custom implementation.
 * This is useful for generating unique identifiers in the application.
 */
export function initCrypto() {
  if (typeof window.crypto === 'undefined') window.crypto = {};
  if (!crypto.randomUUID) {
    crypto.randomUUID = function () {
      const bytes = new Uint8Array(16);
      if (crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
      } else {
        // extremely old browser – fallback to Math.random (lower entropy)
        for (let i = 0; i < 16; i++) bytes[i] = Math.random() * 256;
      }
      // set version / variant bits
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    };
  }
}

/**
 * Return the number of working hours *on that calendar day*.
 * Monday-Friday: 8 hours, Saturday: 4 hours, Sunday: 0 hours
 *
 * @param {Date|string|null} day   JS Date object or ISO string
 * @returns {number} hours
 */
export function workingHours(day = null) {
  if (!day) return 8; // default fallback
  
  const date = day instanceof Date ? day : new Date(day);
  const dayOfWeek = date.getUTCDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
  
  switch (dayOfWeek) {
    case 0: return 0; // Sunday
    case 1: // Monday
    case 2: // Tuesday
    case 3: // Wednesday
    case 4: // Thursday
    case 5: return 8; // Friday
    case 6: return 4; // Saturday
    default: return 8;
  }
}

/**
* Hours an allocation really books, calendar-aware.
* Milestones (boxes) return 0.
*/
export function plannedHours(a){
  if (!a.end) return 0;                      // ← replaces isBox test

  let hrs = 0;
  for (let d = new Date(a.start); d <= new Date(a.end); d.setUTCDate(d.getUTCDate()+1))
    hrs += workingHours(d);
  return hrs * (a.allocation_pct/100);
}

/**
 * Inclusive calendar-day span.
 * e.g. 1 May → 2 May  = 2 days.
 */
export function daysBetween(d1, d2){
  console.log('daysBetween:', d1, d2);
  console.log('result by subtracting:', (d2 - d1) / 86_400_000);
  const a = new Date(d1); a.setUTCHours(0,0,0,0);   // strip time
  const b = new Date(d2); b.setUTCHours(0,0,0,0);
  console.log('result:', a, b, (b - a) / 86_400_000 + 1);
  return Math.max(1, (b - a) / 86_400_000 + 1);
}


/**
 * Turn a stored *UTC* ISO string into a Date that shows local
 * midnight / day-end when rendered on the timeline axis.
 * Works across DST because we read the offset of that day.
 */
export function utcIsoToLocalDate(iso){
  const d = new Date(iso);                        // UTC instant
  return new Date(d.getTime() + d.getTimezoneOffset()*60000);
}

/**
 * Do the reverse: take a Date the user just dragged/resized
 * (which is at *local* clock time) and convert it back to the
 * canonical UTC ISO you store in the plan JSON.
 */
export function localDateToUtcIso(date){
  if (!date) return null;                    // ⇽ bail out gracefully
  const t = (date instanceof Date) ? date    // vis-timeline gives Date
            : new Date(date);                // but defend against strings
  return new Date(t.getTime() - t.getTimezoneOffset()*60000).toISOString();
}

/** Return yyyy-mm-dd that the user originally chose (UTC slice). */
export function isoToInputDate(iso){
  return iso ? iso.slice(0, 10) : '';
}

 /**
 * Convert a local Date (from vis-timeline) that represents a RANGE END
 * into our inclusive-UTC ISO (…T23:59:59.999Z). If the timestamp is
 * exactly local midnight we shift back 1 ms so the stored ISO points
 * to the *previous* day’s inclusive end. Otherwise we keep the clock time.
 */
export function localEndDateToUtcIso(date){
  if (!date) return null;
  const d = (date instanceof Date) ? date : new Date(date);
  const isMidnight = d.getHours()===0 && d.getMinutes()===0 &&
                    d.getSeconds()===0 && d.getMilliseconds()===0;
  const adjusted = isMidnight ? new Date(d.getTime() - 1) : d;    // back 1 ms
  return new Date(adjusted.getTime() - adjusted.getTimezoneOffset()*60000)
        .toISOString();
}