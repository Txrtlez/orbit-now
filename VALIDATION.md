# Validation record

Every comparison between this project and an outside reference is recorded here, with the numbers
and the date it was made. A check that has not been run is listed as "not yet run", never as passed.

## Launch gates

These are the four validations that must pass before launch. The last two cannot be run yet,
because the code they test belongs to a later phase.

| Gate                                                                                      | Phase | Status                                         |
| ----------------------------------------------------------------------------------------- | ----- | ---------------------------------------------- |
| SGP4 matches the test vectors in Vallado et al. (2006), "Revisiting Spacetrack Report #3" | 2     | **Pass, with one documented exception** (V2.1) |
| ISS passes match NASA Spot the Station or Heavens-Above for at least three locations      | 4     | **Pass**, Heavens-Above, four locations (V4.2) |
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

### V2.3 Data pipeline: first run against the real source

- **Date:** 2026-11-15, 01:54 UTC (workflow run 43665237457, started by hand)
- **What is checked:** that the pipeline, written and tested without access to CelesTrak, works on
  CelesTrak's actual responses, and that the published catalog is plausible.
- **Reproduce:** the run's summary is at
  <https://github.com/Txrtlez/orbit-now/actions/runs/43665237457>. The published result can be
  read with `git fetch origin data && git show FETCH_HEAD:status.json`.

| Group                | HTTP status | Rows   | Accepted | Left out |
| -------------------- | ----------- | ------ | -------- | -------- |
| `iridium-33-debris`  | 200         | 109    | 109      | 0        |
| `cosmos-2251-debris` | 200         | 581    | 581      | 0        |
| `fengyun-1c-debris`  | 200         | 1,988  | 1,988    | 0        |
| `active`             | 200         | 16,881 | 16,881   | 0        |

Properties of the resulting catalog:

| Quantity                                                 | Value                                            |
| -------------------------------------------------------- | ------------------------------------------------ |
| Objects                                                  | 19,559 (none listed by two groups)               |
| File size                                                | 723,576 bytes compressed; 2,391,385 uncompressed |
| Objects with catalog numbers above 99,999                | 1,021 (highest: 101357)                          |
| Age of element sets when the catalog was written: median | 0.86 days                                        |
| Age: 90th and 99th percentile                            | 1.46 and 5.69 days                               |
| Age: oldest                                              | 29.63 days                                       |
| Element sets with an epoch in the future                 | 1 (by 1.03 days)                                 |

Two observations follow from this table. First, 1,021 objects could not have been represented in
the legacy two-line format at all, which confirms the brief's instruction to use OMM. Second, the
highest catalog number matches the figure CelesTrak's own site gave for the latest catalogued
object on the same day (101357).

**Plausibility check on one object (not a validation).** The catalog's record for catalog number
25544, named "ISS (ZARYA)", with epoch 2026-11-14T07:16:30.203040, was propagated to its own epoch
with SGP4. The result is 414.7 km above the equatorial radius (distance from the Earth's centre
minus 6378.137 km, which is not the same as height above the ground) and a speed of 7.666 km/s.
Both are in the range expected for the International Space Station. This shows the data is not
garbage. It does not show that positions are accurate; that is launch gate 2, in Phase 4.

**Live site check.** On 2026-11-15 the deployed site (build 1e3ae3a) was opened in a Chromium 156
based browser on Windows with an NVIDIA GeForce RTX 2080 SUPER. It reported "Orbital data loaded
for 19,559 objects", and a screenshot showed the globe drawn. The catalog was served as
`application/gzip` with no content encoding, 723,576 bytes, which is the case the loader's
in-browser decompression was written for. The JavaScript bundle transferred as 141.9 kB.

**Result: pass, with stated limits.** Not checked: a row-by-row comparison of the live catalog with
the raw downloads (the raw files could not be retrieved from the build environment); a scheduled
run, as opposed to one started by hand; and the pipeline's behaviour on a real refusal from
CelesTrak, which so far is covered only by tests with a substitute network.

### V2.4 Build and browser checks at the end of Phase 2

- **Date:** 2026-11-15
- **Result:** on GitHub Actions (run 43665237457): formatting, lint and type-check pass; 131 of 131
  unit and validation tests pass; 12 of 12 browser tests pass. Initial download of HTML, JavaScript
  and CSS: 139.8 kB against the 300 kB budget. The catalog is a further 723.6 kB, fetched after the
  page has started, and is not counted in that budget. Whether the total meets the "under 3 seconds"
  target on a typical phone connection has not been measured.

## Phase 3 (core)

### V3.1 Sidereal time, the TEME to Earth-fixed rotation, and the Sun's direction

- **Date:** 2026-11-15
- **What is checked:** `gmstRadians`, `temeToEarthFixed` and `sunDirection` in `src/orbit/time.ts`.
  The first and third call satellite.js's implementations of the standard formulas.
- **Reproduce:** `npm run test -- tests/validation/frames-and-sun`

