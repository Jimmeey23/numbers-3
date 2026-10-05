/* A panel that fails without taking the page with it.
 *
 * One malformed card used to unmount the entire app: React tears down the whole tree when a
 * render throws and nothing catches it, so a bad value in the Insights rail looked like the
 * dashboard crashing. A boundary keeps the blast radius to the panel, and — more usefully —
 * shows the actual error instead of a blank screen, so the next report names the real fault.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { label: string; children: ReactNode; onReset?: () => void }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[Atlas] ${this.props.label} failed to render.`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="panel-error" role="alert">
        <div className="t-heading-s">{this.props.label} could not be displayed</div>
        <p className="t-body-s muted">{error.message || String(error)}</p>
        <p className="t-label-s faint">The rest of the dashboard is unaffected. The full stack is in the browser console.</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="btn btn-xs" onClick={() => this.setState({ error: null })}>Try again</button>
          {this.props.onReset && (
            <button className="btn btn-xs" onClick={() => { this.props.onReset?.(); this.setState({ error: null }); }}>
              Reset this panel&apos;s saved data
            </button>
          )}
        </div>
      </div>
    );
  }
}
