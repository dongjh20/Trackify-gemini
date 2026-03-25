import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      let errorMessage = "An unexpected error occurred.";
      let errorDetails = this.state.error?.message;

      try {
        if (errorDetails) {
          const parsedError = JSON.parse(errorDetails);
          if (parsedError.error && parsedError.operationType) {
            errorMessage = `Firestore Error (${parsedError.operationType}): ${parsedError.error}`;
            if (parsedError.error.includes("Missing or insufficient permissions")) {
              errorMessage = "You do not have permission to perform this action. Please check your access rights or contact support.";
            }
            errorDetails = JSON.stringify(parsedError, null, 2);
          }
        }
      } catch (e) {
        // Not a JSON error, use the original message
      }

      return (
        <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
          <div className="bg-white p-8 rounded-2xl shadow-xl max-w-lg w-full border border-red-100">
            <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mb-6">
              <AlertTriangle className="w-8 h-8 text-red-500" />
            </div>
            <h1 className="text-2xl font-bold text-gray-800 mb-2">Oops! Something went wrong.</h1>
            <p className="text-gray-600 mb-6">
              {errorMessage}
            </p>
            {errorDetails && (
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 overflow-auto max-h-64 mb-6">
                <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono">
                  {errorDetails}
                </pre>
              </div>
            )}
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-xl transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    // @ts-ignore
    return this.props.children;
  }
}