| Check                                                                                   | Reference value                                | Result                       |
| --------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------- |
| Greenwich sidereal time, 1992-08-20 12:14:00 UT1                                        | 152.578787810°                                 | Agrees to 5e-10°             |
| TEME → pseudo-Earth-fixed, 2004-04-06 07:51:28.386009 UTC with UT1 − UTC = −0.4399619 s | (−1033.4750313, 7901.3055856, 6380.3445327) km | Agrees to 0.5 mm             |
| Sun position vector, 2006-04-02 00:00 UTC                                               | (0.9771945, 0.1924424, 0.0834308) AU           | Direction agrees to 1e-7     |
| Sun's declination at the 2026 solstices                                                 | ±23.44° (the tilt of the Earth's axis)         | +23.44°, −23.44°             |
| Sub-solar longitude at 12:00 UTC on 2026-04-15, when the equation of time is zero       | 0°                                             | Within 0.3°                  |
| Sub-solar longitude at 12:00 UTC on 2026-11-03 and 2026-02-11                           | −4.1° and +3.6°, from the equation of time     | Agrees to the nearest degree |

**Caveat on the first three rows.** Those reference values are worked examples from Vallado's
"Fundamentals of Astrodynamics and Applications" and from "Revisiting Spacetrack Report #3". They
were entered from memory, because the books were not available in the build environment. The code
reproduces all of them to the last digit entered (9, 7 and 7 decimal places), which a misremembered
number would not do by chance, but they have not been checked against the printed pages. The last
three rows do not depend on those examples: they rest on the tilt of the Earth's axis and the
equation of time, and they test the day/night line's position over the ground end to end.

**Stated simplifications, with their size:**

- UTC is used where the formula calls for UT1. The two differ by up to 0.9 s, which is up to
  13.5 arcseconds of Earth rotation, or 0.42 km on the ground at the equator. In the 2004 example
  above, where the difference was 0.44 s, the test measures the effect as 0.26 km.
- Polar motion is ignored (about 10 m).
- The Sun's direction comes from a low-precision series, stated by its source as good to about
  0.01°, and is treated as if it were in the TEME frame.

**Result: pass, subject to the caveat above.**

### V3.2 Bulk propagation into 32-bit scene coordinates

- **Date:** 2026-11-15
- **What is checked:** `propagateAll` in `src/orbit/propagate.ts`, which is what the background
  thread runs: SGP4 for every object, converted to scene axes and units and stored as 32-bit floats.
- **Reference:** the Vallado et al. reference states (see V2.1), 596 of them.
- **Reproduce:** `npm run test -- tests/validation/propagation`
- **Result: pass.** Every position and velocity agrees with the reference to within 2e-7 of its own
  magnitude, which is the rounding of a 32-bit float. In distance terms that is about 1 m in low
  Earth orbit and about 8 m at geostationary height. This rounding is the floor on how precisely any
  object can be placed on screen.

### V3.3 Interpolation between keyframes

- **Date:** 2026-11-15
- **What is checked:** that drawing each object on a cubic curve between two SGP4 results 5 seconds
  apart puts it where SGP4 itself would. Measured over 28 fixture orbits, 12 start times around each
  orbit, and three points within the interval, with the final value rounded to 32 bits.
- **Reproduce:** `npm run test -- tests/validation/propagation`

| Keyframe spacing        | Worst error, ordinary orbits | Worst error, the extreme orbit (case 23333) |
| ----------------------- | ---------------------------- | ------------------------------------------- |
| 5 s (what the app uses) | 10.3 m                       | 147 m                                       |
| 60 s                    | 95 m                         | 1,777 m                                     |

