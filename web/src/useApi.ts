import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './lib/api';

/** Loads data on mount, with a reload for after an action changes something. */
export function useApi<T>(loader: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Held in a ref so callers can pass an inline arrow without re-running the
  // effect on every render.
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const load = useCallback(async () => {
    try {
      setData(await loaderRef.current());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this page.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load, setError };
}
