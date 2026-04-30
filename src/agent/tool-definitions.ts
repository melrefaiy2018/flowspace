/**
 * tool-definitions.ts
 *
 * Static tool metadata: the TOOL_DEFINITIONS array (OpenAI function-calling
 * format), the WRITE_TOOL_NAMES set, and the isWriteTool() predicate.
 *
 * No runtime I/O — safe to import in any environment.
 */

export const WRITE_TOOL_NAMES = new Set([
  'send_email',
  'create_calendar_event',
  'create_task',
  'create_drive_folder',
  'docs_write',
  'sheets_append',
  'sheets_create',
  'sheets_update',
  'drive_upload',
  'save_email_to_doc',
  'archive_email_threads',
  'trash_email_threads',
  'restore_email_threads',
  'mute_email_threads',
  'mark_threads_read',
  'apply_label_to_threads',
  'unsubscribe_from_sender',
  'create_gmail_filter',
]);

export function isWriteTool(name: string): boolean {
  if (WRITE_TOOL_NAMES.has(name)) return true;
  // Dynamic tools run their own step-level execution — they are never
  // approval-gated at the top level. Write steps within them produce output
  // the user sees before deciding to act further.
  return false;
}

// Tool definitions in OpenAI function-calling format (compatible with GLM)
export const TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'search_drive',
      description: 'Search for files in Google Drive by name or content type. Returns file IDs, names, and links. IMPORTANT: the query must use Drive API syntax. To search by filename use: name contains \'filename\'. To search by type use: mimeType=\'...\'. Examples: name contains \'budget\', name contains \'report\' and mimeType=\'application/pdf\'. Do NOT pass a plain filename as the query — always wrap it in name contains \'...\'.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Drive API query string. To find a file by name: name contains \'filename\'. To find by type: mimeType=\'application/pdf\'. Combine with and/or. Never pass a raw filename — always use name contains \'...\'.' },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_drive_files',
      description: 'List recent files in Google Drive, sorted by last modified.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_drive_folder',
      description: 'Create a new folder in Google Drive.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Folder name' },
          parent_id: { type: 'string', description: 'Parent folder ID (optional, defaults to root)' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'send_email',
      description: 'Send an email via Gmail.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email address' },
          subject: { type: 'string', description: 'Email subject' },
          body: { type: 'string', description: 'Email body (plain text)' },
        },
        required: ['to', 'subject', 'body'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'compose_email',
      description: 'Present an editable email draft to the user for review before sending. Use this INSTEAD of send_email when the user asks you to draft, compose, or write an email reply. The draft appears as an interactive card the user can edit and send themselves. For replies to existing threads, include thread_id so the reply is threaded correctly in Gmail.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email address' },
          subject: { type: 'string', description: 'Email subject line' },
          body: { type: 'string', description: 'Email body (plain text)' },
          thread_id: { type: 'string', description: 'Gmail thread ID — include for replies to existing threads, omit for new emails' },
        },
        required: ['to', 'subject', 'body'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_emails',
      description: 'Search Gmail messages. Use Gmail query operators for precise results: from:, subject:, is:unread, has:attachment, newer_than:, older_than:, exact phrases in quotes. Combine with spaces (AND) or OR. Prefer specific operator queries over plain keywords. Example: from:amex subject:(warranty OR "purchase protection"). For inbox review or broad unread sweeps, set a higher limit like 25-50 instead of relying on the default.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Gmail search query. Use operators like from:, subject:, is:, has: for precise results. Avoid broad plain-text queries.' },
          limit: { type: 'number', description: 'Max results (default 25, use up to 50 for inbox review)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_email',
      description: 'Read a specific email message by ID. Returns subject, from, to, date, and body snippet.',
      parameters: {
        type: 'object',
        properties: {
          message_id: { type: 'string', description: 'Gmail message ID' },
        },
        required: ['message_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_calendar_event',
      description: 'Create a new Google Calendar event.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Event title' },
          start_time: { type: 'string', description: 'Start time in ISO 8601 format (e.g., "2026-03-10T14:00:00-06:00")' },
          end_time: { type: 'string', description: 'End time in ISO 8601 format' },
          description: { type: 'string', description: 'Event description (optional)' },
          attendees: { type: 'string', description: 'Comma-separated email addresses of attendees (optional)' },
          location: { type: 'string', description: 'Event location (optional)' },
        },
        required: ['summary', 'start_time', 'end_time'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_calendar_events',
      description: 'List upcoming Google Calendar events.',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Number of days to look ahead (default 7)' },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_task',
      description: 'Create a new task in Google Tasks.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Task title' },
          notes: { type: 'string', description: 'Task notes/description (optional)' },
          due: { type: 'string', description: 'Due date in ISO 8601 format (optional, e.g., "2026-03-10T00:00:00Z")' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_tasks',
      description: 'List open tasks from Google Tasks.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'standup_report',
      description: 'Generate a standup report — today\'s meetings and open tasks combined.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'meeting_prep',
      description: 'Prepare for the next upcoming meeting — shows agenda, attendees, and linked docs.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'email_to_task',
      description: 'Convert a Gmail message into a Google Tasks entry.',
      parameters: {
        type: 'object',
        properties: {
          message_id: { type: 'string', description: 'Gmail message ID to convert to a task' },
        },
        required: ['message_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'weekly_digest',
      description: 'Generate a weekly summary — this week\'s meetings and unread email count.',
      parameters: { type: 'object', properties: {} },
    },
  },

  // Tier 1 — gws skill-based tools
  {
    type: 'function' as const,
    function: {
      name: 'calendar_agenda',
      description: 'Get today\'s agenda with attendees, linked docs, and prep notes. Richer than list_calendar_events.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date in YYYY-MM-DD format, defaults to today' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'gmail_triage',
      description: 'Triage unread emails into action_required, review, and low_priority buckets with AI categorization.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max emails to triage (default 20)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'open_email_triage',
      description: 'Open the AI Triage view that categorizes inbox emails by importance (urgent, needs attention, informational, low priority). Use this when the user wants to see their emails organized by importance or asks to categorize/triage their inbox.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'check_email_triage',
      description: 'Check if the AI Triage view is up-to-date and refresh it with the latest emails. Use when the user asks to update, refresh, or re-check the triage, or asks if their triage is current.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'sheets_read',
      description: 'Read data from a Google Sheets spreadsheet by cell range.',
      parameters: {
        type: 'object',
        properties: {
          spreadsheet_id: { type: 'string', description: 'Google Sheets spreadsheet ID' },
          range: { type: 'string', description: 'A1 notation range, e.g. Sheet1!A1:D10' },
        },
        required: ['spreadsheet_id', 'range'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'docs_read',
      description: 'Read the content of a Google Doc. Returns the text content of the document.',
      parameters: {
        type: 'object',
        properties: {
          doc_id: { type: 'string', description: 'Google Doc ID' },
        },
        required: ['doc_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'docs_write',
      description: 'Write or append content to a Google Doc. Requires approval.',
      parameters: {
        type: 'object',
        properties: {
          doc_id: { type: 'string', description: 'Google Doc ID' },
          content: { type: 'string', description: 'Content to write (plain text or markdown)' },
          mode: { type: 'string', enum: ['append'], description: 'Write mode (only append is supported — adds content to end of doc)' },
        },
        required: ['doc_id', 'content'],
      },
    },
  },

  // Tier 2 — gws skill-based tools
  {
    type: 'function' as const,
    function: {
      name: 'sheets_append',
      description: 'Append rows to a Google Sheets spreadsheet. Requires approval.',
      parameters: {
        type: 'object',
        properties: {
          spreadsheet_id: { type: 'string', description: 'Google Sheets spreadsheet ID' },
          range: { type: 'string', description: 'A1 notation range to append after, e.g. Sheet1!A1' },
          values: { type: 'string', description: 'JSON array of row arrays, e.g. [["A","B"],["C","D"]]' },
        },
        required: ['spreadsheet_id', 'range', 'values'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'sheets_create',
      description: 'Create a new Google Sheets spreadsheet with a title and initial data. Always include both header row AND data rows in the values parameter when the user provides data to populate. Returns the new spreadsheet ID and URL. Requires approval.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Title for the new spreadsheet' },
          values: { type: 'string', description: 'Optional JSON array of row arrays to populate the sheet, e.g. [["Header1","Header2"],["Row1A","Row1B"]]' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'sheets_update',
      description: 'Write or overwrite values in specific cells of an existing Google Sheets spreadsheet. Use this to modify existing data or fill specific cell ranges. Requires approval.',
      parameters: {
        type: 'object',
        properties: {
          spreadsheet_id: { type: 'string', description: 'Google Sheets spreadsheet ID' },
          range: { type: 'string', description: 'A1 notation range to write to, e.g. Sheet1!A1:C3' },
          values: { type: 'string', description: 'JSON array of row arrays, e.g. [["A","B","C"],["D","E","F"]]' },
        },
        required: ['spreadsheet_id', 'range', 'values'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'drive_upload',
      description: 'Upload a file to Google Drive. Requires approval.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Local path to the file to upload' },
          parent_id: { type: 'string', description: 'Parent folder ID (optional, defaults to root)' },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'review_overdue_tasks',
      description: 'Surface overdue tasks with context — shows what needs attention.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'save_email_to_doc',
      description: 'Archive a Gmail thread as a Google Doc for reference. Requires approval.',
      parameters: {
        type: 'object',
        properties: {
          thread_id: { type: 'string', description: 'Gmail thread ID to save' },
        },
        required: ['thread_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'archive_email_threads',
      description: 'Archive one or more Gmail threads by removing the INBOX label. Requires approval.',
      parameters: {
        type: 'object',
        properties: {
          thread_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Gmail thread IDs to archive.',
          },
          preview_items: {
            type: 'string',
            description: 'Optional JSON array preview of the selected threads with sender, subject, and reason.',
          },
        },
        required: ['thread_ids'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'trash_email_threads',
      description: 'Move one or more Gmail threads to Gmail Trash. Requires approval.',
      parameters: {
        type: 'object',
        properties: {
          thread_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Gmail thread IDs to move to Trash.',
          },
          preview_items: {
            type: 'string',
            description: 'Optional JSON array preview of the selected threads with sender, subject, and reason.',
          },
        },
        required: ['thread_ids'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'restore_email_threads',
      description: 'Restore one or more Gmail threads back to the Inbox. Requires approval.',
      parameters: {
        type: 'object',
        properties: {
          thread_ids: { type: 'array', items: { type: 'string' }, description: 'Gmail thread IDs to restore to Inbox.' },
        },
        required: ['thread_ids'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'mute_email_threads',
      description: 'Mute one or more Gmail threads. Requires approval.',
      parameters: {
        type: 'object',
        properties: {
          thread_ids: { type: 'array', items: { type: 'string' }, description: 'Gmail thread IDs to mute.' },
        },
        required: ['thread_ids'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'mark_threads_read',
      description: 'Mark one or more Gmail threads as read. Requires approval.',
      parameters: {
        type: 'object',
        properties: {
          thread_ids: { type: 'array', items: { type: 'string' }, description: 'Gmail thread IDs to mark as read.' },
        },
        required: ['thread_ids'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'apply_label_to_threads',
      description: 'Apply a Gmail label to one or more Gmail threads. Requires approval.',
      parameters: {
        type: 'object',
        properties: {
          thread_ids: { type: 'array', items: { type: 'string' }, description: 'Gmail thread IDs to label.' },
          label_name: { type: 'string', description: 'Gmail label name to apply.' },
        },
        required: ['thread_ids', 'label_name'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'unsubscribe_from_sender',
      description: 'Safely attempt a best-effort unsubscribe using Gmail metadata. Requires approval.',
      parameters: {
        type: 'object',
        properties: {
          thread_ids: { type: 'array', items: { type: 'string' }, description: 'A representative Gmail thread ID from the sender.' },
        },
        required: ['thread_ids'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_gmail_filter',
      description: 'Create a Gmail filter using sender or subject criteria. Requires approval.',
      parameters: {
        type: 'object',
        properties: {
          sender: { type: 'string', description: 'Sender email or sender pattern.' },
          subject: { type: 'string', description: 'Subject text to match.' },
          label_name: { type: 'string', description: 'Optional label name to apply.' },
          archive: { type: 'boolean', description: 'Whether to archive matching emails.' },
          mark_read: { type: 'boolean', description: 'Whether to mark matching emails as read.' },
          skip_inbox: { type: 'boolean', description: 'Whether to skip the inbox.' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'save_memory',
      description: 'Save information to long-term memory for future conversations. Use when the user explicitly says "remember this" or "save this for later" or when you learn something important about the user that should be recalled across conversations. Categories: resource (files, spreadsheets, docs with IDs), workflow (user\'s processes and patterns), preference (user\'s preferences and defaults), fact (important information about people, projects, etc).',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'What to remember, written as a concise human-readable summary' },
          category: { type: 'string', enum: ['resource', 'workflow', 'preference', 'fact'], description: 'Category: resource (files/docs/spreadsheets with IDs), workflow (user processes), preference (defaults and preferences), fact (important information)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Keywords for retrieval (3-5 relevant words)' },
        },
        required: ['content', 'category', 'tags'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_memory',
      description: 'Search long-term memory for previously stored information about the user. Use when the user asks about past preferences, created resources, established workflows, or says "what did I..." or "remember when...". Returns matching memories with relevance scores.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to search for in memory (e.g., "job applications spreadsheet", "email preferences", "weekly standup")' },
        },
        required: ['query'],
      },
    },
  },
];
