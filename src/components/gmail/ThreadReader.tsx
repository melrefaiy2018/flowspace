import { useRef, useEffect } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { Paperclip, Download } from 'lucide-react';
import type { GmailThreadDetail, GmailThreadMessage } from '../../services/api';
import { openExternalUrl } from '../../lib/open-external';

function formatFullDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

function extractName(from: string): string {
  const match = from.match(/^"?([^"<]+)"?\s*</);
  if (match) return match[1].trim();
  return from.split('@')[0];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const EMAIL_LAYOUT_CONTAINER_SELECTOR =
  'table, tbody, thead, tfoot, tr, td, th, div, center, section, article, main';

const EMAIL_SPACER_SELECTOR =
  [
    '[height]',
    '[style*="height:"]',
    '[style*="height: "]',
    '[style*="min-height:"]',
    '[style*="min-height: "]',
    '[style*="padding-top:"]',
    '[style*="padding-top: "]',
    '[style*="padding-bottom:"]',
    '[style*="padding-bottom: "]',
  ].join(',');

function normalizeEmailLayout(doc: Document) {
  const root = doc.getElementById('flowspace-email-root');
  if (!root) return;

  root.querySelectorAll<HTMLElement>(EMAIL_LAYOUT_CONTAINER_SELECTOR).forEach((element) => {
    element.removeAttribute('height');
    element.removeAttribute('width');
    element.style.height = 'auto';
    element.style.width = element.matches('table') ? '100%' : 'auto';
    element.style.minHeight = '0';
    element.style.minWidth = '0';
    element.style.maxWidth = '100%';
    element.style.maxHeight = 'none';
    element.style.alignItems = 'flex-start';
    element.style.overflowWrap = 'anywhere';
    element.style.wordBreak = 'normal';
  });

  root.querySelectorAll<HTMLElement>(EMAIL_SPACER_SELECTOR).forEach((element) => {
    if (element.matches('img, svg, video, canvas')) return;
    const text = element.textContent?.replace(/\u00a0/g, ' ').trim() ?? '';
    const hasMedia = Boolean(element.querySelector('img, svg, video, canvas'));
    const hasBorder = Boolean(element.style.border || element.style.borderTop || element.style.borderBottom);

    element.removeAttribute('height');
    element.style.height = 'auto';
    element.style.minHeight = '0';
    element.style.minWidth = '0';
    element.style.maxWidth = '100%';

    if (!text && !hasMedia && !hasBorder) {
      element.style.paddingTop = '0';
      element.style.paddingBottom = '0';
      element.style.lineHeight = '0';
    }
  });
}

function measureEmailContentHeight(doc: Document): number {
  const root = doc.getElementById('flowspace-email-root');
  if (!root) return 0;

  const rootTop = root.getBoundingClientRect().top;
  let contentBottom = 0;

  root.querySelectorAll<HTMLElement>('body, table, tr, td, th, div, p, span, a, img, blockquote, pre, ul, ol, li, h1, h2, h3, h4, h5, h6').forEach((element) => {
    const text = element.textContent?.replace(/\u00a0/g, ' ').trim() ?? '';
    const hasMedia = element.matches('img, svg, video, canvas') || Boolean(element.querySelector('img, svg, video, canvas'));
    const hasVisibleBox = Boolean(
      element.style.border ||
      element.style.borderTop ||
      element.style.borderRight ||
      element.style.borderBottom ||
      element.style.borderLeft ||
      element.style.background ||
      element.style.backgroundColor,
    );

    if (!text && !hasMedia && !hasVisibleBox) return;

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    contentBottom = Math.max(contentBottom, Math.ceil(rect.bottom - rootTop));
  });

  return contentBottom;
}