**A finding worth recording.** A cubic through two exact states of a smooth orbit would be accurate
to millimetres over 5 seconds, so errors of metres needed explaining. The cause is that the velocity
SGP4 reports is not exactly the rate of change of the position SGP4 reports. Differencing SGP4's
positions shows a mismatch of roughly 1 to 16 m/s for ordinary orbits. The interpolation inherits
it, which is why the error grows in proportion to the spacing and not with its fourth power. Case
23333 (eccentricity 0.97, far point beyond the Moon's distance) has a mismatch of about 300 m/s
near its closest approach; no object in the real catalog resembles it. This explanation fits the
measurements but was not checked against the SGP4 literature.

**Result: pass for the purpose.** At the 5 second spacing the error for ordinary orbits is about
10 m, comparable to the 32-bit rounding in V3.2 and thousands of times smaller than SGP4's own
accuracy with day-old elements (commonly quoted as a kilometre or more). Two orbits were excluded
because SGP4 stops producing valid states for them within one revolution (cases 28872 and 33333).

### V3.4 Earth imagery placement

- **Date:** 2026-11-15
- **What is checked:** that three.js places an equirectangular image on its sphere the way the
  coordinate frames assume: Greenwich at scene +x, 90° E at scene −z, north at scene +y.
- **Reproduce:** `npm run test -- tests/validation/earth-texture-mapping`
- **Result: pass** at five points, compared against this project's own geodesy code. That the image
  files themselves have Greenwich in the centre and north at the top was confirmed by looking at
  them, not by a test.

### V3.5 All objects on the globe

- **Date:** 2026-11-15
- **What is checked:** the built page, given the live catalog of 2026-11-15 (19,559 objects), in
  headless Chromium with software rendering.
- **Result:** all 19,559 objects were prepared and placed, with 0 propagation failures, about 2.5 s
  after navigation on the desktop profile and 3.2 s on the Pixel 7 profile. A zoomed-out screenshot
  shows the geostationary ring as a thin circle in the equatorial plane at the expected distance of
  about 6.6 Earth radii, which is a visual confirmation that orbits and Earth share one frame.
- **Frame rate in the software renderer:** about 9 frames per second, which says nothing about a
  phone or a laptop with a GPU.

**Frame rate on real hardware (added 2026-11-15).** Measured by the project owner on the live site
(build 34f69e9, 19,559 objects, readout enabled with `?stats`):

| Device     | Average frame rate reported | Target in the brief |
| ---------- | --------------------------- | ------------------- |
| Desktop PC | 240 fps                     | 60 fps on a laptop  |
| Phone      | 60 fps                      | 30 fps on a phone   |

Both targets are met with a wide margin, which settles the renderer decision in the README
(three.js with WebGL2). What these two numbers do not establish:

- The device models were not recorded, so "mid-range phone" in the brief is not shown to be
  satisfied: the phone may be a fast one. The desktop is a PC, not a laptop.
- 240 and 60 are common display refresh rates. A browser does not draw faster than the display
  refreshes, so each figure is probably a ceiling set by the screen and not the renderer's limit.
- Only the average was reported, not the "slowest 1%" figure that reveals stutter.
- The measurement predates the interaction features added afterwards (V3.6 to V3.11). Those draw
  the objects in two passes instead of one and add a line and a ring for the selected object. That
  cost is expected to be small but has not been measured on real hardware.

## Phase 3 (interaction)

### V3.6 Orbit figures and the drawn orbit path

- **Date:** 2026-11-15
- **What is checked:** `summariseOrbits` (the period and the lowest and highest altitude shown for
  a selected object) and `sampleOrbitPath` (the points of the blue orbit line), both in
  `src/orbit/propagate.ts`.
- **Reference:** the Vallado et al. verification set (see V2.1), and Kepler's third law with
  SGP4's own gravitational parameter (398 600.8 km³/s², read from satellite.js, not typed in).
- **Reproduce:** `VALIDATION_LOG=/tmp/measurements.txt npm run test -- tests/validation/orbit-summary-and-path`
  (the measured values are written to that file).

| Check                                                                                        | Objects         | Measured         | Limit asserted        |
| -------------------------------------------------------------------------------------------- | --------------- | ---------------- | --------------------- |
| Period and semi-major axis against Kepler's third law: largest relative difference           | 30              | 7.5e-4           | between 1e-4 and 1e-3 |
| Eccentricity implied by the two altitudes against the published eccentricity                 | 30              | agrees           | 5 decimal places      |
| Reference distances within one day of epoch lying outside the stated lowest to highest range | 25 (372 states) | at most 10.2 km  | 15 km                 |
| Middle point of the drawn path against the object's own position at that instant             | 25              | 0 km (identical) | 0.05 km               |
| Gap between the two ends of the drawn path, as a fraction of the orbit's semi-major axis     | 25              | at most 1.7%     | 2%                    |
| Longest straight segment of the path (256 segments), same fraction                           | 25              | 3.4%             | 4%                    |

How to read these numbers. The first row is not expected to be zero: SGP4 converts the published
mean motion to a different convention before using it, a correction of the order of the Earth's
oblateness coefficient (about 0.001), and the figures shown in the app are SGP4's own. The third
row shows that "lowest" and "highest" describe the average orbit and are not hard limits: real
distances stray about 10 km outside them, mostly because the Earth is not a sphere. The app says
so in the tooltip for that figure. The fifth row is the reason the drawn orbit does not quite
close: an orbit turns slowly, so after one revolution the object is not exactly where it started.

**Objects left out, and why.** The verification set was built to stress SGP4, and six of its
orbits are ones that "period" and "highest altitude" cannot sensibly describe: one is deliberately
unphysical (33333, eccentricity 0.995 with its low point underground; left out of every row), four
are in the act of re-entering (22312, 28350, 28872, 29141), and one has eccentricity 0.97 with a
far point beyond the Moon (23333). For 28872 the path function is checked separately to return
nothing, instead of part of a path, when SGP4 cannot cover the whole revolution.

**Stated simplification.** The sample times for the path assume the mean anomaly advances at a
constant rate. That only affects how evenly the points are spaced (hence 3.4% where exact spacing
would give 2.45%); every point is still an SGP4 position.

**Result: pass.**

### V3.7 Orbit regimes and object categories on the real catalog

- **Date:** 2026-11-15
- **What is checked:** `classifyRegime` (`src/orbit/elements.ts`) and `categoryOf`
  (`src/catalog/categories.ts`), applied to the published catalog generated at
  2026-11-15T04:02:18Z (19,560 objects), read from the repository's `data` branch.
- **Reproduce:** unit tests with `npm run test -- src/orbit/elements src/catalog`. The counts below
  come from running the same code over the published catalog; they change with every data update.

| Regime (this site's convention)               | Objects |
| --------------------------------------------- | ------- |
| LEO: highest point below 2,000 km             | 18,740  |
| MEO: everything not in the other three        | 204     |
| GEO: 0.99 to 1.01 revolutions per day         | 572     |
| HEO: eccentricity 0.25 or more (tested first) | 44      |

| Category              | How recognised                   | Objects |
| --------------------- | -------------------------------- | ------- |
| Starlink              | name begins `STARLINK`           | 11,188  |
| OneWeb                | name begins `ONEWEB`             | 651     |
| Kuiper                | name begins `KUIPER`             | 391     |
| Qianfan               | name begins `QIANFAN`            | 275     |
| Hulianwang            | name begins `HULIANWANG`         | 261     |
| GPS                   | name begins `NAVSTAR `           | 40      |
| GLONASS               | name contains `[GLONASS`         | 27      |
| Galileo               | name contains `(GALILEO`         | 32      |
| BeiDou                | name begins `BEIDOU`             | 56      |
| QZSS                  | name begins `QZS-`               | 6       |
| NavIC                 | name begins or contains `IRNSS-` | 9       |
| Space station modules | name begins `ISS (` or `CSS (`   | 8       |
| Fengyun-1C debris     | member of CelesTrak's group      | 1,989   |
| Cosmos 2251 debris    | member of CelesTrak's group      | 581     |
| Iridium 33 debris     | member of CelesTrak's group      | 109     |
| Everything else       |                                  | 3,937   |

**Where the regime boundaries come from, and how sure each is.**

- 2,000 km for LEO: the IADC Space Debris Mitigation Guidelines, section 3.3, "Region A". Confirmed
  on 2026-11-15 from a NASA paper that quotes the guidelines (Johnson, "Medium Earth Orbits: Is
  There a Need for a Third Protected Region?", NTRS 20100007939). The guidelines themselves were
  not opened.
- Eccentricity 0.25: Space-Track.org's catalog pages define LEO with "Eccentricity < 0.25".
  Confirmed second-hand, through an encyclopedia article that cites that page. Using 0.25 as the
  start of HEO follows from it.
- 0.99 to 1.01 revolutions per day for GEO: **from memory** of the same Space-Track definitions.
  Not checked.

Whatever their source, these are a convention: agencies draw the lines differently, and the app
says so wherever it shows a regime.

**Limits of the categories.** Membership by name is a simplification. It was checked only by
reading the matched names in this one catalog (for example, that `GSAT-8`, an Indian satellite, is
not counted as Galileo, and that `SWISSCUBE` is not counted as a space station). It cannot notice a
satellite published under an unexpected name, and it says nothing about whether a satellite is
working: 40 objects named NAVSTAR are more than the GPS constellation's working satellites. The
eight "space station modules" are separate catalog entries for parts of two stations (five for the
ISS, three for the Chinese station), not eight stations.

**Result: recorded, not validated against an outside count.** No independent list of constellation
members was compared.

### V3.8 Picking, ground position and the live readout

- **Date:** 2026-11-15
- **What is checked:** `pickObject`, `projectToScreen` and `segmentHitsSphere`
  (`src/render/picking.ts`); `ecefToGeodetic` (`src/geo/geodetic.ts`); `liveStateFromScene`
  (`src/app/liveState.ts`).
- **Reference:** three.js's own projection for the screen position; otherwise internal
  mathematical consistency. No outside numerical reference was used.
- **Reproduce:** `npm run test -- src/render/picking src/geo/geodetic src/app/liveState`

| Check                                                                                                                    | Tolerance            | Result |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------- | ------ |
| Screen position agrees with three.js's `Vector3.project` at four points                                                  | 1e-9 pixel           | Pass   |
| A point behind the Earth is reported hidden; one beside it visible; the grazing line is told apart at ±0.1%              | exact                | Pass   |
| Nearest object to the pointer wins; of two that coincide, the one nearer the camera                                      | exact                | Pass   |
| Hidden, filtered-out, unplaced and behind-the-camera objects cannot be picked                                            | exact                | Pass   |
| Earth-fixed to latitude, longitude, height and back: 7 heights (0 to 100,000 km) × 25 latitudes × 12 longitudes          | 1e-9 degree, 1e-9 km | Pass   |
| Height is measured along the ellipsoid's normal (a point 7,000 km from the centre at 45° is between 622 and 643 km high) | bounds               | Pass   |
| Scene coordinates to latitude, longitude, height: six points from the surface to 35,786 km                               | 1e-8 degree, 1e-6 km | Pass   |
| A point fixed in space drifts west over the ground at the Earth's rotation rate (15.04° per hour)                        | 0.01 degree          | Pass   |

**What this does and does not show.** It shows that the chain from an object's position to the
altitude and ground position on screen is self-consistent and that picking agrees with what is
drawn. It does not show that the altitude displayed for a real satellite is right: that depends
on SGP4 (validated in V2.1), on the frame rotation (V3.1, with its caveat) and on the age of the
element set. Comparing a displayed position with an independent tracker is part of launch gate 2
in Phase 4.

**Plausibility check on one object (not a validation).** With the catalog of 2026-11-15T04:02Z the
app describes catalog number 25544, "ISS (ZARYA)", as: period 93.0 min, inclination 51.63°, lowest
and highest points 414 km and 424 km, and a live altitude of 431 km while over 40° S. Those are in
the range generally quoted for the International Space Station; the general figures are from
memory. The live altitude exceeding the "highest" figure is the effect described in V3.6: the
Earth's surface is closer to its centre at high latitudes, so the height above it is greater there.

**Result: pass, with the stated limit.**

### V3.9 Satellite catalog (SATCAT) records in the pipeline

- **Date:** 2026-11-15
- **What is checked:** the reader for SATCAT CSV (`pipeline/satcat.ts`), its merging into the
  catalog (`pipeline/merge.ts`) and the rules for requesting it (`pipeline/update.ts`).
- **Reproduce:** `npm run test -- tests/pipeline src/catalog/format`

**Not yet run against CelesTrak.** The build environment is not permitted to contact CelesTrak, so
everything below was done with a substitute network. The request address
(`https://celestrak.org/satcat/records.php?GROUP=<group>&FORMAT=CSV`) and the column names were
taken from CelesTrak's documentation and have not been tried. The first scheduled run after this
change is merged is the real test; this entry must be updated with its outcome.

What was read, and when (all on 2026-11-15, through an automated page reader):

| Page                                             | What was taken from it                                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| <https://celestrak.org/satcat/satcat-format.php> | The CSV field names, the object type codes, the form of the `records.php` query                                                |
| <https://celestrak.org/usage-policy.php>         | SATCAT is updated "manually, once or twice a day" and may be downloaded once per update; stop on any reply other than HTTP 200 |

What the tests establish (substitute network; the SATCAT rows are invented and labelled as such):

| Behaviour                                                                                          | Result |
| -------------------------------------------------------------------------------------------------- | ------ |
| SATCAT is requested after the orbital elements, never before                                       | Pass   |
| It is requested at most once in 22 hours while elements are requested at every run                 | Pass   |
| A refused SATCAT request leaves the new orbital elements published and raises an alert             | Pass   |
| After any refused request earlier in the run, SATCAT is not requested at all                       | Pass   |
| A reply that is not SATCAT CSV, or has too few rows, is rejected whole and the old fields kept     | Pass   |
| Rows with an impossible catalog number, malformed code or impossible date are left out and counted | Pass   |
| Codes never seen before are kept as published, not discarded                                       | Pass   |
| SATCAT never adds an object to the catalog or removes one                                          | Pass   |
| Fields survive a write and read of the catalog file, matched to the right objects                  | Pass   |
| A catalog file without the fields, and a reader that ignores them, both still work                 | Pass   |

**Rehearsal over the real published data.** The pipeline command was run once, outside the test
suite, over the real catalog and status file from the `data` branch (generated 2026-11-15T04:02Z),
with a substitute network that answered the four SATCAT requests with invented rows for exactly the
catalog's objects and with the clock set half an hour after the last real run. Result: the four
orbital-element sources were skipped as too recent, the four SATCAT addresses were requested in the
order small to large, the 19,560 records and their sources came out byte-for-byte unchanged, every
object received fields, no alert was raised, and the compressed file grew from 712,076 to 736,285
bytes. The built app loaded that file and showed the fields. The file was discarded; nothing
invented was published. The size figure is only indicative, since real fields will compress
differently.

**First real run (added 2026-11-15).** The scheduled run of 11:17 UTC (GitHub Actions run
43710931763, which started late, at 11:51 UTC) made the first real SATCAT requests. All eight
requests returned HTTP 200 and every row passed the checks:

| Source                      | Rows   | Accepted | Rejected |
| --------------------------- | ------ | -------- | -------- |
| `satcat-iridium-33-debris`  | 657    | 657      | 0        |
| `satcat-cosmos-2251-debris` | 1,715  | 1,715    | 0        |
| `satcat-fengyun-1c-debris`  | 3,532  | 3,532    | 0        |
| `satcat-active`             | 17,426 | 17,426   | 0        |

The SATCAT groups return more rows than the orbital-element groups (for example 657 against 109
for Iridium 33 debris). The extra rows have no orbital elements in the catalog; the likeliest
reason is that SATCAT also lists pieces that have since re-entered, but that was not checked. They
are not added to the catalog, as designed.

Checks on the published file (generated 2026-11-15T11:52:06Z, 19,573 objects, 738,817 bytes
compressed):

| Check                                                                                                                                             | Result                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Objects with no SATCAT fields at all                                                                                                              | 0 of 19,573                                                      |
| Objects with no launch date                                                                                                                       | 0                                                                |
| Launch year in SATCAT against the year in the object's international designator                                                                   | agree for all 19,573                                             |
| Object type codes outside the documented four                                                                                                     | none (PAY 16,893; DEB 2,676; R/B 4)                              |
| Status codes outside the documented eight                                                                                                         | none                                                             |
| Spot check of three launch dates against dates known independently (from memory): ISS (ZARYA) 1998-11-20, HST 1990-04-24, CSS (TIANHE) 2021-04-29 | agree                                                            |
| Live site (build 46b2895) shows the fields for a selected object                                                                                  | yes: ISS (NAUKA), Payload, Operational, CIS, launched 2021-07-21 |

The agreement of launch year and designator year is a real cross-check: the two come from
different CelesTrak data sets (SATCAT and the orbital elements).

**Result: pass.** The request address and column names taken from the documentation were right.

### V3.10 Code tables for the satellite catalog

- **Date:** 2026-11-15
- **What is checked:** the tables in `src/catalog/satcatCodes.ts` that turn SATCAT codes into words.
- **Sources:** object types from <https://celestrak.org/satcat/satcat-format.php>; operational
  statuses from <https://celestrak.org/satcat/status.php> (page dated 2026 Oct 12); 132 owner codes
  from <https://celestrak.org/satcat/sources.php> (page dated 2026 Jan 09).
- **How they were obtained:** each page was read on 2026-11-15 by an automated page reader that
  returned the table as text, and the text was copied into the code. **The owner table has not been
  compared row by row with the page by a person.** A reader of that kind can drop or alter a row
  without any sign of it.
- **Safeguard in the code:** a code missing from a table is displayed as the bare code. A wrong
  name for a code that is present would not be caught.
- **Partial checks made afterwards (2026-11-15):**
  - The page was read a second time and asked only for its number of rows: 132, the number of
    entries in the code's table. So no row was dropped, unless the same mistake was made twice.
  - The first real download (V3.9) uses 99 distinct owner codes. Three of them, `KWT`, `SVK` and
    `JOR` (5 objects in all), are not in the code's table. The second reading confirmed that those
    three are not on CelesTrak's page either, so the table matches its source and the site shows
    those three as bare codes.
- **Result: partly validated.** The row count matches and the gaps are the source's own. Open
  item: the 132 names themselves have still not been compared with the page by a person.

### V3.11 Build and browser checks at the end of Phase 3

- **Date:** 2026-11-15
- **Environment:** as in V1.4 (Node.js 22.23.4, headless Chrome with software rendering). No
  physical device.

| Check                                             | Result                                          |
| ------------------------------------------------- | ----------------------------------------------- |
| Prettier, ESLint (strict, type-aware), TypeScript | Pass, 0 findings                                |
| Unit and validation tests                         | 287 of 287 pass                                 |
| Browser tests, desktop and Pixel 7 emulation      | 46 of 46 pass                                   |
| Initial download (HTML + JS + CSS, gzip level 9)  | 167.2 kB against a 300 kB budget (was 145.5 kB) |
| GitHub Actions, branch `phase-3-interaction`      | Runs 43689021427 and 43690846564: pass          |

The browser tests cover: selecting an object by click and by tap, and clearing the selection three
ways; that a drag does not select; search by name and by number with the keyboard and by pointer,
and that the camera turns to the chosen object; filters by regime, launch year, kind and owner;
and that the page works with and without SATCAT fields. They use the SGP4 verification element
sets with their epochs moved to the present (and, where needed, invented SATCAT fields), which is a
test fixture and not real data.

**Looked at, not tested.** The built page was also opened with the real catalog of
2026-11-15T04:02Z in headless Chrome at 1280 × 800 and at Pixel 7 size, and screenshots of
selection, search and filters were inspected by eye. With the rehearsal file from V3.9 (the same
19,560 objects plus invented fields) all objects were on the globe 1.9 s after navigation (desktop
size, local server).

**Not done:** any real phone or tablet; Firefox, Safari and Edge; a screen reader. The combobox
and the filter buttons follow the WAI-ARIA patterns and are operated by keyboard in the tests, but
no assistive technology was actually used.

## Phase 4

### V4.1 Running the clock fast: wider keyframe spacing

- **Date:** 2026-11-15
- **What is checked:** that the objects are still drawn where SGP4 puts them when the clock runs
  at up to 600 times normal speed. At that speed SGP4 results 5 seconds apart would be needed 120
  times a second, so the spacing between them grows with the speed: 500 ms of real time, kept
  between 5 s and 300 s of simulated time. The comparison is the one in V3.3, repeated at the
  widest spacing, and extended to the speed shown in the object card.
- **Reproduce:** `npm run test -- tests/validation/propagation`

| Keyframe spacing              | Worst position error | Worst error in displayed speed |
| ----------------------------- | -------------------- | ------------------------------ |
| 5 s (normal speed, and 10×)   | 10.2 m               | 0.00015%                       |
| 300 s (600×), orbits e < 0.25 | 596 m                | 0.20%                          |
| 300 s (600×), orbits e ≥ 0.25 | 714 m                | 0.56%                          |

The orbits are the 28 fixture orbits of V3.3 without the extreme case 23333. At 600× a satellite
in low orbit crosses the whole view in a few seconds, and 0.7 km is far below the width of a dot.

**A choice the measurements decided.** Three ways of getting the displayed speed between two
keyframes were compared at 300 s spacing: the slope of the position curve itself (worst error
0.32% already at 5 s, because of the SGP4 velocity mismatch described in V3.3), a straight blend of
the two velocity vectors (1.65% too low, since a chord is shorter than the arc), and the direction
of the curve with the magnitude blended between the two keyframe speeds (0.56%). The last is used.

**Also measured:** with the speed set to 600×, the clock in a headless browser advanced by 600.0
simulated seconds per real second over four seconds.

**Not checked:** how the display behaves at 600× on a phone. The spacing rule means the background
thread does the same work per real second at every speed, but no device was used.

### V4.2 ISS passes against Heavens-Above (launch gate 2)

- **Date:** 2026-11-15
- **Reference:** Heavens-Above (heavens-above.com), page `PassSummary.aspx` for satellite 25544,
  read on 2026-11-15 at about 16:06 UTC in a desktop browser, with the time zone set to UTC and the
  observer's height to 0. For each place two tables were copied: all passes, and visible passes
  only, for 15 to 25 November 2026. The rows are in
  `tests/fixtures/passes/heavens-above-iss-2026-11-15.json` exactly as printed: times to the
  second, altitudes to the degree, directions as one of sixteen compass points.
- **What is compared:** this project's predictor (`src/passes/predict.ts`) given the ISS element
  set from this project's own catalog of that morning (epoch 2026-11-14 22:45:17 UTC, mean motion
  15.49382049 rev/day; `tests/fixtures/passes/iss-elements-2026-11-15.json`). Heavens-Above's page
  gave its own elements as "Epoch: 15 November", so the two calculations did not start from the
  same element set.
- **Places:** Atlanta (33.749° N, 84.388° W), London (51.5074° N, 0.1278° W), Sydney (33.8688° S,
  151.2093° E) and Singapore (1.3521° N, 103.8198° E): two mid-latitudes in opposite hemispheres,
  one near the northern edge of the station's reach, and one on the equator.
- **Reproduce:** `npm run test -- tests/validation/iss-passes`

**Every pass was found, and no extra ones.** 153 passes in the reference, 153 predicted, matched
one for one.

| Place     | Passes | Worst time difference, first 3 days | Worst time difference, all 10 days | Worst altitude difference | Compass points differing |
| --------- | ------ | ----------------------------------- | ---------------------------------- | ------------------------- | ------------------------ |
| Atlanta   | 39     | 1.4 s                               | 4.9 s                              | 0.51°                     | 0 of 117                 |
| London    | 48     | 1.6 s                               | 4.9 s                              | 0.49°                     | 2 of 134                 |
| Sydney    | 42     | 1.5 s                               | 5.0 s                              | 0.51°                     | 0 of 123                 |
| Singapore | 24     | 1.7 s                               | 4.5 s                              | 0.50°                     | 1 of 71                  |

Times are those of the start, highest point and end of each pass, the start and end being where
the station crosses 10° altitude. A difference of up to 0.5 s and 0.5° is the reference's own
rounding. The time difference grows steadily from under 2 s on the first days to about 5 s on the
tenth, which is what two slightly different element sets would do; it was not investigated further.
The three compass points that differ are all within 1.6° of the boundary between two points.
Fourteen points above 85° altitude were left out of the compass comparison, because nearly overhead
a bearing swings through half the compass in seconds and means little. Limits asserted by the test:
3 s in the first three days, 7 s overall, 0.75°, and 2° from a compass boundary.

**Which passes can be seen.** The reference's table of visible passes has 33 rows (Atlanta 1,
London 20, Sydney 12, Singapore 0). All 33 are passes this project also calls visible, and the
start, highest point and end of the visible part agree within 4.6 s and 0.55°. That includes the
passes that begin or end in mid-sky, where the station leaves or enters the Earth's shadow, so the
shadow model (a plain cylinder, see below) is good to a few seconds for this orbit.

This project calls one further pass visible: Atlanta, 16 November, 22:57:36 to 23:01:37 UTC, a low
pass (15°) at dusk during which the Sun sinks from 5.5° to 6.3° below the horizon. It is in the
reference's table of all passes, labelled "visible", but not in its table of visible passes.

**How darkness is judged, and a change made because of this comparison.** The first version
required the Sun to be at least 6° below the horizon at every instant of the visible part. Four
passes fall in twilight with the Sun crossing that line, and on them the two sources disagreed:

| Pass (UTC)           | Sun at start, highest, end | Reference's visible table | First version here       | Present version here |
| -------------------- | -------------------------- | ------------------------- | ------------------------ | -------------------- |
| London 16 Nov 16:46  | −5.97°, −6.31°, −6.65°     | whole pass                | starts 13 s late         | whole pass           |
| Sydney 15 Nov 18:14  | −6.26°, −5.63°, −4.99°     | whole pass, to 78°        | cut off at 23°, climbing | whole pass           |
| Atlanta 16 Nov 22:57 | −5.47°, −5.86°, −6.25°     | absent                    | last 77 s only           | whole pass           |
| Sydney 17 Nov 18:15  | −5.75°, −5.18°, −4.60°     | absent                    | daylight                 | daylight             |

Cutting a pass at the instant the Sun passes −6° reports a satellite vanishing in mid-sky, which
nobody would see: twilight changes slowly and the station is bright. The predictor now judges
darkness once for each sunlit stretch: if the Sun is 6° down or more at any moment of it, the whole
stretch is reported. That agrees with the reference on three of the four, and on the fourth
(Atlanta) differs as described above. The reference's tables are consistent with its testing the
Sun near the start of the pass against about −6°, but that is an inference from four rows, not
something read in its documentation. (My working notes from earlier in the session say
Heavens-Above states a −6° condition; the page was not re-read when this entry was written.)

**The "pass type" column of the all-passes table means something slightly different.** On 9 of the
153 passes the label there differs from this project's. On 8 of them (London 16, 18, 20, 22 and
24 November near 20:00 UTC; Sydney 18, 21 and 24 November) the reference says "visible" and this
project says the station is in shadow. In each, the station is sunlit only while lower than 10°
(the highest sunlit point is between 1.9° and 8.2° up) and has entered the shadow before reaching
the part of the sky a pass is counted in. Checked the other way round: on all 45 passes the
reference labels "night (unlit)", the station is never sunlit above the horizon at all. So that
column appears to say whether the station is lit anywhere above the horizon, and this project asks
whether it is lit above 10°. None of the 8 is in the reference's own visible table. The ninth is
Sydney 17 November, in the table above.

