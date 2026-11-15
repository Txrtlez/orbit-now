import { airDensity } from './atmosphere';
import { add, EARTH_RADIUS_KM, gravityWithJ2, MU_KM3_S2, norm, scale, type Vec3 } from './orbit';

/**
 * A plain step-by-step integrator of the equations of motion: gravity,
 * optionally with J2, optionally with drag.
 *
 * It is the reference the simulator's faster methods are checked against
 * (VALIDATION.md, V6.2 and V6.3). The simulator itself does not use it: at
 * ten-second steps a hundred years of several thousand fragments would
 * take hours.
 */
export interface ForceOptions {
  /** Include the J2 term of the Earth's gravity. */
  readonly j2: boolean;
  /** Cd A/m in m^2/kg; omit for no drag. */
  readonly ballistic?: number;
  /** Multiplier on the air density. */
  readonly densityFactor?: number;
}

function acceleration(r: Vec3, v: Vec3, options: ForceOptions): Vec3 {
  const radius = norm(r);
  let total: Vec3 = options.j2 ? gravityWithJ2(r) : scale(r, -MU_KM3_S2 / radius ** 3);
  if (options.ballistic !== undefined) {
    const perKm =
      airDensity(radius - EARTH_RADIUS_KM) *
      (options.densityFactor ?? 1) *
      options.ballistic *
      1000;
    total = add(total, scale(v, -0.5 * perKm * norm(v)));
  }
  return total;
}

/**
 * Advance a position (km) and velocity (km/s) by `seconds`, in fixed steps
 * of `stepSeconds`, with the classical fourth-order Runge-Kutta method.
 *
 * @param onStep called after every step with the time since the start
 */
export function integrate(
  r0: Vec3,
  v0: Vec3,
  seconds: number,
  stepSeconds: number,
  options: ForceOptions,
  onStep?: (t: number, r: Vec3, v: Vec3) => void,
): { r: Vec3; v: Vec3 } {
  let r = r0;
  let v = v0;
  const steps = Math.round(seconds / stepSeconds);
  const h = stepSeconds;
  for (let k = 1; k <= steps; k += 1) {
    const a1 = acceleration(r, v, options);
    const r2 = add(r, scale(v, h / 2));
    const v2 = add(v, scale(a1, h / 2));
    const a2 = acceleration(r2, v2, options);
    const r3 = add(r, scale(v2, h / 2));
    const v3 = add(v, scale(a2, h / 2));
    const a3 = acceleration(r3, v3, options);
    const r4 = add(r, scale(v3, h));
    const v4 = add(v, scale(a3, h));
    const a4 = acceleration(r4, v4, options);
    r = add(r, scale(add(add(v, scale(add(v2, v3), 2)), v4), h / 6));
    v = add(v, scale(add(add(a1, scale(add(a2, a3), 2)), a4), h / 6));
    onStep?.(k * h, r, v);
  }
  return { r, v };
}
