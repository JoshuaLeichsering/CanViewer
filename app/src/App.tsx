// SPDX-License-Identifier: GPL-2.0-or-later
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FILE_INPUT_ACCEPT } from './lib/canmatrix/formats';
import type { LoaderEvent } from './lib/import/loader';
import { useDatabaseLoader } from './lib/import/useDatabaseLoader';
import { IMP_FAILURE_TEXT } from './lib/import/messages';
import { findMessageByOccurrence, occurrenceOf } from './lib/dbc/identity';
import type { DbcDatabase } from './lib/dbc/types';
import { useI18n } from './lib/i18n';
import { isSearchShortcut } from './lib/keyboard';
import { NavRail, type Destination } from './components/NavRail';
import { ListPane, type MessageFilter } from './components/ListPane';
import { MessageDetail } from './components/MessageDetail';
import { NodeDetail } from './components/NodeDetail';
import { ValueTableDetail } from './components/ValueTableDetail';
import { Overview } from './components/Overview';
import { NetworkGraph } from './components/NetworkGraph';
import { Icon } from './components/Icon';
import { BackToList, type ListKind } from './components/BackToList';
import { ImportProgress } from './components/ImportProgress';
import { ImportFormatsNote, ImportSourceContext } from './components/ImportSource';
import { DiffView, type Comparison, type DiffViewHandle } from './components/DiffView';
import { TraceView } from './components/TraceView';
import { isTraceFileName, openTraceFile, type LoadedTrace } from './lib/trace';
import { SaveAsDbcButton } from './components/SaveAsDbc';
import { DiscardEditsDialog } from './components/DiscardEditsDialog';
import { messageEditActions, type OnEdit } from './components/editActions';

export type Selection =
  | { kind: 'overview' }
  | { kind: 'graph' }
  | { kind: 'message'; rawId: number; occ: number; signal?: string }
  | { kind: 'node'; name: string }
  | { kind: 'valueTable'; name: string }
  | { kind: 'diff' }
  | { kind: 'trace' };

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
    case 'diff':
      return '#diff';
    case 'trace':
      return '#trace';
    default:
      return '';
  }
}

function hashToSelection(hash: string): Selection {
  try {
    return parseHash(hash);
  } catch {
    // A malformed escape (e.g. "%E0") in a hand-edited link: show the overview.
    return { kind: 'overview' };
  }
}

function parseHash(hash: string): Selection {
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
  if (hash === '#diff') return { kind: 'diff' };
  if (hash === '#trace') return { kind: 'trace' };
  return { kind: 'overview' };
}

const DESTINATION_OF: Record<Selection['kind'], Destination> = {
  overview: 'overview',
  message: 'messages',
  graph: 'network',
  node: 'nodes',
  valueTable: 'tables',
  diff: 'compare',
  trace: 'traces',
};

type Snack = { kind: 'error'; text: string } | { kind: 'info'; text: string };

