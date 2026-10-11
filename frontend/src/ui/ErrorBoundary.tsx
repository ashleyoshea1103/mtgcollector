import { Component, type ReactNode } from 'react';

interface Props {
  /**
   * Shown instead of the children once rendering them has thrown. Given reset, which tries the
   * children again. Don't show the error itself: it may be internal details.
   */
  fallback: (reset: () => void) => ReactNode;
  /** When any of these change, a fallback being shown gives way to the children again (e.g. new data for them). */
  resetKeys?: readonly unknown[];
  children: ReactNode;
}

interface State {
  failed: boolean;
  resetKeys?: readonly unknown[];
}

const changed = (a: readonly unknown[] = [], b: readonly unknown[] = []) => a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));

/**
 * Keeps a rendering error in part of a page to that part, so one bad record can't blank the
 * whole page. (React reports the error to the console, as for any caught error.)
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, resetKeys: this.props.resetKeys };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (!changed(props.resetKeys, state.resetKeys)) return null;
    return { failed: false, resetKeys: props.resetKeys };
  }

  reset = () => this.setState({ failed: false });

  render() {
    return this.state.failed ? this.props.fallback(this.reset) : this.props.children;
  }
}
