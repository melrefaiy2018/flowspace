import { useState, useCallback, useEffect } from 'react';
import { api } from '../services/api';
import type { StagedDraft, ScanMeta, RelatedEmail, LinkedDoc } from '../agent/draft-types';

export interface ApproveResult {
  threadBrief: string;
  sources: {
    emails: RelatedEmail[];
    docs: LinkedDoc[];
    attendees: string[];
    meetingTitle: string;
    meetingTime: string;
  };
}

export interface UseDraftsState {
  drafts: StagedDraft[];
  lastScan: ScanMeta | null;
  loading: boolean;
  scanning: boolean;
  scanProgress: string | null;
  error: string | null;
}

export interface UseDraftsActions {
  refresh: () => Promise<void>;
  scan: () => Promise<void>;
  approve: (id: string) => Promise<ApproveResult | null>;
  dismiss: (id: string) => Promise<void>;
  toggleUseful: (id: string, useful: boolean) => Promise<void>;
}

export type UseDraftsReturn = UseDraftsState & UseDraftsActions;

export function useDrafts(): UseDraftsReturn {
  const [drafts, setDrafts] = useState<StagedDraft[]>([]);
  const [lastScan, setLastScan] = useState<ScanMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { drafts: fetched, lastScan: meta } = await api.getDrafts();
      setDrafts(fetched);
      setLastScan(meta);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load drafts');
    } finally {
      setLoading(false);
    }
  }, []);

  const scan = useCallback(async () => {
    if (scanning) return;
    setScanning(true);
    setScanProgress('Scanning your next 48 hours...');
    setError(null);
    try {
      const result = await api.scanDrafts();
      const total = result.meta.meetingsFound;
      const prepped = result.meta.meetingsPrepped;
      setScanProgress(`Prepped ${prepped} of ${total} meeting${total !== 1 ? 's' : ''}`);
      // Refresh the list from server (has dedup + purge applied)
      const { drafts: fetched, lastScan: meta } = await api.getDrafts();
      setDrafts(fetched);
      setLastScan(meta);
    } catch (err: any) {
      setError(err?.message ?? 'Scan failed');
    } finally {
      setScanning(false);
      // Clear progress message after a brief moment
      setTimeout(() => setScanProgress(null), 3000);
    }
  }, [scanning]);

  const approve = useCallback(async (id: string): Promise<ApproveResult | null> => {
    try {
      const { draft, threadBrief, sources } = await api.approveDraft(id);
      setDrafts((prev) => prev.map((d) => (d.id === id ? draft : d)));
      return { threadBrief, sources };
    } catch (err: any) {
      setError(err?.message ?? 'Failed to approve draft');
      return null;
    }
  }, []);

  const dismiss = useCallback(async (id: string) => {
    try {
      await api.dismissDraft(id);
      setDrafts((prev) => prev.filter((d) => d.id !== id));
    } catch (err: any) {
      setError(err?.message ?? 'Failed to dismiss draft');
    }
  }, []);

  const toggleUseful = useCallback(async (id: string, useful: boolean) => {
    try {
      await api.toggleDraftUseful(id, useful);
      setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, useful } : d)));
    } catch (err: any) {
      setError(err?.message ?? 'Failed to update feedback');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    drafts,
    lastScan,
    loading,
    scanning,
    scanProgress,
    error,
    refresh,
    scan,
    approve,
    dismiss,
    toggleUseful,
  };
}
