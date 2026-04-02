/**
 * Credential storage for crystallize-mcp.
 *
 * Provides keychain-backed credential storage via keytar (optional dependency).
 * Falls back gracefully if keytar is unavailable (no keyring daemon, native
 * binding mismatch, headless Linux, etc.).
 *
 * Storage keys:
 *   service:  crystallize-mcp
 *   accounts: access-token-id, access-token-secret, static-auth-token
 */

const SERVICE = 'crystallize-mcp';

export interface StoredCredentials {
  accessTokenId?: string;
  accessTokenSecret?: string;
  staticAuthToken?: string;
}

interface KeytarCompat {
  getPassword: (service: string, account: string) => Promise<string | null>;
  setPassword: (
    service: string,
    account: string,
    password: string,
  ) => Promise<void>;
  deletePassword: (service: string, account: string) => Promise<boolean>;
}

/** Attempt to load @napi-rs/keyring keytar compat shim. Returns null if unavailable. */
async function loadKeytar(): Promise<KeytarCompat | null> {
  try {
    // Use the keytar-compatible shim — same API, Rust/NAPI-RS backend.
    // Dynamic import with unknown cast: @napi-rs/keyring is an optional dep,
    // so TypeScript has no types for it at compile time.
    const mod = (await import(
      '@napi-rs/keyring/keytar.js' as string
    )) as unknown as KeytarCompat;
    if (typeof mod.getPassword !== 'function') {
      return null;
    }
    return mod;
  } catch {
    return null;
  }
}

/** Read stored credentials from the OS keychain. Returns empty object if keytar unavailable. */
export async function readCredentials(): Promise<StoredCredentials> {
  const kt = await loadKeytar();
  if (!kt) {
    return {};
  }

  try {
    const [accessTokenId, accessTokenSecret, staticAuthToken] =
      await Promise.all([
        kt.getPassword(SERVICE, 'access-token-id'),
        kt.getPassword(SERVICE, 'access-token-secret'),
        kt.getPassword(SERVICE, 'static-auth-token'),
      ]);

    return {
      accessTokenId: accessTokenId ?? undefined,
      accessTokenSecret: accessTokenSecret ?? undefined,
      staticAuthToken: staticAuthToken ?? undefined,
    };
  } catch {
    // Keyring daemon not running, permission denied, etc.
    return {};
  }
}

/** Store credentials in the OS keychain. Throws if keytar is unavailable. */
export async function writeCredentials(
  creds: StoredCredentials,
): Promise<void> {
  const kt = await loadKeytar();
  if (!kt) {
    throw new Error(
      'keytar is not available on this system.\n' +
        'Install it with: npm install -g keytar\n' +
        'Or set credentials as environment variables instead.',
    );
  }

  const writes: Promise<void>[] = [];

  if (creds.accessTokenId) {
    writes.push(
      kt.setPassword(SERVICE, 'access-token-id', creds.accessTokenId),
    );
  }
  if (creds.accessTokenSecret) {
    writes.push(
      kt.setPassword(SERVICE, 'access-token-secret', creds.accessTokenSecret),
    );
  }
  if (creds.staticAuthToken) {
    writes.push(
      kt.setPassword(SERVICE, 'static-auth-token', creds.staticAuthToken),
    );
  }

  await Promise.all(writes);
}

/** Remove all stored credentials from the OS keychain. */
export async function deleteCredentials(): Promise<void> {
  const kt = await loadKeytar();
  if (!kt) {
    return;
  }

  try {
    await Promise.all([
      kt.deletePassword(SERVICE, 'access-token-id'),
      kt.deletePassword(SERVICE, 'access-token-secret'),
      kt.deletePassword(SERVICE, 'static-auth-token'),
    ]);
  } catch {
    // best-effort
  }
}

/** True if keytar loaded successfully and can reach the OS keyring. */
export async function isKeychainAvailable(): Promise<boolean> {
  const kt = await loadKeytar();
  if (!kt) {
    return false;
  }
  try {
    // Probe with a read — cheap and non-destructive
    await kt.getPassword(SERVICE, '_probe');
    return true;
  } catch {
    return false;
  }
}
