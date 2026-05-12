import React, { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    // Could integrate with logging service or Tauri log here
    try {
      // Optional: invoke Rust log command
      import('@tauri-apps/api/core').then(({ invoke }) => {
        invoke('log_error', { message: error.message, stack: error.stack });
      });
    } catch (_) {}
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="min-h-screen flex items-center justify-center theme-bg p-8">
          <div className="max-w-md w-full bg-white dark:bg-tokyo-surface rounded-2xl shadow-xl p-8 text-center">
            <div className="text-red-500 text-5xl mb-4">⚠️</div>
            <h2 className="text-2xl font-bold theme-text mb-3">Something went wrong</h2>
            <p className="theme-text-muted mb-6">
              {this.state.error?.message || 'An unexpected error occurred in the application.'}
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => window.location.reload()}
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium transition-colors"
              >
                Reload App
              </button>
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="px-6 py-2.5 border border-gray-300 dark:border-tokyo-border hover:bg-gray-50 dark:hover:bg-tokyo-hover rounded-xl font-medium transition-colors"
              >
                Try Again
              </button>
            </div>
            <p className="text-xs theme-text-muted mt-8">
              If the problem persists, check the console or report the issue.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
