import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  schoolYearShort,
  findSchoolYearByShort,
  isDraftSchoolYear,
  hasSchoolYearStarted,
  findSchoolYearForDate,
  isPreviewWindowOpen,
  isPreviewGateOpen,
  isFinishedSchoolYear,
  selectableSchoolYears,
} from '@/src/lib/schoolYear';
import type { SchoolYearSummary } from '@/src/types';

const YEAR_2526: SchoolYearSummary = {
  id: 1,
  name: '2025/2026',
  startDate: '2025-08-17T22:00:00.000Z',
  endDate: '2026-07-15T22:00:00.000Z',
};
const YEAR_2627: SchoolYearSummary = {
  id: 2,
  name: '2026/2027',
  startDate: '2026-08-16T22:00:00.000Z',
  endDate: '2027-07-14T22:00:00.000Z',
};
const YEARS = [YEAR_2526, YEAR_2627];

const at = (iso: string) => new Date(iso).getTime();

describe('schoolYearShort', () => {
  it('returns the 2-digit start year', () => {
    expect(schoolYearShort(YEAR_2526)).toBe('25');
    expect(schoolYearShort(YEAR_2627)).toBe('26');
  });
});

describe('findSchoolYearByShort', () => {
  it('resolves a short form to its year', () => {
    expect(findSchoolYearByShort('26', YEARS)).toBe(YEAR_2627);
    expect(findSchoolYearByShort('25', YEARS)).toBe(YEAR_2526);
  });
  it('returns null for unknown or invalid input', () => {
    expect(findSchoolYearByShort('99', YEARS)).toBeNull();
    expect(findSchoolYearByShort('abc', YEARS)).toBeNull();
  });
});

describe('isDraftSchoolYear', () => {
  it('shows the notice for a future year before the current year ends', () => {
    expect(isDraftSchoolYear(YEAR_2627, YEARS, at('2026-06-11T00:00:00.000Z'))).toBe(true);
  });

  it('hides the notice once the previous year has ended (summer break)', () => {
    expect(isDraftSchoolYear(YEAR_2627, YEARS, at('2026-07-20T00:00:00.000Z'))).toBe(false);
  });

  it('hides the notice once the year itself has started', () => {
    expect(isDraftSchoolYear(YEAR_2627, YEARS, at('2026-09-01T00:00:00.000Z'))).toBe(false);
  });

  it('never shows the notice for the current (already started) year', () => {
    expect(isDraftSchoolYear(YEAR_2526, YEARS, at('2026-06-11T00:00:00.000Z'))).toBe(false);
  });

  it('shows the notice for a future year when no previous year is known', () => {
    expect(isDraftSchoolYear(YEAR_2627, [YEAR_2627], at('2026-06-11T00:00:00.000Z'))).toBe(true);
  });

  it('returns false for an undefined year', () => {
    expect(isDraftSchoolYear(undefined, YEARS, at('2026-06-11T00:00:00.000Z'))).toBe(false);
  });
});

describe('hasSchoolYearStarted', () => {
  it('is false before the start date (draft year still in the future)', () => {
    expect(hasSchoolYearStarted(YEAR_2627, at('2026-06-11T00:00:00.000Z'))).toBe(false);
  });

  it('is true on or after the start date', () => {
    expect(hasSchoolYearStarted(YEAR_2627, at('2026-08-16T22:00:00.000Z'))).toBe(true);
    expect(hasSchoolYearStarted(YEAR_2627, at('2026-09-01T00:00:00.000Z'))).toBe(true);
  });

  it('is true for the current, already-started year', () => {
    expect(hasSchoolYearStarted(YEAR_2526, at('2026-06-11T00:00:00.000Z'))).toBe(true);
  });

  it('returns false for an undefined year', () => {
    expect(hasSchoolYearStarted(undefined, at('2026-06-11T00:00:00.000Z'))).toBe(false);
  });
});

