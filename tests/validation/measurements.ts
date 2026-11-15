import { appendFileSync } from 'node:fs';

/**
 * Write a measured value where a person can read it.
 *
 * The validation tests assert thresholds, but VALIDATION.md records the
 * numbers actually measured. Setting the environment variable
 * VALIDATION_LOG to a file path makes the tests append their measurements
 * to that file:
 *
 *   VALIDATION_LOG=/tmp/measurements.txt npm run test -- tests/validation
 *
 * Without the variable this does nothing.
 */
export function recordMeasurement(label: string, values: Readonly<Record<string, number>>): void {
  const path = process.env.VALIDATION_LOG;
  if (path === undefined || path === '') {
    return;
  }
  const parts = Object.entries(values).map(([key, value]) => `${key}=${String(value)}`);
  appendFileSync(path, `${label}: ${parts.join(', ')}\n`);
}
