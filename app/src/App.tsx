import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FILE_INPUT_ACCEPT } from './lib/canmatrix/formats';
import type { LoaderEvent } from './lib/import/loader';
import { useDatabaseLoader } from './lib/import/useDatabaseLoader';
import { IMP_FAILURE_TEXT } from './lib/import/messages';
import { findMessageByOccurrence, occurrenceOf } from './lib/dbc/identity';
import type { DbcDatabase } from './lib/dbc/types';
import { useI18n } from './lib/i18n';
import { NavRail, type Destination } from './components/NavRail';
import { ListPane, type MessageFilter } from './components/ListPane';
import { MessageDetail } from './components/MessageDetail';
import { NodeDetail } from './components/NodeDetail';
import { ValueTableDetail } from './components/ValueTableDetail';
import { Overview } from './components/Overview';
import { NetworkGraph } from './components/NetworkGraph';
import { Icon } from './components/Icon';
import { ImportProgress } from './components/ImportProgress';
import { ImportFormatsNote, ImportSourceContext } from './components/ImportSource';

export type Selection =
  | { kind: 'overview' }
  | { kind: 'graph' }
  | { kind: 'message'; rawId: number; occ: number; signal?: string }
  | { kind: 'node'; name: string }
  | { kind: 'valueTable'; name: string };

/** Serialize the selection into the URL hash so views are deep-linkable. */
function selectionToHash(sel: Selection): string {
  switch (sel.kind) {
    case 'message': {
      const occ = sel.occ > 0 ? `.${sel.occ}` : '';
      const signal = sel.signal ? `/${encodeURIComponent(sel.signal)}` : '';
      return `#msg=${sel.rawId}${occ}${signal}`;
    }
    case 'node':
      return `#node=${encodeURIComponent(sel.name)}`;
    case 'valueTable':
      return `#vt=${encodeURIComponent(sel.name)}`;
    case 'graph':
      return '#graph';
    default:
      return '';
  }
}

