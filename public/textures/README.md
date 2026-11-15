# Earth imagery

REAL DATA. Both images are NASA products. NASA does not claim copyright on them; it asks to be
credited.

| File              | What it is                                                                                                                                                                         | Changes made                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `earth-day.jpg`   | Blue Marble Next Generation with topography and bathymetry, May 2004, 2048 × 1024. A cloud-free composite of the Earth in daylight. Credit: NASA Earth Observatory (Reto Stöckli). | None. Byte-identical to the source file.                                                                               |
| `earth-night.jpg` | Black Marble 2012 ("Earth at Night"), 2048 × 1024. A composite of night-time lights. Credit: NASA Earth Observatory / NOAA NGDC (Suomi NPP VIIRS data).                            | Converted from PNG to JPEG (quality 82) to reduce it from 1.5 MB to 0.18 MB. The image content is otherwise unaltered. |

## Where these copies came from

NASA's own servers could not be reached from the environment this phase was built in. The files
were taken on 2026-11-14 from NASA's WebWorldWind repository on GitHub
(<https://github.com/NASAWorldWind/WebWorldWind>, commit `5ffe2dfc54ab4d744fc9e587af9639c9910db228`):

- `images/BMNG_world.topo.bathy.200405.3.2048x1024.jpg`
  (SHA-256 `7405c39a220bc37519474eba54625a0d1a02b6ad954895147c103a1bc8dd61fb`)
- `images/dnb_land_ocean_ice_2012.png`
  (SHA-256 `c1893c1a97634f9d9dc45a62f83916c77cae742d5128551f8d7c4e4f5296ed36`)

The product names above are inferred from those file names, which match NASA's naming for the two
products. **Open item:** the credit lines should be checked against NASA's own pages for these
images before launch.

## Limits worth knowing

- Resolution is about 20 km per pixel at the equator, so the picture is soft when zoomed in close.
- The daytime image shows one month (May 2004) with no clouds. Snow and vegetation do not follow the
  seasons.
- The projection is equirectangular: 180° W at the left edge, Greenwich in the centre, north at the
  top. `tests/validation/earth-texture-mapping.test.ts` checks that this lands correctly on the globe.
