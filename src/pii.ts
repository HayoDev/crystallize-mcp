/**
 * PII masking utilities.
 *
 * Masks personal data in customer and order responses based on the
 * configured CRYSTALLIZE_PII_MODE.
 */

import type { PiiMode } from './types.js';
export type { PiiMode };

/** Mask an email: `hani@example.com` → `h***@example.com` */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) {
    return '***';
  }
  return `${local[0]}***@${domain}`;
}

/** Mask a phone number: keeps only last 4 digits → `***-1264` */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) {
    return '***';
  }
  return `***-${digits.slice(-4)}`;
}

/** Strip an address down to city + country only. */
export function maskAddress<T>(addr: T): T {
  const masked = { ...addr } as Record<string, unknown>;
  for (const key of [
    'street',
    'street2',
    'streetNumber',
    'postalCode',
    'state',
    'email',
    'phone',
    'firstName',
    'lastName',
  ]) {
    delete masked[key];
  }
  return masked as T;
}

/**
 * Apply PII masking to a flat object with known field names.
 * Always returns a new object — never mutates the original.
 */
export function maskFields<T extends Record<string, unknown>>(
  obj: T,
  mode: PiiMode,
): T {
  if (mode === 'full') {
    return { ...obj };
  }

  const result = { ...obj };

  if (mode === 'none') {
    for (const key of [
      'email',
      'phone',
      'companyName',
      'taxNumber',
      'birthDate',
    ] as const) {
      if (key in result) {
        delete (result as Record<string, unknown>)[key];
      }
    }
    if ('addresses' in result) {
      delete (result as Record<string, unknown>).addresses;
    }
    if ('firstName' in result) {
      delete (result as Record<string, unknown>).firstName;
    }
    if ('lastName' in result) {
      delete (result as Record<string, unknown>).lastName;
    }
    return result;
  }

  // mode === 'masked'
  if (typeof result.email === 'string') {
    (result as Record<string, unknown>).email = maskEmail(result.email);
  }
  if (typeof result.phone === 'string') {
    (result as Record<string, unknown>).phone = maskPhone(result.phone);
  }
  if (Array.isArray(result.addresses)) {
    (result as Record<string, unknown>).addresses = result.addresses.map(
      (addr: Record<string, unknown>) => maskAddress(addr),
    );
  }

  return result;
}
