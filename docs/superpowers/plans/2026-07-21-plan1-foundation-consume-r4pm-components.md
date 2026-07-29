# Plan 1 — Foundation: Consume `@r4pm/components` in OCPQ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make OCPQ's frontend able to import and render a component from propel's `@r4pm/components` (source-TS, radix-Themes, Tailwind) via a local link, proven by one smoke render.

**Architecture:** Add `@r4pm/components` as a `file:` link to the side-by-side propel checkout. Configure OCPQ's Vite to dedupe React + `@xyflow/react` (context singletons), resolve the package's subpath exports, and load propel's compiled stylesheet. Wrap propel consumers in radix `Theme`. Verify with a dev-only smoke route. This is the prerequisite for tracks 1-4; no OCPQ feature changes yet.

**Tech Stack:** pnpm, Vite 5 + `@vitejs/plugin-react`, `@tailwindcss/vite` (Tailwind v4), React 18, `@radix-ui/themes` (from the linked package), `@r4pm/components` (raw TS source, subpath exports).

## Global Constraints

- Never auto-commit; never push. Steps include `git commit` — the user runs/authorizes commits. If executing agentically, stage + show the message and stop for the user unless the user has said to commit.
- Components stay pure/backend-free: OCPQ feeds view-models/callbacks; no edits to `packages/components` in this plan.
- Both repos live side-by-side: `~/doc/projects/OCPQ` and `~/doc/projects/propel`. The link is a relative `file:../../propel/packages/components` from `OCPQ/frontend`.
- propel `@r4pm/components` ships raw TS (`main: src/index.ts`) with subpath exports `.`, `./ui`, `./charts`, `./elk-layout`, `./rust-layout/*`; peer deps react/react-dom `>=18`; own deps include `@radix-ui/themes`, `@tanstack/react-virtual`, `@xyflow/react`, `elkjs`, `react-plotly.js`, `react-icons`.
- OCPQ frontend: pnpm, `frontend/vite.config.ts`, entry `frontend/src/main.tsx`, React 18, Tailwind v4 via `@tailwindcss/vite`, uses individual `@radix-ui/react-*` primitives (NOT `@radix-ui/themes` — the two coexist; propel components render inside a `<Theme>` island).

---

## File structure

- `frontend/package.json` — add the `file:` dependency.
- `frontend/vite.config.ts` — dedupe + optimizeDeps handling for the linked source package.
- `frontend/src/main.tsx` — import propel's stylesheet once.
- `frontend/src/routes/_smoke/ComponentsSmoke.tsx` — dev-only smoke route (deleted at end of track work, kept through the track plans).
- `frontend/src/router.tsx` — register the smoke route.

---

## Task 1: Link the package and verify resolution

**Files:**
- Modify: `frontend/package.json` (dependencies)

**Interfaces:**
- Produces: an installed `@r4pm/components` resolvable from `frontend/`, whose subpath `@r4pm/components/ui` also resolves.

- [ ] **Step 1: Add the file: dependency**

Edit `frontend/package.json` dependencies, add (keep alphabetical near other `@r`):

```json
"@r4pm/components": "file:../../propel/packages/components",
```

- [ ] **Step 2: Install**

Run (from `frontend/`): `pnpm install`
Expected: install completes; `frontend/node_modules/@r4pm/components` exists as a link. Verify:

Run: `node -e "console.log(require.resolve('@r4pm/components/package.json'))"`
Expected: prints a path under `propel/packages/components/package.json` (symlinked) or `frontend/node_modules/...`.

- [ ] **Step 3: Verify the linked package brings its own deps**

