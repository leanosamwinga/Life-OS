import { useEffect, useState } from 'react';

export type AsyncState<T> =
  | { status: 'loading'; data: T | null; error: null }
  | { status: 'ready'; data: T; error: null }
  | { status: 'error'; data: T | null; error: string };

/** Run `load` whenever `deps` change; keeps the previous data while reloading. */
export function useAsync<T>(
  load: (() => Promise<T>) | null,
  deps: readonly unknown[],
): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading', data: null, error: null });
  useEffect(() => {
    if (!load) return;
    let alive = true;
    setState((s) => ({ status: 'loading', data: s.data, error: null }));
    load().then(
      (data) => alive && setState({ status: 'ready', data, error: null }),
      (err: unknown) =>
        alive &&
        setState((s) => ({
          status: 'error',
          data: s.data,
          error: err instanceof Error ? err.message : 'Could not load your data.',
        })),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
