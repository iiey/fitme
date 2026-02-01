"use client"

import { Component, type ErrorInfo, type ReactNode } from "react"

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && prevProps.children !== this.props.children) {
      this.setState({ hasError: false })
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="flex items-center justify-center rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
            Something went wrong rendering this section.
          </div>
        )
      )
    }
    return this.props.children
  }
}
