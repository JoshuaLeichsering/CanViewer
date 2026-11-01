import { useCallback, useEffect, useRef, useState } from 'react';
import { parseDbc } from './lib/dbc/parser';
import { importWithCanmatrix, type ImportStage } from './lib/canmatrix/client';
import { canmatrixFormatFor } from './lib/canmatrix/formats';
import { findMessageByOccurrence } from './lib/dbc/identity';
import type { DbcDatabase } from './lib/dbc/types';
import { useI18n } from './lib/i18n';
import { Sidebar } from './components/Sidebar';
import { MessageDetail } from './components/MessageDetail';
import { NodeDetail } from './components/NodeDetail';
import { ValueTableDetail } from './components/ValueTableDetail';
import { Overview } from './components/Overview';
import { NetworkGraph } from './components/NetworkGraph';
import { SettingsMenu } from './components/SettingsMenu';

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

const IMPORT_STAGE_KEYS = {
  runtime: 'importRuntime',
  packages: 'importPackages',
  reading: 'importReading',
} as const;

/** DBC files from Vector tools are often Latin-1; fall back when UTF-8 fails. */
async function readFileText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

export function App() {
  const { t, tn } = useI18n();
  const [db, setDb] = useState<DbcDatabase | null>(null);
  const [fileName, setFileName] = useState('');
  const [selection, setSelection] = useState<Selection>({ kind: 'overview' });
  const [search, setSearch] = useState('');
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState<{ name: string; stage: ImportStage } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const initialHash = useRef(window.location.hash);
  const restoredOnce = useRef(false);

  const loadText = useCallback((name: string, text: string) => {
    setDb(parseDbc(text));
    setFileName(name);
    setSelection({ kind: 'overview' });
    setSearch('');
    try {
      localStorage.setItem('canviewer.file', JSON.stringify({ name, text }));
    } catch {
      // File too large for localStorage — reopening after reload just won't restore it.
    }
  }, []);

  const loadFile = useCallback(
    async (file: File) => {
      setImportError(null);
      if (!canmatrixFormatFor(file.name)) {
        loadText(file.name, await readFileText(file));
        return;
      }
      // Non-DBC formats go through canmatrix in a Web Worker, loaded on first use.
      setImporting({ name: file.name, stage: 'runtime' });
      try {
        const imported = await importWithCanmatrix(file, (stage) => setImporting({ name: file.name, stage }));
        setDb(imported.db);
        setFileName(file.name);
        setSelection({ kind: 'overview' });
        setSearch('');
        // Restoring an imported file on reload is not supported yet; drop the
        // stored DBC so that a reload does not show a different file.
        try {
          localStorage.removeItem('canviewer.file');
        } catch {
          // storage unavailable
        }
      } catch (e) {
        setImportError(t('importFailed', { name: file.name, error: e instanceof Error ? e.message : String(e) }));
      } finally {
        setImporting(null);
      }
    },
    [loadText, t],
  );

  // Restore the last opened file on startup. Guarded by a ref so StrictMode's
  // double effect run cannot restore twice with diverging results.
  useEffect(() => {
    if (restoredOnce.current) return;
    restoredOnce.current = true;

    try {
      const saved = localStorage.getItem('canviewer.file');
      if (saved) {
        const { name, text } = JSON.parse(saved) as { name: string; text: string };
        loadText(name, text);
        if (initialHash.current) setSelection(hashToSelection(initialHash.current));
      }
    } catch {
      // Corrupt storage — start empty.
    }
  }, [loadText]);

  // Keep the URL hash in sync with the current selection (deep links). Only
  // active once a file is loaded, so the initial hash is never clobbered.
  useEffect(() => {
    if (!db) return;
    const hash = selectionToHash(selection);
    history.replaceState(null, '', window.location.pathname + window.location.search + hash);
  }, [db, selection]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) void loadFile(file);
    },
    [loadFile],
  );

  return (
    <div
      className="app"
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

      <div className="toolbar">
        <div className="brand">
          Can<span>Viewer</span>
        </div>
        <button className="btn primary" onClick={() => fileInputRef.current?.click()}>
          {t('openDbc')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".dbc,.txt,.arxml"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void loadFile(file);
            e.target.value = '';
          }}
        />
        {importing && (
          <div className="file-info" role="status">
            {t(IMPORT_STAGE_KEYS[importing.stage], { name: importing.name })}
          </div>
        )}
        {importError && (
          <div className="file-info" role="alert" style={{ color: 'var(--danger)' }}>
            {importError}
          </div>
        )}
        {db && !importing && (
          <div className="file-info">
            <b>{fileName}</b>
            {db.version && <> · {t('version')} “{db.version}”</>} · {db.messages.length}{' '}
            {t('messagesWord')} · {db.messages.reduce((n, m) => n + m.signals.length, 0)}{' '}
            {t('signalsWord')} · {db.nodes.length} {t('nodesWord')}
          </div>
        )}
        <div className="spacer" />
        {db && db.problems.length > 0 && (
          <button
            className="btn"
            style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
            onClick={() => setSelection({ kind: 'overview' })}
          >
            {tn('parseProblemOne', 'parseProblemMany', db.problems.length)}
          </button>
        )}
        <SettingsMenu />
      </div>

      {!db ? (
        <div className="main">
          <div className="welcome">
            <h1>
              Can<span style={{ color: 'var(--accent)' }}>Viewer</span>
            </h1>
            <p>{t('welcomeTagline')}</p>
            <div className="actions">
              <button className="btn primary" onClick={() => fileInputRef.current?.click()}>
                {t('welcomeOpen')}
              </button>
            </div>
            <div className="dropzone">{t('welcomeDrop')}</div>
            <p className="muted" style={{ marginTop: 18 }}>
              {t('welcomeExampleHint')} <code>examples/demo.dbc</code>
            </p>
          </div>
        </div>
      ) : (
        <div className="content">
          <Sidebar
            db={db}
            selection={selection}
            onSelect={setSelection}
            search={search}
            onSearch={setSearch}
          />
          <div className="main">
            <MainView db={db} selection={selection} onSelect={setSelection} />
          </div>
        </div>
      )}
    </div>
  );
}

function MainView({
  db,
  selection,
  onSelect,
}: {
  db: DbcDatabase;
  selection: Selection;
  onSelect: (s: Selection) => void;
}) {
  switch (selection.kind) {
    case 'message': {
      const message = findMessageByOccurrence(db, selection.rawId, selection.occ);
      if (!message) return <Overview db={db} onSelect={onSelect} />;
      return (
        <MessageDetail
          db={db}
          message={message}
          selectedSignal={selection.signal}
          onSelectSignal={(signal) =>
            onSelect({ kind: 'message', rawId: selection.rawId, occ: selection.occ, signal })
          }
        />
      );
    }
    case 'node': {
      const node = db.nodes.find((n) => n.name === selection.name);
      if (!node) return <Overview db={db} onSelect={onSelect} />;
      return <NodeDetail db={db} node={node} onSelect={onSelect} />;
    }
    case 'valueTable': {
      const table = db.valueTables.find((t) => t.name === selection.name);
      if (!table) return <Overview db={db} onSelect={onSelect} />;
      return <ValueTableDetail table={table} />;
    }
    case 'graph':
      return <NetworkGraph db={db} onSelect={onSelect} />;
    default:
      return <Overview db={db} onSelect={onSelect} />;
  }
}
