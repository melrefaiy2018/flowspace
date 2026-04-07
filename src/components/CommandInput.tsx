import { useRef, useEffect, useState, useCallback, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Sparkles, Square, Send } from 'lucide-react';
import { useChatContext } from '../context/ChatContext';

interface Props {
  variant?: 'hero' | 'reply' | 'compact';
}

export default function CommandInput({ variant = 'hero' }: Props) {
  const { activeView, input, setInput, sendMessage, stopGeneration, isLoading, registerInputRef, focusInput } = useChatContext();
  const textareaRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  const isReply = variant === 'reply';
  const isCompact = variant === 'compact';
  const preserveActiveView = isReply && activeView !== 'chat' && activeView !== 'dashboard';

  useEffect(() => {
    if (isReply) registerInputRef(textareaRef.current);
  }, [isReply, registerInputRef]);

  // Global "/" shortcut
  useEffect(() => {
    if (isReply) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        textareaRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isReply, focusInput]);

  const handleSubmit = useCallback(() => {
    if (!input.trim() || isLoading) return;
    void sendMessage(undefined, preserveActiveView ? { preserveActiveView: true } : undefined);
  }, [input, isLoading, preserveActiveView, sendMessage]);

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const placeholder = isReply ? 'Delegate the next outcome...' : 'Delegate an outcome (e.g., prep tomorrow and draft replies)...';

  if (isReply) {
    return (
      <div className="px-2 py-1 shrink-0">
        <div
          className="relative flex items-center border-2 rounded-2xl transition-all duration-300 shadow-sm"
          style={{
            borderColor: isFocused ? 'var(--accent)' : 'var(--border)',
            background: 'var(--surface)',
            boxShadow: isFocused ? '0 0 0 4px var(--accent-glow)' : 'none',
          }}
        >
          <Sparkles size={16} className="ml-4 shrink-0 transition-colors" style={{ color: isFocused ? 'var(--accent)' : 'var(--text-faint)' }} />
          <textarea
            ref={textareaRef as any}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            className="flex-1 bg-transparent text-[var(--text)] px-3 py-2.5 text-[14px] resize-none outline-none placeholder:text-[var(--text-faint)] leading-relaxed"
            style={{ fieldSizing: 'content' as any, maxHeight: '200px' }}
          />
          <div className="flex items-center gap-2 mr-2">
            {isLoading ? (
              <button onClick={stopGeneration} aria-label="Stop generation" className="w-8 h-8 rounded-xl bg-[var(--error-dim)] text-[var(--error)] flex items-center justify-center shrink-0 hover:bg-[var(--error)] hover:text-black transition-all cursor-pointer">
                <Square size={14} fill="currentColor" aria-hidden="true" />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!input.trim()}
                aria-label="Send message"
                className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-all cursor-pointer ${
                  input.trim() ? 'bg-[var(--accent)] text-black shadow-lg shadow-green-900/20' : 'bg-[var(--surface2)] text-[var(--text-faint)] opacity-50 cursor-not-allowed'
                }`}
              >
                <Send size={14} strokeWidth={2.5} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        <div className="mt-1 px-2 text-[12px] text-[var(--text-faint)] flex items-center gap-2 opacity-70">
          <div className="w-1 h-1 rounded-full bg-[var(--accent)]" />
          Write actions always require your approval.
        </div>
      </div>
    );
  }

  // Compact variant — slim single-line input for dashboard header
  if (isCompact) {
    return (
      <div
        className="flex items-center gap-2 border rounded-xl px-3 py-2 transition-all duration-200"
        style={{
          borderColor: isFocused ? 'var(--accent)' : 'var(--border)',
          background: 'var(--surface)',
          boxShadow: isFocused ? '0 0 0 3px var(--accent-glow)' : 'none',
        }}
      >
        <Sparkles size={14} style={{ color: isFocused ? 'var(--accent)' : 'var(--text-faint)' }} className="shrink-0 transition-colors" />
        <input
          ref={textareaRef as any}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); } }}
          placeholder="Ask anything..."
          className="bg-transparent border-none outline-none text-[var(--text)] text-[13px] flex-1 min-w-0 placeholder:text-[var(--text-faint)]"
        />
        {!input.trim() && !isLoading && (
          <span className="font-mono text-[11px] text-[var(--text-faint)] bg-[var(--surface3)] px-1.5 py-0.5 rounded shrink-0 select-none">/</span>
        )}
        {isLoading ? (
          <button onClick={stopGeneration} aria-label="Stop generation" className="w-7 h-7 rounded-lg bg-[var(--error-dim)] text-[var(--error)] flex items-center justify-center shrink-0 hover:bg-[var(--error)] hover:text-black transition-all cursor-pointer">
            <Square size={12} fill="currentColor" aria-hidden="true" />
          </button>
        ) : input.trim() ? (
          <button onClick={handleSubmit} aria-label="Send message" className="w-7 h-7 rounded-lg bg-[var(--accent)] text-black flex items-center justify-center shrink-0 cursor-pointer hover:brightness-110 transition-all">
            <Send size={13} strokeWidth={2.5} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    );
  }

  // Hero variant — the central main input
  return (
    <div className="flex flex-col w-full rounded-2xl group">
      <div
        className="flex items-center gap-3 bg-[var(--surface)]/90 border border-[var(--border)] rounded-[20px] px-5 py-4 transition-all duration-300"
        style={{
          borderColor: isFocused ? 'var(--accent)' : 'var(--border)',
          boxShadow: isFocused ? '0 0 0 4px var(--accent-glow-strong)' : 'inset 0 1px 0 rgba(255,255,255,0.04)',
        }}
      >
        <Sparkles size={18} style={{ color: isFocused ? 'var(--accent)' : 'var(--text-faint)' }} className="shrink-0 transition-colors" />
        <textarea
          ref={textareaRef as any}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
          placeholder="What can I help you with today?"
          rows={1}
          className="bg-transparent border-none outline-none text-[var(--text)] text-[16px] leading-relaxed flex-1 min-w-0 placeholder:text-[var(--text-faint)] resize-none"
          style={{ fieldSizing: 'content' as any, maxHeight: '200px' }}
        />
        {!input.trim() && !isLoading && (
          <span className="font-mono text-[12px] text-[var(--text-faint)] bg-[var(--surface3)] px-2 py-1 rounded shrink-0 select-none">
            /
          </span>
        )}
        {input.trim() && (
          <button
            onClick={handleSubmit}
            aria-label="Send message"
            className="w-9 h-9 rounded-xl bg-[var(--accent)] text-black flex items-center justify-center shrink-0 cursor-pointer hover:brightness-110 transition-all shadow-[0_2px_8px_rgba(34,197,94,0.3)]"
          >
            <Send size={15} strokeWidth={2.5} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="px-2 mt-2 text-[12px] text-[var(--text-faint)] flex items-center justify-center gap-1.5 opacity-70">
        <Sparkles size={12} />
        Delegate tasks, draft replies, or prepare for meetings.
      </div>
    </div>
  );
}
