import type { ImportStage } from '../lib/canmatrix/worker-protocol';
import type { ImportProgress as Progress } from '../lib/import/loader';
import { useI18n, type MsgKey } from '../lib/i18n';
import { Icon } from './Icon';
import './import-ui.css';

export type StepState = 'done' | 'active' | 'pending';

const STAGES: ImportStage[] = ['runtime', 'packages', 'reading'];

const LABEL: Record<ImportStage, MsgKey> = {
  runtime: 'impStepRuntime',
  packages: 'impStepPackages',
  reading: 'impStepReading',
};

/** The sentence announced for the current stage. */
const ANNOUNCE: Record<ImportStage, MsgKey> = {
  runtime: 'importRuntime',
  packages: 'importPackages',
  reading: 'importReading',
};

const STATE: Record<StepState, MsgKey> = {
  done: 'impStepDone',
  active: 'impStepActive',
  pending: 'impStepPending',
};

/**
 * The steps an import goes through, and where it is. The package step is
 * listed only for formats that need packages beyond canmatrix; a step the
 * worker skips (the runtime or the packages are loaded already) counts as
 * done once a later one starts.
 */
export function importSteps(progress: Progress): Array<{ stage: ImportStage; state: StepState }> {
  const stages = STAGES.filter((s) => s !== 'packages' || progress.packages.length > 0 || progress.stage === s);
  const current = stages.indexOf(progress.stage);
  return stages.map((stage, i) => ({ stage, state: i < current ? 'done' : i === current ? 'active' : 'pending' }));
}

/**
 * What an import is doing, for as long as it runs: every step stays listed,
 * the ones done are ticked, so a cold start (runtime download, packages,
 * reading) shows where it is instead of a spinner that flips between texts.
 */
export function ImportProgress({ progress }: { progress: Progress }) {
  const { t } = useI18n();
  return (
    <div className="imp-progress" data-testid="imp-progress" data-stage={progress.stage}>
      <div className="imp-progress-title">{t('impProgressTitle', { name: progress.name })}</div>
      <span className="visually-hidden" role="status">
        {t(ANNOUNCE[progress.stage], { name: progress.name })}
      </span>
      <ol className="imp-steps">
        {importSteps(progress).map(({ stage, state }) => (
          <li
            key={stage}
            className={`imp-step ${state}`}
            data-testid={`imp-step-${stage}`}
            data-state={state}
            aria-current={state === 'active' ? 'step' : undefined}
          >
            <span className="imp-step-mark" aria-hidden="true">
              {state === 'done' && <Icon name="check_circle" size={18} />}
              {state === 'active' && <Icon name="progress_activity" size={18} className="spinner" />}
            </span>
            <span className="imp-step-label">{t(LABEL[stage])}</span>
            <span className="visually-hidden">({t(STATE[state])})</span>
            {stage === 'runtime' && <span className="imp-step-detail">{t('impStepRuntimeHint')}</span>}
            {stage === 'packages' && <span className="imp-step-detail mono">{progress.packages.join(', ')}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
