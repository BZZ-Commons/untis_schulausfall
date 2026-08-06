'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Loader2, CalendarDays } from 'lucide-react';
import ClassSelector from '@/components/ClassSelector';
import SchoolYearCalendar from '@/components/SchoolYearCalendar';
import SchoolYearSelector from '@/components/SchoolYearSelector';
import CalendarLegend from '@/components/CalendarLegend';
import IAVariantDialog from '@/components/IAVariantDialog';
import ViewToggle, { type ViewMode } from '@/components/ViewToggle';
import AggregatedCalendar from '@/components/AggregatedCalendar';
import DayDetailsDialog from '@/components/DayDetailsDialog';
import SingleDayDialog from '@/components/SingleDayDialog';
import ErrorNotice from '@/components/ErrorNotice';
import ExportButton from '@/components/ExportButton';
import DraftNotice from '@/components/DraftNotice';
import { isIAClass, isMEClass, isIMClass, getIAVariants } from '@/src/lib/classGroups';
import {
  schoolYearShort,
  isDraftSchoolYear,
  findDefaultSchoolYear,
  isPreviewGateOpen,
  selectableSchoolYears,
} from '@/src/lib/schoolYear';
import { writeLastSelection } from '@/src/lib/lastSelection';
import { useMeasuredHeight } from '@/src/lib/useMeasuredHeight';
import { useYearData } from '@/src/lib/useYearData';
import { useCalendarData } from '@/src/lib/useCalendarData';
import { useAggregatedData } from '@/src/lib/useAggregatedData';
import { useDeepLink } from '@/src/lib/useDeepLink';
import { useUrlSync } from '@/src/lib/useUrlSync';
import type { AggregatedDay, CalendarDay, UntisClass } from '@/src/types';

// Card header (title + actions + legend) — pinned on scroll above the calendar's
// own sticky weekday row. Shared verbatim by the single- and aggregated-view cards.
const STICKY_CARD_HEADER_CLASS =
  'sticky top-0 z-20 bg-white flex flex-col sm:flex-row sm:items-center gap-3 mb-6 pb-4 border-b border-slate-100';

