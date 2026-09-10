/** Normalizes a MAC address for comparison: strips separators and upper-cases it. */
export function normalizeMac(mac: string): string {
  return mac.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
