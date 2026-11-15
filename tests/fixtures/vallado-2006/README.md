# SGP4 verification data (Vallado et al., 2006)

REAL DATA. These two files are the published verification set for the SGP4 orbit propagator:

- `SGP4-VER.TLE`: 33 element sets chosen to exercise every branch of the algorithm (near-Earth,
  deep-space, resonant, low-perigee, decaying, and deliberately invalid orbits). After each second
  line come three extra numbers: start time, stop time and step, in minutes from the element epoch.
- `tcppver.out`: the position (km) and velocity (km/s) the reference C++ implementation produced for
  each element set at each of those times, in the TEME frame. 667 states in total.

They accompany:

> Vallado, D. A., Crawford, P., Hujsak, R., and Kelso, T. S., "Revisiting Spacetrack Report #3,"
> AIAA/AAS Astrodynamics Specialist Conference, Keystone, CO, 2006, paper AIAA 2006-6753.

The authors distribute the paper, code and these files at
<https://celestrak.org/publications/AIAA/2006-6753/>.

## Where these copies came from

They were **not** downloaded from CelesTrak, which could not be reached from the environment this
phase was built in. They were extracted, unmodified, on 2026-11-14 from the source distribution of
the `sgp4` Python package, version 2.27, on PyPI (`sgp4-2.27.tar.gz`, files `sgp4/SGP4-VER.TLE` and
`sgp4/tcppver.out`). That package is Brandon Rhodes's wrapper around the same reference code.

| File           | SHA-256                                                            |
| -------------- | ------------------------------------------------------------------ |
| `SGP4-VER.TLE` | `d246d1d9d768ace445a38a965713fa9ba52d80fd8a41a0502ff83d7acffe2881` |
| `tcppver.out`  | `687bf28dbe52df86e8e60ab5cb4a08d1aa3dbcaf4e63b1f7ab95f044fbe3833b` |

**Open item:** these copies have not been compared byte-for-byte with the files in the authors' own
archive on CelesTrak. Anyone with normal internet access can close this by downloading the archive
from the address above and comparing checksums.

Do not edit these files. `tests/validation/sgp4-vallado.test.ts` reads them as they are.
