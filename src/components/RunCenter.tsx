import { useMemo, useState, useEffect } from 'react';
import { Activity, CheckCircle2, Clock3, ExternalLink, RefreshCw, ShieldCheck, XCircle, ChevronRight, AlertCircle, Info, Check, X, Layers } from 'lucide-react';
import EmptyState from './EmptyState';
import { useChatContext } from '../context/ChatContext';
import type { RunStatus, ApprovalRequest } from '../shared/chat';
import { motion, AnimatePresence } from 'motion/react';

const STATUS_LABEL: Record<RunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  awaiting_approval: 'Awaiting approval',
  completed: 'Completed',
  failed: 'Failed',
  canceled: 'Canceled',
};

const STATUS_STYLE: Record<RunStatus, string> = {
  queued: 'bg-[var(--surface3)] text-[var(--text-faint)]',
  running: 'bg-[var(--blue-dim)] text-[var(--blue)]',
  awaiting_approval: 'bg-[var(--amber-dim)] text-[var(--amber)]',
  completed: 'bg-[var(--accent-dim)] text-[var(--accent)]',
  failed: 'bg-[var(--error-dim)] text-[var(--error)]',
  canceled: 'bg-[var(--surface3)] text-[var(--text-dim)]',
};

function formatAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function ProgressBar({ current, total, status }: { current: number; total: number; status: RunStatus }) {
  const percentage = Math.min(100, Math.max(0, (current / total) * 100));
  const isRunning = status === 'running' || status === 'queued';
  
  return (
    <div className="h-1.5 w-full bg-[var(--surface3)] rounded-full overflow-hidden mt-2 relative">
      <motion.div 
        initial={{ width: 0 }}
        animate={{ width: `${percentage}%` }}
        className={`h-full rounded-full ${
          status === 'failed' ? 'bg-[var(--error)]' : 
          status === 'completed' ? 'bg-[var(--accent)]' : 
          status === 'awaiting_approval' ? 'bg-[var(--amber)]' : 
          'bg-[var(--blue)]'
        }`}
      />
      {isRunning && (
        <motion.div
          animate={{ x: ['-100%', '200%'] }}
          transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
          className="absolute top-0 left-0 h-full w-1/3 bg-white/20 skew-x-[-20deg]"
        />
      )}
    </div>
  );
}

