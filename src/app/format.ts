/**
 * Turning numbers into the text shown in the interface. Kept in one place so
 * that every figure of the same kind is rounded and written the same way.
 */

const WHOLE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** A whole number with thousands separators: 19,560. */
export function formatCount(value: number): string {
  return WHOLE.format(value);
}

/**
 * A distance in kilometres, to the nearest kilometre: "417 km", "35,786 km".
 *
 * Whole kilometres on purpose. Positions come from SGP4 with element sets
 * that are typically hours to days old, which is good to roughly a
 * kilometre at best; printing decimals would claim precision that is not there.
 */
export function formatKm(km: number): string {
  // Avoid "-0 km" for a value that rounds to zero from below.
  const rounded = Math.round(km);
  return `${WHOLE.format(rounded === 0 ? 0 : rounded)} km`;
}

/** A speed in kilometres per second, to two decimals: "7.66 km/s". */
export function formatSpeed(kmPerSecond: number): string {
  return `${kmPerSecond.toFixed(2)} km/s`;
}

/** An angle in degrees, to two decimals: "51.63°". */
export function formatDegrees(degrees: number): string {
  return `${degrees.toFixed(2)}°`;
}

/**
 * An orbital period: minutes with one decimal below two hours ("92.9 min"),
 * hours and minutes above ("23 h 56 min").
 */
export function formatPeriod(minutes: number): string {
  if (minutes < 120) {
    return `${minutes.toFixed(1)} min`;
  }
  const whole = Math.round(minutes);
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}

/** A latitude and longitude, to one decimal, with hemisphere letters: "12.3° N, 45.6° W". */
export function formatLatLon(latitudeDeg: number, longitudeDeg: number): string {
  const part = (value: number, positive: string, negative: string): string => {
    const magnitude = Math.abs(value).toFixed(1);
    // A value that rounds to 0.0 has no hemisphere worth naming.
    if (Number(magnitude) === 0) {
      return '0.0°';
    }
    return `${magnitude}° ${value >= 0 ? positive : negative}`;
  };
  return `${part(latitudeDeg, 'N', 'S')}, ${part(longitudeDeg, 'E', 'W')}`;
}
