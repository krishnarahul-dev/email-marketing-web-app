/**
 * Business day and send-window utilities.
 * All calculations are timezone-aware.
 */

interface SendWindow {
  start: string;          // 'HH:MM:SS'
  end: string;            // 'HH:MM:SS'
  timezone: string;       // IANA timezone, e.g. 'America/New_York'
  skipWeekends: boolean;
}

/**
 * Add N business days to a date, skipping weekends.
 * Optionally skip weekends entirely.
 */
export function addBusinessDays(start: Date, days: number, skipWeekends: boolean = true): Date {
  if (days === 0) return new Date(start);
  if (!skipWeekends) {
    const result = new Date(start);
    result.setDate(result.getDate() + days);
    return result;
  }

  const result = new Date(start);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) {
      added++;
    }
  }
  return result;
}

/**
 * Compute the next valid send time given a desired moment and a send window.
 * If the desired time is outside the window or on a weekend (when skipWeekends=true),
 * returns the next valid time inside the window.
 */
export function clampToSendWindow(desired: Date, window: SendWindow): Date {
  // Convert desired to the workspace timezone
  const tzDate = new Date(desired.toLocaleString('en-US', { timeZone: window.timezone }));
  const offset = desired.getTime() - tzDate.getTime();

  let candidate = new Date(desired);

  // Skip weekends if needed
  if (window.skipWeekends) {
    const day = getDayInTimezone(candidate, window.timezone);
    if (day === 0) {
      // Sunday → Monday
      candidate.setDate(candidate.getDate() + 1);
    } else if (day === 6) {
      // Saturday → Monday
      candidate.setDate(candidate.getDate() + 2);
    }
  }

  // Get the candidate's hour:minute in the target timezone
  const [startH, startM] = window.start.split(':').map(Number);
  const [endH, endM] = window.end.split(':').map(Number);
  const candidateHour = getHourInTimezone(candidate, window.timezone);
  const candidateMin = getMinuteInTimezone(candidate, window.timezone);
  const candidateMinutes = candidateHour * 60 + candidateMin;
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  // Before window → push to start of today
  if (candidateMinutes < startMinutes) {
    candidate = setTimeInTimezone(candidate, startH, startM, 0, window.timezone);
  }
  // After window → push to start of next day, then re-check weekend
  else if (candidateMinutes >= endMinutes) {
    candidate.setDate(candidate.getDate() + 1);
    candidate = setTimeInTimezone(candidate, startH, startM, 0, window.timezone);
    if (window.skipWeekends) {
      const day = getDayInTimezone(candidate, window.timezone);
      if (day === 0) candidate.setDate(candidate.getDate() + 1);
      else if (day === 6) candidate.setDate(candidate.getDate() + 2);
    }
  }

  return candidate;
}

function getDayInTimezone(date: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  });
  const day = formatter.format(date);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[day] ?? 0;
}

function getHourInTimezone(date: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  });
  return parseInt(formatter.format(date));
}

function getMinuteInTimezone(date: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    minute: '2-digit',
  });
  return parseInt(formatter.format(date));
}

function setTimeInTimezone(date: Date, hour: number, minute: number, second: number, timezone: string): Date {
  // Create a date at the specified time in the given timezone.
  // We find the offset by formatting and reverse-engineering.
  const targetISO = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parseInt(targetISO.find(p => p.type === type)?.value ?? '0');
  const year = get('year');
  const month = get('month');
  const day = get('day');

  // Construct the desired wall-clock time in target tz, then convert back to UTC instant
  const localISO = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;

  // Calculate the timezone offset for this date in the target zone
  const utcDate = new Date(localISO + 'Z');
  const tzAtThatTime = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'shortOffset',
  }).formatToParts(utcDate);
  const offsetStr = tzAtThatTime.find(p => p.type === 'timeZoneName')?.value ?? 'GMT+0';
  const offsetMatch = offsetStr.match(/GMT([+-]\d+)(?::?(\d+))?/);
  const offsetHours = offsetMatch ? parseInt(offsetMatch[1]) : 0;
  const offsetMins = offsetMatch && offsetMatch[2] ? parseInt(offsetMatch[2]) * (offsetHours < 0 ? -1 : 1) : 0;
  const totalOffsetMs = (offsetHours * 60 + offsetMins) * 60 * 1000;

  return new Date(utcDate.getTime() - totalOffsetMs);
}

/**
 * Compute the absolute next-send timestamp for a sequence step,
 * combining business-day delays + clock delays + send-window enforcement.
 */
export function computeNextSendAt(
  baseTime: Date,
  step: {
    delay_business_days: number;
    delay_days: number;
    delay_hours: number;
    delay_minutes: number;
  },
  window: SendWindow
): Date {
  let next = new Date(baseTime);

  // Apply business days first
  if (step.delay_business_days && step.delay_business_days > 0) {
    next = addBusinessDays(next, step.delay_business_days, true);
  }

  // Apply calendar delays
  if (step.delay_days) next.setDate(next.getDate() + step.delay_days);
  if (step.delay_hours) next.setHours(next.getHours() + step.delay_hours);
  if (step.delay_minutes) next.setMinutes(next.getMinutes() + step.delay_minutes);

  // Clamp to send window
  next = clampToSendWindow(next, window);
  return next;
}