function MessageBody({ message }: { message: GmailThreadMessage }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  // Theme-aware colors passed into the sandboxed iframe
  const iframeBg   = isDark ? '#1a1a1a' : '#ffffff';
  const iframeText = isDark ? '#e0e0e0' : '#111113';
  const iframeLink = isDark ? '#7eb3f5' : '#2563eb';
  const iframeBq   = isDark ? '#555555' : '#d1d1d6';
  const iframeBqText = isDark ? '#999999' : '#6b7280';
  const colorScheme = isDark ? 'dark' : 'light';
  // Override white backgrounds in dark mode; override dark backgrounds in light mode
  const whiteBgOverride = isDark
    ? `[style*="background:#fff"], [style*="background: #fff"],
       [style*="background:#ffffff"], [style*="background: #ffffff"],
       [style*="background-color:#fff"], [style*="background-color: #fff"],
       [style*="background-color:#ffffff"], [style*="background-color: #ffffff"],
       [style*="background-color: white"], [style*="background-color:white"] {
         background-color: #1a1a1a !important;
       }
       [style*="color:#000"], [style*="color: #000"],
       [style*="color:#333"], [style*="color: #333"],
       [style*="color:#222"], [style*="color: #222"],
       [style*="color: black"], [style*="color:black"] {
         color: #e0e0e0 !important;
       }`
    : `[style*="background:#000"], [style*="background: #000"],
       [style*="background:#111"], [style*="background:#1a1a1a"],
       [style*="background-color:#000"], [style*="background-color: #000"],
       [style*="background-color:#111"], [style*="background-color:#1a1a1a"],
       [style*="background-color: black"], [style*="background-color:black"] {
         background-color: #ffffff !important;
       }`;

  useEffect(() => {
    if (message.bodyType === 'html' && iframeRef.current) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(`
          <html>
            <head>
              <style>
                html, body {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                  font-size: 13px;
                  line-height: 1.5;
                  margin: 0;
                  padding: 0;
                  height: auto !important;
                  min-height: 0 !important;
                  word-break: break-word;
                  overflow-wrap: break-word;
                  overflow: visible !important;
                  background: ${iframeBg} !important;
                  color: ${iframeText} !important;
                  color-scheme: ${colorScheme};
                }
                body {
                  display: block !important;
                }
                #flowspace-email-root {
                  display: flow-root !important;
                  width: 100% !important;
                  max-width: 100% !important;
                  height: auto !important;
                  min-height: 0 !important;
                  overflow: visible !important;
                  overflow-wrap: anywhere !important;
                  word-break: normal !important;
                }
                #flowspace-email-root,
                #flowspace-email-root * {
                  box-sizing: border-box;
                  min-width: 0 !important;
                }
                /* Google Calendar invites and many marketing emails use
                 * full-page height attributes/styles to enforce
                 * layout heights designed for full-page email rendering.
                 * Inside our small iframe those values create huge empty
                 * vertical gaps. Force tables/cells to natural height so
                 * scrollHeight tracks actual content. */
                #flowspace-email-root table,
                #flowspace-email-root thead,
                #flowspace-email-root tfoot,
                #flowspace-email-root tbody,
                #flowspace-email-root tr,
                #flowspace-email-root td,
                #flowspace-email-root th,
                #flowspace-email-root div,
                #flowspace-email-root center,
                #flowspace-email-root section,
                #flowspace-email-root article,
                #flowspace-email-root main,
                #flowspace-email-root [height="100%"],
                #flowspace-email-root [style*="height:100%"],
                #flowspace-email-root [style*="height: 100%"],
                #flowspace-email-root [style*="min-height:100%"],
                #flowspace-email-root [style*="min-height: 100%"] {
                  height: auto !important;
                  width: auto !important;
                  min-height: 0 !important;
                  min-width: 0 !important;
                  max-width: 100% !important;
                  max-height: none !important;
                  align-items: flex-start !important;
                  overflow-wrap: anywhere !important;
                  word-break: normal !important;
                }
                #flowspace-email-root table {
                  width: 100% !important;
                  table-layout: auto !important;
                }
                #flowspace-email-root table,
                #flowspace-email-root td,
                #flowspace-email-root th,
                #flowspace-email-root img,
                #flowspace-email-root div {
                  max-width: 100% !important;
                }
                #flowspace-email-root p,
                #flowspace-email-root span,
                #flowspace-email-root a,
                #flowspace-email-root font {
                  max-width: 100% !important;
                  overflow-wrap: anywhere !important;
                  word-break: normal !important;
                }
                img { max-width: 100%; height: auto; }
                a { color: ${iframeLink}; }
                blockquote {
                  border-left: 2px solid ${iframeBq};
                  margin: 8px 0;
                  padding-left: 12px;
                  color: ${iframeBqText};
                }
                pre, code { white-space: pre-wrap; }
                table, td, th { background-color: transparent !important; }
                ${whiteBgOverride}
              </style>
              <script>
                document.addEventListener('click', function(e) {
                  var a = e.target.closest('a');
                  if (a && a.href) {
                    e.preventDefault();
                    window.parent.postMessage({ type: 'open-url', url: a.href }, '*');
                  }
                });
              </script>
            </head>
            <body><main id="flowspace-email-root">${message.body}</main></body>
          </html>
        `);
        doc.close();
        normalizeEmailLayout(doc);

        // Listen for open-url messages posted by the injected iframe script
        const handleMessage = (e: MessageEvent) => {
          if (e.data?.type === 'open-url' && typeof e.data.url === 'string') {
            openExternalUrl(e.data.url);
          }
        };
        window.addEventListener('message', handleMessage);

        // Auto-resize iframe to its natural content height. Measure both
        // body.scrollHeight and documentElement.scrollHeight and take the
        // smaller — body can over-report when the document has tall
        // empty containers; documentElement reflects actual painted
        // content. Cap to a sane upper bound so a misbehaving email
        // template can't blow the layout to tens of thousands of px.
        let resizeQueued = false;
        const resize = () => {
          if (resizeQueued) return;
          resizeQueued = true;
          requestAnimationFrame(() => {
            resizeQueued = false;
            if (!iframeRef.current || !doc.body || !doc.documentElement) return;
            normalizeEmailLayout(doc);
            const root = doc.getElementById('flowspace-email-root');
            const contentH = measureEmailContentHeight(doc);
            const rootRectH = root ? Math.ceil(root.getBoundingClientRect().height) : 0;
            const rootScrollH = root?.scrollHeight ?? 0;
            const rootOffsetH = root?.offsetHeight ?? 0;
            const bodyH = doc.body.scrollHeight;
            const docH = doc.documentElement.scrollHeight;
            // Prefer the explicit content wrapper so the iframe height follows
            // the email document, not viewport-sized calendar invite shells.
            const rootH = Math.max(rootRectH, rootScrollH, rootOffsetH);
            const fallbackH = Math.min(bodyH || docH, docH || bodyH);
            const h = contentH || rootH || fallbackH;
            const clamped = Math.max(80, Math.min(h, 8000));
            iframeRef.current.style.height = `${clamped + 16}px`;
          });
        };
        resize();
        // Re-check after images load or DOM mutates. Debounced via
        // requestAnimationFrame so style mutations from resize() itself
        // can't ratchet the height upward.
        const observer = new MutationObserver(resize);
        observer.observe(doc.body, { childList: true, subtree: true });
        doc.addEventListener('load', resize, true);
        return () => {
          observer.disconnect();
          window.removeEventListener('message', handleMessage);
        };
      }
    }
  }, [message.body, message.bodyType, iframeBg, iframeText, iframeLink, iframeBq, iframeBqText, colorScheme, whiteBgOverride]);

  if (message.bodyType === 'html') {
    return (
      <iframe
        ref={iframeRef}
        sandbox="allow-same-origin allow-scripts"
        title="Email content"
        className="block w-full min-w-0 max-w-full shrink-0 border-0 min-h-[100px]"
        style={{ background: 'transparent', width: '100%', maxWidth: '100%' }}
      />
    );
  }

  return (
    <pre className="text-[13px] text-[var(--text-dim)] whitespace-pre-wrap leading-relaxed font-sans">
      {message.body || '(no content)'}
    </pre>
  );
}

