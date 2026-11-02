// SPDX-License-Identifier: GPL-2.0-or-later
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
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
  // Plain state rather than useSyncExternalStore: React renders a store's
  // update on its own, at a higher priority than the reset of the view that
  // `onEvent` makes for a new database. One render would then show the new
  // database with the old selection, and the app would remember that
  // selection for the new file. As state, both changes render together.
  // Subscribed in a layout effect, so before the restore below runs.
  //
  // A change of the import's stage alone renders at once, as the worker
  // reports it. Batched with the next update, a stage shorter than React's
  // next render (reading a small file in a runtime that is already loaded)
  // would never reach the screen, and the progress panel would skip it.
  const [state, setState] = useState(loader.getState);
  useLayoutEffect(() => {
    let shown = loader.getState();
    setState(shown);
    return loader.subscribe(() => {
      const next = loader.getState();
      const stageOnly = next.db === shown.db && next.fileName === shown.fileName && next.source === shown.source;
      shown = next;
      if (stageOnly) flushSync(() => setState(next));
      else setState(next);
    });
  }, [loader]);

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

  return { ...state, loadFile, selectCluster: loader.selectCluster, edit: loader.edit, savedAsDbc: loader.savedAsDbc, close: loader.close };
}
