import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ApiError } from './api';

/**
 * Loads data and reloads it whenever the screen regains focus, so a balance is
 * never stale after money moves on another tab.
 */
export function useApiData<T>(loader: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Held in a ref so a caller can pass an inline arrow function without
  // re-triggering the focus effect on every render.
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const result = await loaderRef.current();
      setData(result);
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not load this screen.',
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return {
    data,
    error,
    loading,
    refreshing,
    refresh: () => load(true),
    reload: () => load(),
  };
}