function hashToSelection(hash: string): Selection {
  const msg = hash.match(/^#msg=(\d+)(?:\.(\d+))?(?:\/(.+))?$/);
  if (msg) {
    return {
      kind: 'message',
      rawId: Number(msg[1]),
      occ: msg[2] ? Number(msg[2]) : 0,
      signal: msg[3] ? decodeURIComponent(msg[3]) : undefined,
    };
  }
  const node = hash.match(/^#node=(.+)$/);
  if (node) return { kind: 'node', name: decodeURIComponent(node[1]) };
  const vt = hash.match(/^#vt=(.+)$/);
  if (vt) return { kind: 'valueTable', name: decodeURIComponent(vt[1]) };
  if (hash === '#graph') return { kind: 'graph' };
  return { kind: 'overview' };
}

const DESTINATION_OF: Record<Selection['kind'], Destination> = {
  overview: 'overview',
  message: 'messages',
  graph: 'network',
  node: 'nodes',
  valueTable: 'tables',
};

type Snack = { kind: 'error'; text: string } | { kind: 'info'; text: string };

export function App() {
  const { t } = useI18n();
  const [selection, setSelection] = useState<Selection>({ kind: 'overview' });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<MessageFilter>('all');
  const [dragging, setDragging] = useState(false);
  const [snack, setSnack] = useState<Snack | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const initialHash = useRef(window.location.hash);
  // The last item shown per destination, so the rail returns to it.
  const lastShown = useRef<Partial<Record<Destination, Selection>>>({});

  const resetView = useCallback(() => {
    setSelection({ kind: 'overview' });
    setSearch('');
    setFilter('all');
    lastShown.current = {};
  }, []);

  // Opening, importing and restoring files (lib/import/loader.ts). A restored
  // file is shown at the deep link the page was loaded with.
  const onLoaderEvent = useCallback(
    (event: LoaderEvent) => {
      if (event.kind === 'failed') {
        setSnack({
          kind: 'error',
          text: t(event.restored ? 'impRestoreFailed' : 'importFailed', {
            name: event.name,
            error: event.reason ? t(IMP_FAILURE_TEXT[event.reason]) : event.error,
          }),
        });
        return;
      }
      resetView();
      if (event.restored && initialHash.current) setSelection(hashToSelection(initialHash.current));
    },
    [resetView, t],
  );
  const { db, fileName, source, progress, loadFile: openFile, selectCluster } = useDatabaseLoader(onLoaderEvent);
  const loadFile = useCallback(
    (file: File) => {
      setSnack(null);
      void openFile(file);
    },
    [openFile],
  );
  const importSource = useMemo(() => ({ source, onSelectCluster: selectCluster }), [source, selectCluster]);

  // Keep the URL hash in sync with the current selection (deep links). Only
  // active once a file is loaded, so the initial hash is never clobbered.
  useEffect(() => {
    if (!db) return;
    const hash = selectionToHash(selection);
    history.replaceState(null, '', window.location.pathname + window.location.search + hash);
    lastShown.current[DESTINATION_OF[selection.kind]] = selection;
  }, [db, selection]);

  useEffect(() => {
    document.title = db ? `${fileName} — CanViewer` : 'CanViewer — CAN Database Viewer';
  }, [db, fileName]);

  // Informational snackbars go away by themselves; errors stay until dismissed.
  useEffect(() => {
    if (snack?.kind !== 'info') return;
    const timer = setTimeout(() => setSnack(null), 3000);
    return () => clearTimeout(timer);
  }, [snack]);

  const navigate = useCallback(
    (destination: Destination) => {
      if (!db) return;
      const last = lastShown.current[destination];
      if (last && destination !== 'overview' && destination !== 'network') {
        setSelection(last);
        return;
      }
      switch (destination) {
        case 'overview':
          setSelection({ kind: 'overview' });
          break;
        case 'network':
          setSelection({ kind: 'graph' });
          break;
        case 'messages': {
          const first = [...db.messages].sort((a, b) => a.id - b.id)[0];
          if (first) setSelection({ kind: 'message', rawId: first.rawId, occ: occurrenceOf(db, first) });
          break;
        }
        case 'nodes':
          if (db.nodes[0]) setSelection({ kind: 'node', name: db.nodes[0].name });
          break;
        case 'tables':
          if (db.valueTables[0]) setSelection({ kind: 'valueTable', name: db.valueTables[0].name });
          break;
      }
    },
    [db],
  );

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setSnack({ kind: 'info', text: t('linkCopied') });
    } catch {
      setSnack({ kind: 'error', text: t('copyFailed') });
    }
  }, [t]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) loadFile(file);
    },
    [loadFile],
  );

  const destination = db ? DESTINATION_OF[selection.kind] : null;
  const listKind =
    destination === 'messages' ? 'messages' : destination === 'nodes' ? 'nodes' : destination === 'tables' ? 'tables' : null;
  const enabled = useMemo<Record<Destination, boolean>>(
    () => ({
      overview: !!db,
      messages: !!db && db.messages.length > 0,
      network: !!db,
      nodes: !!db && db.nodes.length > 0,
      tables: !!db && db.valueTables.length > 0,
    }),
    [db],
  );
  const openFileDialog = () => fileInputRef.current?.click();

  // The import's progress takes the snackbar's place while it runs.
  const shownSnack: Snack | null = progress ? null : snack;

  return (
    <div
      className={`app ${listKind ? 'with-list' : ''}`}
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={(e) => {
        e.preventDefault();
        // Only react to real file drags, not text selections or link drags.
        if (!e.dataTransfer.types.includes('Files')) return;
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={onDrop}
    >
      {dragging && <div className="drop-overlay">{t('dropOverlay')}</div>}
      <input
        ref={fileInputRef}
        type="file"
        accept={FILE_INPUT_ACCEPT}
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) loadFile(file);
          e.target.value = '';
        }}
      />

      <NavRail
        active={destination}
        enabled={enabled}
        badges={db ? { overview: db.problems.length } : {}}
        onNavigate={navigate}
        onOpenFile={openFileDialog}
      />

      {db && listKind && (
        <ListPane
          db={db}
          kind={listKind}
          selection={selection}
          onSelect={setSelection}
          search={search}
          onSearch={setSearch}
          filter={filter}
          onFilter={setFilter}
        />
      )}

      <main className="main">
        {db ? (
          <ImportSourceContext.Provider value={importSource}>
            <MainView db={db} fileName={fileName} selection={selection} onSelect={setSelection} onCopyLink={copyLink} />
          </ImportSourceContext.Provider>
        ) : (
          <div className="welcome">
            <div className="welcome-card">
              <div className="brand">
                Can<b>Viewer</b>
              </div>
              <p>{t('welcomeTagline')}</p>
              <div className="actions">
                <button className="btn filled with-icon state" onClick={openFileDialog}>
                  <Icon name="upload_file" size={18} />
                  {t('welcomeOpen')}
                </button>
              </div>
              <div className="dropzone">{t('welcomeDrop')}</div>
              <ImportFormatsNote />
              <p className="formats">
                {t('welcomeExampleHint')} <code>examples/demo.dbc</code>
              </p>
            </div>
          </div>
        )}
      </main>

      {progress && <ImportProgress progress={progress} />}

      {shownSnack && (
        <div className="snackbar" role={shownSnack.kind === 'error' ? 'alert' : 'status'}>
          {shownSnack.kind === 'error' && <Icon name="error" size={20} />}
          <span className="msg">{shownSnack.text}</span>
          <button className="close state" title={t('dismiss')} aria-label={t('dismiss')} onClick={() => setSnack(null)}>
            <Icon name="close" size={20} />
          </button>
        </div>
      )}
    </div>
  );
}

function MainView({
  db,
  fileName,
  selection,
  onSelect,
  onCopyLink,
}: {
  db: DbcDatabase;
  fileName: string;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onCopyLink: () => void;
}) {
  switch (selection.kind) {
    case 'message': {
      const message = findMessageByOccurrence(db, selection.rawId, selection.occ);
      if (!message) return <Overview db={db} fileName={fileName} onSelect={onSelect} />;
      return (
        <MessageDetail
          db={db}
          fileName={fileName}
          message={message}
          selectedSignal={selection.signal}
          onSelectSignal={(signal) =>
            onSelect({ kind: 'message', rawId: selection.rawId, occ: selection.occ, signal })
          }
          onCopyLink={onCopyLink}
        />
      );
    }
    case 'node': {
      const node = db.nodes.find((n) => n.name === selection.name);
      if (!node) return <Overview db={db} fileName={fileName} onSelect={onSelect} />;
      return <NodeDetail db={db} fileName={fileName} node={node} onSelect={onSelect} />;
    }
    case 'valueTable': {
      const table = db.valueTables.find((t) => t.name === selection.name);
      if (!table) return <Overview db={db} fileName={fileName} onSelect={onSelect} />;
      return <ValueTableDetail db={db} fileName={fileName} table={table} onSelect={onSelect} />;
    }
    case 'graph':
      return <NetworkGraph db={db} fileName={fileName} onSelect={onSelect} />;
    default:
      return <Overview db={db} fileName={fileName} onSelect={onSelect} />;
  }
}
