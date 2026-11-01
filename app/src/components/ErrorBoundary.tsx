import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useI18n } from '../lib/i18n';
import { clearStoredFile } from '../lib/stored-file';
import { Icon } from './Icon';

/**
 * Catches a crash anywhere in the app and shows a recovery screen instead of a
 * blank page. The last opened file is restored on every start, so a file that
 * makes a view throw would crash the app again on each reload: the screen's
 * "Reset stored file" forgets it and starts empty.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('CanViewer crashed:', error, info.componentStack);
  }

  render() {
    return this.state.error ? <CrashScreen error={this.state.error} /> : this.props.children;
  }
}

function CrashScreen({ error }: { error: Error }) {
  const { t } = useI18n();
  const reset = () => {
    clearStoredFile();
    // A deep link points into the file that is gone now.
    history.replaceState(null, '', location.pathname + location.search);
    location.reload();
  };
  // Chromium's stack starts with the message, Firefox's does not.
  const details = error.stack?.includes(error.message) ? error.stack : `${String(error)}\n${error.stack ?? ''}`;

  return (
    <main className="welcome" data-testid="rgh-crash">
      <div className="welcome-card rgh-crash">
        <Icon name="error" size={40} className="rgh-crash-icon" />
        <h1>{t('rghCrashTitle')}</h1>
        <p>{t('rghCrashText')}</p>
        <div className="actions">
          <button className="btn filled with-icon state" onClick={reset}>
            <Icon name="restart_alt" size={18} />
            {t('rghCrashReset')}
          </button>
          <button className="btn outlined state" onClick={() => location.reload()}>
            {t('rghCrashReload')}
          </button>
        </div>
        <details className="rgh-crash-details">
          <summary>{t('rghCrashDetails')}</summary>
          {/* Focusable, so that a long stack can be scrolled with the keyboard. */}
          <pre tabIndex={0}>{details}</pre>
        </details>
      </div>
    </main>
  );
}