function DiffPreview({ before, after }: { before?: Record<string, string>; after?: Record<string, string> }) {
  if (!before && !after) return null;
  
  const keys = Array.from(new Set([...Object.keys(before || {}), ...Object.keys(after || {})]));
  
  return (
    <div className="mt-2 text-[10px] border border-[var(--border)] rounded-[6px] overflow-hidden bg-[var(--surface2)]">
      <div className="grid grid-cols-2 border-b border-[var(--border)] bg-[var(--surface3)] font-medium">
        <div className="px-2 py-1 border-r border-[var(--border)]">Current</div>
        <div className="px-2 py-1">Proposed Change</div>
      </div>
      <div className="max-h-[120px] overflow-y-auto">
        {keys.map(key => (
          <div key={key} className="grid grid-cols-2 border-b last:border-0 border-[var(--border)]">
            <div className="px-2 py-1.5 border-r border-[var(--border)] text-[var(--text-dim)] break-all font-mono">
              <span className="text-[var(--text-faint)] block mb-0.5">{key}:</span>
              {before?.[key] || '(none)'}
            </div>
            <div className="px-2 py-1.5 text-[var(--text)] break-all font-mono bg-[var(--accent-dim)]/20">
              <span className="text-[var(--text-faint)] block mb-0.5">{key}:</span>
              {after?.[key] || '(removed)'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function RunCenter() {
  const { runs, runSummary, pendingApprovals, switchConversation, triggerAction, approveAction, dismissApproval } = useChatContext();
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'runs' | 'approvals'>('runs');

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen]);
  const [filter, setFilter] = useState<'all' | 'active' | 'completed' | 'failed'>('active');

  const filteredRuns = useMemo(() => {
    if (filter === 'all') return runs;
    if (filter === 'active') return runs.filter((run) => run.status === 'running' || run.status === 'queued' || run.status === 'awaiting_approval');
    if (filter === 'completed') return runs.filter((run) => run.status === 'completed');
    return runs.filter((run) => run.status === 'failed');
  }, [runs, filter]);

  const activeCount = runSummary?.activeCount ?? runs.filter((run) => run.status === 'running' || run.status === 'queued').length;
  const awaitingCount = pendingApprovals.length;
  const notificationCount = pendingApprovals.length + runs.filter((run) => (
    run.status === 'completed' || run.status === 'failed' || run.status === 'canceled'
  )).length;

  // Auto-switch to approvals tab if a new one arrives
  useEffect(() => {
    if (awaitingCount > 0 && activeTab === 'runs' && filteredRuns.length === 0) {
      setActiveTab('approvals');
    }
  }, [awaitingCount, filteredRuns.length, activeTab]);

  const handleApprove = async (e: React.MouseEvent, item: typeof pendingApprovals[0]) => {
    e.stopPropagation();
    try {
      // In a real app, we might need to switch conversation context first
      // but the api call itself just needs the approval object
      await approveAction(item.messageId, item.approval);
    } catch (err) {
      console.error('Failed to approve:', err);
    }
  };

  const handleCancel = (e: React.MouseEvent, messageId: string) => {
    e.stopPropagation();
    dismissApproval(messageId);
  };

  return (
    <div className="relative flex items-center">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all duration-200 cursor-pointer ${
          isOpen 
            ? 'bg-[var(--surface3)] border-[var(--border2)] text-[var(--text)] shadow-sm' 
            : awaitingCount > 0
              ? 'bg-[var(--amber-dim)] border-[var(--amber-border)] text-[var(--amber)] shadow-[0_0_10px_rgba(var(--amber-rgb),0.2)]'
              : activeCount > 0
                ? 'bg-[var(--blue-dim)] border-[var(--blue-border)] text-[var(--blue)]'
                : 'bg-[var(--surface2)] border-[var(--border2)] text-[var(--text-dim)] hover:text-[var(--text)]'
        }`}
      >
        <div className="relative flex items-center justify-center">
          {awaitingCount > 0 ? (
            <ShieldCheck size={14} className="animate-pulse" />
          ) : activeCount > 0 ? (
            <Activity size={14} className="animate-spin-slow" />
          ) : (
            <Layers size={14} />
          )}
          {(activeCount > 0 || awaitingCount > 0) && (
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-current border border-[var(--surface)]" />
          )}
        </div>
        
        <span className="hidden sm:inline text-[12px] font-medium whitespace-nowrap">Run Status</span>
        
        <div className="flex items-center gap-1 ml-1 px-1.5 py-0.5 rounded-md bg-black/5 font-mono text-[10px]">
          {awaitingCount > 0 && (
            <span className="text-[var(--amber)] font-bold">{awaitingCount}A</span>
          )}
          {awaitingCount > 0 && activeCount > 0 && <span className="opacity-20">/</span>}
          {activeCount > 0 && (
            <span className="text-[var(--blue)]">{activeCount}R</span>
          )}
          {awaitingCount === 0 && activeCount === 0 && (
            <span className="opacity-40">Idle</span>
          )}
        </div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop for closing */}
            <div 
              className="fixed inset-0 z-20" 
              onClick={() => setIsOpen(false)}
            />
            
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="absolute right-0 top-[40px] z-30 w-[420px] max-h-[580px] flex flex-col rounded-[12px] bg-[var(--surface)] border border-[var(--border)] shadow-2xl overflow-hidden"
            >
              {/* Header / Tabs */}
              <div className="flex items-center border-b border-[var(--border)] bg-[var(--surface2)] px-1 pt-1">
                <button
                  onClick={() => setActiveTab('runs')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-[12px] font-medium transition-colors relative ${activeTab === 'runs' ? 'text-[var(--text)]' : 'text-[var(--text-faint)] hover:text-[var(--text-dim)]'}`}
                >
                  <Activity size={13} />
                  Activity
                  {activeCount > 0 && (
                    <span className="ml-1 px-1.5 py-px rounded-full bg-[var(--blue)] text-white text-[9px] font-bold">
                      {activeCount}
                    </span>
                  )}
                  {activeTab === 'runs' && (
                    <motion.div layoutId="tab-underline" className="absolute bottom-0 left-2 right-2 h-0.5 bg-[var(--accent)]" />
                  )}
                </button>
                <button
                  onClick={() => setActiveTab('approvals')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-[12px] font-medium transition-colors relative ${activeTab === 'approvals' ? 'text-[var(--text)]' : 'text-[var(--text-faint)] hover:text-[var(--text-dim)]'}`}
                >
                  <ShieldCheck size={13} />
                  Approvals
                  {awaitingCount > 0 && (
                    <span className="ml-1 px-1.5 py-px rounded-full bg-[var(--amber)] text-white text-[9px] font-bold animate-pulse">
                      {awaitingCount}
                    </span>
                  )}
                  {activeTab === 'approvals' && (
                    <motion.div layoutId="tab-underline" className="absolute bottom-0 left-2 right-2 h-0.5 bg-[var(--accent)]" />
                  )}
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto min-h-0 custom-scrollbar">
                {activeTab === 'runs' && (
                  <div className="p-3">
                    <div className="flex items-center gap-1.5 mb-3 overflow-x-auto pb-1 no-scrollbar">
                      {(['active', 'all', 'completed', 'failed'] as const).map((item) => (
                        <button
                          key={item}
                          onClick={() => setFilter(item)}
                          className={`text-[10px] px-2.5 py-1 rounded-full border whitespace-nowrap cursor-pointer transition-colors ${filter === item ? 'bg-[var(--surface3)] border-[var(--border2)] text-[var(--text)] font-medium' : 'bg-transparent border-[var(--border)] text-[var(--text-faint)] hover:border-[var(--border2)]'}`}
                        >
                          {item.charAt(0).toUpperCase() + item.slice(1)}
                        </button>
                      ))}
                      <div className="ml-auto text-[10px] text-[var(--text-faint)] font-mono">
                        {runSummary?.completed24h ?? 0} done / 24h
                      </div>
                    </div>

                    <div className="space-y-2.5">
                      {filteredRuns.length === 0 && (
                        <EmptyState
                          icon={Info}
                          title="No activity found"
                          description="Delegate a task to see it tracked here in real-time."
                          size="sm"
                        />
                      )}
                      {filteredRuns.map((run) => (
                        <div key={run.id} className="group rounded-[10px] border border-[var(--border)] p-3 bg-[var(--bg)] hover:border-[var(--border2)] transition-colors">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-[12px] text-[var(--text)] font-semibold truncate leading-tight">
                                  {run.objective}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-faint)]">
                                <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md font-mono text-[9px] uppercase font-bold ${STATUS_STYLE[run.status]}`}>
                                  {run.status === 'running' && <RefreshCw size={8} className="animate-spin" />}
                                  {STATUS_LABEL[run.status]}
                                </span>
                                <span>•</span>
                                <span>{formatAgo(run.startedAt)}</span>
                              </div>
                            </div>
                            {run.conversationId && (
                              <button
                                onClick={() => switchConversation(run.conversationId!)}
                                className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 p-1.5 rounded-full hover:bg-[var(--surface2)] text-[var(--text-faint)] hover:text-[var(--text)] transition-all cursor-pointer"
                                title="Jump to thread"
                              >
                                <ChevronRight size={16} />
                              </button>
                            )}
                          </div>

                          {(run.status === 'running' || run.status === 'completed' || run.status === 'awaiting_approval' || (run.status === 'failed' && run.toolTotal > 0)) && (
                            <div className="mt-3 pt-3 border-t border-[var(--border)] border-dashed">
                              <div className="flex justify-between text-[10px] mb-1">
                                <span className="text-[var(--text-dim)] font-medium">Progress</span>
                                <span className="text-[var(--text-faint)] font-mono">{run.toolCompleted} / {run.toolTotal} steps</span>
                              </div>
                              <ProgressBar current={run.toolCompleted} total={run.toolTotal} status={run.status} />
                            </div>
                          )}

                          {run.sourceApps.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {run.sourceApps.map((app) => (
                                <span key={app} className="text-[9px] px-2 py-0.5 rounded-md bg-[var(--surface2)] text-[var(--text-dim)] border border-[var(--border2)] flex items-center gap-1">
                                  <div className="w-1 h-1 rounded-full bg-[var(--accent)]" />
                                  {app}
                                </span>
                              ))}
                            </div>
                          )}

                          {run.status === 'failed' && (
                            <div className="mt-3 p-2 rounded-md bg-[var(--error-dim)] border border-[var(--error-border)] flex items-start gap-2">
                              <AlertCircle size={12} className="text-[var(--error)] mt-0.5 shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="text-[10px] text-[var(--error)] font-medium leading-tight">
                                  {run.errorMessage || 'Unknown execution error'}
                                </div>
                                <button
                                  onClick={() => triggerAction(`Retry this request: ${run.objective}`, true)}
                                  className="mt-1.5 text-[10px] font-bold text-[var(--error)] hover:underline flex items-center gap-1 cursor-pointer"
                                >
                                  <RefreshCw size={10} /> Retry action
                                </button>
                              </div>
                            </div>
                          )}

                          {run.status === 'awaiting_approval' && (
                            <button
                              onClick={() => setActiveTab('approvals')}
                              className="mt-3 w-full py-1.5 rounded-md bg-[var(--amber)] text-white text-[11px] font-bold hover:brightness-110 transition-all cursor-pointer flex items-center justify-center gap-1.5"
                            >
                              <ShieldCheck size={12} /> View pending approval
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeTab === 'approvals' && (
                  <div className="p-3">
                    {pendingApprovals.length === 0 ? (
                      <EmptyState
                        icon={CheckCircle2}
                        title="All caught up"
                        description="No pending actions require your signature right now."
                        size="sm"
                      />
                    ) : (
                      <div className="space-y-3">
                        <div className="text-[11px] text-[var(--text-faint)] px-1 mb-2">
                          Review and approve write actions before they execute.
                        </div>
                        {pendingApprovals.map((item) => (
                          <div key={item.messageId} className="rounded-[12px] border border-[var(--amber-border)] p-3.5 bg-gradient-to-b from-[var(--bg)] to-[var(--surface2)] shadow-sm">
                            <div className="flex items-start gap-3">
                              <div className="w-8 h-8 rounded-full bg-[var(--amber-dim)] flex items-center justify-center shrink-0 border border-[var(--amber-border)]">
                                <ShieldCheck size={16} className="text-[var(--amber)]" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-[13px] text-[var(--text)] font-bold leading-tight">
                                  {item.approval.title}
                                </div>
                                <div className="text-[11px] text-[var(--text-dim)] mt-1 leading-relaxed">
                                  {item.approval.summary}
                                </div>
                              </div>
                            </div>

                            {(item.approval.beforePreview || item.approval.afterPreview) && (
                              <DiffPreview 
                                before={item.approval.beforePreview} 
                                after={item.approval.afterPreview} 
                              />
                            )}

                            {item.approval.fields && item.approval.fields.length > 0 && (
                              <div className="mt-3 space-y-2">
                                {item.approval.fields.map(field => (
                                  <div key={field.key} className="text-[10px]">
                                    <span className="text-[var(--text-faint)] font-medium block uppercase tracking-wider text-[8px] mb-0.5">{field.label}</span>
                                    <div className="p-2 rounded-md bg-[var(--surface2)] border border-[var(--border)] text-[var(--text-dim)] break-words">
                                      {field.value}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}

                            <div className="mt-4 flex items-center gap-2">
                              <button
                                onClick={(e) => handleApprove(e, item)}
                                className="flex-1 py-2 rounded-lg bg-[var(--amber)] text-white text-[12px] font-bold hover:brightness-110 transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
                              >
                                <Check size={14} /> {item.approval.confirmLabel || 'Approve'}
                              </button>
                              <button
                                onClick={(e) => handleCancel(e, item.messageId)}
                                className="px-3 py-2 rounded-lg bg-[var(--surface3)] text-[var(--text-dim)] text-[12px] font-medium hover:text-[var(--error)] transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                                title="Reject"
                              >
                                <X size={14} />
                              </button>
                              <button
                                onClick={() => switchConversation(item.conversationId)}
                                className="p-2 rounded-lg bg-[var(--surface3)] text-[var(--text-faint)] hover:text-[var(--text)] transition-colors cursor-pointer"
                                title="Review context in thread"
                              >
                                <ExternalLink size={14} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="border-t border-[var(--border)] bg-[var(--surface2)] px-3 py-2 flex items-center justify-between">
                <div className="text-[10px] text-[var(--text-faint)] flex items-center gap-1">
                  <Info size={10} />
                  Safe by design: write actions always require approval.
                </div>
                <button
                   onClick={() => setIsOpen(false)}
                   className="text-[10px] font-medium text-[var(--text-dim)] hover:text-[var(--text)]"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
