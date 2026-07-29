# Plan 2 — Track 1: OCEL stats, log-overview counts, and count-driven choosers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add an `ocel/stats` backend request returning per-type event/object counts, render them in `/ocel-info` via propel's `OCELCountInfo`, and swap the visual-editor type-variable picker onto propel's count-driven `ObjectTypeChooser`/`ActivityChooser`.

**Architecture:** New Rust `OCELTypeStats` built from `SlimLinkedOCEL` (mirrors `OCELInfo`), exposed at `/ocel/stats` (web-server) + `get_current_ocel_stats` (Tauri), ts-rs-exported, bound in `BackendProviderContext`, consumed via a `useOcelStats` react-query hook. Frontend renders propel components inside a radix `<Theme>` island wrapper. Depends on Plan 1 foundation (link + Vite + tsc dist-paths already in place).

**Tech Stack:** Rust (axum + tauri + ts-rs), React 18 + react-query, `@r4pm/components` (`OCELCountInfo`, `ObjectTypeChooser`, `ActivityChooser`, `Theme`).

## Global Constraints

- Never auto-commit / never push. Stage + surface messages; the user commits.
- Components stay pure: OCPQ feeds `OCELTypeStats` (plain `{event_type_counts, object_type_counts}`) + Set/onChange.
- Backend active OCEL type is `SlimLinkedOCEL` via `LinkedOCELAccess`. Web-server state is `std::sync::RwLock` (`.read().unwrap()`); Tauri state is `tauri::async_runtime::RwLock` (`.read().await`).
- ts-rs output dir set by `.cargo/config.toml` `TS_RS_EXPORT_DIR=frontend/src/types/generated`; regenerate with `cargo test` in `backend/`.
- All propel components must render under a radix `<Theme>` ancestor (loaded css from Plan 1).

---

## Phase A — backend `ocel/stats` (per-type counts)

### Task A1: `OCELTypeStats` type + builder (Rust)

**Files:**
- Modify: `backend/shared/src/lib.rs` (after line 120, past the `OCELInfo` impl)

**Interfaces:**
- Produces: `pub struct OCELTypeStats { event_type_counts: HashMap<String,usize>, object_type_counts: HashMap<String,usize> }` + `impl From<&SlimLinkedOCEL> for OCELTypeStats`.

- [ ] **Step 1: Add the type + impl**

Append after line 120 in `backend/shared/src/lib.rs`:

```rust
#[derive(Debug, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct OCELTypeStats {
    pub event_type_counts: HashMap<String, usize>,
    pub object_type_counts: HashMap<String, usize>,
}

impl From<&SlimLinkedOCEL> for OCELTypeStats {
    fn from(val: &SlimLinkedOCEL) -> Self {
        let event_type_counts = val
            .get_ev_types()
            .map(|t| (t.to_string(), val.get_evs_of_type(t).count()))
            .collect();
        let object_type_counts = val
            .get_ob_types()
            .map(|t| (t.to_string(), val.get_obs_of_type(t).count()))
            .collect();
        OCELTypeStats { event_type_counts, object_type_counts }
    }
}
```

(If `ts_rs` is not already a direct dep of `ocpq-shared`, it is — `ActivityStatistics` in `oc_declare/statistics.rs` uses `#[derive(ts_rs::TS)]`. Confirm with `rg 'ts_rs' backend/shared/Cargo.toml src` before building.)

- [ ] **Step 2: Compile the shared crate**

Run (from `backend/`): `cargo build -p ocpq-shared`
Expected: builds clean. If `get_evs_of_type`/`get_obs_of_type` need the trait in scope, `LinkedOCELAccess` is already imported at lib.rs:14-18.

- [ ] **Step 3: Regenerate ts-rs bindings**

Run (from `backend/`): `cargo test -p ocpq-shared export_bindings 2>&1 | tail -5`
Expected: test passes; `frontend/src/types/generated/OCELTypeStats.ts` now exists containing
`export type OCELTypeStats = { event_type_counts: { [key in string]: number }, object_type_counts: { [key in string]: number }, };`

