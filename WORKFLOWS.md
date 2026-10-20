# Shared workflows

Every codec repository (zstd-js, lz4-js, snappy-js, brotli-js, gzip-js) builds, tests and
releases the same way. The jobs live here as reusable workflows (`on: workflow_call`), so the
native build pipeline is fixed in one place. A codec repository's `ci.yml` and `release.yml`
only say which workflows to run and pass the codec-specific values.

| Workflow | Jobs | Used by |
| --- | --- | --- |
| [`build-wasm.yml`](.github/workflows/build-wasm.yml) | Build the WebAssembly module, upload it as `wasm` | CI, release |
| [`test-node.yml`](.github/workflows/test-node.yml) | vitest on every OS × Node.js version | CI |
| [`test-browsers.yml`](.github/workflows/test-browsers.yml) | Typecheck, then the browser suite in Chromium, Firefox and WebKit | CI |
| [`test-runtimes.yml`](.github/workflows/test-runtimes.yml) | Packed tarball on Node.js (native and WebAssembly), Bun, Deno and Workers | CI |
| [`prebuild.yml`](.github/workflows/prebuild.yml) | Native addon for 8 platforms, uploaded as `prebuild-<platform>` | release |
| [`pack-verify-publish.yml`](.github/workflows/pack-verify-publish.yml) | Pack, install on 8 systems, publish to npm | release |

## Calling them

```yaml
jobs:
  wasm:
    uses: kodespire/compression-js/.github/workflows/build-wasm.yml@v1
    with:
      wasm-build: node scripts/build-wasm.mjs
      wasm-artifact-path: out/wasm
```

