import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  // Shown above the error message so it's obvious which part of the page broke
  // (e.g. "This result card failed to render" vs "The app failed to render").
  label?: string;
}

interface State {
  error: Error | null;
}

/** Catches render-time errors in its subtree and shows a visible message + reload button
 *  instead of letting React unmount the whole tree to a blank white page. React only calls
 *  componentDidCatch/getDerivedStateFromError for errors thrown during render (not inside
 *  event handlers or promises, which already have their own try/catch in this app) -- exactly
 *  the class of bug that otherwise looks like "the page went blank" with no visible cause. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("Render error caught by ErrorBoundary:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-title">{this.props.label ?? "Something went wrong rendering this."}</div>
          <pre className="error-boundary-message">{this.state.error.message}</pre>
          <button type="button" onClick={() => window.location.reload()}>
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