export function App() {
  const { t } = useI18n();
  const [selection, setSelection] = useState<Selection>({ kind: 'overview' });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<MessageFilter>('all');
  const [dragging, setDragging] = useState(false);
  const [snack, setSnack] = useState<Snack | null>(null);
  // On narrow screens the list pane and the detail take turns (see narrow.css).
  const [pane, setPane] = useState<'list' | 'detail'>('detail');
  const [searchFocus, setSearchFocus] = useState(0);
  // Diff mode: the other version the open file is compared with.
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const diffRef = useRef<DiffViewHandle>(null);
  const [trace, setTrace] = useState<LoadedTrace | null>(null);
  // Edits made in the app and not yet saved as DBC.
  const [edited, setEdited] = useState(false);
  // What waits for the answer to "discard the unsaved edits?": opening another
  // file, or showing another cluster of the imported one.
  const [discardFor, setDiscardFor] = useState<{ name: string; proceed: () => void } | null>(null);
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
    // A comparison belongs to the file it was made with.
    setComparison(null);
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
      // Another database (a new file, another cluster, the restored file) has no edits.
      setEdited(false);
      if (event.restored && initialHash.current) setSelection(hashToSelection(initialHash.current));
    },
    [resetView, t],
  );
  const {
    db,
    fileName,
    source,
    progress,
    loadFile: openFile,
    selectCluster,
    edit: editDatabase,
    savedAsDbc,
  } = useDatabaseLoader(onLoaderEvent);

  // Logs (.asc, .log) open in the Traces view and leave the database as it is.
  const openTrace = useCallback(
    async (file: File) => {
      try {
        const loaded = await openTraceFile(file);
        if (!loaded) {
          setSnack({ kind: 'error', text: t('trcNotALog', { name: file.name }) });
          return;
        }
        setTrace(loaded);
        if (db) setSelection({ kind: 'trace' });
        else setSnack({ kind: 'info', text: t('trcNeedDatabase', { name: file.name }) });
      } catch (e) {
        setSnack({ kind: 'error', text: t('trcReadFailed', { name: file.name, error: e instanceof Error ? e.message : String(e) }) });
      }
    },
    [db, t],
  );

  // A database replaces unsaved edits only once the person agrees (W11); a
  // log leaves the database as it is and opens without asking.
  const loadFile = useCallback(
    (file: File) => {
      if (isTraceFileName(file.name)) {
        setSnack(null);
        void openTrace(file);
        return;
      }
      const open = () => {
        setSnack(null);
        void openFile(file);
      };
      if (edited) setDiscardFor({ name: file.name, proceed: open });
      else open();
    },
    [openFile, openTrace, edited],
  );
  const onSelectCluster = useCallback(
    (index: number) => {
      const cluster = source?.clusters[index];
      if (!cluster) return;
      if (edited) setDiscardFor({ name: cluster.name || t('impClusterUnnamed'), proceed: () => selectCluster(index) });
      else selectCluster(index);
    },
    [source, selectCluster, edited, t],
  );
  const importSource = useMemo(() => ({ source, onSelectCluster }), [source, onSelectCluster]);

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

  // Unsaved edits live only in this page: ask before it is closed or reloaded.
  useEffect(() => {
    if (!edited) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [edited]);

  const applyEdit = useCallback<OnEdit>(
    (next, nextSelection) => {
      editDatabase(next);
      setSelection(nextSelection);
      setEdited(true);
      setSnack({ kind: 'info', text: t('edtApplied') });
    },
    [editDatabase, t],
  );

  // Informational snackbars go away by themselves; errors stay until dismissed.
  useEffect(() => {
    if (snack?.kind !== 'info') return;
    const timer = setTimeout(() => setSnack(null), 3000);
    return () => clearTimeout(timer);
  }, [snack]);

  const navigate = useCallback(
    (destination: Destination) => {
      if (!db) return;
      setPane('list');
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
        case 'compare':
          setSelection({ kind: 'diff' });
          break;
        case 'traces':
          setSelection({ kind: 'trace' });
          break;
      }
    },
    [db],
  );

  // A selection made from a list or a link opens the detail (on narrow screens).
  const show = useCallback((s: Selection) => {
    setSelection(s);
    setPane('detail');
  }, []);

  // A deep link pasted into the address bar of the open app changes only the hash.
  useEffect(() => {
    if (!db) return;
    const follow = () => show(hashToSelection(window.location.hash));
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, [db, show]);

  // "/" focuses the message search, from any view.
  useEffect(() => {
    if (!db || db.messages.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isSearchShortcut(e)) return;
      e.preventDefault();
      navigate('messages');
      setSearchFocus((n) => n + 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [db, navigate]);

  // When the panes take turns on a narrow screen, the focused element can be in
  // the pane that is now hidden. Move the focus to the back button of the
  // detail, or to the selected item of the list, so it is not lost. On wide
  // screens both panes stay visible and the focus stays where it is.
  const paneShown = useRef(pane);
  useEffect(() => {
    if (paneShown.current === pane) return;
    paneShown.current = pane;
    const focused = document.activeElement;
    if (focused && focused !== document.body && focused.getClientRects().length > 0) return;
    document.querySelector<HTMLElement>(pane === 'detail' ? '.rgh-back' : '.list-pane .list-item.active')?.focus();
  }, [pane]);

  useEffect(() => {
    if (searchFocus > 0) document.querySelector<HTMLInputElement>('.list-pane input[type=search]')?.focus();
  }, [searchFocus]);

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
      if (!file) return;
      // On the Compare page a dropped database is the other version, not a new
      // open file; a log is never a version of a database and opens as a trace.
      if (diffRef.current && !isTraceFileName(file.name)) diffRef.current.openOther(file);
      else loadFile(file);
    },
    [loadFile],
  );

  const destination = db ? DESTINATION_OF[selection.kind] : null;
  const listKind: ListKind | null =
    destination === 'messages' ? 'messages' : destination === 'nodes' ? 'nodes' : destination === 'tables' ? 'tables' : null;
  const enabled = useMemo<Record<Destination, boolean>>(
    () => ({
      overview: !!db,
      messages: !!db && db.messages.length > 0,
      network: !!db,
      nodes: !!db && db.nodes.length > 0,
      tables: !!db && db.valueTables.length > 0,
      compare: !!db,
      traces: !!db,
    }),
    [db],
  );
  const openFileDialog = () => fileInputRef.current?.click();

  // The import's progress takes the snackbar's place while it runs.
  const shownSnack: Snack | null = progress ? null : snack;

  return (
    <div
      className={`app ${listKind ? `with-list rgh-pane-${pane}` : ''}`}
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
      {dragging && (
        <div className="drop-overlay">
          {db && selection.kind === 'diff' ? t('difDropOverlay', { file: fileName }) : t('dropOverlay')}
        </div>
      )}
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
        actions={
          db && (
            <SaveAsDbcButton
              db={db}
              fileName={fileName}
              edited={edited}
              onSaved={(name, text) => {
                setEdited(false);
                setSnack({ kind: 'info', text: t('edtSaved', { name }) });
                // A reload restores what was saved, not the file as it was before the edits.
                savedAsDbc(name, text);
              }}
            />
          )
        }
      />
      {discardFor && (
        <DiscardEditsDialog
          fileName={fileName}
          nextName={discardFor.name}
          onDiscard={() => {
            setDiscardFor(null);
            discardFor.proceed();
          }}
          onCancel={() => setDiscardFor(null)}
        />
      )}

      {db && listKind && (
        <ListPane
          db={db}
          kind={listKind}
          selection={selection}
          onSelect={show}
          onBrowse={setSelection}
          search={search}
          onSearch={setSearch}
          filter={filter}
          onFilter={setFilter}
        />
      )}

      <main className="main">
        {db && selection.kind === 'diff' ? (
          <DiffView
            ref={diffRef}
            db={db}
            fileName={fileName}
            cluster={source ? source.clusters[source.cluster].name : undefined}
            comparison={comparison}
            onComparison={setComparison}
            onSelect={show}
          />
        ) : db ? (
          <ImportSourceContext.Provider value={importSource}>
            {listKind && <BackToList kind={listKind} onBack={() => setPane('list')} />}
            <MainView
              db={db}
              fileName={fileName}
              selection={selection}
              onSelect={show}
              onCopyLink={copyLink}
              onEdit={applyEdit}
              trace={trace}
              onTrace={setTrace}
            />
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
  onEdit,
  trace,
  onTrace,
}: {
  db: DbcDatabase;
  fileName: string;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onCopyLink: () => void;
  onEdit: OnEdit;
  trace: LoadedTrace | null;
  onTrace: (trace: LoadedTrace | null) => void;
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
          {...messageEditActions(db, message, selection.signal, onEdit)}
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
    case 'trace':
      return <TraceView db={db} fileName={fileName} trace={trace} onTrace={onTrace} onSelect={onSelect} />;
    default:
      return <Overview db={db} fileName={fileName} onSelect={onSelect} />;
  }
}
