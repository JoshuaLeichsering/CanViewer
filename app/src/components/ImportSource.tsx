// SPDX-License-Identifier: GPL-2.0-or-later
import { createContext, useContext, useRef } from 'react';
import { canmatrixFormatLabels } from '../lib/canmatrix/formats';
import type { ImportedSource } from '../lib/import/loader';
import { useI18n } from '../lib/i18n';
import { Icon } from './Icon';
import './import-ui.css';

/** The id of the overview's problem list, which the lossy-conversion note links to. */
export const IMP_PROBLEMS_ID = 'imp-problems';

export interface ImportSourceValue {
  source: ImportedSource | null;
  onSelectCluster: (index: number) => void;
}

/** Provided by the app, so the overview can show where its database came from. */
export const ImportSourceContext = createContext<ImportSourceValue>({ source: null, onSelectCluster: () => {} });

function showProblems() {
  const list = document.getElementById(IMP_PROBLEMS_ID);
  if (!list) return;
  list.scrollIntoView({ block: 'start' });
  list.focus({ preventScroll: true });
}

/**
 * On the overview of an imported database: its source format, a note that
 * the conversion may be lossy with a link to the problems canmatrix
 * reported, and, for a file with several clusters, the choice of cluster.
 * Renders nothing for a DBC.
 */
export function ImportSource() {
  const { source, onSelectCluster } = useContext(ImportSourceContext);
  const { t, tn } = useI18n();
  const chips = useRef<Array<HTMLButtonElement | null>>([]);
  if (!source) return null;

  const problems = source.clusters[source.cluster]?.db.problems.length ?? 0;
  const count = source.clusters.length;
  const pick = (index: number) => {
    const next = (index + count) % count;
    onSelectCluster(next);
    chips.current[next]?.focus();
  };

  return (
    <section className="imp-source" data-testid="imp-source" data-format={source.format.importType}>
      <div className="banner info">
        <Icon name="info" size={20} />
        <div className="imp-source-text">
          <b className="imp-source-title">{t('impSourceTitle', { format: source.format.label })}</b>
          <span className="imp-source-note">{t('impSourceLossy')}</span>
          {problems > 0 ? (
            <button type="button" className="btn text state imp-problems-link" data-testid="imp-problems-link" onClick={showProblems}>
              <Icon name="error" size={18} />
              {tn('impSourceProblemsOne', 'impSourceProblemsMany', problems)}
            </button>
          ) : (
            <span className="imp-source-note">{t('impSourceNoProblems')}</span>
          )}
        </div>
      </div>

      {count > 1 && (
        <div className="imp-clusters">
          <div className="imp-clusters-hint" id="imp-clusters-hint">
            {t('impClustersHint', { n: count })}
          </div>
          <div
            className="chips"
            role="radiogroup"
            aria-labelledby="imp-clusters-hint"
            onKeyDown={(e) => {
              const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
              if (step === undefined) return;
              e.preventDefault();
              pick(source.cluster + step);
            }}
          >
            {source.clusters.map((cluster, i) => {
              const checked = i === source.cluster;
              return (
                <button
                  key={i}
                  ref={(el) => {
                    chips.current[i] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  tabIndex={checked ? 0 : -1}
                  className={`chip state imp-cluster ${checked ? 'on' : ''}`}
                  data-testid="imp-cluster"
                  data-name={cluster.name}
                  onClick={() => onSelectCluster(i)}
                >
                  {checked && <Icon name="check" size={18} />}
                  <span className="imp-cluster-name">{cluster.name || t('impClusterUnnamed')}</span>
                  <span className="imp-cluster-count">{tn('messagesOne', 'messagesMany', cluster.db.messages.length)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

/** The welcome screen's line on formats, listing what canmatrix reads (from formats.ts). */
export function ImportFormatsNote() {
  const { t, lang } = useI18n();
  const formats = new Intl.ListFormat(lang, { type: 'conjunction' }).format(canmatrixFormatLabels());
  return <p className="formats">{t('welcomeFormats', { formats })}</p>;
}
