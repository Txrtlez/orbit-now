# Orbit Now

A live 3D tracker of the publicly tracked objects in Earth orbit, with an illustrative
debris-cascade ("Kessler syndrome") simulator.

**Status: Phase 1 of 7 (architecture and scaffold).** The app currently shows an untextured globe
with a latitude/longitude grid. It loads no orbital data and shows no satellites yet. Nothing in it
should be read as a statement about the real state of Earth orbit.

| Phase | Scope                                                                     | State                                            |
| ----- | ------------------------------------------------------------------------- | ------------------------------------------------ |
| 1     | Repository structure, tooling, CI, deploy pipeline, empty app             | Built; deployment waiting on a GitHub repository |
| 2     | Scheduled OMM data pipeline; SGP4 validated against published vectors     | Not started                                      |
| 3     | Earth rendering, all objects moving, picking, info panel, filters, search | Not started                                      |
| 4     | Overhead passes with visibility; time controls                            | Not started                                      |
| 5     | Historical debris layers; growth-of-orbit chart                           | Not started                                      |
| 6     | "What if?" mode: breakup model, propagation, reentry, cascade statistics  | Not started                                      |
| 7     | Guided tour, shareable links, About page, accessibility, launch           | Not started                                      |

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

| Command                | What it does                                                              |
| ---------------------- | ------------------------------------------------------------------------- |
| `npm run format:check` | Fails if any file is not formatted the way Prettier would format it       |
| `npm run lint`         | ESLint with typescript-eslint's strict, type-aware rule sets              |
| `npm run typecheck`    | TypeScript in strict mode, three projects: app, tooling, end-to-end tests |
| `npm run test`         | Vitest unit tests (all physics and geometry code has them)                |
| `npm run build`        | Production build into `dist/`                                             |
| `npm run size`         | Fails if the gzip-compressed initial download exceeds 300 kB              |
| `npm run preview`      | Serves `dist/` at http://localhost:4173                                   |

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
  render/                  three.js scene, camera framing, latitude/longitude grid
  modes/whatif/            "What if?" mode, loaded on demand as a separate file
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

## Known issues

- **Not deployed.** No GitHub repository was available when this phase was built, so the two
  workflow files have never run. They use the current major versions of each action as of
  2026-11-14 (`checkout@v7`, `setup-node@v7`, `configure-pages@v6`, `upload-pages-artifact@v5`,
  `deploy-pages@v5`, `upload-artifact@v7`), but until they run once they are untested.
- **Tested in one browser engine.** Chromium only, in headless mode with software rendering. Firefox
  and Safari are untested.
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
- WGS 84 parameters: National Geospatial-Intelligence Agency.

No Earth imagery or orbital data is used yet. Sources for both will be credited here and in the
in-app About page when they are added.
