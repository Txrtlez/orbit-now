# Validation record

Every comparison between this project and an outside reference is recorded here, with the numbers
and the date it was made. A check that has not been run is listed as "not yet run", never as passed.

## Launch gates

These are the four validations that must pass before launch. None can be run yet, because the code
they test belongs to later phases.

| Gate                                                                                      | Phase | Status      |
| ----------------------------------------------------------------------------------------- | ----- | ----------- |
| SGP4 matches the test vectors in Vallado et al. (2006), "Revisiting Spacetrack Report #3" | 2     | Not yet run |
| ISS passes match NASA Spot the Station or Heavens-Above for at least three locations      | 4     | Not yet run |
| Breakup model reproduces the published size-distribution curves and conserves momentum    | 6     | Not yet run |
| J2 propagation matches the analytic secular nodal precession rate                         | 6     | Not yet run |

## Phase 1

### V1.1 WGS 84 ellipsoid constants

- **Date:** 2026-11-14
- **What is checked:** the two constants in `src/geo/wgs84.ts` that are entered by hand, and the two
  quantities the code derives from them.
- **Reference for the defining parameters:** the National Geospatial-Intelligence Agency's WGS 84
  summary, which cites NIMA Technical Report 8350.2, read on 2026-11-14 from the copy hosted by the
  UN Office for Outer Space Affairs at <https://www.unoosa.org/pdf/icg/2012/template/WGS_84.pdf>.
- **Reference for the derived values:** that document does not list the semi-minor axis or the
  eccentricity. The figures below were taken from secondary listings of the WGS 84 parameters
  (the "World Geodetic System" encyclopedia article and a published constants table), so they are a
  weaker check than the defining parameters.
- **Reproduce:** `npm run test -- src/geo/wgs84.test.ts`

| Quantity                      | Reference value  | Value in code       | Difference | Kind     |
| ----------------------------- | ---------------- | ------------------- | ---------- | -------- |
| Semi-major axis a             | 6 378 137.0 m    | 6378.137 km         | 0 (exact)  | Defining |
| Reciprocal flattening 1/f     | 298.257223563    | 298.257223563       | 0 (exact)  | Defining |
| Semi-minor axis b = a(1 − f)  | 6 356 752.3142 m | 6 356 752.314245… m | < 0.05 mm  | Derived  |
| First eccentricity squared e² | 6.69437999014e-3 | 6.6943799901413…e-3 | < 5e-15    | Derived  |

**Result: pass.** The reference values for b and e² are quoted to 0.1 mm and 12 significant figures
respectively; the code agrees to within the rounding of those published figures. The code's own
values are b = 6 356 752.314245179 m and e² = 0.006694379990141316.

### V1.2 Geodetic to Earth-fixed conversion

- **Date:** 2026-11-14
- **What is checked:** `geodeticToEcef` in `src/geo/geodetic.ts`.
- **Reference:** internal mathematical consistency only. No external numerical reference has been
  used yet. An external comparison is planned for Phase 4, when observer positions first matter.
- **Reproduce:** `npm run test -- src/geo/geodetic.test.ts`

| Check                                                                     | Tolerance        | Result |
| ------------------------------------------------------------------------- | ---------------- | ------ |
| (0°, 0°, 0 km) lies on +x at distance a                                   | 1e-9 km          | Pass   |
| (0°, 90° E, 0 km) lies on +y at distance a                                | 1e-9 km          | Pass   |
| Both poles lie on the z axis at distance b                                | 1e-9 km          | Pass   |
| 250 zero-height points satisfy x²/a² + y²/a² + z²/b² = 1                  | 1e-12 (relative) | Pass   |
| Geocentric latitude obeys tan φ′ = (1 − e²) tan φ at six latitudes        | 1e-12            | Pass   |
| Adding 400 km of height moves the point 400 km along the ellipsoid normal | 1e-9 km, 1e-12   | Pass   |

**Result: pass, with a stated limit.** These checks show the function is self-consistent and agrees
with identities derived independently from the ellipse equation. They do not yet show agreement with
an outside implementation.

### V1.3 Rendering frame

- **Date:** 2026-11-14
- **What is checked:** the mapping from Earth-fixed coordinates to scene coordinates in
  `src/geo/sceneFrame.ts` is a pure rotation and scale, not a mirror image.
- **Reproduce:** `npm run test -- src/geo/sceneFrame.test.ts`
- **Result: pass.** For the mapped basis vectors, x × y = z holds to 1e-12, so handedness is
  preserved and prograde orbits will appear prograde.

### V1.4 Build and browser checks

- **Date:** 2026-11-14
- **Environment:** Node.js 22.23.4, Google Chrome for Testing 153.0.8010.12, headless, software
  rendering (SwiftShader). No physical GPU and no physical phone were involved.

| Check                                              | Result                                        |
| -------------------------------------------------- | --------------------------------------------- |
| Prettier, ESLint (strict, type-aware), TypeScript  | Pass, 0 findings                              |
| Unit tests                                         | 30 of 30 pass                                 |
| Browser smoke tests, desktop and Pixel 7 emulation | 6 of 6 pass                                   |
| Initial download (HTML + JS + CSS, gzip level 9)   | 138.0 kB against a 300 kB budget              |
| GitHub Actions workflows                           | **Not yet run.** No repository was available. |
| Frame rate on real hardware                        | **Not yet measured.**                         |
| Firefox, Safari, Edge, real iOS and Android        | **Not yet tested.** Scheduled for Phase 7.    |