export function MessageCard({ message, isLast }: { message: GmailThreadMessage; isLast: boolean }) {
  return (
    <div className={`min-w-0 shrink-0 px-5 py-4 ${!isLast ? 'border-b border-[var(--border)]' : ''}`}>
      {/* Header */}
      <div className="mb-3 flex min-w-0 items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-[var(--purple)] flex items-center justify-center text-[11px] font-bold text-white shrink-0">
          {extractName(message.from)[0]?.toUpperCase() ?? '?'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="min-w-0 text-[13px] font-medium break-words [overflow-wrap:anywhere]">{extractName(message.from)}</span>
            <span className="shrink-0 text-[10px] text-[var(--text-faint)]">{formatFullDate(message.date)}</span>
          </div>
          <div className="text-[11px] text-[var(--text-faint)] break-words [overflow-wrap:anywhere]">
            To: {message.to}
            {message.cc && <> &middot; Cc: {message.cc}</>}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flow-root min-w-0 overflow-hidden pl-11">
        <MessageBody message={message} />

        {/* Attachments */}
        {message.attachments.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {message.attachments.map((att) => (
              <div
                key={att.attachmentId}
                className="flex items-center gap-2 px-3 py-2 bg-[var(--surface2)] border border-[var(--border)] rounded-lg text-[11px]"
              >
                <Paperclip size={12} className="text-[var(--text-faint)] shrink-0" />
                <span className="truncate max-w-[160px]">{att.filename}</span>
                <span className="text-[var(--text-faint)]">{formatSize(att.size)}</span>
                <Download size={12} className="text-[var(--accent)] shrink-0 cursor-pointer hover:scale-110 transition-transform" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ThreadReader({ thread }: { thread: GmailThreadDetail }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
      {thread.messages.map((msg, i) => (
        <MessageCard key={msg.id} message={msg} isLast={i === thread.messages.length - 1} />
      ))}
    </div>
  );
}