Verify: `cat frontend/src/types/generated/OCELTypeStats.ts`

- [ ] **Step 4: Stage (commit deferred)**

```bash
git add backend/shared/src/lib.rs frontend/src/types/generated/OCELTypeStats.ts
# commit msg: feat(backend): OCELTypeStats per-type event/object counts + ts-rs export
```

### Task A2: web-server route

**Files:**
- Modify: `backend/web-server/src/main.rs` (import ~:70, route ~:102, handler ~:188)

**Interfaces:**
- Consumes: `OCELTypeStats` from A1, `with_ocel_from_state` (main.rs:244).
- Produces: `GET /ocel/stats -> Json<Option<OCELTypeStats>>`.

- [ ] **Step 1: Import the type**

Add `OCELTypeStats` to the `ocpq_shared::{...}` import that already brings in `OCELInfo` (~line 70).

- [ ] **Step 2: Register the route**

After the `.route("/ocel/info", get(get_loaded_ocel_info))` line (~102):

```rust
.route("/ocel/stats", get(get_loaded_ocel_stats))
```

- [ ] **Step 3: Add the handler**

Mirror `get_loaded_ocel_info` (~181-188):

```rust
async fn get_loaded_ocel_stats(
    State(state): State<AppState>,
) -> (StatusCode, Json<Option<OCELTypeStats>>) {
    match with_ocel_from_state(&State(state), |ocel| ocel.into()) {
        Some(stats) => (StatusCode::OK, Json(Some(stats))),
        None => (StatusCode::NOT_FOUND, Json(None)),
    }
}
```

- [ ] **Step 4: Build**

Run (from `backend/`): `cargo build -p ocpq-web-server`
Expected: builds clean.

- [ ] **Step 5: Stage**

```bash
git add backend/web-server/src/main.rs
# commit msg: feat(web-server): GET /ocel/stats endpoint
```

### Task A3: Tauri command

**Files:**
- Modify: `tauri/src-tauri/src/main.rs` (import ~:49, command ~:156, register ~:610)

**Interfaces:**
- Consumes: `OCELTypeStats`.
- Produces: `get_current_ocel_stats` tauri command.

- [ ] **Step 1: Import + command + register**

Add `OCELTypeStats` to the `ocpq_shared::{...}` import (~49). Add after `get_current_ocel_info` (~156):

```rust
#[tauri::command(async)]
async fn get_current_ocel_stats(
    state: tauri::State<'_, AppState>,
) -> Result<Option<OCELTypeStats>, String> {
    Ok(match state.ocel.read().await.as_ref() {
        Some(ocel) => Some(ocel.into()),
        None => None,
    })
}
```

Add `get_current_ocel_stats,` to the `tauri::generate_handler![ ... ]` list (after `get_current_ocel_info`, ~610).

- [ ] **Step 2: Build**

Run (from `tauri/src-tauri/`): `cargo build` (or skip if the tauri toolchain is heavy — the web-server path is enough to exercise the frontend in `pnpm dev`; note the skip).
Expected: builds clean, or documented skip.

- [ ] **Step 3: Stage**

```bash
git add tauri/src-tauri/src/main.rs
# commit msg: feat(tauri): get_current_ocel_stats command
```

### Task A4: frontend binding + hook

**Files:**
- Modify: `frontend/src/BackendProviderContext.ts` (interface :48, stub :154, web impl :195)
- Modify: `tauri/src/main.tsx` (:36)
- Modify: `frontend/src/hooks/useOcelInfo.ts`

**Interfaces:**
- Consumes: generated `OCELTypeStats`, backend `ocel/stats`.
- Produces: `backend["ocel/stats"](): Promise<OCELTypeStats | undefined>`, `useOcelStats()` react-query hook keyed `["ocel","stats"]`.

- [ ] **Step 1: Binding type + impls**

In `BackendProviderContext.ts`:
- Import: `import type { OCELTypeStats } from "./types/generated/OCELTypeStats";`
- After the `"ocel/info"` interface line (:48): `"ocel/stats": () => Promise<OCELTypeStats | undefined>;`
- After the `"ocel/info"` error stub (:154): `"ocel/stats": warnForNoBackendProvider,`
- After the web `"ocel/info"` impl (:195):