Run (from `frontend/`): `node -e "require.resolve('@radix-ui/themes')" && echo OK`
Expected: `OK` (either OCPQ hoisted it or it resolves from the linked package). If it throws, add `@radix-ui/themes` and `@tanstack/react-virtual` to `frontend/package.json` explicitly at the versions in `propel/packages/components/package.json` and re-run `pnpm install`.

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml
git commit -m "build(frontend): link @r4pm/components via file: dep"
```

---

## Task 2: Vite config for the source-TS linked package

**Files:**
- Modify: `frontend/vite.config.ts`

**Interfaces:**
- Consumes: the linked package from Task 1.
- Produces: a Vite config that transpiles the linked `.tsx` source, keeps a single React and single `@xyflow/react` instance, and does not pre-bundle the source package incorrectly.

- [ ] **Step 1: Add dedupe + fs allow + optimizeDeps exclude**

Replace `frontend/vite.config.ts` with:

```ts
import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    watch: { ignored: ["**/*.bck"] },
    // Allow importing source files from the sibling propel checkout (file: link).
    fs: { allow: [path.resolve(__dirname, "."), path.resolve(__dirname, "../../propel")] },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
    // React + xyflow hold React context singletons; a second copy breaks hooks/provider lookup.
    dedupe: ["react", "react-dom", "@xyflow/react"],
  },
  optimizeDeps: {
    // The linked package ships raw TSX; let Vite transpile it on demand instead of pre-bundling.
    exclude: ["@r4pm/components"],
  },
});
```

- [ ] **Step 2: Verify dev server boots**

Run (from `frontend/`, background it): `pnpm dev`
Expected: Vite prints a Local URL, no immediate resolve errors in the terminal. Stop the server after confirming (the render check is Task 4).

- [ ] **Step 3: Commit**

```bash
git add frontend/vite.config.ts
git commit -m "build(frontend): dedupe react/xyflow + allow propel source for @r4pm/components"
```

---

## Task 3: Load propel's stylesheet

**Files:**
- Modify: `frontend/src/main.tsx`

**Interfaces:**
- Produces: propel component styles + radix Themes tokens present in the OCPQ bundle.

- [ ] **Step 1: Determine which CSS entry works**

The package exports `./ui/styles.css` -> `./src/ui/styles.css` (Tailwind SOURCE, needs a Tailwind pipeline over the package's classes). Prefer the package's COMPILED css if present:

Run: `ls ../../propel/packages/components/dist/ui/styles.css ../../propel/packages/components/dist/styles.css 2>/dev/null`
- If the `dist/*.css` files exist: import the compiled files directly by relative path (they are plain CSS, no Tailwind processing needed).
- If they do NOT exist: run `pnpm --filter @r4pm/components build` in the propel repo to generate them, or fall back to Step 3 (Tailwind-content approach).

- [ ] **Step 2: Import the compiled stylesheet in main.tsx**

Add near the top of `frontend/src/main.tsx`, after existing global CSS imports:

```ts
import "@r4pm/components/dist/ui/styles.css";
import "@r4pm/components/dist/styles.css";
```

(If a subpath like `@r4pm/components/dist/...` is not in the package `exports` map and Vite rejects it, import via the resolved relative path `../../../propel/packages/components/dist/ui/styles.css` instead, or add the dist paths to the package `exports` — the latter is a propel-side change, defer it and use the relative import here.)

- [ ] **Step 3: Fallback — Tailwind-content approach (only if no dist css)**

If compiled CSS is unavailable, instead point OCPQ's Tailwind at the package source so its utility classes are generated into OCPQ's own build. In the OCPQ Tailwind entry CSS (the file processed by `@tailwindcss/vite`; Tailwind v4 uses `@source`), add:

```css
@source "../../../propel/packages/components/src/**/*.{ts,tsx}";
```

and still import radix Themes base tokens:

```ts
import "@radix-ui/themes/styles.css";
```

- [ ] **Step 4: Verify no build error**

Run (from `frontend/`): `pnpm dev`
Expected: server boots, no CSS resolve error. Keep running for Task 4.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/main.tsx
git commit -m "build(frontend): load @r4pm/components stylesheet"
```

---

## Task 4: Smoke render behind a dev route

**Files:**
- Create: `frontend/src/routes/_smoke/ComponentsSmoke.tsx`
- Modify: `frontend/src/router.tsx`

**Interfaces:**
- Consumes: `Theme` from `@r4pm/components/ui`, `LogMetadataCard` from `@r4pm/components` (a pure static component — no OCPQ backend needed).
- Produces: a `/_smoke` route proving import + transpile + styles + Theme all work end-to-end.

- [ ] **Step 1: Confirm the smoke component's prop shape**

