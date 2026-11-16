# Orbit Now

A live 3D tracker of the publicly tracked objects in Earth orbit, with an illustrative
debris-cascade ("Kessler syndrome") simulator.

**Live site:** <https://txrtlez.github.io/orbit-now/>

**Status: all seven phases are done and the site is launched.** The site shows the Earth with its real day and night sides and
about 19,500 objects moving in real time. Click or tap an object to see what it is, where it is
and the path of its orbit; search by name or number; filter by constellation, orbit, launch year,
kind and owner. The clock can be paused, run at up to 600 times normal speed, or moved three days
either way. Give a place (your device's position, a city, or coordinates) and the site lists the
passes of the space stations and other bright satellites over it for the next five days, and
which of them can be seen. Three documented break-ups (2007, 2009 and 2021) can be opened to read
what happened and to leave only what remains of each debris cloud on the globe, and a chart plays
through NASA's count of catalogued objects month by month since 1957. The "What if?" tab stages a
break-up (three set up like real ones, two made up, or the object you have selected), makes the
fragments with NASA's standard breakup model, follows them for a century, and shows the cloud on
the globe with a table and chart of what is left; it is an illustrative model, not a prediction,
and says so. A first visit is taken on a one-minute tour; the address after `#` always describes
the view, so copying it shares the view; and the menu (⋯) holds the tour, the link, a "Reduce
motion" setting and the About page, which states every source, model, simplification and limit.
The data on the globe covers
active satellites, three debris clouds and CelesTrak's list of the brightest objects, not every
tracked object (see "Data source"). What is still unproven is listed first under "Known issues".

| Phase | Scope                                                                     | State                                                                                                                              |
| ----- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Repository structure, tooling, CI, deploy pipeline, empty app             | Done                                                                                                                               |
| 2     | Scheduled OMM data pipeline; SGP4 validated against published vectors     | Done, with one documented exception in the SGP4 gate                                                                               |
| 3     | Earth rendering, all objects moving, picking, info panel, filters, search | Done. Frame rate measured by the owner at 240 fps (PC) and 60 fps (phone), before the interaction features were added              |
| 4     | Overhead passes with visibility; time controls                            | Done. ISS passes agree with Heavens-Above at four places (launch gate 2). The bright-objects group awaits its first download       |
| 5     | Historical debris layers; growth-of-orbit chart                           | Done. Nothing of the 2021 Cosmos 1408 cloud is in the data, and the site says so. The chart's numbers were read from a NASA figure |
| 6     | "What if?" mode: breakup model, propagation, reentry, cascade statistics  | Done. All four launch gates have been run (VALIDATION.md, V6.2). Limits of the model: "Known issues" and V6.3 to V6.5              |
| 7     | Guided tour, shareable links, About page, accessibility, launch           | Done and deployed. What was and was not tested across browsers: VALIDATION.md, V7.4                                                |

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

To run the same browser tests in Firefox and WebKit (the engine of Safari) instead, install those
browsers (`npx playwright install firefox webkit`) and set `CROSS_BROWSER=1`:

```bash
CROSS_BROWSER=1 npx playwright test
```

On GitHub that is the `cross-browser` workflow, which runs on every branch push and can be started
by hand. It is separate from CI and cannot stop a deployment (decision 33).

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
vectors pass with one documented exception, the ISS passes agree with Heavens-Above at four
places, and the breakup model reproduces NASA's size-distribution curves with stated limits (V6.1);
the fourth (J2 nodal precession) belongs to the rest of Phase 6 and is listed as not yet run. Phase 5 has no launch gate; its checks are V5.1 to V5.7.

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
                           filters, the debris events, the clock and time bar, the passes
                           panel, number formatting, tabs, shareable links, the guided tour
  about/                   The About page's text, loaded on demand
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
  sim/                     Physics for "What if?" mode, none of it touching the page: the breakup
                           model, orbits under J2, air density, decay under drag, a step-by-step
                           integrator kept for checking, the presets, a whole run, its worker
  growth/                  The growth-of-orbit chart, loaded on demand: NASA's figure as read,
                           its conversion to counts, the chart itself, and a README on provenance
  modes/whatif/            "What if?" mode, loaded on demand as a separate file: the form and
                           results, the fragment layer on the globe, the chart
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
the end of Phase 3 the figure was 167.2 kB and at the end of Phase 5 it is 179.8 kB; the catalog
(about 0.7 MB) is fetched after the page has started and is not counted.

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

### 24. A debris event is a setting of the filters, and says so

Opening one of the three break-ups under "Debris from three break-ups" leaves only its debris on
the globe. It does that by setting the filters to that event's group or groups and nothing else,
exactly as if the viewer had pressed the buttons. The filters therefore remain the single record
of what is on the globe: their section shows "(on)", the headline shows the count, and if the
viewer changes them by hand the event closes, or opens, to match. The alternative, a second and
separate way of hiding objects, was rejected because two mechanisms that can disagree are harder
to explain to a viewer and harder to put in a shareable link later.

The Cosmos 1408 test of 2021 is listed although the catalog holds none of its debris (VALIDATION.md,
V5.3). The brief asks for it, and leaving it out silently would suggest the site had covered the
well-known events when it had not. Its entry tells the story, gives NASA's counts and states
that nothing can be drawn and that today's number of pieces is not known.

Everything said about the three events is in one file, `src/app/events.ts`, with the publication
and page for each statement in VALIDATION.md, V5.2.

### 25. The growth chart's numbers were read from the lines of a NASA figure

The brief asks for historical counts from NASA's Orbital Debris Program Office or ESA's Space
Environment Report. Both publish the history as a chart and neither publishes the table. In
NASA's PDF the chart is a vector drawing whose five lines are paths with one vertex per month, so
the values were taken from the file's drawing instructions and scaled by the chart's own tick
marks. That gives 833 monthly values per line, each within roughly ten objects of what NASA
plotted (VALIDATION.md, V5.1), which is far better than reading a picture by eye and is still not
the same as having NASA's table. The interface therefore rounds every figure to the nearest ten,
declines to name a count below 20, and says how the numbers were obtained.

The values are kept as read, in the units of the PDF, with a checksum (`src/growth/odqnFigure.ts`),
and converted to objects in code that is tested. When NASA publishes a newer chart the procedure in
`src/growth/README.md` has to be repeated by hand; it is not part of the data pipeline.

Deriving the history from a full satellite catalog (launch and decay dates of every object) was
the alternative. It was not done: this site's catalog is not the full one, and the brief asks for a
citable source's counts, not this project's own.

### 26. Five lines in a dialog, not stacked areas in a card

The chart draws the total and the four kinds as five lines, as NASA's does. Stacked areas are the
usual picture for "by type", but since December 2018 NASA's total runs above its four kinds added
together, so the top edge of a stack would be a line NASA did not draw. The chart plays from 1957
to the present in 14 seconds when opened; it shows the last month and waits if the viewer has asked
for reduced motion. The month in view can be set with a slider (which works from the keyboard) or
by pointing at the plot, the legend gives every line's figure for that month, and a table gives the
figures by decade, so nothing depends on seeing the picture or on telling colours apart.

It opens in a dialog over the page because it needs more room than a card beside the globe has,
and because the browser's own dialog element takes care of keyboard focus and the Escape key. Its
code and data (34 kB, 10 kB compressed) are fetched when it is first opened and are not part of
the first download.

### 27. Fragments are moved by averaged formulas, checked against step-by-step integration

A century of a few thousand fragments cannot be integrated step by step in a browser: at 10 s a
step it is 3 × 10⁸ steps per fragment. Each fragment's orbit is instead described by its size,
shape and three angles, and those are advanced with formulas averaged over a revolution: the
secular J2 rates for the angles, and drag averaged by numerical quadrature for the size and shape.
Steps adapt to how fast the orbit is falling, from minutes near re-entry to two years where there
is almost no air, so a fragment takes about a hundred steps instead of hundreds of millions. A
plain Runge-Kutta integrator (`sim/numeric.ts`) is kept in the repository only to check the
formulas, which is how launch gate 4 was run (VALIDATION.md, V6.2 and V6.3). The cost is
exactness of position along the orbit after years, which nothing here uses.

### 28. Hits are counted, not staged

The brief asks for cascade statistics. What is computed is the expected number of hits by the
cloud's fragments on the satellites in this site's data, from a collision rate in 50 km shells of
height, with the range across twelve repetitions. No follow-on collision is made to happen and
no second generation of debris is created. Two reasons. First, this site's data is almost
entirely working satellites; the dead satellites and spent stages that a real cascade feeds on
are not in it (VALIDATION.md, V6.5), so a staged cascade would be a confident picture of the
wrong population. Second, an expected number with its assumptions beside it is easier to read
honestly than an animation of one random outcome. The page calls the number what it is: how much
crossing traffic a cloud makes if nobody dodged.

### 29. The cloud is drawn over a dimmed tracker, in its own shape and colours

Simulated fragments must never be mistaken for tracked objects. They are drawn as small squares
in two colours used nowhere else (one per parent body), the tracked objects fade to about a third
of their brightness while a cloud is on show, and the cloud disappears when the tab is left. The
time under the cloud is a separate control from the tracker's clock, stretched evenly in ratio
from one minute to a hundred years, because a cloud changes as much between a day and a month as
between ten years and a hundred. The tracked objects behind it stay at the tracker's own time.

### 30. The view is kept in the address, after the `#`

Shareable links needed somewhere to put the view. The path is not available (decision 2: plain
files in a sub-folder, no routing), and a query string would be sent to the server with every
request. The fragment is never sent, needs no server support, and can be rewritten without
reloading. So the address always describes the view: selected object, filters, the time if it is
not the present, the mode, and in "What if?" the event, the Sun setting and which run is on show.
Because a run's number decides its random fragments, a shared run shows the same cloud and the
same figures. The format is a short list of `name=value` pairs (`src/app/shareLink.ts`); anything
missing means "as the site opens" and anything not understood is ignored, so an old or mangled
link opens the site and never an error. Two limits follow from other decisions: a shared time
only works while it is within three days of the present (the clock's range), and then the view is
paused at that instant; and a run built on "the object selected in the tracker" is recomputed
from where that object is when the link is opened, so its numbers can differ slightly.

### 31. The tour drives the real controls, and starts by itself once

The tour's five stops press the same filters, selection, tabs and "What if?" form that a viewer
would, and every number in its text is counted from the data on the page, so it cannot show
something the site would not. A stop whose subject is missing from the data is left out. It
starts by itself on a first visit, as the brief asks, but not when the visitor arrived by a link
to a particular view, and not again once seen (one flag in the browser's storage; where storage
is off, it does not start by itself at all, so as not to start on every visit). It moves on
every 12 seconds, can be paused, stepped both ways, left with one button or Escape, and taken
again from the menu. With reduced motion it waits to be moved on. While it runs the tracker's
own cards step aside.

### 32. Reduced motion: the device's setting, or the site's own

Everything that moves by itself (the globe's slow turn, camera flights, the growth chart's and
the tour's playback) already stopped when the device asks for reduced motion. The brief asks for
an option, so the menu has a "Reduce motion" tick box that does the same and is remembered. The
two are combined with "or": the site's box can reduce motion further than the device asks but
never turns back on what the device turned off.

### 33. Other browsers are tested in a separate run that cannot block a deployment

CI and deployment use Chromium only, as before. Firefox and WebKit run the same tests in their
own workflow. The reason for keeping them apart is that those results depend on what the test
machine can do, not only on the site: a failure there should be read and recorded, not allowed
to stop a fix from going out. What those runs found is in VALIDATION.md, V7.4.

### 34. What was decided about the questions left open

The owner asked for these to be settled by judgement. Each can be reversed.

- **The full public catalogue was not added.** It would give "What if?" the dead satellites and
  spent stages its hit count lacks. But CelesTrak serves no single list of them and asks users
  not to download every group; the alternative, Space-Track, needs an account and has terms that
  have not been read. A change to what the site downloads every day, made on the last day and
  untestable from the build machine, was the wrong trade for a number already labelled as
  illustrative. The About page says what is missing instead.
- **No query for Cosmos 1408 debris was added.** By NASA's count 364 of its 1,785 pieces were
  still in orbit in January 2023, and nearly all of it was expected down within about five years
  of 2021 (VALIDATION.md, V5.3). The site would be asking CelesTrak one more question a day to
  draw, at best, a few dots.
- **The Heavens-Above tables stay in the repository.** They are 186 rows of predicted times, kept
  with their source named and used only to test this site's predictions. Their terms of use
  have still not been read; removing them is the two deletions described under "Known issues".
- **No licence was chosen.** That is the one decision left to the owner, because a licence is
  a legal grant made in the owner's name and cannot be taken back from copies already made.

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
debris (decision 24). The app states the limitation next to the object count.

**The growth chart is a separate source.** Its counts are NASA's, from one figure in Orbital Debris
Quarterly News of July 2026, as of 3 May 2026 (decision 25). They are counts of the whole public
catalog, about 33,500 objects, and so are not comparable with the 19,500 or so that this site
draws. The chart says so.

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

Limits of "What if?" mode (Phase 6), most important first. All of it is an illustrative model:

- **The model makes too few pieces for real events,** by a factor of 4 for Fengyun-1C, 2 for
  Iridium 33 and Cosmos 2251 and 1.3 for Cosmos 1408 (VALIDATION.md, V6.4). This is the published
  model's average against particular events, not a fault found in the code, but for Fengyun-1C
  this implementation also gives 21% fewer pieces after a day than NASA said its model does, and
  the cause has not been found.
- **The count of hits is not a forecast of collisions.** Its targets are the satellites in this
  site's data, nearly all of them working and able to dodge; dead satellites and spent rocket
  stages are mostly absent; every target is assumed to weigh 500 kg; targets stay where they are
  today for a century; pieces under 10 cm are left out; and the debris of any later collision is
  not followed (decision 28).
- **The air is one fixed table.** There is no solar cycle. The "Sun" setting multiplies the table
  by 1/3, 1 or 3, numbers of mine. With the middle setting the model's share of debris still in
  orbit comes within 3 to 9 percentage points of three real events, which is partly luck.
- **One reading of the breakup model rests on memory:** the area-to-mass distribution is taken as
  a mixture of two populations (VALIDATION.md, V6.1). The 2001 paper was not read.
- **The masses in the three history-like presets are rounded,** and Cosmos 1408's (1,750 kg) is
  from LeoLabs, not NASA. The orbits are circular; the real ones were nearly so.
- **The object you select has no mass in the data,** so the mass is whatever is typed, 1,000 kg
  unless changed. A collision's second body is invented: its mass and the angle are typed too.
- **The tracked objects behind a cloud are shown at the tracker's time,** not at the cloud's.
  Ten years after a break-up the cloud is drawn over today's satellites.
- **An interceptor's own mass and debris are left out** of the two interceptor presets.
- **Running a large event takes a while on a slow phone.** The made-up collision (about 2,500
  pieces, twelve repetitions) took 18 s on the build machine, with the first cloud on the globe
  after 3 s. Frame rate with a cloud on show has not been measured on real hardware.
- **Nothing of a run is kept.** Leaving the page loses it, and there is no link to a run yet
  (shareable links are Phase 7).

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

Unproven or incomplete parts of Phase 5:

- **The text about the three break-ups was checked by an automated page reader, not by a person.**
  Each statement has a NASA publication and page against it (VALIDATION.md, V5.2), and where two
  publications overlap they agree. Reading those pages yourself would be the real check; it is
  twenty rows.
- **The growth chart's numbers are a reading of a figure.** They are good to roughly ten objects
  and were checked several ways (V5.1), but NASA's own table was never seen. NASA's chart and the
  "box score" table in the same issue disagree by about 1%, for a reason that was not found.
- **Since late 2018 the chart's total is larger than its four kinds added together,** by about 680
  objects in May 2026. NASA's chart does not explain it and the site does not guess.
- **The growth chart will go out of date.** It ends on 3 May 2026. Updating it means repeating the
  procedure in `src/growth/README.md` on a newer issue; nothing does that automatically.
- **Nothing of the Cosmos 1408 cloud is drawn, and today's number of pieces is not known.** A query
  that might show the last few was considered and not added (V5.3); say if you want it.
- **"In today's data" is not "still in orbit".** The count shown for each cloud is the size of
  CelesTrak's list, which was made differently from NASA's count of pieces in orbit (V5.4).
- **The break-ups are marked on the growth chart but the two are not linked:** a mark cannot be
  clicked to open the event.
- **The chart has only been looked at in Chromium,** like the rest of the site.

- **A fault that had been in the site since Phase 3 was found and fixed in this phase:** on a touch
  screen, a tap on an object could also press whatever opened under the finger, such as the close
  button of the object's own details (VALIDATION.md, V5.6). It was confirmed and fixed in Chrome's
  emulation of a phone, not on a real one.

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
- Growth of orbit: NASA Orbital Debris Program Office, _Orbital Debris Quarterly News_, volume 30,
  issues 1 & 2 (July 2026), page 9. Facts about the three break-ups: the same newsletter, issues
  11-2, 12-1, 13-2, 27-1 and 28-2, and NASA's _History of On-orbit Satellite Fragmentations_, 16th
  edition (NASA/TP-20220019160).
- Earth imagery: NASA Earth Observatory, Blue Marble Next Generation (2004) and Black Marble (2012).
  Provenance and the one change made are in `public/textures/README.md`.
