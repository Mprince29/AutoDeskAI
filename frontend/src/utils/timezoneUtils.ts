import { DateTime } from 'luxon';
/**
 * Comprehensive timezone utilities for the Email AI Agent
 */

export interface TimezoneInfo {
  value: string;
  label: string;
  offset: string;
  description: string;
}

export const SUPPORTED_TIMEZONES: TimezoneInfo[] = [
  {
    value: 'UTC',
    label: 'UTC',
    offset: '+00:00',
    description: 'Universal Time Coordinated'
  },
  {
    value: 'GMT',
    label: 'GMT',
    offset: '+00:00',
    description: 'Greenwich Mean Time'
  },
  {
    value: 'America/New_York',
    label: 'EST/EDT',
    offset: '-05:00/-04:00',
    description: 'Eastern Standard Time / Eastern Daylight Time'
  },
  {
    value: 'America/Chicago',
    label: 'CST/CDT',
    offset: '-06:00/-05:00',
    description: 'Central Standard Time / Central Daylight Time'
  },
  {
    value: 'America/Denver',
    label: 'MST/MDT',
    offset: '-07:00/-06:00',
    description: 'Mountain Standard Time / Mountain Daylight Time'
  },
  {
    value: 'America/Los_Angeles',
    label: 'PST/PDT',
    offset: '-08:00/-07:00',
    description: 'Pacific Standard Time / Pacific Daylight Time'
  },
  {
    value: 'Europe/London',
    label: 'GMT/BST',
    offset: '+00:00/+01:00',
    description: 'Greenwich Mean Time / British Summer Time'
  },
  {
    value: 'Europe/Paris',
    label: 'CET/CEST',
    offset: '+01:00/+02:00',
    description: 'Central European Time / Central European Summer Time'
  },
  {
    value: 'Asia/Kolkata',
    label: 'IST',
    offset: '+05:30',
    description: 'Indian Standard Time'
  },
  {
    value: 'Asia/Shanghai',
    label: 'CST',
    offset: '+08:00',
    description: 'China Standard Time'
  },
  {
    value: 'Asia/Tokyo',
    label: 'JST',
    offset: '+09:00',
    description: 'Japan Standard Time'
  },
  {
    value: 'Asia/Dubai',
    label: 'AST',
    offset: '+04:00',
    description: 'Arabia Standard Time'
  }
];

/**
 * Get the user's browser timezone
 */
export function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch (error) {
    console.warn('Could not detect browser timezone:', error);
    return 'UTC';
  }
}

/**
 * Get timezone info by value
 */
export function getTimezoneInfo(timezoneValue: string): TimezoneInfo | undefined {
  return SUPPORTED_TIMEZONES.find(tz => tz.value === timezoneValue);
}

/**
 * Get current timezone offset for a specific timezone
 */
export function getCurrentTimezoneOffset(timezoneValue: string): string {
  try {
    const date = new Date();
    const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
    const targetTime = new Date(utc + (0 * 60000));
    
    const formatter = new Intl.DateTimeFormat('en', {
      timeZone: timezoneValue,
      timeZoneName: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric'
    });
    
    const parts = formatter.formatToParts(targetTime);
    const timeZonePart = parts.find(part => part.type === 'timeZoneName');
    
    return timeZonePart?.value || '+00:00';
  } catch (error) {
    console.warn(`Could not get offset for timezone ${timezoneValue}:`, error);
    return '+00:00';
  }
}

/**
 * Convert local time to ISO string with proper timezone handling
 */
export function convertLocalTimeToISO(localTimeString: string, targetTimezone: string = 'UTC'): string {
  try {
    if (!validateTimezone(targetTimezone)) {
      console.warn(`Invalid timezone: ${targetTimezone}, defaulting to UTC`);
      targetTimezone = 'UTC';
    }

    // Parse local time string as naive local datetime
    const local = DateTime.fromISO(localTimeString, { zone: 'local' });

    // Convert to target timezone, keeping wall clock time
    const zoned = local.setZone(targetTimezone, { keepLocalTime: true });

    // Convert to UTC ISO string (standard for APIs like Google Calendar)
    const isoString = zoned.toUTC().toISO();
    if (!isoString) {
      throw new Error('Failed to convert to ISO string');
    }
    return isoString;
  } catch (error) {
    console.error('Error in timezone conversion:', error);
    return new Date().toISOString();
  }
}

