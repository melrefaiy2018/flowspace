import { useState } from 'react';
import { Send, Loader2, Check, X, Mail, Pencil, Eye } from 'lucide-react';
import { api } from '../services/api';
import type { EmailDraftData } from '../shared/chat';
import { safeMarkdown } from './ChatThread';

function stripMarkdown(text: string): string {
  let html = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) => code.trim());
  html = html.replace(/((?:^.*\|.*$\n?){2,})/gm, '');

  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) => code.trim());
  html = html.replace(/((?:^.*\|.*$\n?){2,})/gm, '');

  function inlineStrip(text: string): string {
    return text
      .replace(/!!(.+?)!!/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/\[([^\]]+)\]\(https?:\/\/[^\s)]+\)/g, '$1')
      .replace(/(?<!href="|">)(https?:\/\/[^\s<)"]+)/g, '$1');
  }

  const lines = html.split('\n');
  const out: string[] = [];
  let inList = false;
  let listType: 'ul' | 'ol' = 'ul';

  for (const line of lines) {
    if (line.startsWith('<pre') || line.startsWith('<table')) {
      if (inList) { out.push(`</${listType}>`); inList = false; }
      out.push(line.replace(/<[^>]+>/g, ''));
      continue;
    }

    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      if (inList) { out.push(`</${listType}>`); inList = false; }
      continue;
    }

    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      if (inList) { out.push(`</${listType}>`); inList = false; }
      out.push(inlineStrip(headingMatch[2]));
      continue;
    }

    if (line.includes('<li>')) {
      const liMatch = line.match(/<li>(.+?)<\/li>/);
      if (liMatch) {
        if (!inList) {
          out.push('');
          inList = true;
          listType = 'ul';
        }
        out.push(`- ${inlineStrip(liMatch[1])}`);
        continue;
      }
    }

    if (line === '</ul>' || line === '</ol>') {
      if (inList) { out.push(''); inList = false; }
      continue;
    }

    if (line.startsWith('<ul') || line.startsWith('<ol')) {
      continue;
    }

    const ulMatch = line.match(/^[\s]*[-*]\s+(.+)$/);
    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        if (inList) out.push(`</${listType}>`);
        inList = true;
        listType = 'ul';
      }
      out.push(`- ${inlineStrip(ulMatch[1])}`);
      continue;
    }

    const olMatch = line.match(/^[\s]*\d+[.)]\s+(.+)$/);
    if (olMatch) {
      if (!inList || listType !== 'ol') {
        if (inList) out.push(`</${listType}>`);
        inList = true;
        listType = 'ol';
      }
      out.push(`${olMatch[1].match(/^\d+/)?.[0] || '1'}. ${inlineStrip(olMatch[1].replace(/^\d+[.)]\s*/, ''))}`);
      continue;
    }

    if (inList) { out.push(`</${listType}>`); inList = false; }

    if (line.trim() === '') {
      out.push('');
      continue;
    }

    out.push(inlineStrip(line));
  }

  if (inList) out.push('');

  const result = out.join('\n').trim();
  return result;
}

interface Props {
  data: EmailDraftData;
}

export default function EmailDraftCard({ data }: Props) {
  const [to, setTo] = useState(data.to);
  const [subject, setSubject] = useState(data.subject);
  const [body, setBody] = useState(data.body);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [discarded, setDiscarded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);

  const handleSend = async () => {
    if (!to.trim() || !body.trim()) return;
    setSending(true);
    setError(null);
    try {
      const plainBody = stripMarkdown(body);
      if (data.thread_id) {
        await api.sendReply({ thread_id: data.thread_id, to, subject, body: plainBody });
      } else {
        await api.sendEmail({ to, subject, body: plainBody });
      }
      setSent(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to send';
      setError(message);
    } finally {
      setSending(false);
    }
  };

  if (discarded) return null;

  if (sent) {
    return (
      <div style={{ border: '1px solid var(--green-border)', borderRadius: '14px', padding: '16px', background: 'var(--green-dim)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Check size={14} style={{ color: 'var(--green)' }} />
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>Email sent</span>
        </div>
        <p style={{ marginTop: '4px', fontSize: '12px', color: 'var(--text-dim)' }}>
          Sent to {to}
        </p>
      </div>
    );
  }

  return (
    <div style={{ border: '1px solid var(--amber-border)', borderRadius: '14px', padding: '16px', background: 'var(--amber-dim)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <Mail size={14} style={{ color: 'var(--amber)' }} />
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
          {data.thread_id ? 'Draft reply' : 'Draft email'}
        </span>
      </div>

      <div>
        <label style={{ display: 'block', marginBottom: '12px' }}>
          <div style={{ marginBottom: '4px', fontSize: '10px', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)' }}>
            To
          </div>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            style={{ width: '100%', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--bg)', padding: '8px 12px', fontSize: '12px', color: 'var(--text)', outline: 'none' }}
            placeholder="recipient@example.com"
          />
        </label>

        <label style={{ display: 'block', marginBottom: '12px' }}>
          <div style={{ marginBottom: '4px', fontSize: '10px', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)' }}>
            Subject
          </div>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            style={{ width: '100%', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--bg)', padding: '8px 12px', fontSize: '12px', color: 'var(--text)', outline: 'none' }}
            placeholder="Email subject"
          />
        </label>

        <label style={{ display: 'block', marginBottom: '12px' }}>
          <div style={{ marginBottom: '4px', fontSize: '10px', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Body</span>
            <button
              type="button"
              onClick={() => setPreviewMode(!previewMode)}
              style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '9px', fontFamily: 'monospace', textTransform: 'uppercase', color: 'var(--text-faint)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: '4px', backgroundColor: 'var(--surface2)' }}
            >
              {previewMode ? <><Pencil size={10} /> Edit</> : <><Eye size={10} /> Preview</>}
            </button>
          </div>
          {previewMode ? (
            <div
              dangerouslySetInnerHTML={{ __html: safeMarkdown(body) }}
              style={{ width: '100%', minHeight: '120px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--bg)', padding: '8px 12px', fontSize: '12px', color: 'var(--text)', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}
            />
          ) : (
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              style={{ width: '100%', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--bg)', padding: '8px 12px', fontSize: '12px', color: 'var(--text)', lineHeight: '1.5', outline: 'none', resize: 'none' }}
              placeholder="Email body"
            />
          )}
        </label>
      </div>

      {error && (
        <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--error)' }}>{error}</div>
      )}

      <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
        <button
          onClick={handleSend}
          disabled={sending || !to.trim() || !body.trim()}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', borderRadius: '10px', background: 'var(--amber)', padding: '8px 12px', fontSize: '12px', fontWeight: 600, color: 'black', opacity: (sending || !to.trim() || !body.trim()) ? 0.5 : 1, cursor: 'pointer' }}
        >
          {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
          Send
        </button>
        <button
          onClick={() => setDiscarded(true)}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--bg)', padding: '8px 12px', fontSize: '12px', fontWeight: 500, color: 'var(--text-dim)', cursor: 'pointer' }}
        >
          <X size={12} />
          Discard
        </button>
      </div>
    </div>
  );
}
