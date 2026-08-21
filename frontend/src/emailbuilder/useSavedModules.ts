import { useCallback, useEffect, useState } from 'react';
import { createSavedModule, deleteSavedModule, listSavedModules } from '../api/client';
import type { EmailModule } from './edm';
import type { SavedEmailModule } from './types';

export interface UseSavedModules {
  savedModules: SavedEmailModule[];
  loading: boolean;
  error: string | null;
  saveModule: (name: string, module: EmailModule) => Promise<void>;
  removeModule: (id: number) => Promise<void>;
}

// Feature 04 — a user's personal Saved Modules library. Kept isolated
// from the EDM builder state (useEmailBuilderState) — searching/filtering
// the library must never re-render the canvas, and vice versa.
export function useSavedModules(): UseSavedModules {
  const [savedModules, setSavedModules] = useState<SavedEmailModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listSavedModules()
      .then((loaded) => {
        if (!cancelled) setSavedModules(loaded);
      })
      .catch(() => {
        if (!cancelled) setError('We could not load your saved modules.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveModule = useCallback(async (name: string, module: EmailModule) => {
    const created = await createSavedModule({
      name,
      module_type: module.type,
      props: module.props,
      settings: module.settings,
    });
    setSavedModules((current) => [created, ...current]);
  }, []);

  const removeModule = useCallback(async (id: number) => {
    await deleteSavedModule(id);
    setSavedModules((current) => current.filter((saved) => saved.id !== id));
  }, []);

  return { savedModules, loading, error, saveModule, removeModule };
}
