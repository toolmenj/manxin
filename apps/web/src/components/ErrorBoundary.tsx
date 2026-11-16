/**
 * 一頁出錯時只讓那一頁顯示錯誤，不要整個 App 白屏（review M15）。
 * 換頁（resetKey 改變）就重新試一次。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  resetKey: string;
  children: ReactNode;
}
interface State {
  error: Error | null;
  key: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(p: Props, s: State): Partial<State> | null {
    return p.resetKey !== s.key ? { error: null, key: p.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('畫面出錯', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="empty" role="alert">
        <h2 className="h2">這一頁出了點問題</h2>
        <p>信和資料都還在伺服器上，不會不見。重新整理一下，或先去別的地方看看。</p>
        <button type="button" className="btn primary" onClick={() => location.reload()}>
          重新整理
        </button>
      </div>
    );
  }
}
