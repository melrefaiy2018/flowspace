import { useCallback, useMemo } from 'react';
import { Loader2, Calendar } from 'lucide-react';
import { useChatContext } from '../context/ChatContext';
import { useCalendarPage } from '../hooks/useCalendarPage';
import { useBriefing } from '../hooks/useBriefing';
import type { DayEvent } from '../services/api';
import CalendarHeader from '../components/calendar/CalendarHeader';
import InsightRail from '../components/calendar/InsightRail';
import WeekRhythm from '../components/calendar/WeekRhythm';
import AgendaTimeline from '../components/calendar/AgendaTimeline';
import AgentPanel from '../components/calendar/AgentPanel';
import WeekView from '../components/calendar/WeekView';
import DayView from '../components/calendar/DayView';
import MonthView from '../components/calendar/MonthView';
import AgendaView from '../components/calendar/AgendaView';
import {
  computeWeekInsights,
  computeDayLoads,
  computeEventMetas,
} from '../components/calendar/calendarUtils';
import type { CalendarEventDetail } from '../services/api';

function buildEventThreadBrief(event: CalendarEventDetail): string {
  const attendeeLines = event.attendees
    .map((a) => `- ${a.name ?? a.email} (${a.email}) — ${a.responseStatus}`)
    .join('\n');
  const description = event.description
    ? event.description.replace(/<[^>]+>/g, '').slice(0, 500)
    : '(none)';
  return [
    'Meeting Prep Context',
    `Event ID: ${event.id}`,
    `Title: ${event.summary}`,
    `Time: ${event.start} → ${event.end}`,
    `Location: ${event.location ?? '(none)'}`,
    `Organizer: ${event.organizer ? `${event.organizer.name ?? ''} <${event.organizer.email}>` : '(none)'}`,
    '',
    'Attendees:',
    attendeeLines || '(none)',
    '',
    'Description:',
    description,
    '',
    `Video link: ${event.hangoutLink ?? '(none)'}`,
  ].join('\n');
}

function formatRangeLabel(currentDate: Date, dateRange: { start: Date; end: Date }): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const start = dateRange.start.toLocaleDateString('en-US', opts);
  const end = dateRange.end.toLocaleDateString('en-US', { ...opts, year: 'numeric' });
  return `${start} – ${end}`;
}

