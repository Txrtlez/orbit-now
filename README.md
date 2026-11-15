# Orbit Now

A live 3D tracker of the publicly tracked objects in Earth orbit, with an illustrative
debris-cascade ("Kessler syndrome") simulator.

**Live site:** <https://txrtlez.github.io/orbit-now/>

**Status: Phases 1 to 4 are done.** The site shows the Earth with its real day and night sides and
about 19,500 objects moving in real time. Click or tap an object to see what it is, where it is
and the path of its orbit; search by name or number; filter by constellation, orbit, launch year,
kind and owner. The clock can be paused, run at up to 600 times normal speed, or moved three days
either way. Give a place (your device's position, a city, or coordinates) and the site lists the
passes of the space stations and other bright satellites over it for the next five days, and
which of them can be seen. The data covers active satellites, three debris clouds and CelesTrak's
list of the brightest objects, not every tracked object (see "Data source"). What is still
unproven is listed first under "Known issues".

| Phase | Scope                                                                     | State                                                                                                                        |
| ----- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1     | Repository structure, tooling, CI, deploy pipeline, empty app             | Done                                                                                                                         |
| 2     | Scheduled OMM data pipeline; SGP4 validated against published vectors     | Done, with one documented exception in the SGP4 gate                                                                         |
| 3     | Earth rendering, all objects moving, picking, info panel, filters, search | Done. Frame rate measured by the owner at 240 fps (PC) and 60 fps (phone), before the interaction features were added        |
| 4     | Overhead passes with visibility; time controls                            | Done. ISS passes agree with Heavens-Above at four places (launch gate 2). The bright-objects group awaits its first download |
| 5     | Historical debris layers; growth-of-orbit chart                           | Not started                                                                                                                  |
| 6     | "What if?" mode: breakup model, propagation, reentry, cascade statistics  | Not started                                                                                                                  |
| 7     | Guided tour, shareable links, About page, accessibility, launch           | Not started                                                                                                                  |

## Run it

Requires Node.js 22.13 or newer (the version is pinned in `.nvmrc`).

```bash
npm ci            # install exactly the locked dependency versions
npm run dev       # development server with hot reload, http://localhost:5173
```

## Check it

```bash
npm run check     # formatting, lint, type-check, unit tests, production build, size budget
npm run e2e       # builds, serves the production build, runs the browser smoke tests
```

`npm run e2e` needs a Chromium browser. Either let Playwright download one
(`npx playwright install chromium`), or point it at one you already have:

```bash
PW_CHROMIUM_PATH=/path/to/chrome npm run e2e
```

Individual commands:

| Command                | What it does                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| `npm run format:check` | Fails if any file is not formatted the way Prettier would format it                             |
| `npm run lint`         | ESLint with typescript-eslint's strict, type-aware rule sets                                    |
| `npm run typecheck`    | TypeScript in strict mode, three projects: app, tooling, end-to-end tests                       |
| `npm run test`         | Vitest unit tests (all physics and geometry code has them)                                      |
| `npm run build`        | Production build into `dist/`                                                                   |
| `npm run size`         | Fails if the gzip-compressed initial download exceeds 300 kB                                    |
| `npm run preview`      | Serves `dist/` at http://localhost:4173                                                         |
| `npm run data:update`  | Runs the data pipeline. **Makes real requests to CelesTrak; do not run it by hand** (see below) |

## Deploy it

Deployment is automatic: every push to `main` runs the full CI workflow and, only if it passes,
publishes `dist/` to GitHub Pages (`.github/workflows/deploy.yml`).

One-time setup for a new repository:

1. Push this project to a GitHub repository, with `main` as the default branch.
2. In the repository, open **Settings → Pages → Build and deployment** and set **Source** to
   **GitHub Actions**.
3. Push to `main` (or run the "Deploy" workflow by hand from the Actions tab).

The site is then served at `https://<owner>.github.io/<repository>/`. The footer of the page shows
the commit it was built from, so a deployed copy can always be matched to its source.

GitHub Pages on a free account requires the repository to be public.

## Reproduce the validations

Every comparison against an outside reference is recorded in [`VALIDATION.md`](./VALIDATION.md),
with numbers, dates and the command that reproduces it. Of the four launch gates, the SGP4 test
vectors pass with one documented exception and the ISS passes agree with Heavens-Above at four
places; the other two (breakup-model curves, J2 nodal precession) belong to Phase 6 and are listed
there as not yet run.

The validation tests assert limits; the numbers actually measured are written to a file when asked:

```bash
VALIDATION_LOG=/tmp/measurements.txt npm run test -- tests/validation
```

## Repository layout

```
index.html                 Page shell: canvas, mode tabs, search field, cards
src/
  main.ts                  Start-up: wires the globe, the data and the interface together
  styles.css               All styling
  app/                     Interface code that is not 3D: selection, the object card, search,
                           filters, the clock and time bar, the passes panel, number
                           formatting, tabs
  geo/                     Earth geometry: WGS 84 constants, coordinate conversions both ways,
                           where something appears in an observer's sky
  passes/                  Pass prediction and visibility, which satellites to predict for,
                           finding a place by name or coordinates, keeping the viewer's place
  orbit/                   Time and frames, SGP4 for many objects, orbit regimes and orbit-path
                           sampling, the background worker
  render/                  three.js scene: Earth, sunlight, the object layer, the orbit line and
                           selection ring, picking, camera framing
  catalog/                 The catalog file format (shared with the pipeline), its loader, object
                           categories, satellite-catalog code tables, the per-object index
  modes/whatif/            "What if?" mode, loaded on demand as a separate file
pipeline/                  Data pipeline: download, check, merge, publish (runs in GitHub Actions)
tests/validation/          Launch-gate validations against published reference data
tests/pipeline/            Pipeline tests; the network is always substituted, never contacted
tests/fixtures/            The reference data itself, with provenance notes
e2e/                       Playwright browser tests, run against the production build
tests/passes/              Checks on the published list of places
public/places.txt          Cities for the passes panel (GeoNames), downloaded on demand
scripts/                   Build-time checks (bundle size budget); how the list of places was made
.github/workflows/         CI and GitHub Pages deployment
VALIDATION.md              Record of every check against an outside reference
```

Unit tests sit next to the code they test (`foo.ts` and `foo.test.ts`).

Three labels are used in code comments, and will be used in the interface, to keep different kinds
of content apart:

- **Real data**: measured or defined values taken from a named source.
- **Standard model**: an established physical or mathematical model, implemented as published.
- **Simplification**: something this project approximates, with the approximation stated.

## Architecture decisions

### 1. Renderer: three.js, not CesiumJS

**Decision.** three.js (0.187), drawing with WebGL2.

**What was measured (2026-11-14).**

| Quantity                                    | three.js                            | CesiumJS 1.147                                                    |
| ------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------- |
| JavaScript for first paint, gzip level 9    | 135.9 kB (this app's actual bundle) | 1 335 kB (`Build/Cesium/index.js`, the complete prebuilt library) |
| Additional static files that must be hosted | none                                | `Workers/` 1.2 MB and `Assets/` 4.7 MB on disk                    |

The CesiumJS figure is an upper bound. An application that imports only what it uses from
`@cesium/engine` ships less than the complete library, and that smaller figure was not measured.
The comparison is therefore "at least several times larger", not "exactly ten times larger".

**Reasoning.**

1. _Load time._ The targets are a first load under 3 seconds and a small initial download. The
   measured three.js bundle uses under half of this project's 300 kB budget before any data is
   loaded, which leaves room for the catalog itself.
2. _Control of the hot path._ The plan for 30 000+ moving objects is one draw call, with positions
   interpolated between propagation samples inside the vertex shader. three.js exposes shaders and
   vertex buffers directly, so this is ordinary use. CesiumJS's point primitives are designed to be
   updated from JavaScript on the main thread, and doing the same thing there means working
   against the library through its custom-primitive interfaces.
3. _What CesiumJS would have provided._ Streaming terrain and imagery, a time-dynamic entity
   system, and built-in reference-frame transformations. This project needs one global Earth
   texture, has its own data pipeline, and must validate its frame transformations against published
   values regardless of which library performs them. The built-in features would be paid for in
   download size and largely unused.

**What this costs.** Frame conversions (TEME to Earth-fixed to topocentric), sidereal time, the
Sun's position and the Earth shader all have to be written and tested in this repository instead of
being inherited. That work is scheduled for Phases 2 to 4 and each piece gets a validation entry.

**Measured since (2026-11-15).** The decisive question in the brief was frame rate with tens of
thousands of points on a phone. With 19,559 objects the owner measured 240 fps on a desktop PC and
60 fps on a phone (VALIDATION.md, V3.5), against targets of 60 and 30. The decision stands. Two
cautions: the catalog holds about 19,500 objects, not the 30,000+ the brief names, and the phone's
model was not recorded, so "mid-range" is not established.

**WebGPU.** The brief asks for WebGL2 "with WebGPU where available". The site uses WebGL2 only.
three.js's WebGPU renderer uses a different shader language from its WebGL renderer, so supporting
both means writing and testing every custom shader twice. WebGL2 alone meets the frame-rate targets
with a wide margin, so that cost buys nothing at present and WebGPU is not planned. This is a
deviation from the brief's default and is flagged as such; it would be revisited if a much larger
catalog (see "Data source") changed the measurements.

### 2. Relative base path, and no path-based routing

`vite.config.ts` sets `base: './'`. The same build then works at
`https://<owner>.github.io/<repository>/` and at the root of a custom domain, with no rebuild and no
repository name hard-coded anywhere. The consequence is that the app cannot use URL paths such as
`/object/25544` for navigation, because a static host has no server to route them. Shareable view
state (Phase 7) will be encoded in the query string instead.

### 3. Scene units and axes

One scene unit is the WGS 84 equatorial radius, 6378.137 km, and the Earth-fixed z axis (north) is
mapped to three.js's y axis (up) by a rotation. Earth radii are used because GPU floats carry only
about seven significant digits, so kilometre-scale coordinates out to geostationary distance would
lose precision. The mapping is a rotation and not an axis swap because a swap mirrors the scene and
would make every orbit run backwards. Both points are explained and tested in
`src/geo/sceneFrame.ts`.

### 4. TypeScript 6.0, not 7.0

TypeScript 7.0.2 is the current release, but typescript-eslint 8.72 (the linter's type-aware rules)
declares support only for TypeScript below 6.1. The project pins TypeScript 6.0.3 so that strict
type-aware linting works. Revisit when typescript-eslint supports 7.

### 5. Tests run against the production build

The browser tests start `vite preview` on the built `dist/` directory, not the development server.
Bundling problems (wrong asset paths under a sub-directory, a lazy chunk that fails to load) only
exist in the built output, so that is what is tested.

### 6. An enforced size budget

`npm run size` fails the build if the HTML, JavaScript and CSS needed for first paint exceed 300 kB
after gzip. The number was chosen in Phase 1 to leave headroom above the 138.0 kB of the time. At
the end of Phase 3 the figure is 167.2 kB; the catalog (about 0.7 MB) is fetched after the page has
started and is not counted.

### 7. System fonts

The interface uses the operating system's own font. This avoids a font download, a request to a
third party, and text shifting when a web font arrives. A self-hosted typeface can be reconsidered
in Phase 7 if the design calls for one.

### 8. Data lives on a single-commit `data` branch

The catalog is about 0.7 MB and changes three times a day. Committing it to `main` would add
roughly 2 MB of permanent history daily. Instead the pipeline force-pushes one commit to a `data`
branch, and the deploy workflow copies that branch's files into the built site. The repository's
history stays small, the source code and the data stay separate, and the site remains purely
static. The cost is that old catalogs are not kept.

### 9. Catalog format: column-wise JSON, gzip-compressed, numbers untouched

Each field is stored as one array across all objects, the file is gzip-compressed by the pipeline,
and the browser decompresses it with the built-in `DecompressionStream`. Numbers are stored exactly
as published; nothing is rounded or rescaled, and a test asserts that every value survives the round
trip bit for bit. Five OMM fields that SGP4 does not read are dropped (the two mean-motion
derivatives, the element-set number, the revolution number and the classification); the validation
suite shows that propagation from the reduced record still reproduces the published reference
states. A more compact binary encoding was considered and deferred: it would save perhaps a few
hundred kilobytes at the cost of a format that is harder to inspect, and that trade is better judged
in Phase 3 with real loading times.

### 10. Three downloads a day, not twelve

CelesTrak refreshes every 2 hours, but its documentation notes that the underlying Space Force data
changes only two or three times a day and asks users to download only what they need. Three runs a
day keeps the typical element set under a day old (measured: median 0.86 days on the first run)
while using about a quarter of the permitted request rate.

### 11. The scene is inertial; the Earth turns inside it

The 3D scene uses the frame SGP4 reports in (TEME), which does not rotate with the Earth. Objects
are placed in it directly, and the Earth is turned about its axis by the sidereal angle each frame.
The alternative, an Earth-fixed scene with every object rotated into it, was rejected because in an
inertial frame an orbit is a closed ellipse, which is what a viewer expects to see when orbit paths
are drawn, whereas in an Earth-fixed frame it is an open spiral.

### 12. SGP4 every 5 seconds, interpolation on the GPU in between

A background thread runs SGP4 for every object once every 5 seconds and hands over positions and
velocities. The vertex shader places each object on the cubic curve through its two most recent
results. The main thread therefore does almost no per-object work per frame, and all objects are one
draw call. The measured cost in accuracy is about 10 m (VALIDATION.md, V3.3). satellite.js also
ships a WebAssembly bulk propagator; it was not used, because the plain JavaScript path takes well
under a second per 5 second cycle and adds nothing to the download.

### 13. Module workers

Workers are built as JavaScript modules (`worker.format: 'es'`). Every current browser supports
them; very old ones (Safari before 15, Firefox before 114) do not.

### 14. Picking is arithmetic on the main thread, not a read-back from the graphics card

To find the object under the pointer, the page recomputes every object's position with the same
formula the vertex shader uses, projects each to the screen, and takes the nearest within a few
pixels that the Earth does not hide (`src/render/picking.ts`). The usual alternative, drawing each
object in a unique colour to a hidden image and reading the pixel back, was rejected: with 20,000
objects the arithmetic takes well under a millisecond, it behaves identically on every device, it
needs no second set of shaders, and it can be unit-tested without a browser. The pick radius
depends on the pointer: 9 pixels for a mouse, 22 for a fingertip.

### 15. One byte per object decides how it is drawn

Filtering and highlighting never touch the position data. Each object has a display state (hidden,
dimmed, normal, emphasised) in one array of bytes that is rewritten when a filter or the selection
changes. The objects are drawn in two passes over the same buffers, dimmed ones first, so that a
dimmed dot can never cover a bright one whatever the order of the catalog. The cost is a second
draw call. Objects related to the selection are shown by dimming everything else, not by enlarging
them: enlarging 11,000 Starlink satellites turned the picture into a solid mass.

### 16. The orbit line: SGP4 positions, evenly spaced around the ellipse

The path of a selected object is one revolution of SGP4 positions computed in the background
thread, centred on the present so that the small gap where an orbit fails to close falls on the
far side from the object. The sample times are spaced evenly in eccentric anomaly, not in time,
which puts points where an eccentric orbit curves most (VALIDATION.md, V3.6). It is drawn with
three.js's wide-line add-on, because plain WebGL lines are always one device pixel wide, a hairline
on a phone. The initial download grew by about 14 kB when selection was added; how much of that
is the add-on was not measured separately.

The line is the orbit in the inertial frame, which is why it is a closed loop (decision 11). It is
not the ground track, and the Earth turns underneath it.

### 17. Constellations are recognised by name

Membership of Starlink, OneWeb, GPS and the rest is decided from the published object name
(`src/catalog/categories.ts`). CelesTrak does maintain a group for each, and downloading those
would be authoritative, but every one is a subset of the `active` group already downloaded, and
CelesTrak asks users to download only what they need. The price is that the rule is a heuristic:
see VALIDATION.md, V3.7, for what it matched and what it cannot know. Membership of the three
debris clouds is not a heuristic; it comes from which CelesTrak group listed the object.

### 18. Cards, and sheets on a phone

The interface is a set of cards floating over the globe. On a wide screen the overview sits at the
bottom left and the selected object's details at the right. On a narrow one both become sheets
across the bottom, at most 46% of the screen high, and the object's details replace the overview
while something is selected. The globe is told how much of the screen the search field and the
open sheet cover and re-centres the Earth in what is left, by shifting the camera's window, so a
sheet never hides half the planet. The overview starts folded on a phone.

### 19. Satellite-catalog fields ride in the same file, as an optional section

Kind, status, owner and launch date come from a different CelesTrak data set (SATCAT) on a
different schedule. They are stored in the catalog file as an optional `metadata` section, one
entry per object. The file's version number was not raised: a reader that predates the section
ignores it, and the app works with or without it, which matters because the deployed site always
has to cope with whatever the last data run produced. Putting the fields in a second file was
considered and rejected as one more request and one more way for two files to disagree.

SATCAT is requested group by group (`records.php?GROUP=...`), not as CelesTrak's complete catalog
file: the complete file is several times larger and consists mostly of objects that decayed long
ago, and the usage policy asks for only the data that is needed.

### 20. One clock, and keyframes that spread out as it runs faster

Everything that depends on time (object positions, the Earth's rotation, the Sun, the readouts)
asks one clock, `src/app/clock.ts`, which is the real time unless the viewer pauses it, changes
its speed (1, 10, 60 or 600 times) or moves it, by up to three days either way. Three days because
positions come from today's elements, and the further from their date, the worse they are.

Decision 12 has SGP4 run every 5 simulated seconds. At 600× that would be 120 runs a second, so
the spacing grows with the speed: one keyframe per half second of real time, between 5 s and 300 s
of simulated time. The cost at the widest spacing is about 0.7 km of position, far less than a
dot's width at any zoom (VALIDATION.md, V4.1). A jump in time redraws from fresh keyframes without
blanking the dots.

### 21. What counts as a pass, and as a visible one

A pass is counted while the satellite is at least 10° above the observer's horizon, the convention
of the reference tables it was validated against. It is called visible if, during some part of it,
the satellite is in sunlight and the observer's sky is dark, taken as the Sun 6° or more below the
horizon (the end of civil twilight). Darkness is judged once for each sunlit stretch of a pass,
not instant by instant, after the comparison with Heavens-Above showed that the stricter rule cut
passes off in mid-sky at dusk and dawn (VALIDATION.md, V4.2). The Earth's shadow is a cylinder.
Nothing is said about how bright a satellite will look: that needs each object's size and
reflectivity, which the data does not include.

Rise, set and shadow times are found by sampling SGP4 positions (every 30 s, coarser when the
satellite is far below the horizon) and halving the interval around each change down to 50 ms.
Predictions run in the background thread, a few satellites per request, so the dots keep moving.

### 22. The viewer's place stays in the browser

There is no server, so there is nowhere for a location to go. The place comes from the device
(with the browser's permission), from a city chosen in a list, or from typed coordinates. It is
rounded to a hundredth of a degree, about a kilometre, which moves a pass by under a second, and
kept in the browser's local storage so that it need not be given again; "Change place" erases it.

The city list is a file on this site (26,435 places from GeoNames, 370 kB compressed), downloaded
only when the viewer starts typing and searched in the browser. The alternative, a geocoding
service, would have sent what the viewer types to a third party. The list gives each city's time
zone, so pass times for a city are in that city's time; for the device's position or typed
coordinates they are in the device's time zone, and the panel says which.

### 23. Which satellites get pass predictions

Predicting passes for 19,500 objects would produce thousands of rows a day, nearly all of things
too faint to see. Two sets are used: the two space stations, found by catalog number (25544 and
48274, each standing for all of its station's modules), and the objects in CelesTrak's group
"visual", its list of the hundred or so brightest. The second set is off until asked for, because
it makes a long list. Adding that group also brings into the catalog some spent rocket stages and
dead satellites that the "active" group leaves out.

## Data source

**What the site shows.** Orbital data comes from [CelesTrak](https://celestrak.org), which
republishes the US Space Force's general-perturbations (GP) element sets. Four of CelesTrak's
groups are used for the bulk of it:

| CelesTrak group      | Objects on 2026-11-15 |
| -------------------- | --------------------- |
| `active`             | 16,881                |
| `fengyun-1c-debris`  | 1,988                 |
| `cosmos-2251-debris` | 581                   |
| `iridium-33-debris`  | 109                   |
| **Total**            | **19,559**            |

A fifth group, `visual` (CelesTrak's "100 (or so) Brightest"), was added on 2026-11-15 for the
pass predictions. It had not yet been downloaded when this was written, so its size, and how many
of its objects the other groups do not already include, are not known (VALIDATION.md, V4.4).

**What each object is.** Kind (payload, rocket body, debris), operational status, owner and launch
date come from CelesTrak's satellite catalog, SATCAT, requested once a day for the same
groups. The first download, on 2026-11-15, covered every object in the catalog. An object
catalogued since the last download has no such fields until the next one; for it the site derives
the launch year from the international designator and shows nothing for the rest.

**What it does not show.** This is not the full public catalog. The brief asked for every publicly
tracked object, and that turned out not to be available from CelesTrak in one query: its GP data is
served in named groups, none of which covers all rocket bodies, inactive satellites and debris, and
its documentation asks users not to download all the groups. There is also no group for Cosmos 1408
debris, which affects the historical layers planned for Phase 5. The app states the limitation next
to the object count.

**Why this choice, and how to change it.** The alternatives were Space-Track.org (the full
catalog, but it needs an account, and whether its user agreement allows republishing the data on a
public website has not been checked) and asking CelesTrak for a special arrangement. The CelesTrak
groups were chosen because they work today without an account and within CelesTrak's published
rules. The choice is not locked in: sources are a list in `pipeline/sources.ts`, and the catalog
format records which source each object came from.

## Data pipeline

`.github/workflows/data.yml` runs at 03:17, 11:17 and 19:17 UTC. Each run:

1. reads the currently published data from the `data` branch;
2. requests each group's orbital elements once from CelesTrak as OMM CSV, smallest group first
   (except the bright-objects group, the newest, which is asked for last);
3. if at least 22 hours have passed since it last asked, requests the satellite-catalog records
   for the same groups, also as CSV;
4. checks every row (see `pipeline/omm.ts` and `pipeline/satcat.ts` for the rules) and each
   download as a whole;
5. merges what passed into the catalog, keeping the previous data for anything that was not
   refreshed;
6. writes `catalog.json.gz` and `status.json` to the `data` branch and redeploys the site.

**Rules it follows.** CelesTrak's [usage policy](http://celestrak.org/usage-policy.php) allows one
download of each data set per update (every 2 hours for GP data) and tells automated clients to
stop on any response other than HTTP 200. The satellite catalog is updated by hand once or twice
a day, with the same once-per-update rule. Accordingly the pipeline never requests orbital
elements it requested less than 2 hours 5 minutes earlier or catalog records it requested less
than 22 hours earlier, never retries, never follows redirects, and stops the run at the first
non-200 response. Orbital elements are requested first, so a refusal of the catalog records cannot
hold them back. The 2-hour rule is enforced in code, so pressing "Run
workflow" by hand is safe: a run that comes too soon makes no requests at all.

**Do not run `npm run data:update` on your own computer** unless you mean to. It would spend your
home IP address's allowance for those groups for the next two hours, and repeated mistakes can get
an address blocked. Use `npm run test`, which never touches the network.

**When a run is marked failed.** Only when something needs a person: a request failed for a
reason other than CelesTrak's routine "not updated yet" reply, a download was rejected by the
checks, or a group has gone more than 48 hours without a successful refresh. The run's summary
page says which. A routine refusal alone does not fail the run, because GitHub's runners share IP
addresses with other users and can be refused through no fault of this project.

**Looking at the data.** `git fetch origin data && git show FETCH_HEAD:status.json` prints the
pipeline's own record of the last request to each group, including how many rows were left out
and why.

## Known issues

Unproven parts of Phases 3 and 4, most important first:

- **The bright-objects group has not been downloaded yet.** It was added to the pipeline in Phase
  4; the first scheduled run after the merge is its first test (VALIDATION.md, V4.4). Until then
  the passes panel offers the two space stations only. If CelesTrak refuses that one request, the
  other groups will already have been refreshed in the same run, and the run will be marked failed.
- **No predicted pass has been checked against the sky.** The predictions agree with Heavens-Above
  to a few seconds, but both use the same model and nearly the same elements. Watching one pass of
  the ISS with a clock in hand would be the first real-world check of this site.
- **Only the ISS was compared with a reference.** Tiangong and the other satellites use the same
  code but were not compared with anything.
- **Frame rate has not been measured since the interaction features were added.** The 240 fps and
  60 fps figures were taken on the build before selection, search, filters, time controls and
  passes existed. Add `?stats` to the page address to measure again; the phone's model would make
  the figure meaningful. Running at 600× has not been tried on a phone at all.
- **The Heavens-Above tables are kept in the repository as test data** (186 rows, with the source
  named). Its terms of use were not read. If that is a concern, delete
  `tests/fixtures/passes/heavens-above-iss-2026-11-15.json` and the test that reads it; the record
  of the comparison in VALIDATION.md stands on its own.
- **The owner names were transcribed by an automated page reader** and not checked name by name
  against CelesTrak's list; the number of rows matches (VALIDATION.md, V3.10). Three owner codes in
  the data (`KWT`, `SVK`, `JOR`) are not on CelesTrak's list and are shown as bare codes.
- **Dots are coloured by the CelesTrak group they came from, not by kind of object.** The brief asks
  for colour by object type. With the present data the two nearly coincide (the active list is
  payloads; the three debris groups are debris), and the group colours also tell the three debris
  clouds apart, so the colouring was left as it is. Objects that only the bright-objects group
  lists (spent rocket stages, dead satellites) are drawn grey. It should be revisited if the full
  catalog is ever added.

Limits of the passes panel:

- **"Visible" says nothing about brightness, weather or obstructions.** A low pass of a small
  satellite counts the same as the ISS overhead. The list of other bright satellites is CelesTrak's
  judgement of what is bright, not this project's.
- **Passes are listed five days ahead, but the 3D view only moves three.** A pass further ahead
  than that has no "Show in 3D" button.
- **Later passes are less certain.** They are computed from today's elements; orbits decay and the
  stations are boosted from time to time. The list is recomputed when the page is reloaded with
  newer data, and the dates of large changes are not known in advance.
- **A city has one name in the list,** usually the English one, and only places of 15,000 people or
  more are in it. Anywhere else can be given as coordinates or by the device.
- **For typed coordinates the times are in the device's time zone,** which is wrong if the
  coordinates are somewhere else. The panel says which time zone it is using.
- **The observer is at sea level.** A kilometre of height changes a pass by under a second.
- **The marker for the viewer's place has no label,** and the camera does not follow a pass: it
  turns to face the place once when "Show in 3D" is pressed.

Limits of what is built:

- **Constellation membership is a guess from the object's name** (decision 17).
- **On a phone, the filters cannot be reached while an object is selected,** because its details
  take the overview's place. Close the details first.
- **The camera does not follow a selected object.** It turns to face the object once; a satellite
  in low orbit then drifts out of the middle of the view within a few minutes.
- **The orbit line is the orbit, not the ground track** (decision 16).
- **Objects can only be picked with a pointer or through the search field.** There is no way to
  move from object to object with the keyboard, and the globe cannot be rotated from the keyboard.
  Keyboard camera control is part of Phase 7.
- **Names appear on hover only with a mouse.** Touch has no hover; tap the object instead.
- **Orbit regime boundaries are a convention,** and one of the three thresholds is from memory
  (VALIDATION.md, V3.7).

Carried over:

- **The refusal path has only been exercised in tests.** CelesTrak has answered every real request
  with HTTP 200 so far. How the pipeline behaves when CelesTrak refuses is covered by tests with a
  substitute network, but has not yet happened for real.
- **The live catalog has not been compared row by row with the raw downloads.** The raw files are
  kept as a workflow artifact for 3 days, but the build environment could not download them.
- **Scheduled runs can start late.** The first scheduled data run (2026-11-15) succeeded but
  started at 04:01 UTC, 44 minutes after its scheduled 03:17. To my knowledge GitHub also pauses
  scheduled workflows in repositories with no activity for 60 days; if the data stops updating
  after a long quiet period, check the Actions tab for a prompt to re-enable it.
- **Tested in one browser engine.** Chromium only: headless with software rendering in CI and in
  the build environment. Firefox and Safari are untested, and no screen reader has been used.
- **Development-only security advisory.** `npm audit` reports a moderate-severity denial-of-service
  advisory (GHSA-g3hv-75wg-m249) in `minimatch`, a dependency of typescript-eslint. It affects the
  linter on a developer's machine and in CI only. It is not part of the code shipped to visitors.
  No fixed typescript-eslint release existed on 2026-11-14.
- **No licence file.** Until one is added, the code is "all rights reserved" by default even in a
  public repository. Choosing a licence is the owner's decision.

## Credits

- [three.js](https://threejs.org/) (MIT licence) for 3D rendering.
- [satellite.js](https://github.com/shashwatak/satellite-js) (MIT licence) for SGP4/SDP4 propagation.
- WGS 84 parameters: National Geospatial-Intelligence Agency.
- SGP4 verification data: Vallado, Crawford, Hujsak and Kelso, "Revisiting Spacetrack Report #3"
  (AIAA 2006-6753), obtained through the `sgp4` Python package by Brandon Rhodes (MIT licence).

- Orbital data and satellite catalog: [CelesTrak](https://celestrak.org) (Dr. T.S. Kelso), from
  general-perturbations data published by the US Space Force's 18th Space Defense Squadron.
- City names, positions and time zones: [GeoNames](https://www.geonames.org) (CC BY 4.0), through
  the npm package `cities-15000-structured` by Adam Averay (MIT licence).
- Reference pass tables used in testing: [Heavens-Above](https://www.heavens-above.com).
- Earth imagery: NASA Earth Observatory, Blue Marble Next Generation (2004) and Black Marble (2012).
  Provenance and the one change made are in `public/textures/README.md`.
