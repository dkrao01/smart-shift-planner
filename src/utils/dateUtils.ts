import { format, parseISO, addDays, differenceInCalendarDays, isToday, isBefore, isAfter } from 'date-fns';

export function formatDate(date: string | Date, fmt = 'dd MMM yyyy'): string {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, fmt);
}

export function formatShortDate(date: string): string {
  return format(parseISO(date), 'dd MMM');
}

export function formatDayName(date: string): string {
  return format(parseISO(date), 'EEE');
}

export function getTodayStr(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

export function addDaysToStr(date: string, days: number): string {
  return format(addDays(parseISO(date), days), 'yyyy-MM-dd');
}

export function daysBetween(from: string, to: string): number {
  return differenceInCalendarDays(parseISO(to), parseISO(from));
}

export function isDateToday(date: string): boolean {
  return isToday(parseISO(date));
}

export function isDatePast(date: string): boolean {
  return isBefore(parseISO(date), new Date()) && !isToday(parseISO(date));
}

export function isDateFuture(date: string): boolean {
  return isAfter(parseISO(date), new Date());
}

/** Get the cycle day for the 23-day period: 6 work + 2 off, 6 work + 2 off, 6 work + 1 off. */
export function getCycleDay(dateOffset: number): { cycleNumber: 1 | 2 | 3; cycleDay: number; isWorkDay: boolean } {
  if (dateOffset < 8) {
    return { cycleNumber: 1, cycleDay: dateOffset + 1, isWorkDay: dateOffset < 6 };
  }
  if (dateOffset < 16) {
    const cycleDay = dateOffset - 7;
    return { cycleNumber: 2, cycleDay, isWorkDay: cycleDay <= 6 };
  }
  const cycleDay = dateOffset - 15;
  return { cycleNumber: 3, cycleDay, isWorkDay: cycleDay <= 6 };
}

/** Build an array of date strings for the 23-day period starting from startDate. */
export function buildPeriodRange(startDate: string): string[] {
  return Array.from({ length: 23 }, (_, i) => addDaysToStr(startDate, i));
}

export function isSameDate(a: string, b: string): boolean {
  return a === b;
}