export default function CalendarPage() {
  const cal = useCalendarPage();
  const { sendMessage, findConversationByEventId, openConversationInPanel } = useChatContext();
  const { briefing } = useBriefing();

  // Build AI insights map from briefing
  const aiInsightsMap = useMemo(() => {
    const map = new Map<string, DayEvent>();
    if (briefing?.day_at_a_glance) {
      for (const ev of briefing.day_at_a_glance) {
        if (ev.event_id) map.set(ev.event_id, ev);
      }
    }
    return map;
  }, [briefing]);

  // Derived data — all pure computation
  const weekInsights = useMemo(
    () => computeWeekInsights(cal.events, aiInsightsMap),
    [cal.events, aiInsightsMap]
  );

  const dayLoads = useMemo(
    () => computeDayLoads(cal.events, cal.dateRange),
    [cal.events, cal.dateRange]
  );

  const eventMetas = useMemo(
    () => computeEventMetas(cal.filteredEvents, aiInsightsMap),
    [cal.filteredEvents, aiInsightsMap]
  );

  const selectedEvent = useMemo(
    () => cal.filteredEvents.find((ev) => ev.id === cal.selectedEventId) ?? null,
    [cal.filteredEvents, cal.selectedEventId]
  );

  const handleAskAI = useCallback((prompt: string) => {
    // Open the chat panel on explicit user action (Prepare / Continue in chat).
    // The panel is closed automatically when navigating to the calendar view
    // (see AppInner's view-change effect in App.tsx), so the calendar + prep
    // panel own the default state; chat only appears after deliberate action.
    void sendMessage(prompt, { forceNewChat: true });
  }, [sendMessage]);

  const handlePrepareEvent = useCallback((event: CalendarEventDetail) => {
    const existing = findConversationByEventId(event.id);
    if (existing) {
      openConversationInPanel(existing.id);
      return;
    }
    const threadBrief = buildEventThreadBrief(event);
    const prompt = `Prepare a meeting brief for: ${event.summary}. Include key context, talking points, relevant docs, and open questions.`;
    void sendMessage(prompt, {
      forceNewChat: true,
      threadBrief,
      eventId: event.id,
      displayContent: `Prepare this meeting: ${event.summary}`,
    });
  }, [findConversationByEventId, openConversationInPanel, sendMessage]);

  const handleSlotClick = useCallback((date: Date, hour: number) => {
    const formatted = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const timeStr = hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`;
    handleAskAI(`Create a calendar event on ${formatted} at ${timeStr}`);
  }, [handleAskAI]);

  const handleDayClick = useCallback((date: Date) => {
    cal.setCurrentDate(date);
  }, [cal.setCurrentDate]);

  const rangeLabel = formatRangeLabel(cal.currentDate, cal.dateRange);

  const isSemanticView = cal.view === 'timeline' || cal.view === 'focus' || cal.view === 'prep';
  const isGridView = cal.view === 'grid';
  const isAgendaView = cal.view === 'agenda';

  // Loading / error states
  if (cal.loading && cal.filteredEvents.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <CalendarHeader
          view={cal.view}
          onViewChange={cal.setView}
          filter={cal.filter}
          onFilterChange={cal.setFilter}
          insightFilter={cal.insightFilter}
          onInsightFilterChange={cal.setInsightFilter}
          rangeLabel={rangeLabel}
          onPrev={cal.goPrev}
          onNext={cal.goNext}
          onToday={cal.goToday}
          lastFetchedAt={cal.lastFetchedAt}
        />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={20} className="animate-spin text-[var(--text-faint)]" />
        </div>
      </div>
    );
  }

  if (cal.error) {
    return (
      <div className="flex flex-col h-full">
        <CalendarHeader
          view={cal.view}
          onViewChange={cal.setView}
          filter={cal.filter}
          onFilterChange={cal.setFilter}
          insightFilter={cal.insightFilter}
          onInsightFilterChange={cal.setInsightFilter}
          rangeLabel={rangeLabel}
          onPrev={cal.goPrev}
          onNext={cal.goNext}
          onToday={cal.goToday}
          lastFetchedAt={cal.lastFetchedAt}
        />
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
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <CalendarHeader
        view={cal.view}
        onViewChange={cal.setView}
        filter={cal.filter}
        onFilterChange={cal.setFilter}
        insightFilter={cal.insightFilter}
        onInsightFilterChange={cal.setInsightFilter}
        rangeLabel={rangeLabel}
        onPrev={cal.goPrev}
        onNext={cal.goNext}
        onToday={cal.goToday}
        lastFetchedAt={cal.lastFetchedAt}
      />

      {/* Insight rail — only in semantic views */}
      {isSemanticView && (
        <InsightRail
          insights={weekInsights}
          activeFilter={cal.insightFilter}
          onFilter={cal.setInsightFilter}
        />
      )}

      {/* Body */}
      {isSemanticView && (
        <div className="flex flex-1 min-h-0">
          {/* Left: Week Rhythm (desktop only, hidden via CSS) */}
          <WeekRhythm
            dayLoads={dayLoads}
            selectedDay={cal.selectedDay}
            onSelectDay={cal.setSelectedDay}
          />

          {/* Center: Agenda Timeline */}
          <AgendaTimeline
            events={cal.filteredEvents}
            eventMetas={eventMetas}
            insightFilter={cal.insightFilter}
            view={cal.view as 'timeline' | 'focus' | 'prep'}
            selectedEventId={cal.selectedEventId}
            selectedDay={cal.selectedDay}
            onSelectEvent={cal.selectEvent}
            onAskAI={handleAskAI}
          />

          {/* Right: Agent Panel */}
          <AgentPanel
            selectedEvent={selectedEvent}
            aiInsight={selectedEvent ? aiInsightsMap.get(selectedEvent.id) : undefined}
            events={cal.filteredEvents}
            eventMetas={eventMetas}
            onAskAI={handleAskAI}
            onSelectEvent={cal.selectEvent}
            onPrepareEvent={handlePrepareEvent}
            findConversationByEventId={findConversationByEventId}
          />
        </div>
      )}

      {isGridView && (
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 flex flex-col min-w-0">
            <WeekView
              events={cal.filteredEvents}
              dateRange={cal.dateRange}
              selectedEventId={cal.selectedEventId}
              onSelectEvent={cal.selectEvent}
              onSlotClick={handleSlotClick}
            />
          </div>
          {/* Keep event detail panel for grid view */}
          {selectedEvent && (
            <div className="w-[320px] shrink-0 border-l border-[var(--border)] bg-[var(--bg)] flex flex-col h-full overflow-y-auto">
              <AgentPanel
                selectedEvent={selectedEvent}
                aiInsight={aiInsightsMap.get(selectedEvent.id)}
                events={cal.filteredEvents}
                eventMetas={eventMetas}
                onAskAI={handleAskAI}
                onSelectEvent={cal.selectEvent}
                onPrepareEvent={handlePrepareEvent}
                findConversationByEventId={findConversationByEventId}
              />
            </div>
          )}
        </div>
      )}

      {isAgendaView && (
        <AgendaView
          events={cal.filteredEvents}
          selectedEventId={cal.selectedEventId}
          onSelectEvent={cal.selectEvent}
          onAskAI={handleAskAI}
        />
      )}
    </div>
  );
}
