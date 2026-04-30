import type { GmailThreadDetail, GmailThreadMessage } from '../services/api';

export type GmailAgentAction =
  | 'ask_agent'
  | 'add_to_calendar'
  | 'draft_follow_up'
  | 'create_task'
  | 'pick_times'
  | 'decline'
  | 'delegate'
  | 'save_to_drive';

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeMessageBody(message: GmailThreadMessage): string {
  const raw = message.bodyType === 'html' ? stripHtml(message.body) : message.body.trim();
  return raw.replace(/\s+/g, ' ').trim();
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3).trimEnd()}...`;
}

function formatParticipantLine(message: GmailThreadMessage): string {
  return `From: ${message.from}\nTo: ${message.to}${message.cc ? `\nCc: ${message.cc}` : ''}`;
}

function summarizeRecentMessages(messages: GmailThreadMessage[]): string {
  const recent = messages.slice(-2).map((message, index, arr) => {
    const label = arr.length === 1
      ? 'Latest message'
      : index === 0
        ? 'Previous message'
        : 'Latest message';
    const preview = truncate(normalizeMessageBody(message) || '(no content)', 280);
    return `${label} (${message.date})\n${formatParticipantLine(message)}\nPreview: ${preview}`;
  });

  return recent.join('\n\n');
}

/** Returns a short user-facing label for the action (shown in the chat bubble instead of the full injected prompt). */
export function gmailAgentDisplayText(
  thread: GmailThreadDetail,
  action: GmailAgentAction,
  question?: string,
): string {
  const subject = thread.subject || '(no subject)';
  switch (action) {
    case 'ask_agent':
      return question?.trim() || `Help me with "${subject}"`;
    case 'add_to_calendar':
      return `Add "${subject}" to calendar`;
    case 'draft_follow_up':
      return `Draft a follow-up for "${subject}"`;
    case 'create_task':
      return `Create a task from "${subject}"`;
    case 'pick_times':
      return `Pick times for "${subject}"`;
    case 'decline':
      return `Decline "${subject}"`;
    case 'delegate':
      return `Delegate "${subject}"`;
    case 'save_to_drive':
      return `Save "${subject}" to Drive`;
    default:
      return `Help me with "${subject}"`;
  }
}

export function buildGmailAgentPrompt(
  thread: GmailThreadDetail,
  action: GmailAgentAction,
  question?: string,
): string {
  const latestMessage = thread.messages[thread.messages.length - 1];
  const latestPreview = latestMessage
    ? truncate(normalizeMessageBody(latestMessage) || '(no content)', 500)
    : '(no message content available)';
  const threadContext = [
    `I am viewing Gmail thread "${thread.id}" about "${thread.subject || '(no subject)'}".`,
    latestMessage
      ? `Latest message details:\nDate: ${latestMessage.date}\n${formatParticipantLine(latestMessage)}\nContent preview: ${latestPreview}`
      : 'Latest message details: unavailable.',
    `Recent thread context:\n${summarizeRecentMessages(thread.messages)}`,
  ].join('\n\n');

  switch (action) {
    case 'ask_agent':
      return `${threadContext}\n\nUser request: ${question?.trim() || 'Help me with this email.'}\n\nUse the email context above to answer the question or suggest the next step. If you need more information, ask a follow-up question.`;
    case 'add_to_calendar':
      return `${threadContext}\n\nPlease extract any meeting, interview, deadline, or scheduling details from this email thread and prepare a calendar event draft. If the thread does not include enough information to create a reliable event, ask a focused follow-up question instead of guessing.`;
    case 'draft_follow_up':
      return `${threadContext}\n\nPlease draft an appropriate follow-up reply for this Gmail thread. Preserve the likely tone and intent of the conversation, and mention any specific open questions or commitments that should be addressed.`;
    case 'create_task':
      return `${threadContext}\n\nPlease identify any actionable follow-up from this email thread and prepare a task if appropriate. Include the key action, any due date mentioned, and note if the thread does not contain a clear task yet.`;
    case 'pick_times':
      return `${threadContext}\n\nPlease find 3 available 30-minute slots in the user's calendar over the next 7 business days that could work for this meeting/conversation. Use the calendar tools to check availability. Present the slots clearly and offer to draft a reply proposing them.`;
    case 'decline':
      return `${threadContext}\n\nPlease draft a polite, brief decline reply appropriate to the tone of this thread. Preserve any existing context or commitments that should be addressed, and suggest alternatives only if the thread explicitly invites them.`;
    case 'delegate':
      return `${threadContext}\n\nPlease help the user delegate this thread to a teammate. Ask who should handle it if unclear, then draft a handoff message to the delegate that includes the relevant context, and an optional notification to the original sender that the user is looping someone in.`;
    case 'save_to_drive':
      return `${threadContext}\n\nPlease save this email thread as a Google Doc in Drive. Extract the key content (subject, participants, messages) into a readable format, suggest a filename, and confirm the Drive folder before creating the doc.`;
    default:
      return threadContext;
  }
}