```ts
"ocel/stats": async () => {
    const res = await fetch(`${localBackendURL}/ocel/stats`, { method: "get", headers: {} });
    return await res.json();
},
```

In `tauri/src/main.tsx` after the `"ocel/info"` impl (:36):

```ts
"ocel/stats": async () => await invoke("get_current_ocel_stats"),
```

- [ ] **Step 2: Hook**

In `frontend/src/hooks/useOcelInfo.ts`, add:

```ts
export function useOcelStats() {
  return useOcelStatsQuery().data;
}
export function useOcelStatsQuery() {
  const backend = useBackend();
  return useQuery({
    queryKey: ["ocel", "stats"],
    queryFn: () => backend["ocel/stats"](),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}
```

- [ ] **Step 3: Typecheck**

Run (from `frontend/`): `pnpm exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Stage**

```bash
git add frontend/src/BackendProviderContext.ts tauri/src/main.tsx frontend/src/hooks/useOcelInfo.ts
# commit msg: feat(frontend): ocel/stats binding + useOcelStats hook
```

---

## Phase B — log-overview counts via propel `OCELCountInfo`

### Task B1: radix Theme island wrapper

**Files:**
- Create: `frontend/src/components/r4pm/R4pmIsland.tsx`

**Interfaces:**
- Produces: `R4pmIsland` — wraps children in `@r4pm/components/ui` `Theme` so any propel component renders correctly inside OCPQ's shadcn app without restyling the rest of the page.

- [ ] **Step 1: Write it**

```tsx
import { Theme } from "@r4pm/components/ui";
import type { ReactNode } from "react";

/** Scopes propel @r4pm/components (radix Themes based) inside OCPQ's own (shadcn) UI.
 *  Wrap each propel-component usage so its radix tokens apply locally, not app-wide. */