export default function HomePage() {
  const [viewMode, setViewMode] = useState<ViewMode>('single');
  const [detailsMode, setDetailsMode] = useState(false);
  const [iaDialogClass, setIaDialogClass] = useState<UntisClass | null>(null);
  const [selectedAggregatedDay, setSelectedAggregatedDay] = useState<AggregatedDay | null>(null);
  const [selectedSingleDay, setSelectedSingleDay] = useState<{
    day: CalendarDay;
    monday: string;
  } | null>(null);

  // ── Cross-hook wiring ──────────────────────────────────────────────────────
  // `useYearData` owns `selectedSchoolYearId` and the bootstrap, but its year
  // switch must reach into the calendar/aggregated hooks (which in turn need the
  // selected year). React's fixed hook-call order forbids a direct cycle, so we
  // route the back-edges through a ref that always points at the live callbacks.
  const wiringRef = useRef<{
    captureUrlParams: () => { urlYearShort: string | null; detailsRequested: boolean };
    onYearSwitch: () => void;
    loadAggregated: (yearId: number) => void;
  }>(null);

  const {
    schoolYears,
    selectedSchoolYearId,
    classes,
    classesLoading,
    classesError,
    periods,
    handleSchoolYearChange,
    reloadYearData,
  } = useYearData({
    captureUrlParams: useCallback(() => wiringRef.current!.captureUrlParams(), []),
    setDetailsMode,
    onYearSwitch: useCallback(() => wiringRef.current!.onYearSwitch(), []),
    loadAggregated: useCallback((yearId: number) => wiringRef.current!.loadAggregated(yearId), []),
    viewMode,
  });

  const {
    selectedFetchIds,
    setSelectedFetchIds,
    calendarData,
    calendarLoading,
    calendarError,
    loadCalendar,
    abort: abortCalendar,
    reset: resetCalendar,
  } = useCalendarData(selectedSchoolYearId);

  const {
    aggregatedData,
    aggregatedLoading,
    aggregatedError,
    loadAggregated,
    abort: abortAggregated,
    reset: resetAggregated,
  } = useAggregatedData(selectedSchoolYearId);

  const handleClassChange = useCallback(
    (id: number) => {
      const cls = classes.find((c) => c.id === id);
      if (!cls) return;

      // IA classes whose companion was NOT auto-resolved server-side need the dialog.
      // (Years where IA a/b/c all exist resolve unambiguously and skip it.)
      const unresolvedIA = isIAClass(cls.name) && (cls.fetchIds?.length ?? 0) < 2;
      if (unresolvedIA) {
        setIaDialogClass(cls);
        return;
      }

      const fetchIds = cls.fetchIds ?? [id];
      setSelectedFetchIds(fetchIds);
      void loadCalendar(fetchIds);
    },
    [classes, loadCalendar, setSelectedFetchIds],
  );

  const { captureUrlParams, isPending } = useDeepLink({
    classes,
    handleClassChange,
    loadCalendar,
    loadAggregated,
    setSelectedFetchIds,
    setViewMode,
  });

  // On a year switch: abort + clear both calendar concerns and reset selection.
  const handleYearSwitch = useCallback(() => {
    abortCalendar();
    abortAggregated();
    resetCalendar();
    resetAggregated();
    setIaDialogClass(null);
    setSelectedAggregatedDay(null);
    setSelectedSingleDay(null);
  }, [abortCalendar, abortAggregated, resetCalendar, resetAggregated]);

  // Publish the live back-edges for `useYearData` to call through the ref.
  wiringRef.current = {
    captureUrlParams,
    onYearSwitch: handleYearSwitch,
    loadAggregated,
  };

  const handleIAVariantPick = useCallback(
    (companion: UntisClass) => {
      const cls = iaDialogClass;
      if (!cls) return;
      setIaDialogClass(null);
      const fetchIds = [cls.id, companion.id];
      setSelectedFetchIds(fetchIds);
      void loadCalendar(fetchIds);
    },
    [iaDialogClass, loadCalendar, setSelectedFetchIds],
  );

  const handleViewModeChange = useCallback(
    (mode: ViewMode) => {
      if (mode === viewMode) return;
      setViewMode(mode);
      if (mode === 'all' && aggregatedData == null && !aggregatedLoading) {
        void loadAggregated();
      }
    },
    [viewMode, aggregatedData, aggregatedLoading, loadAggregated],
  );

  const selectedClassId = selectedFetchIds?.[0] ?? null;
  const selectedClass =
    selectedClassId != null ? classes.find((c) => c.id === selectedClassId) : undefined;

  // id → name, so a day cell can name the (possibly companion) class it links to.
  const classNamesById = useMemo(() => new Map(classes.map((c) => [c.id, c.name])), [classes]);

  const selectedSchoolYear = useMemo(
    () => schoolYears.find((y) => y.id === selectedSchoolYearId),
    [schoolYears, selectedSchoolYearId],
  );

  const selectedSchoolYearShort = useMemo(
    () => (selectedSchoolYear ? schoolYearShort(selectedSchoolYear) : null),
    [selectedSchoolYear],
  );

  // Logo/title "home" link → the current school year's overview (drops class/view).
  // Falls back to `/` until the year list has loaded.
  const homeHref = useMemo(() => {
    const current = findDefaultSchoolYear(schoolYears, Date.now());
    return current ? `/?schoolyear=${schoolYearShort(current)}` : '/';
  }, [schoolYears]);

  // The next school year's plan is published early as a draft — warn that the
  // shown cancellations may still change (until the end of the current year).
  // Computed inline rather than memoized so it reflects the current date.
  const showDraftNotice = isDraftSchoolYear(selectedSchoolYear, schoolYears, Date.now());

  // The day-timetable preview is gated until the selected school year has actually
  // begun (next year's plan is only a draft) — except on the dev server. Shared
  // with the API route's server-side gate via isPreviewGateOpen.
  const previewAllowed = isPreviewGateOpen(selectedSchoolYear, Date.now());

  // Abgeschlossene Schuljahre verschwinden aus dem Dropdown; die volle Liste bleibt
  // erhalten (isDraftSchoolYear braucht das Vorjahr, Deep-Links dessen Kurzform).
  // Wie oben inline statt memoized, damit es dem aktuellen Datum folgt.
  const dropdownSchoolYears = selectableSchoolYears(schoolYears, Date.now(), selectedSchoolYearId);

  // Only surface a companion in the header for single-companion merges (length 2).
  // Multi-companion classes (e.g. AB c → IA a+b) fall back to longName.
  const selectedCompanion =
    selectedFetchIds?.length === 2 ? classes.find((c) => c.id === selectedFetchIds[1]) : null;

  // Remember the selection (incl. the IA BM/ABU pick) so the next param-less
  // visit restores it (see useDeepLink).
  useEffect(() => {
    if (!selectedClass) return;
    writeLastSelection({
      className: selectedClass.name,
      companionName: selectedCompanion?.name,
    });
  }, [selectedClass, selectedCompanion]);

  const handleDaySelect = useCallback(
    (day: CalendarDay, monday: string) => setSelectedSingleDay({ day, monday }),
    [],
  );

  // Sync URL with current state so it stays shareable / copy-pasteable.
  useUrlSync({
    selectedSchoolYearShort,
    selectedClassName: selectedClass?.name ?? null,
    selectedCompanionName: selectedCompanion?.name ?? null,
    viewMode,
    detailsMode,
    isDeepLinkPending: isPending,
  });

  const subtitle = selectedCompanion ? `+ ${selectedCompanion.name}` : selectedClass?.longName;

  const iaVariants = useMemo(
    () => (iaDialogClass ? getIAVariants(iaDialogClass.name, classes) : null),
    [iaDialogClass, classes],
  );

  // The card header (title + legend) is made sticky on scroll. Its height is
  // measured so the calendar's own sticky weekday row can stack directly below
  // it via the inherited `--sticky-stack-top` CSS variable.
  const [stickyHeaderRef, stickyHeaderHeight] = useMeasuredHeight();
  const stickyStackStyle = {
    '--sticky-stack-top': `${stickyHeaderHeight}px`,
  } as React.CSSProperties;

  const showSingleEmptyState = viewMode === 'single' && !selectedClassId && !calendarLoading;
  // While a class switch reloads, the previous calendar stays visible (dimmed,
  // spinner in the card header) — the full-page spinner only covers the first load.
  const showSingleCalendar =
    viewMode === 'single' && calendarData && selectedClassId != null && !calendarError;
  const showAggregatedCalendar = viewMode === 'all' && aggregatedData && !aggregatedLoading;
  const showAggregatedLoading = viewMode === 'all' && aggregatedLoading;
  const showSingleLoading = viewMode === 'single' && calendarLoading && !calendarData;
  const showSingleError = viewMode === 'single' && calendarError && !calendarLoading;
  const showAggregatedError = viewMode === 'all' && aggregatedError && !aggregatedLoading;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/40 to-slate-100">
      <header className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <a
            href={homeHref}
            title="Zur aktuellen Schuljahresübersicht"
            className="flex items-center gap-3 transition-opacity hover:opacity-80"
          >
            <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
              <CalendarDays className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 leading-tight">
                Unterrichtsausfälle
              </h1>
              <p className="text-xs text-slate-500">BZZ Bildungszentrum Zürichsee</p>
            </div>
          </a>

          {dropdownSchoolYears.length >= 2 && (
            <div className="sm:ml-auto">
              <SchoolYearSelector
                schoolYears={dropdownSchoolYears}
                selectedId={selectedSchoolYearId}
                onChange={handleSchoolYearChange}
              />
            </div>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-6 flex flex-col sm:flex-row items-center gap-3">
          <ViewToggle value={viewMode} onChange={handleViewModeChange} />
          {viewMode === 'single' &&
            (classesError ? (
              <p className="sm:ml-auto text-sm text-red-600 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {classesError}
                <button
                  type="button"
                  onClick={reloadYearData}
                  className="font-medium underline hover:text-red-700 transition-colors"
                >
                  Erneut versuchen
                </button>
              </p>
            ) : (
              <ClassSelector
                classes={classes}
                selectedId={selectedClassId}
                onChange={handleClassChange}
                loading={classesLoading}
                className="sm:ml-auto"
              />
            ))}
        </div>

        {showDraftNotice && selectedSchoolYear && (
          <DraftNotice schoolYearName={selectedSchoolYear.name} />
        )}

        {showSingleEmptyState && (
          <div className="text-center py-24">
            <div className="w-16 h-16 rounded-2xl bg-indigo-100 flex items-center justify-center mx-auto mb-4">
              <CalendarDays className="w-8 h-8 text-indigo-400" />
            </div>
            <h2 className="text-lg font-semibold text-slate-700 mb-1">Klasse auswählen</h2>
            <p className="text-sm text-slate-500 max-w-sm mx-auto">
              Wählen Sie oben eine Klasse aus, um den Schuljahreskalender mit allen Ausfällen
              anzuzeigen.
            </p>
          </div>
        )}

        {(showSingleLoading || showAggregatedLoading) && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
            <p className="text-sm text-slate-500">
              {viewMode === 'all'
                ? 'Lade Stundenpläne aller Klassen — das kann einen Moment dauern …'
                : 'Lade Stundenplan für das gesamte Schuljahr …'}
            </p>
          </div>
        )}

        {showSingleError && calendarError && (
          <ErrorNotice
            message={calendarError}
            onRetry={selectedFetchIds ? () => void loadCalendar(selectedFetchIds) : undefined}
          />
        )}

        {showAggregatedError && aggregatedError && (
          <ErrorNotice message={aggregatedError} onRetry={() => void loadAggregated()} />
        )}

        {showSingleCalendar && calendarData && selectedClassId != null && (
          <div
            className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6"
            style={stickyStackStyle}
          >
            <div ref={stickyHeaderRef} className={STICKY_CARD_HEADER_CLASS}>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {selectedClass?.name}
                  {subtitle && (
                    <span className="ml-2 text-sm font-normal text-slate-500">{subtitle}</span>
                  )}
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Schuljahr {calendarData.schoolYear.name}
                </p>
              </div>
              <div className="sm:ml-auto flex flex-wrap items-center gap-3">
                {/* Reload indicator while another class's data is fetched (the
                    previous calendar stays visible, dimmed, below). */}
                {calendarLoading && (
                  <Loader2
                    className="w-4 h-4 text-indigo-400 animate-spin"
                    aria-label="Lade Stundenplan …"
                  />
                )}
                {/* Details mode has no UI toggle — it is controlled only via the
                    `?details=true` URL parameter (see useDeepLink / useUrlSync). */}
                <ExportButton
                  days={calendarData.days}
                  className={selectedClass?.name ?? ''}
                  schoolYearName={calendarData.schoolYear.name}
                  detailsMode={detailsMode}
                />
                <CalendarLegend variant="single" detailsMode={detailsMode} />
              </div>
            </div>

            <div
              className={`transition-opacity ${calendarLoading ? 'opacity-50 pointer-events-none' : ''}`}
              aria-busy={calendarLoading}
            >
              <SchoolYearCalendar
                days={calendarData.days}
                schoolYearName={calendarData.schoolYear.name}
                classId={selectedClassId}
                classNamesById={classNamesById}
                detailsMode={detailsMode}
                periods={periods}
                showQuarterDividers={
                  isIAClass(selectedClass?.name ?? '') ||
                  isMEClass(selectedClass?.name ?? '') ||
                  isIMClass(selectedClass?.name ?? '')
                }
                onDaySelect={handleDaySelect}
              />
            </div>
          </div>
        )}

        {showAggregatedCalendar && aggregatedData && (
          <div
            className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6"
            style={stickyStackStyle}
          >
            <div ref={stickyHeaderRef} className={STICKY_CARD_HEADER_CLASS}>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Alle Klassen — Gesamtübersicht
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Schuljahr {aggregatedData.schoolYear.name}
                </p>
              </div>
              <div className="sm:ml-auto">
                <CalendarLegend variant="aggregated" />
              </div>
            </div>

            <AggregatedCalendar
              days={aggregatedData.days}
              schoolYearName={aggregatedData.schoolYear.name}
              onDaySelect={setSelectedAggregatedDay}
              periods={periods}
            />
          </div>
        )}
      </main>

      {iaDialogClass && iaVariants && (
        <IAVariantDialog
          iaClass={iaDialogClass}
          bm={iaVariants.bm}
          abu={iaVariants.abu}
          onPick={handleIAVariantPick}
          onCancel={() => setIaDialogClass(null)}
        />
      )}

      {selectedAggregatedDay && aggregatedData && (
        <DayDetailsDialog
          day={selectedAggregatedDay}
          schoolYearShort={schoolYearShort(aggregatedData.schoolYear)}
          onClose={() => setSelectedAggregatedDay(null)}
        />
      )}

      {selectedSingleDay && selectedClassId != null && (
        <SingleDayDialog
          day={selectedSingleDay.day}
          monday={selectedSingleDay.monday}
          fallbackClassId={selectedClassId}
          classIds={selectedFetchIds ?? [selectedClassId]}
          previewAllowed={previewAllowed}
          classNamesById={classNamesById}
          onClose={() => setSelectedSingleDay(null)}
        />
      )}
    </div>
  );
}
