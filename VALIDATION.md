# Validation record

Every comparison between this project and an outside reference is recorded here, with the numbers
and the date it was made. A check that has not been run is listed as "not yet run", never as passed.

## Launch gates

These are the four validations that must pass before launch. The last three cannot be run yet,
because the code they test belongs to later phases.

| Gate                                                                                      | Phase | Status                                         |
| ----------------------------------------------------------------------------------------- | ----- | ---------------------------------------------- |
| SGP4 matches the test vectors in Vallado et al. (2006), "Revisiting Spacetrack Report #3" | 2     | **Pass, with one documented exception** (V2.1) |
| ISS passes match NASA Spot the Station or Heavens-Above for at least three locations      | 4     | Not yet run                                    |
| Breakup model reproduces the published size-distribution curves and conserves momentum    | 6     | Not yet run                                    |
| J2 propagation matches the analytic secular nodal precession rate                         | 6     | Not yet run                                    |

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

## Phase 2

### V2.1 SGP4 against the published verification set (launch gate 1)

- **Date:** 2026-11-14
- **What is checked:** satellite.js 7.2.0, the SGP4/SDP4 implementation this project uses, through
  both of its entry points: two-line element sets (`twoline2satrec`) and OMM records
  (`json2satrec`). Production code will only ever use the OMM entry point.
- **Reference:** the verification set distributed with Vallado, Crawford, Hujsak and Kelso,
  "Revisiting Spacetrack Report #3" (AIAA 2006-6753): 33 element sets (`SGP4-VER.TLE`) and the 667
  position and velocity states the authors' C++ code produced for them (`tcppver.out`), in the TEME
  frame with WGS 72 constants.
- **Provenance of the reference files:** extracted unmodified from the `sgp4` 2.27 source
  distribution on PyPI, not from the authors' archive on CelesTrak, which was unreachable from the
  build environment. Checksums are in `tests/fixtures/vallado-2006/README.md`. **Open item:** compare
  those checksums with the authors' own copy.
- **Reproduce:** `npm run test -- tests/validation`

| Quantity                                                       | TLE entry point | OMM entry point |
| -------------------------------------------------------------- | --------------- | --------------- |
| Reference states compared                                      | 666 of 667      | 666 of 667      |
| Largest position difference, 597 states within 10 000 min      | 8.12e-9 km      | 8.12e-9 km      |
| States beyond the rounding limit of the reference (8.67e-9 km) | 0               | 0               |
| Largest position difference, 69 states at 1.84 million min     | 1.17e-7 km      | 1.17e-7 km      |
| Largest velocity difference, all 666 states                    | 8.53e-10 km/s   | 8.53e-10 km/s   |

How to read these numbers. The reference file prints positions to 1e-8 km, so each coordinate is
rounded by up to 0.5e-8 km and a distance by up to √3 × 0.5e-8 = 8.67e-9 km. For the 597 states
within 10 000 minutes of epoch, every difference is below that limit: the implementation agrees
with the reference to the last printed digit. The remaining 69 states belong to one case that
propagates 3.5 years from its epoch, where the difference reaches 1.17e-7 km, which is 0.12 mm.
That is about 13 times the rounding limit, so it is a real difference and not a printing artefact;
it is consistent with accumulated floating-point rounding over a long propagation, but that cause
is an inference and was not isolated.

Error behaviour. Seven cases are designed to fail part-way. The implementation reports the
standard error codes 1, 1, 6, 6, 4, 3, 6 for cases 22312, 28350, 28872, 29141, 33333, 33334 and
20413 (second occurrence), each at the first step after the reference output ends. That sequence
is the same one the reference Python implementation (`sgp4` 2.27) asserts in its own test suite.

**The exception.** Case 33334 is a deliberately impossible orbit (mean motion 0.00001 revolutions
per day). The reference file contains one state for it, at time zero. satellite.js returns no state
and reports error 3 (perturbed eccentricity out of range). This is the one reference state of 667
that is not reproduced. The likely reason is that later revisions of the reference code return
immediately on this error where the 2006 program carried on and printed a state; that explanation
was not confirmed against the 2006 source. The practical effect on this project is nil, because
the data pipeline will reject element sets this far from a physical orbit before they reach SGP4.

**Result: pass, with the one exception above.** Whether an exception in a deliberately invalid test
case is acceptable for the launch gate is the owner's call; it is recorded here so that the call is
an informed one.

### V2.2 Build and browser checks after adding the validation suite

- **Date:** 2026-11-14
- **Environment:** as in V1.4.
- **Result:** formatting, lint and type-check pass with 0 findings; 37 of 37 unit and validation
  tests pass; 6 of 6 browser smoke tests pass; initial download 138.0 kB against the 300 kB budget
  (satellite.js is installed but not yet imported by the app, so it adds nothing to the download).
  GitHub Actions workflows: still not run.
