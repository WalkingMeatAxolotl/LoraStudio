import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State { error: Error | null }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center p-8 bg-canvas">
          <div className="card max-w-[560px] w-full p-6">
            <h1 className="text-err font-semibold text-lg mb-2">应用初始化失败</h1>
            <pre className="text-sm text-fg-secondary whitespace-pre-wrap break-all">
              {this.state.error.message}
            </pre>
            <button
              className="btn btn-primary btn-sm mt-4"
              onClick={() => window.location.reload()}
            >
              重新加载
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
