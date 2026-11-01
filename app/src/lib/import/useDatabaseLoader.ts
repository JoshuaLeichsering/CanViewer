// SPDX-License-Identifier: GPL-2.0-or-later
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { importWithCanmatrix } from '../canmatrix/client';
import { DatabaseLoader, type LoaderEvent } from './loader';
import * as storage from './storage';

/**
 * The app's file loader (loader.ts) as React state. It restores the file of
 * the last session once, on mount, and reports what happens through
 * `onEvent` (a database shown, an import failed).
 */
export function useDatabaseLoader(onEvent: (event: LoaderEvent) => void) {
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);
  const [loader] = useState(
    () =>
      new DatabaseLoader({ importFile: importWithCanmatrix, storage }, (event) => {
        // A failure CanViewer names is shown in the user's language instead of
        // the technical message (the browser's, say); keep that for the console.
        if (event.kind === 'failed' && event.reason) console.warn(`${event.name}: ${event.error}`);
        onEventRef.current(event);
      }),
  );
  const state = useSyncExternalStore(loader.subscribe, loader.getState);

  // Guarded by a ref so StrictMode's double effect run cannot restore twice.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    void loader.restore();
  }, [loader]);

  const loadFile = useCallback(
    async (file: File) => {
      let bytes: ArrayBuffer;
      try {
        bytes = await file.arrayBuffer();
      } catch (e) {
        // The file went away, or the browser may not read it.
        onEventRef.current({ kind: 'failed', name: file.name, error: e instanceof Error ? e.message : String(e), restored: false });
        return;
      }
      await loader.open(file.name, bytes);
    },
    [loader],
  );

  return { ...state, loadFile, selectCluster: loader.selectCluster };
}
