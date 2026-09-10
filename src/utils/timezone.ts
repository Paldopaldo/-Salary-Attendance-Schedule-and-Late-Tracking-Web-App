// Utility for Asia/Manila timezone business logic and formatting

export const TIMEZONE = 'Asia/Manila';

/**
 * Returns the current date and time in Asia/Manila
 */
export function getManilaNow(): {
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  formattedTime: string; // h:mm A (e.g. 7:12 AM)
  month: string; // YYYY-MM
  isoString: string;
  timestamp: number;
} {
  const now = new Date();

  // Format parts according to Asia/Manila timezone
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const date = dateFormatter.format(now); // YYYY-MM-DD

  const timeFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const time = timeFormatter.format(now); // HH:mm

  const displayFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const formattedTime = displayFormatter.format(now); // e.g. 7:12 AM

  const month = date.substring(0, 7); // YYYY-MM

  return {
    date,
    time,
    formattedTime,
    month,
    isoString: now.toISOString(),
    timestamp: now.getTime(),
  };
}

/**
 * Converts a 24-hour time string (e.g. "07:12") to 12-hour formatted time (e.g. "7:12 AM")
 */
export function formatTo12Hour(time24: string): string {
  if (!time24) return '';
  const [hStr, mStr] = time24.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr || '0', 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const displayHour = h % 12 === 0 ? 12 : h % 12;
  const displayMin = m < 10 ? `0${m}` : `${m}`;
  return `${displayHour}:${displayMin} ${ampm}`;
}

/**
 * Calculates late minutes based on actual Time In and Scheduled Start Time.
 * Scheduled Start Time is default 07:00 (7:00 AM).
 * Only positive difference is considered late; early or on-time arrival returns 0.
 */
export function calculateLateMinutes(timeIn: string, scheduledStart: string = '07:00'): number {
  if (!timeIn || !scheduledStart) return 0;
  const [inH, inM] = timeIn.split(':').map(Number);
  const [startH, startM] = scheduledStart.split(':').map(Number);

  const actualMinutes = inH * 60 + inM;
  const scheduledMinutes = startH * 60 + startM;

  const diff = actualMinutes - scheduledMinutes;
  return diff > 0 ? diff : 0;
}

/**
 * Computes Monday to Sunday date range for a given date in Asia/Manila (YYYY-MM-DD)
 */
export function getManilaWeekRange(dateStr?: string): {
  weekStart: string; // Monday YYYY-MM-DD
  weekEnd: string;   // Sunday YYYY-MM-DD
  weekLabel: string; // e.g. "Sep 7 - Sep 13, 2026"
} {
  const targetDateStr = dateStr || getManilaNow().date;
  const [year, month, day] = targetDateStr.split('-').map(Number);
  // Construct date in UTC for neutral day arithmetic
  const d = new Date(Date.UTC(year, month - 1, day));
  
  // getUTCDay(): 0 is Sunday, 1 is Monday, ..., 6 is Saturday
  const dayOfWeek = d.getUTCDay();
  // We want Monday as start of week (day diff: Monday is 0, Tuesday is 1, ..., Sunday is 6)
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + diffToMonday);

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  const formatIso = (dt: Date) => dt.toISOString().split('T')[0];

  const weekStart = formatIso(monday);
  const weekEnd = formatIso(sunday);

  const startMonthName = monday.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const endMonthName = sunday.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const weekLabel = `${startMonthName} ${monday.getUTCDate()} - ${endMonthName} ${sunday.getUTCDate()}, ${sunday.getUTCFullYear()}`;

  return {
    weekStart,
    weekEnd,
    weekLabel,
  };
}

/**
 * Returns Day of Week (e.g. "Monday", "Tuesday", etc.) for a date string in Asia/Manila
 */
export function getDayOfWeek(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.toLocaleString('en-US', { weekday: 'long', timeZone: 'UTC' });
}

/**
 * Validates whether a date belongs to a given calendar month in Asia/Manila
 */
export function isDateInMonth(dateStr: string, monthStr: string): boolean {
  return dateStr.startsWith(monthStr);
}
