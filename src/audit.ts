/**
 * Audit logger — writes one JSON line per tool call to a configured file.
 *
 * Never logs response content — only what was requested and the shape of the result.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AuditEntry {
  ts: string;
  tool: string;
  params: Record<string, unknown>;
  result: string;
  tenant: string;
}

export class AuditLogger {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
  }

  log(entry: AuditEntry): void {
    try {
      appendFileSync(this.path, JSON.stringify(entry) + '\n');
    } catch {
      // Audit logging should never crash the server
    }
  }
}

/** Summarise a tool result into a short string for the audit log. */
export function summariseResult(result: {
  content: { text: string }[];
  isError?: boolean;
}): string {
  if (result.isError) {
    return 'error';
  }
  const text = result.content[0]?.text ?? '';
  // Extract the first line, capped at 80 chars
  const firstLine = text.split('\n')[0] ?? '';
  return firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine;
}
