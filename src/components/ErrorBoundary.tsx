import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props { children: React.ReactNode; }
interface State { hasError: boolean; message: string; }

/** 全局错误边界：组件渲染崩溃时显示友好提示，禁止白屏 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(err: any): State {
    return { hasError: true, message: (err && (err.message || String(err))) || '未知渲染错误' };
  }

  componentDidCatch(err: any, info: any) {
    console.error('[ErrorBoundary] 组件渲染崩溃:', err, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[60vh] flex flex-col items-center justify-center p-6">
          <div className="max-w-md w-full bg-slate-900 border border-rose-500/40 rounded-2xl p-6 shadow-2xl space-y-4 text-center">
            <div className="p-3 bg-rose-500/15 text-rose-400 rounded-xl w-fit mx-auto">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <h2 className="text-base font-bold text-slate-100">页面渲染出现异常</h2>
            <p className="text-xs text-slate-400 break-all">{this.state.message}</p>
            <p className="text-[11px] text-slate-500">业务数据不受影响。可点击下方按钮刷新页面恢复。</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold inline-flex items-center space-x-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>刷新页面</span>
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