Run: `sed -n '1,40p' ../../propel/packages/components/src/shared/LogMetadataCard.tsx`
Expected: shows the exported `LogMetadataCard` and its props interface. Use those exact prop names in Step 2 (adjust the static object below to match; if the shape differs, use `DatasetSelector` from `@r4pm/components` with a static `datasets` array as the smoke component instead — it has no required backend data either).

- [ ] **Step 2: Write the smoke route component**

Create `frontend/src/routes/_smoke/ComponentsSmoke.tsx`:

```tsx
import { Theme } from "@r4pm/components/ui";
import { LogMetadataCard } from "@r4pm/components";

// Dev-only smoke check that @r4pm/components imports, transpiles, styles, and themes correctly
// inside OCPQ. Not linked in the nav. Remove once the real track swaps land.
export default function ComponentsSmoke() {
  return (
    <Theme>
      <div style={{ padding: 24 }}>
        <h1>@r4pm/components smoke</h1>
        <LogMetadataCard data={{ num_traces: 42, num_events: 1337 }} />
      </div>
    </Theme>
  );
}
```

(Replace the `LogMetadataCard` line + props with whatever Step 1 confirmed. The point is one propel component rendering under `Theme`.)

- [ ] **Step 3: Register the route**

In `frontend/src/router.tsx`, add a lazy route (match the file's existing route-object style):

```tsx
{ path: "/_smoke", element: <ComponentsSmoke /> },
```

with a matching `import ComponentsSmoke from "@/routes/_smoke/ComponentsSmoke";` at the top.

- [ ] **Step 4: Verify the render in the browser**

Run (from `frontend/`): `pnpm dev`, then open the printed URL at `/_smoke`.
Expected:
- The card renders with propel's styling (radix Themes look), not unstyled.
- Browser console has NO "Invalid hook call" / "two copies of React" error (would mean dedupe failed — revisit Task 2 Step 1).
- Terminal has no unresolved-import error for `@r4pm/components` or `@r4pm/components/ui`.

- [ ] **Step 5: Typecheck**

Run (from `frontend/`): `pnpm exec tsc --noEmit`
Expected: no new type errors referencing `@r4pm/components`. (If tsc cannot find the package types, ensure `frontend/tsconfig` `moduleResolution` is `bundler` or `node16`; the package's `types` points at `src/index.ts`.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/routes/_smoke/ComponentsSmoke.tsx frontend/src/router.tsx
git commit -m "chore(frontend): smoke route rendering an @r4pm/components component"
```

---

## Task 5: Production build sanity

**Files:** none (verification only)

- [ ] **Step 1: Full build**

Run (from `frontend/`): `pnpm build`
Expected: `tsc && vite build` completes with no errors from `@r4pm/components` (transpile of the linked source, CSS, and subpath resolution all work in the production pipeline, not just dev).

- [ ] **Step 2: If build fails on the linked source**

Common causes + fixes:
- "Failed to resolve entry for @r4pm/components" -> the source-TS `main` needs transpile; ensure `optimizeDeps.exclude` (Task 2) is set and that `vite build` (Rollup) can read the sibling path (the `file:` link is inside `node_modules`, so Rollup follows it; no extra `fs.allow` needed for build).
- xyflow/react duplicate at build -> confirm `resolve.dedupe` includes `@xyflow/react` and both repos are on compatible major (`^12`).
- Record whichever fix was needed as a one-line comment in `vite.config.ts`.

- [ ] **Step 3: Commit any fix**

```bash
git add frontend/vite.config.ts
git commit -m "build(frontend): production build green with @r4pm/components"
```

---

## Self-review notes

- Covers the spec's foundation requirements: local link (Task 1), dedupe/transpile of source-TS package (Task 2), styles + Theme (Task 3), proven render (Task 4), and production build (Task 5).
- Known risk points are called out with concrete fallbacks rather than left as TBD: CSS source-vs-dist (Task 3), React/xyflow dedupe (Tasks 2/4/5), missing peer deps (Task 1 Step 3), tsconfig moduleResolution (Task 4 Step 5).
- No feature behavior changes; the smoke route is dev-only and removed when the track swaps replace it.
- Next plans (not in this file): Track 4 input swaps, Track 1 overview + `ocel/stats`, Track 2 `OcelTypeGraph`, Track 3 OC-DECLARE editor. Each depends on this foundation.
```