/**
 * Get timezone offset in minutes for a specific date and timezone
 */
function getTimezoneOffsetForDate(date: Date, timezone: string): number {
  try {
    // Create a date string in the target timezone
    const targetDateString = date.toLocaleString('en-US', { timeZone: timezone });
    
    // Create a new date from this string (this will be in local timezone)
    const targetDate = new Date(targetDateString);
    
    // Calculate the offset difference
    // This gives us the difference between UTC and the target timezone
    const utcTime = date.getTime() + (date.getTimezoneOffset() * 60000);
    const targetTime = targetDate.getTime() + (targetDate.getTimezoneOffset() * 60000);
    
    return (utcTime - targetTime) / 60000;
  } catch (error) {
    console.warn(`Could not get offset for timezone ${timezone}:`, error);
    return 0; // Default to UTC
  }
}

/**
 * Format date/time for display with timezone
 */
export function formatDateTimeWithTimezone(dateTimeString: string, timezone: string = 'UTC'): string {
  try {
    const date = new Date(dateTimeString);
    const _timezoneInfo = getTimezoneInfo(timezone);
    
    return date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone,
      timeZoneName: 'short'
    });
  } catch (error) {
    console.error('Error formatting date with timezone:', error);
    return dateTimeString;
  }
}

/**
 * Get timezone options for select dropdown
 */
export function getTimezoneOptions(): { value: string; label: string }[] {
  return SUPPORTED_TIMEZONES.map(tz => ({
    value: tz.value,
    label: `${tz.label} (${tz.description})`
  }));
}

/**
 * Check if a timezone is supported
 */
export function isTimezoneSupported(timezone: string): boolean {
  return SUPPORTED_TIMEZONES.some(tz => tz.value === timezone);
}

/**
 * Get recommended timezone based on browser timezone
 */
export function getRecommendedTimezone(): string {
  const browserTimezone = getBrowserTimezone();

  // Check if browser timezone is directly supported
  if (isTimezoneSupported(browserTimezone)) {
    return browserTimezone;
  }

  // Alias map: common IANA names not in SUPPORTED_TIMEZONES → nearest match
  const ALIAS_MAP: Record<string, string> = {
    'Asia/Calcutta': 'Asia/Kolkata',
    'Asia/Kolkata': 'Asia/Kolkata',
    'US/Eastern': 'America/New_York',
    'US/Central': 'America/Chicago',
    'US/Mountain': 'America/Denver',
    'US/Pacific': 'America/Los_Angeles',
    'America/Indiana/Indianapolis': 'America/New_York',
    'America/Detroit': 'America/New_York',
    'Europe/Berlin': 'Europe/Paris',
    'Europe/Amsterdam': 'Europe/Paris',
    'Europe/Rome': 'Europe/Paris',
    'Europe/Madrid': 'Europe/Paris',
    'Asia/Singapore': 'Asia/Shanghai',
    'Asia/Hong_Kong': 'Asia/Shanghai',
    'Asia/Taipei': 'Asia/Shanghai',
    'Asia/Seoul': 'Asia/Tokyo',
    'Asia/Karachi': 'Asia/Dubai',
    'Asia/Riyadh': 'Asia/Dubai',
    'Asia/Baghdad': 'Asia/Dubai',
    'Africa/Nairobi': 'Asia/Dubai',
  };
  if (ALIAS_MAP[browserTimezone]) return ALIAS_MAP[browserTimezone];

  // Keyword fallback
  const browserLower = browserTimezone.toLowerCase();
  if (browserLower.includes('eastern') || browserLower.includes('new_york')) return 'America/New_York';
  if (browserLower.includes('central') || browserLower.includes('chicago')) return 'America/Chicago';
  if (browserLower.includes('mountain') || browserLower.includes('denver')) return 'America/Denver';
  if (browserLower.includes('pacific') || browserLower.includes('los_angeles')) return 'America/Los_Angeles';
  if (browserLower.includes('london') || browserLower.includes('british')) return 'Europe/London';
  if (browserLower.includes('paris') || browserLower.includes('berlin') || browserLower.includes('europe')) return 'Europe/Paris';
  if (browserLower.includes('india') || browserLower.includes('kolkata') || browserLower.includes('calcutta')) return 'Asia/Kolkata';
  if (browserLower.includes('china') || browserLower.includes('shanghai') || browserLower.includes('singapore') || browserLower.includes('hong')) return 'Asia/Shanghai';
  if (browserLower.includes('japan') || browserLower.includes('tokyo') || browserLower.includes('seoul')) return 'Asia/Tokyo';
  if (browserLower.includes('dubai') || browserLower.includes('arabia') || browserLower.includes('karachi')) return 'Asia/Dubai';

  // Last resort: match by UTC offset
  try {
    const nowOffset = -new Date().getTimezoneOffset(); // in minutes
    // IST = +330, GST = +240, CST = +480, JST = +540, etc.
    const offsetMap: [number, string][] = [
      [330, 'Asia/Kolkata'],
      [240, 'Asia/Dubai'],
      [480, 'Asia/Shanghai'],
      [540, 'Asia/Tokyo'],
      [-300, 'America/New_York'],
      [-360, 'America/Chicago'],
      [-420, 'America/Denver'],
      [-480, 'America/Los_Angeles'],
      [0,   'Europe/London'],
      [60,  'Europe/Paris'],
    ];
    const match = offsetMap.find(([off]) => off === nowOffset);
    if (match) return match[1];
  } catch { /* ignore */ }

  // Default to UTC if no match found
  return 'UTC';
}

