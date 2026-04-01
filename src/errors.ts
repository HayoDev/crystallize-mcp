/**
 * Categorized error handling for actionable error messages.
 */

import type { ErrorCategory } from './types.js';

export class CrystallizeToolError extends Error {
  constructor(
    message: string,
    public readonly category: ErrorCategory,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = 'CrystallizeToolError';
  }
}

/** Format an error into a user-friendly message with actionable hints. */
export function formatError(error: unknown): string {
  if (error instanceof CrystallizeToolError) {
    const parts = [`Error: ${error.message}`];
    if (error.hint) {
      parts.push(`Hint: ${error.hint}`);
    }
    return parts.join('\n');
  }

  let message: string;
  if (error instanceof Error) {
    message = error.message;
  } else if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error
  ) {
    message = String((error as { message: unknown }).message);
  } else {
    message = String(error);
  }

  // Detect common API error patterns and add hints
  if (
    message.includes('401') ||
    message.includes('Unauthorized') ||
    message.includes('authentication')
  ) {
    return `Error: Authentication failed.\nHint: Check CRYSTALLIZE_ACCESS_TOKEN_ID and CRYSTALLIZE_ACCESS_TOKEN_SECRET env vars.`;
  }

  if (message.includes('403') || message.includes('Forbidden')) {
    return `Error: Access denied.\nHint: Your token may lack the required permissions, or set CRYSTALLIZE_ACCESS_MODE=write for write operations.`;
  }

  if (message.includes('429') || message.includes('rate limit')) {
    return `Error: API rate limited.\nHint: Wait a moment and retry.`;
  }

  if (
    message.includes('404') ||
    message.includes('not found') ||
    message.includes('Not Found')
  ) {
    return `Error: ${message}\nHint: Check the path or identifier — use browse_catalogue or list_shapes to explore what's available.`;
  }

  return `Error: ${message}`;
}
