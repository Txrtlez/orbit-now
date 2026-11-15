# Orbit Now

A live 3D tracker of the publicly tracked objects in Earth orbit, with an illustrative
debris-cascade ("Kessler syndrome") simulator.

**Live site:** <https://txrtlez.github.io/orbit-now/>

**Status: Phases 1 and 2 are done; the core of Phase 3 is done.** The site shows the Earth with its
real day and night sides and about 19,500 objects moving in real time. Selecting an object, search,
filters and orbit paths are not built yet. The data covers active satellites and three debris
clouds, not every tracked object (see "Data source").

| Phase | Scope                                                                     | State                                                                                                                                               |
| ----- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Repository structure, tooling, CI, deploy pipeline, empty app             | Done                                                                                                                                                |
| 2     | Scheduled OMM data pipeline; SGP4 validated against published vectors     | Done, with one documented exception in the SGP4 gate                                                                                                |
| 3     | Earth rendering, all objects moving, picking, info panel, filters, search | Core done (Earth, sunlight, all objects moving); frame rate unmeasured on real devices; picking, panel, orbit paths, filters and search not started |
| 4     | Overhead passes with visibility; time controls                            | Not started                                                                                                                                         |
| 5     | Historical debris layers; growth-of-orbit chart                           | Not started                                                                                                                                         |
| 6     | "What if?" mode: breakup model, propagation, reentry, cascade statistics  | Not started                                                                                                                                         |
| 7     | Guided tour, shareable links, About page, accessibility, launch           | Not started                                                                                                                                         |

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
with numbers, dates and the command that reproduces it. The four launch gates (SGP4 test vectors,
ISS passes, breakup-model curves, J2 nodal precession) belong to later phases and are listed there
as not yet run.

## Repository layout

```
index.html                 Page shell: canvas, mode tabs, panels
src/
  main.ts                  Start-up: wires the tabs and the globe together
  styles.css               All styling
  app/                     Interface code that is not 3D (tabs, build stamp)
  geo/                     Earth geometry: WGS 84 constants, coordinate conversions
  orbit/                   Time and frames, SGP4 for many objects, the background worker
  render/                  three.js scene: Earth, sunlight, the object layer, camera framing
  catalog/                 The catalog file format (shared with the pipeline) and its loader
  modes/whatif/            "What if?" mode, loaded on demand as a separate file
pipeline/                  Data pipeline: download, check, merge, publish (runs in GitHub Actions)
tests/validation/          Launch-gate validations against published reference data
tests/pipeline/            Pipeline tests; the network is always substituted, never contacted
tests/fixtures/            The reference data itself, with provenance notes
e2e/                       Playwright browser tests, run against the production build
scripts/                   Build-time checks (bundle size budget)
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

**Not yet demonstrated.** The decisive question in the brief is frame rate with 30 000+ points on a
mid-range phone. That has not been measured, because Phase 1 draws no points. It will be measured
in Phase 3 on real hardware. If three.js misses the target there, this decision is reopened.

**WebGPU.** The brief asks for WebGL2 "with WebGPU where available". Phase 1 uses WebGL2 only.
three.js's WebGPU renderer uses a different shader language from its WebGL renderer, so supporting
both means writing and testing every custom shader twice. That is deferred until Phase 3 shows
whether WebGL2 alone meets the frame-rate targets. This is a deviation from the brief's default and
is flagged as such.

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
after gzip. The number is a starting point chosen to leave headroom above today's 138.0 kB, and
should be tightened or justified again when the catalog data arrives in Phase 2.

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

## Data source

**What the site shows.** Orbital data comes from [CelesTrak](https://celestrak.org), which
republishes the US Space Force's general-perturbations (GP) element sets. Four of CelesTrak's
groups are used:

| CelesTrak group      | Objects on 2026-11-15 |
| -------------------- | --------------------- |
| `active`             | 16,881                |
| `fengyun-1c-debris`  | 1,988                 |
| `cosmos-2251-debris` | 581                   |
| `iridium-33-debris`  | 109                   |
| **Total**            | **19,559**            |

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
2. requests each group once from CelesTrak as OMM CSV, smallest group first;
3. checks every row (see `pipeline/omm.ts` for the rules) and the download as a whole;
4. merges what passed into the catalog, keeping the previous data for any group that was not
   refreshed;
5. writes `catalog.json.gz` and `status.json` to the `data` branch and redeploys the site.

**Rules it follows.** CelesTrak's [usage policy](http://celestrak.org/usage-policy.php) allows one
download of each data set per update (every 2 hours for GP data) and tells automated clients to
stop on any response other than HTTP 200. Accordingly the pipeline never requests a group it
requested less than 2 hours 5 minutes earlier, never retries, never follows redirects, and stops
the run at the first non-200 response. The 2-hour rule is enforced in code, so pressing "Run
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

- **The schedule itself is unproven.** The data workflow has run once, started by hand, and
  succeeded. Its first scheduled run had not happened when this was written. To my knowledge GitHub
  also pauses scheduled workflows in repositories with no activity for 60 days; if the data stops
  updating after a long quiet period, check the Actions tab for a prompt to re-enable it.
- **The refusal path has only been exercised in tests.** CelesTrak answered all four first requests
  with HTTP 200. How the pipeline behaves when CelesTrak refuses is covered by tests with a
  substitute network, but has not yet happened for real.
- **The live catalog has not been compared row by row with the raw downloads.** The raw files are
  kept as a workflow artifact for 3 days, but the build environment could not download them.
- **Frame rate is unmeasured on real hardware.** Add `?stats` to the page address to see a readout.
- **On a phone, opening "About this data" makes the panel cover part of the globe.** The layout is
  reworked in Phase 3 when the panel gains real content.
- **Tested in one browser engine.** Chromium only: headless with software rendering in CI, and one
  manual check of the live site in a Chromium-based browser on a desktop GPU. Firefox and Safari are
  untested.
- **No real-device performance numbers.** Nothing here has been run on a physical phone.
- **Development-only security advisory.** `npm audit` reports a moderate-severity denial-of-service
  advisory (GHSA-g3hv-75wg-m249) in `minimatch`, a dependency of typescript-eslint. It affects the
  linter on a developer's machine and in CI only. It is not part of the code shipped to visitors.
  No fixed typescript-eslint release existed on 2026-11-14.
- **No licence file.** Until one is added, the code is "all rights reserved" by default even in a
  public repository. Choosing a licence is the owner's decision.
- **The globe cannot be rotated from the keyboard.** The mode tabs are fully keyboard-operable; the
  3D camera is mouse and touch only for now. Keyboard camera control is part of Phase 7.

## Credits

- [three.js](https://threejs.org/) (MIT licence) for 3D rendering.
- [satellite.js](https://github.com/shashwatak/satellite-js) (MIT licence) for SGP4/SDP4 propagation.
- WGS 84 parameters: National Geospatial-Intelligence Agency.
- SGP4 verification data: Vallado, Crawford, Hujsak and Kelso, "Revisiting Spacetrack Report #3"
  (AIAA 2006-6753), obtained through the `sgp4` Python package by Brandon Rhodes (MIT licence).

- Orbital data: [CelesTrak](https://celestrak.org) (Dr. T.S. Kelso), from general-perturbations
  data published by the US Space Force's 18th Space Defense Squadron.
- Earth imagery: NASA Earth Observatory, Blue Marble Next Generation (2004) and Black Marble (2012).
  Provenance and the one change made are in `public/textures/README.md`.