**Result: pass.** The gate asks for agreement at three or more places within a reasonable
tolerance; four places agree within 5 s over ten days and within 2 s over the first three.

**What this does and does not show.**

- It shows that the chain from element set to "look north-west at 6:47 pm" is implemented
  correctly: SGP4, sidereal time, the observer's frame on the ellipsoid, the search for rise, peak
  and set, the Sun's position and the shadow test.
- It does not show how close either source is to the real station. Both run the same model on
  nearly the same published elements. Nobody has yet stood outside and timed a pass against this
  site; that is the check that would.
- Only the ISS was compared. Tiangong and the other satellites go through the same code, but no
  reference table was fetched for them.
- The Sun's elevation comes from the low-precision formula validated in V3.1. Atmospheric
  refraction is ignored, for the Sun and for the satellite.
- The Earth's shadow is a cylinder of the equatorial radius. The real shadow's partly-lit fringe at
  the station's height is about 22 km across (the Sun's 0.53° disc seen from about 2,350 km behind
  the Earth's edge: my arithmetic, not a cited figure), which the station crosses in a few seconds.

### V4.3 The list of places, and the passes panel

- **Date:** 2026-11-15
- **Source of the place list:** the GeoNames gazetteer, file `cities15000` (populated places of
  15,000 people or more), licensed CC BY 4.0, taken from the copy bundled in the npm package
  `cities-15000-structured` 1.0.1, whose newest record is dated 2023-03-05. The licence statement
  was read in that package's README, not on geonames.org. `scripts/build-places.mjs` turns it into
  `public/places.txt`.
