import { t as tr } from '../lib/i18n.js';
import { Component } from 'react';
import { Icon } from './ui.jsx';

/** Chặn lỗi hiển thị của một trang để không làm trắng toàn bộ ứng dụng. */
export default class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error(tr("[ui] Lỗi hiển thị trang:"), error, info?.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="card max-w-md p-6 text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-500">
            <Icon name="error" size={26} />
          </span>
          <p className="text-headline-sm text-slate-900">{tr("Trang gặp lỗi khi hiển thị")}</p>
          <p className="mt-1 text-body-sm text-slate-500">{String(this.state.error.message || this.state.error)}</p>
          <button className="btn-primary mt-4" onClick={() => this.setState({ error: null })}>{tr("Thử lại")}</button>
        </div>
      </div>
    );
  }
}
