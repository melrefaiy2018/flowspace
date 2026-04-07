import { useCallback, useMemo } from 'react';
import { Loader2, Calendar } from 'lucide-react';
import { useChatContext } from '../context/ChatContext';
import { useCalendarPage } from '../hooks/useCalendarPage';
import { useBriefing } from '../hooks/useBriefing';
import type { DayEvent } from '../services/api';
import CalendarToolbar from '../components/calendar/CalendarToolbar';
import ScheduleInsights from '../components/calendar/ScheduleInsights';
import WeekView from '../components/calendar/WeekView';
import DayView from '../components/calendar/DayView';
import MonthView from '../components/calendar/MonthView';
import AgendaView from '../components/calendar/AgendaView';
import EventDetailPanel from '../components/calendar/EventDetailPanel';

function formatRangeLabel(view: string, currentDate: Date, dateRange: { start: Date; end: Date }): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };

  switch (view) {
    case 'day':
      return currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    case 'week': {
      const start = dateRange.start.toLocaleDateString('en-US', opts);
      const end = dateRange.end.toLocaleDateString('en-US', { ...opts, year: 'numeric' });
      return `${start} – ${end}`;
    }
    case 'month':
      return currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    case 'agenda':
      return `Next 2 weeks`;
    default:
      return '';
  }
}

export default function CalendarPage() {
  const cal = useCalendarPage();
  const { sendMessage } = useChatContext();
  const { briefing } = useBriefing();

  // Build a map from event_id → DayEvent for AI enrichment
  const aiInsightsMap = useMemo(() => {
    const map = new Map<string, DayEvent>();
    if (briefing?.day_at_a_glance) {
      for (const ev of briefing.day_at_a_glance) {
        if (ev.event_id) map.set(ev.event_id, ev);
      }
    }
    return map;
  }, [briefing]);

  const selectedEvent = useMemo(
    () => cal.events.find((ev) => ev.id === cal.selectedEventId) ?? null,
    [cal.events, cal.selectedEventId]
  );

  const handleAskAI = useCallback((prompt: string) => {
    const preserveActiveView = typeof window !== 'undefined' ? window.innerWidth >= 1024 : true;
    void sendMessage(prompt, { forceNewChat: true, preserveActiveView });
  }, [sendMessage]);

  const handleSlotClick = useCallback((date: Date, hour: number) => {
    const formatted = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const timeStr = hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`;
    handleAskAI(`Create a calendar event on ${formatted} at ${timeStr}`);
  }, [handleAskAI]);

  const handleDayClick = useCallback((date: Date) => {
    cal.setCurrentDate(date);
    cal.setView('day');
  }, [cal.setCurrentDate, cal.setView]);

  const rangeLabel = formatRangeLabel(cal.view, cal.currentDate, cal.dateRange);

  return (
    <div className="flex h-full">
      {/* Main calendar area */}
      <div className="flex-1 flex flex-col min-w-0">
        <CalendarToolbar
          view={cal.view}
          onViewChange={cal.setView}
          filter={cal.filter}
          onFilterChange={cal.setFilter}
          rangeLabel={rangeLabel}
          onPrev={cal.goPrev}
          onNext={cal.goNext}
          onToday={cal.goToday}
        />

        <ScheduleInsights events={cal.events} />

        {cal.loading && cal.filteredEvents.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 size={20} className="animate-spin text-[var(--text-faint)]" />
          </div>
        ) : cal.error ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-[var(--text-faint)]">
            <Calendar size={28} strokeWidth={1.5} />
            <p className="text-[13px]">{cal.error}</p>
            <button
              onClick={cal.refresh}
              className="text-[12px] text-[var(--accent)] hover:underline cursor-pointer"
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            {cal.view === 'week' && (
              <WeekView
                events={cal.filteredEvents}
                dateRange={cal.dateRange}
                selectedEventId={cal.selectedEventId}
                onSelectEvent={cal.selectEvent}
                onSlotClick={handleSlotClick}
              />
            )}
            {cal.view === 'day' && (
              <DayView
                events={cal.filteredEvents}
                currentDate={cal.currentDate}
                selectedEventId={cal.selectedEventId}
                onSelectEvent={cal.selectEvent}
                onSlotClick={handleSlotClick}
              />
            )}
            {cal.view === 'month' && (
              <MonthView
                events={cal.filteredEvents}
                currentDate={cal.currentDate}
                selectedEventId={cal.selectedEventId}
                onSelectEvent={cal.selectEvent}
                onDayClick={handleDayClick}
              />
            )}
            {cal.view === 'agenda' && (
              <AgendaView
                events={cal.filteredEvents}
                selectedEventId={cal.selectedEventId}
                onSelectEvent={cal.selectEvent}
                onAskAI={handleAskAI}
              />
            )}
          </>
        )}
      </div>

      {/* Event detail panel */}
      {selectedEvent && (
        <EventDetailPanel
          event={selectedEvent}
          aiInsight={aiInsightsMap.get(selectedEvent.id)}
          onClose={() => cal.selectEvent(null)}
          onAskAI={handleAskAI}
          classification={cal.classification.getClassification(selectedEvent)}
          onClassify={(c) => cal.classification.setClassification(selectedEvent, c)}
          hasOverride={cal.classification.hasOverride(selectedEvent)}
          onClearOverride={() => cal.classification.clearOverride(selectedEvent)}
        />
      )}
    </div>
  );
}