- **Reproduce:** `npm run test -- tests/passes src/passes`

| Check                                                                                                         | Result                                    |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Places in the file; all parse                                                                                 | 26,435 of 26,435                          |
| Time zones named in the file; all known to the JavaScript engine (Node.js 22)                                 | 357 of 357                                |
| Atlanta, London, Sydney, Singapore found first under their names, within 0.1° of the coordinates used in V4.2 | 4 of 4                                    |
| File size                                                                                                     | 738,077 bytes; 369,957 after gzip         |
| Spot check of the column layout: the row for Atlanta                                                          | 33.749, −84.388, US, GA, America/New_York |

The file is downloaded only when the viewer starts typing a place, and is not part of the first
download. A browser test confirms that choosing a city causes no request other than that file, to
this site itself, and that nothing typed appears in any address requested.

**The panel, with real data.** The built page was opened in headless Chrome with the real catalog
of 2026-11-15T11:52Z. For London it listed the ISS pass of 16 November as 4:46:44 PM to 4:51:26 PM
local time, the same seconds as the reference row in V4.2 (16:46:44 to 16:51:26 UTC); for Atlanta
(typed as coordinates) the 44-second pass of 15 November at 6:47:19 PM, also as in the reference.
Tiangong appeared in both lists. Working out five days of passes for the two stations was
immediate; for 149 further low-orbit objects (a stand-in for the bright list, see V4.4) it took
1.8 s in that software-rendered browser, in batches of 8 so that the dots keep moving.