describe('findSchoolYearForDate', () => {
  it('returns the year whose range contains the date', () => {
    expect(findSchoolYearForDate(YEARS, at('2025-12-01T00:00:00.000Z'))).toBe(YEAR_2526);
    expect(findSchoolYearForDate(YEARS, at('2026-10-01T00:00:00.000Z'))).toBe(YEAR_2627);
  });

  it('returns undefined for a date outside every year (e.g. summer break)', () => {
    // Between YEAR_2526 end (2026-07-15) and YEAR_2627 start (2026-08-16).
    expect(findSchoolYearForDate(YEARS, at('2026-08-01T00:00:00.000Z'))).toBeUndefined();
  });
});

describe('isFinishedSchoolYear', () => {
  it('is true only after the end date', () => {
    expect(isFinishedSchoolYear(YEAR_2526, at('2026-07-15T21:00:00.000Z'))).toBe(false);
    expect(isFinishedSchoolYear(YEAR_2526, at('2026-08-06T00:00:00.000Z'))).toBe(true);
    expect(isFinishedSchoolYear(YEAR_2627, at('2026-08-06T00:00:00.000Z'))).toBe(false);
  });
});

describe('selectableSchoolYears', () => {
  // Real lists come newest first (see fetchSchoolYearSummaries).
  const NEWEST_FIRST = [YEAR_2627, YEAR_2526];

  it('drops finished years', () => {
    expect(selectableSchoolYears(NEWEST_FIRST, at('2026-08-06T00:00:00.000Z'))).toEqual([
      YEAR_2627,
    ]);
  });

  it('keeps every year while none has ended', () => {
    expect(selectableSchoolYears(NEWEST_FIRST, at('2026-06-11T00:00:00.000Z'))).toEqual(
      NEWEST_FIRST,
    );
  });

  it('keeps the selected year even when it is finished (deep link)', () => {
    expect(
      selectableSchoolYears(NEWEST_FIRST, at('2026-08-06T00:00:00.000Z'), YEAR_2526.id),
    ).toEqual(NEWEST_FIRST);
  });

  it('returns an empty list when every year has ended', () => {
    expect(selectableSchoolYears(NEWEST_FIRST, at('2030-01-01T00:00:00.000Z'))).toEqual([]);
  });
});

describe('isPreviewWindowOpen', () => {
  it('is closed before 1 July of the start year', () => {
    expect(isPreviewWindowOpen(YEAR_2627, at('2026-06-30T23:59:59.000Z'))).toBe(false);
  });

  it('opens from 1 July of the start year, before the year actually starts', () => {
    expect(isPreviewWindowOpen(YEAR_2627, at('2026-07-01T00:00:00.000Z'))).toBe(true);
    expect(isPreviewWindowOpen(YEAR_2627, at('2026-08-01T00:00:00.000Z'))).toBe(true);
  });

  it('is open for the current, long-started year', () => {
    expect(isPreviewWindowOpen(YEAR_2526, at('2026-06-11T00:00:00.000Z'))).toBe(true);
  });

  it('returns false for an undefined year', () => {
    expect(isPreviewWindowOpen(undefined, at('2026-06-11T00:00:00.000Z'))).toBe(false);
  });
});

describe('isPreviewGateOpen', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is always open on the dev server, even outside the preview window', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(isPreviewGateOpen(YEAR_2627, at('2026-06-11T00:00:00.000Z'))).toBe(true);
  });

  it('in production, gates before 1 July but opens the next year from 1 July', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(isPreviewGateOpen(YEAR_2627, at('2026-06-11T00:00:00.000Z'))).toBe(false);
    expect(isPreviewGateOpen(YEAR_2627, at('2026-07-01T00:00:00.000Z'))).toBe(true);
    expect(isPreviewGateOpen(YEAR_2526, at('2026-06-11T00:00:00.000Z'))).toBe(true);
  });

  it('in production, gates an undefined year (date in no known year)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(isPreviewGateOpen(undefined, at('2026-06-11T00:00:00.000Z'))).toBe(false);
  });
});
