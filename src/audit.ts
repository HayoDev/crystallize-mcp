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
  result: 'ok' | 'error';
  tenant: string;
}

export class AuditLogger {
  private readonly path: string;
  private enabled = true;

  constructor(path: string) {
    this.path = path;
    try {
      mkdirSync(dirname(path), { recursive: true });
    } catch {
      // Audit logging should never crash the server
      this.enabled = false;
    }
  }

  log(entry: AuditEntry): void {
    if (!this.enabled) {
      return;
    }
    try {
      appendFileSync(this.path, JSON.stringify(entry) + '\n');
    } catch {
      // Audit logging should never crash the server
      this.enabled = false;
    }
  }
}

/** Return a non-content status string for the audit log. */
export function summariseResult(result: { isError?: boolean }): 'ok' | 'error' {
  return result.isError ? 'error' : 'ok';
}