**From memory, not checked:** the sentence shown when no visible pass is found, that a station's
visible passes "come in runs, with gaps of days or weeks between". The reference tables are
consistent with it (Atlanta has 1 visible pass in ten days, London 20), but the statement itself is
general knowledge.

### V4.4 CelesTrak's list of the brightest objects

- **Date:** 2026-11-15
- **What was checked:** the name of the group. CelesTrak's current-data page
  (https://celestrak.org/NORAD/elements/) lists "100 (or so) Brightest" with `GROUP=visual`; read
  on 2026-11-15 through an automated page reader, which reported the link text and the group value.
- **Status of the download itself: not yet run.** The group was added to the pipeline in this
  phase and the build environment may not contact CelesTrak. Until the first scheduled run after
  the merge, the published catalog has no such group and the site offers passes for the two space
  stations only. The first run is the test of: the request being accepted, how many objects the
  group holds, and how many of them were not already in the catalog.

The list of other satellites in the panel was tried with a local stand-in: the real catalog with
149 low-orbit objects marked as if they were in the group. That file was never published.

### V4.5 Build and browser checks at the end of Phase 4

- **Date:** 2026-11-15
- **Environment:** as in V1.4 (Node.js 22.23.4, headless Chrome with software rendering). No
  physical device.

| Check                                             | Result                                          |
| ------------------------------------------------- | ----------------------------------------------- |
| Prettier, ESLint (strict, type-aware), TypeScript | Pass, 0 findings                                |
| Unit and validation tests                         | 388 of 388 pass                                 |
| Browser tests, desktop and Pixel 7 emulation      | 72 of 72 pass                                   |
| Initial download (HTML + JS + CSS, gzip level 9)  | 175.6 kB against a 300 kB budget (was 167.2 kB) |

The 26 new browser tests cover: pausing, resuming, the four speeds, the slider by pointer and by
keyboard, stopping at the three-day limit and returning to the present; and for passes, asking for
a place before listing anything, finding a city by name, typed coordinates, the device's position
when allowed and when refused, remembering and forgetting the place, the contents of a row, paging,
the two options, and showing a pass in the 3D view. The pass tests use fixture orbits listed under
a pretend bright group; they test that the page works, not that the times are right (V4.2 does
that).

**Not done:** any real phone or tablet; Firefox, Safari and Edge; a screen reader; the browser's
real permission prompt for location (the tests grant or withhold permission directly).

**The deployed site.** GitHub Actions: CI runs 43758976976 and 43759793769 on the branch passed;
Deploy run 43760184090 on `main` passed. The live page was then opened in Chromium 156 on the
owner's PC at about 20:57 UTC and reported build `62b8325` with 19,572 objects. Given Atlanta as typed
coordinates (33.749, −84.388), the panel listed six visible passes of the two stations in five
days, the first two being the ISS at 6:47:19 PM to 6:48:02 PM EST on 15 November (10° NNW) and at
5:57:36 PM to 6:01:37 PM on 16 November (15° NNW): the same seconds as the reference rows in V4.2
(23:47:19 to 23:48:03, and 22:57:36 to 23:01:37 UTC), apart from one second on one end time. The
test location was erased from the browser afterwards. The option for other bright satellites was
absent, as expected before the group's first download (V4.4).