/**
 * Validate timezone string
 */
export function validateTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Test function to verify timezone conversion (for debugging)
 */
export function testTimezoneConversion() {
  const testTime = "2024-01-15T14:30";
  const testTimezone = "America/New_York";
  
  console.log("Testing timezone conversion:");
  console.log("Input time:", testTime);
  console.log("Target timezone:", testTimezone);
  
  const result = convertLocalTimeToISO(testTime, testTimezone);
  console.log("Result:", result);
  
  // Also test the reverse to verify
  const date = new Date(result);
  console.log("Converted back to local:", date.toLocaleString());
  console.log("Converted to target timezone:", date.toLocaleString('en-US', { timeZone: testTimezone }));
  
  return result;
}

/**
 * Check if two timezones represent the same timezone (accounting for aliases)
 */
export function areTimezonesEquivalent(tz1: string, tz2: string): boolean {
  if (tz1 === tz2) return true;
  
  // Handle common timezone aliases
  const timezoneAliases: Record<string, string[]> = {
    'Asia/Kolkata': ['Asia/Calcutta'],
    'Asia/Calcutta': ['Asia/Kolkata'],
    'UTC': ['GMT'],
    'GMT': ['UTC'],
    'America/New_York': ['US/Eastern'],
    'US/Eastern': ['America/New_York'],
    'America/Chicago': ['US/Central'],
    'US/Central': ['America/Chicago'],
    'America/Denver': ['US/Mountain'],
    'US/Mountain': ['America/Denver'],
    'America/Los_Angeles': ['US/Pacific'],
    'US/Pacific': ['America/Los_Angeles']
  };
  
  // Check if tz1 has tz2 as an alias
  if (timezoneAliases[tz1]?.includes(tz2)) return true;
  
  // Check if tz2 has tz1 as an alias
  if (timezoneAliases[tz2]?.includes(tz1)) return true;
  
  // If no alias match, check if they have the same offset at current time
  try {
    const now = new Date();
    const offset1 = getTimezoneOffsetForDate(now, tz1);
    const offset2 = getTimezoneOffsetForDate(now, tz2);
    return offset1 === offset2;
  } catch {
    return false;
  }
}