import { Component, type ReactNode } from "react";

interface Props {
  /** The screen the app is on; when it changes (a sidebar click), a caught error is cleared. */
  resetKey: string;
  onHome: () => void;
  children: ReactNode;
}

/**
 * Keeps a screen's render error inside the page area. Without it React unmounts the whole window, and with
 * `decorations: false` that takes the title bar's close button with it.
 */
export default class PageBoundary extends Component<Props, { failed: boolean; error: unknown }> {
  state = { failed: false, error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, error };
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false, error: null });
  }

  render() {
    const { failed, error } = this.state;
    if (!failed) return this.props.children;
    const retry = () => this.setState({ failed: false, error: null });
    return (
      <div className="content" role="alert">
        <h1>이 화면을 보여 주지 못했습니다</h1>
        <p className="sub">저장된 세트와 학습 기록은 그대로입니다. 다시 시도하거나 왼쪽에서 다른 화면을 고르세요.</p>
        <pre className="page-error">{error instanceof Error ? error.message || error.name : String(error)}</pre>
        <div className="toolbar">
          <button className="btn primary" onClick={retry}>
            다시 시도
          </button>
          <button
            className="btn"
            onClick={() => {
              retry();
              this.props.onHome();
            }}
          >
            홈으로
          </button>
        </div>
      </div>
    );
  }
}