[zstd-js's ci.yml](https://github.com/kodespire/zstd-js/blob/main/.github/workflows/ci.yml) and
[release.yml](https://github.com/kodespire/zstd-js/blob/main/.github/workflows/release.yml) are
complete examples.

- **Versions.** Callers pin a major tag, `@v1`. Changes that keep every input working move the
  `v1` tag. A change that renames or removes an input, or changes what a codec repository has to
  provide, gets `v2`.
- **Testing a change here.** Push it to a branch, point a codec repository's branch at it
  (`@my-branch` in every `uses:` line), and run that repository's CI and a manual Release run.
  Move `v1` only once both are green.
- **Shared scripts.** `scripts/ci/` in this repository is checked out into `.compression-js/` in
  the jobs that need it. It comes from the same commit as the workflow file (`job.workflow_repository` and
  `job.workflow_sha`), so `@v1` runs v1's scripts and `@my-branch` runs the branch's.
- **Job names.** GitHub shows a called job as `<caller job> / <job>`, for example
  `node / Node 22 (ubuntu-latest)`. Branch protection rules that require checks need these names.
- **Concurrency** belongs in the caller (zstd-js's ci.yml cancels superseded runs). None of these
  workflows sets it, since a group set inside a called workflow would be the caller's group.

## What a codec repository provides

The workflows run the same commands in every repository, so each one needs:

- the upstream library as a git submodule (every checkout uses `submodules: true`)
- `.emsdk-version` at the root, with the Emscripten version to build with
- npm scripts `build:native` (node-gyp), `build:ts` (dist/, including the `.wasm`), `typecheck`
  and `test` (the Node.js vitest suite)
- prebuildify as a dev dependency, and `prebuilds` in package.json's `files`
- a browser vitest config that reads the browser list from `BROWSERS`, by default
  `vitest.browser.config.ts`
- a smoke test script (below) and, unless the Workers test is turned off, a Workers test
  directory (below)

## Artifacts

All jobs in one run share artifacts, so the release workflows hand them on by name.

| Name | Made by | Contents |
| --- | --- | --- |
| `wasm` | build-wasm | The `wasm-artifact-path` directory. Restored to the same directory in every job that downloads it. |
| `prebuild-<platform>` | prebuild | `prebuilds/<platform>/…` for one of the 8 platforms |
| `tarball` | pack-verify-publish | The `npm pack` tarball, with every prebuild and the `.wasm` inside |

## Inputs

### build-wasm.yml

Installs the Emscripten version in `.emsdk-version` (scripts/ci/setup-emsdk.sh), runs the build
with `emcc` on `PATH`, and uploads the output as the `wasm` artifact.

| Input | Required | Default | |
| --- | --- | --- | --- |
| `wasm-build` | yes | | Command that builds the module. Runs from the repository root after `source ~/emsdk/emsdk_env.sh`. zstd-js: `node scripts/build-wasm.mjs` |
| `wasm-artifact-path` | yes | | Directory the build writes to. All of it is uploaded, and the build should write nothing else there. zstd-js: `out/wasm` |

### test-node.yml

One job per OS and Node.js version: `npm ci`, `npm run build:native`, `npm run build:ts`, the
optional CLI build, then `npm test`. Needs `wasm`.

| Input | Required | Default | |
| --- | --- | --- | --- |
| `wasm-artifact-path` | yes | | Where to restore the `wasm` artifact. Use the value given to build-wasm.yml. |
| `cli-build` | no | `''` | Command that builds the upstream command-line tool for the interop tests. Skipped on Windows (it needs `make`). Empty: no CLI build. zstd-js: `node scripts/build-zstd-cli.mjs` |
| `os` | no | `["ubuntu-latest", "ubuntu-24.04-arm", "macos-latest", "windows-latest"]` | JSON array of runner labels |
| `node-versions` | no | `[22, 24, 26]` | JSON array of Node.js versions |

### test-browsers.yml

`npm ci`, `npm run typecheck`, `npm run build:ts`, installs the Playwright browsers, then runs
`npx vitest run -c <vitest-config>` with `BROWSERS` set. Needs `wasm`.

| Input | Required | Default | |
| --- | --- | --- | --- |
| `wasm-artifact-path` | yes | | Where to restore the `wasm` artifact. Use the value given to build-wasm.yml. |
| `browsers` | no | `chromium,firefox,webkit` | Comma-separated Playwright browsers, passed to the config as `BROWSERS` |
| `vitest-config` | no | `vitest.browser.config.ts` | The browser suite's vitest config |

### test-runtimes.yml

Builds the Linux x64 glibc prebuild (scripts/ci/prebuild-linux.sh), runs `npm pack`, installs the
tarball into an empty project and runs the smoke test on Node.js (native, then with
`<backend-env>=wasm`), Bun (native), Deno (WebAssembly) and, through `wrangler dev`, Cloudflare
Workers. Needs `wasm`.

| Input | Required | Default | |
| --- | --- | --- | --- |
| `wasm-artifact-path` | yes | | Where to restore the `wasm` artifact. Use the value given to build-wasm.yml. |
| `tarball-prefix` | yes | | Start of the file name `npm pack` writes: the package name without `@`, with `/` as `-`. zstd-js: `kodespire-zstd-js` |
| `smoke-script` | yes | | Path of the smoke test script. zstd-js: `test/smoke/smoke.mjs` |
| `backend-env` | yes | | Environment variable that makes the Node.js entry point use WebAssembly when set to `wasm`. zstd-js: `ZSTD_JS_BACKEND` |
| `workerd-dir` | no | `test/workerd` | Directory with `worker.mjs`, `wrangler.toml` and `run.mjs`. Empty: no Workers test. |

**The smoke script** is an ES module with no imports besides the package itself. It is copied
next to the installed package as `smoke.mjs` and run with `node`, `bun` and
`deno run -A --node-modules-dir=manual`. It exits non-zero on failure, and fails if the
package's active backend is not the one in `EXPECT_BACKEND` (`native` or `wasm`).
[zstd-js's](https://github.com/kodespire/zstd-js/blob/main/test/smoke/smoke.mjs) is the model.

**The Workers test:** the three files are copied into the same project, `wrangler@4` is
installed, and `node run.mjs` runs. `run.mjs` starts `wrangler dev`, requests the worker, checks
the result, stops wrangler and exits non-zero on failure.
[zstd-js's](https://github.com/kodespire/zstd-js/tree/main/test/workerd) is the model.

### prebuild.yml

No inputs. Runs `prebuildify --napi --strip --target 22.0.0` for darwin arm64/x64 and win32
x64/arm64 on their own runners, and for linux x64/arm64 in manylinux_2_28 (glibc 2.28) and
Alpine (musl) containers with `--tag-libc`. Each platform is uploaded as `prebuild-<platform>`.

### pack-verify-publish.yml

Call it with `needs:` on the build-wasm and prebuild jobs.

- **Pack:** `npm ci`, `npm run build:ts`, `npm pack` with the `wasm` artifact and all
  `prebuild-*` artifacts in place, uploaded as `tarball`.
- **Verify:** installs the tarball into an empty project and runs the smoke test with
  `EXPECT_BACKEND=native` on macOS arm64 and x64, Windows x64 and arm64, Ubuntu x64 and arm64,
  Alpine (`node:22-alpine`) and Rocky Linux 8 (glibc 2.28). Node.js 22.
- **Publish:** runs `npm stage publish <tarball> --access public --provenance` after every
  verify job passes, when `publish` is true. The version then waits in the package's stage queue
  on npmjs.com until a maintainer approves it with 2FA (on the website, or
  `npm stage list` / `npm stage approve <id>`). With `publish-dry-run`, it runs with `--dry-run`
  instead. Either way it first prints the OIDC claims npm trusted publishing checks.

| Input | Required | Default | |
| --- | --- | --- | --- |
| `wasm-artifact-path` | yes | | Where to restore the `wasm` artifact. Use the value given to build-wasm.yml. |
| `tarball-prefix` | yes | | As for test-runtimes.yml |
| `smoke-script` | yes | | As for test-runtimes.yml |
| `publish` | no | `false` | Publish the tarball. zstd-js: `${{ startsWith(github.ref, 'refs/tags/v') }}` |
| `publish-dry-run` | no | `false` | Run the publish job with `npm stage publish --dry-run`. Never publishes, even if `publish` is true. Fails if the version is already on npm (see below). |

**Permissions:** the calling job must grant `id-token: write` (and `contents: read`). A called
workflow can't have more permissions than the job that calls it, and GitHub refuses to start a
run whose caller grants less. Only the publish job asks for `id-token: write`; pack and
verify get `contents: read`.

**Secrets:** none. Trusted publishing uses the OIDC token, not an npm token, so callers don't
need `secrets: inherit`. Leaving it out means a codec repository's secrets never reach a
workflow it pulls from another repository by a tag that can move.

## npm trusted publishing

npm checks the **calling** workflow, so each package's trusted publisher on npmjs.com is
configured with the codec repository's own `release.yml`, not `pack-verify-publish.yml`:

| Field | Value (zstd-js) |
| --- | --- |
| Publisher | GitHub Actions |
| Organization or user | `kodespire` |
| Repository | `zstd-js` |
| Workflow filename | `release.yml` |
| Environment | (empty) |
| Allow npm publish / Allow npm dist-tag | Leave both unchecked. The workflow only stages releases, which needs neither. |

**Checked on 2026-10-20** with a manual Release run in zstd-js with `publish-dry-run` ticked
([run 39490031238](https://github.com/kodespire/zstd-js/actions/runs/39490031238)). The OIDC
token minted inside this repository's publish job carried:

```json
{
  "repository": "kodespire/zstd-js",
  "ref": "refs/heads/shared-workflows",
  "event_name": "workflow_dispatch",
  "workflow_ref": "kodespire/zstd-js/.github/workflows/release.yml@refs/heads/shared-workflows",
  "job_workflow_ref": "kodespire/compression-js/.github/workflows/pack-verify-publish.yml@refs/heads/shared-workflows"
}
```

- **Observed:** `repository` and `workflow_ref`, the claims npm matches against the trusted
  publisher, name zstd-js and its release.yml. `job_workflow_ref` records that the job itself
  came from here. That run's runner had npm 11.19.1, and trusted publishing needs 11.5.1 or
  later.
- **Expected from npm's docs:** npm checks the calling workflow, so it should accept these
  claims with the configuration above.
- **Not yet tested:** npm exchanging the token for a publish token. A dry run never reaches
  that step, so the first tag-triggered publish will be the first real test.

Notes:

- npm's docs say `id-token: write` must be granted to both the caller and the called workflow.
  zstd-js's `release` job and this repository's publish job both grant it.
- `publish-dry-run` fails at `npm stage publish --dry-run` if the version in package.json is already
  on npm, since npm 11 checks that even in a dry run. A real publish would fail the same way. Bump
  the version before using it to rehearse a release.
- npm's docs describe adding a trusted publisher from the package's settings page, so a package
  needs one version on npm before its trusted publisher can be added. The first version of each codec package has to
  be published another way (for example by hand). All five codec packages were first published by hand on 2026-10-20.
