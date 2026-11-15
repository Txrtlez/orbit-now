/**
 * WGS 84 reference ellipsoid.
 *
 * WGS 84 (World Geodetic System 1984) is the Earth model that GPS and most
 * mapping software use. It approximates the Earth as an oblate spheroid: a
 * sphere squashed slightly along its rotation axis.
 *
 * REAL DATA: the two values marked "defining" are exact by definition. They
 * were checked against the National Geospatial-Intelligence Agency's WGS 84
 * summary (which cites NIMA Technical Report 8350.2), as hosted at
 * https://www.unoosa.org/pdf/icg/2012/template/WGS_84.pdf. Everything else in
 * this file is derived from them by formula. See VALIDATION.md, entry V1.1.
 *
 * Note for later phases: the SGP4 orbit propagator does NOT use these
 * constants. It is defined in terms of the older WGS 72 constants, and mixing
 * the two inside SGP4 would be an error. WGS 84 is used only for geometry on
 * and around the Earth's surface (rendering, observer positions).
 */

/** Semi-major axis (equatorial radius), in kilometres. Defining parameter. */
export const WGS84_A_KM = 6378.137;

/** Reciprocal of the flattening, 1/f. Dimensionless. Defining parameter. */
export const WGS84_INVERSE_FLATTENING = 298.257223563;

/** Flattening, f = (a - b) / a. Derived. */
export const WGS84_F = 1 / WGS84_INVERSE_FLATTENING;

/** Semi-minor axis (polar radius), b = a (1 - f), in kilometres. Derived. */
export const WGS84_B_KM = WGS84_A_KM * (1 - WGS84_F);

/** First eccentricity squared, e^2 = f (2 - f). Derived. */
export const WGS84_E2 = WGS84_F * (2 - WGS84_F);
