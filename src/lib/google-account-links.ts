export function gmailThreadUrl(threadId: string, accountEmail?: string | null): string {
  if (!accountEmail) return `https://mail.google.com/mail/u/0/#inbox/${threadId}`;
  return `https://mail.google.com/mail/u/${encodeURIComponent(accountEmail)}/#inbox/${threadId}`;
}

export function googleTasksUrl(accountEmail?: string | null): string {
  if (!accountEmail) return 'https://calendar.google.com/calendar/u/0/r/tasks';
  return `https://calendar.google.com/calendar/u/${encodeURIComponent(accountEmail)}/r/tasks`;
}
