"use client";

import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[aeris] Uncaught error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-black text-white"
        >
          <p className="text-lg font-semibold">Something went wrong</p>
          <p className="max-w-md text-center text-sm text-white/50">
            {this.state.error.message}
          </p>
          <button
            onClick={() => this.setState({ error: null })}
            className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium transition-colors hover:bg-white/20"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
