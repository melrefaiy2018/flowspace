import { useState, useEffect } from 'react';
import { api } from '../services/api';
import type { VersionInfo } from '../services/api';

export function useUpdateCheck() {
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const check = () => {
    setLoading(true);
    api.getVersion()
      .then(setVersionInfo)
      .catch(() => setVersionInfo(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => { check(); }, []);

  return { versionInfo, loading, recheck: check };
}
