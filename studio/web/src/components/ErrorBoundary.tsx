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
        <div className="min-h-screen flex items-center justify-center p-8">
          <div className="max-w-xl w-full bg-red-50 border border-red-200 rounded-lg p-6">
            <h1 className="text-red-700 font-semibold text-lg mb-2">应用初始化失败</h1>
            <pre className="text-sm text-red-600 whitespace-pre-wrap break-all">
              {this.state.error.message}
            </pre>
            <button
              className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
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