export function R4pmIsland({ children }: { children: ReactNode }) {
  return <Theme hasBackground={false}>{children}</Theme>;
}
```

(`hasBackground={false}` so the island doesn't paint a radix panel background over OCPQ's layout. If a component needs the radix surface, drop it for that usage.)

- [ ] **Step 2: Typecheck** — `pnpm exec tsc --noEmit` → 0 errors.

- [ ] **Step 3: Stage** — `git add frontend/src/components/r4pm/R4pmIsland.tsx`

### Task B2: render `OCELCountInfo` in `/ocel-info`

**Files:**
- Modify: `frontend/src/routes/ocel-info/OcelInfoViewer.tsx`

**Interfaces:**
- Consumes: `useOcelStats()` (A4), `OCELCountInfo` from `@r4pm/components`, `R4pmIsland` (B1).

- [ ] **Step 1: Add the counts section**

In `OcelInfoViewer.tsx`: import `OCELCountInfo` from `@r4pm/components`, `R4pmIsland` from `@/components/r4pm/R4pmIsland`, and `useOcelStats` from the hook. Below the existing totals (after the `num_events`/`num_objects` header, ~line 22), add:

```tsx
{ocelStats && (
  <R4pmIsland>
    <OCELCountInfo data={ocelStats} />
  </R4pmIsland>
)}
```

with `const ocelStats = useOcelStats();` next to the existing `useOcelInfo()` call (~line 12).

Do NOT remove the existing per-type attribute cards yet (that is the later attribute-stats phase). Also drop the "What do you want to do?" marketing panel (lines ~23-55) — it is not data.

- [ ] **Step 2: Typecheck** — `pnpm exec tsc --noEmit` → 0 errors.

- [ ] **Step 3: Verify render**

With the web-server backend running + an OCEL loaded, open `/ocel-info` in `pnpm dev`.
Expected: a "OCEL Counts" card with ranked bars for event types and object types, matching the loaded OCEL; no console React errors. (If no backend is running, the section is absent — `ocelStats` undefined — which is the correct graceful degrade.)

- [ ] **Step 4: Stage**

```bash
git add frontend/src/routes/ocel-info/OcelInfoViewer.tsx
# commit msg: feat(ocel-info): per-type counts via @r4pm/components OCELCountInfo
```

---

## Phase C — count-driven type-variable chooser (your example)

### Task C1: swap the type MultiSelect onto `ObjectTypeChooser`/`ActivityChooser`

**Files:**
- Modify: `frontend/src/routes/visual-editor/helper/box/NewVariablesChooser.tsx`

**Interfaces:**
- Consumes: `useOcelStats()`, `ObjectTypeChooser`/`ActivityChooser` from `@r4pm/components`, `R4pmIsland`.
- Current picker: `MultiSelect` (`:262-275`) over `ocelInfo.object_types`/`event_types` names, `alertState.value: string[]`.

- [ ] **Step 1: Replace the MultiSelect with the count-driven chooser**

In the dialog body (~:262-275), replace the `MultiSelect` with (inside `R4pmIsland`):

```tsx
{alertState.variant === "object" ? (
  <ObjectTypeChooser
    counts={ocelStats?.object_type_counts ?? Object.fromEntries((ocelInfo?.object_types ?? []).map((t) => [t.name, 0]))}
    value={new Set(alertState.value)}
    onChange={(next) => setAlertState((s) => (s ? { ...s, value: [...next] } : s))}
    mode="multi"
    searchable
  />
) : (
  <ActivityChooser
    counts={ocelStats?.event_type_counts ?? Object.fromEntries((ocelInfo?.event_types ?? []).map((t) => [t.name, 0]))}
    value={new Set(alertState.value)}
    onChange={(next) => setAlertState((s) => (s ? { ...s, value: [...next] } : s))}
    mode="multi"
    searchable
  />
)}
```

with `const ocelStats = useOcelStats();` added near the existing `ctx`/`ocelInfo` access (~:34). The chooser lists every type from `counts`; the fallback (`0` counts from `ocelInfo`) keeps it working before stats load — it degrades to a plain searchable list rather than breaking.

Keep the variable-index `Combobox` (`:233-261`) and add/save/delete logic unchanged — only the type-selection control changes.

- [ ] **Step 2: Typecheck** — `pnpm exec tsc --noEmit` → 0 errors. (Set<->array bridging must line up with `alertState.value: string[]`.)

- [ ] **Step 3: Verify render**

Open the constraint editor, add an object/event variable, open the type dialog.
Expected: the chooser shows types with frequency bars + counts (from `ocel/stats`), multi-select toggling works, selected types persist on Save exactly as before.

- [ ] **Step 4: Stage**

```bash
git add frontend/src/routes/visual-editor/helper/box/NewVariablesChooser.tsx
# commit msg: feat(visual-editor): count-driven type picker via @r4pm/components choosers
```

---

## Deferred (follow-up plan, additive)

- `OcelAttributeStats` (per-attribute value stats: min/max, distinct, null-rate, examples) + `OcelAttributeList` component; extend `ocel/stats` (or a `ocel/attribute-stats` request).
- `OcelTemporalSpan` + events-over-time via propel `EventsPerTime`.
- `OcelOverview` full composition + retiring the old per-type attribute cards.
- path-schemas source/target picker onto choosers (rides with Track 2, counts already exist there).

## Self-review notes

- Spec coverage: per-type counts (A), overview counts render (B), count-driven chooser = your example (C). Attribute/temporal/full-overview explicitly deferred, not dropped.
- No placeholders: Rust struct/impl, handler, command, binding, hook, island, and both frontend swaps carry full code.
- Type consistency: `OCELTypeStats { event_type_counts, object_type_counts: HashMap<String,usize> }` is identical across Rust, generated TS, binding, `OCELCountInfo` prop, and chooser `counts` — the propel `OCELTypeStats` view-model matches field-for-field.
- Backend build cost: Rust compile of `ocpq-shared`/`web-server` may take minutes; Tauri build (A3) may be skipped for a web-only dev verify, noted in the task.
```
