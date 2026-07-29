# Plan 3 — Attribute value-stats + reusable histogram/selector

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Per-attribute value statistics (histogram + min/max/mean/distinct/top-values/null) computed on demand, rendered as a reusable `@r4pm/components` component that both *displays* distributions in `/ocel-info` and *drives* interactive value selection in OCPQ's attribute filter editor (its selection value is structurally OCPQ's `ValueFilter`).

**Architecture:** New Rust `OcelAttributeStats` (tagged by value type) computed from `SlimLinkedOCEL` for one `(scope, type, attribute)` on demand; POST `/ocel/attribute-stats` (web) + tauri command; ts-rs export; binding + `useAttributeStats` hook. New pure propel `AttributeValueStats` component (ThemedPlot histogram / RankedBarList / split bar + StatCards; optional `value`+`onChange` selection). Wired into `OCELCountInfo` attribute detail (display, via `onAttributeClick`) and OCPQ `AttributeValueFilterSelector` (interactive).

**Tech Stack:** Rust (axum+tauri+ts-rs), React 18, `@r4pm/components` (`ThemedPlot`, `StatCards`, `RankedBarList`), react-query.

## Global Constraints

- Never auto-commit / never push. Stage, surface messages.
- propel components pure/backend-free; OCPQ fetches and passes `data`.
- Selection contract mirrors OCPQ `ValueFilter` (`generated/ValueFilter.ts`): `{type:"Float"|"Integer", min:number|null, max:number|null} | {type:"String", is_in:string[]} | {type:"Boolean", is_true:boolean} | {type:"Time", from:string|null, to:string|null}`.
- Histogram convention = propel `CaseDurations`: `hist_bin_edges` (N+1) + `hist_counts` (N).
- `OCELAttributeValue` variants: `Integer(i64) | Float(f64) | Boolean(bool) | Time(DateTime<FixedOffset>) | String(String) | Null`.
- Editing a propel component's public API requires a propel `dist` rebuild (`pnpm --filter @r4pm/components build`) for OCPQ tsc.

---

## Phase A — backend `ocel/attribute-stats`

### A1: `OcelAttributeStats` type + compute (Rust)
**Files:** Create `backend/shared/src/ocel_stats.rs` (or append in `lib.rs`); export from crate.

Type (tag = `type`, ts-rs export):
```rust
#[derive(Serialize, Deserialize, ts_rs::TS)] #[ts(export)] #[serde(tag = "kind")]
pub enum OcelAttributeStats {
    Float { min: f64, max: f64, mean: f64, hist_bin_edges: Vec<f64>, hist_counts: Vec<usize>, count: usize, null_count: usize },
    Integer { min: f64, max: f64, mean: f64, hist_bin_edges: Vec<f64>, hist_counts: Vec<usize>, count: usize, null_count: usize },
    Str { top_values: Vec<AttrValueCount>, distinct: usize, count: usize, null_count: usize },
    Bool { true_count: usize, false_count: usize, null_count: usize },
    Time { min: String, max: String, hist_bin_edges_ms: Vec<f64>, hist_counts: Vec<usize>, count: usize, null_count: usize },
    Empty,
}
#[derive(Serialize, Deserialize, ts_rs::TS)] #[ts(export)]
pub struct AttrValueCount { pub value: String, pub count: usize }
```
Free fn `pub fn get_ocel_attribute_stats(ocel: &SlimLinkedOCEL, scope: AttrScope, type_name: &str, attr: &str) -> OcelAttributeStats` where `AttrScope { Event, Object }`.
- Pick variant from the declared attribute type via `get_ev_type/get_ob_type` -> `OCELTypeAttribute.value_type` (lowercased: float/integer/boolean/time/string).
- Collect values: events via `get_evs_of_type(type).filter_map(get_ev_attr_val(ev, attr))`; objects via `get_obs_of_type(type)` + `get_ob_attr_vals(ob, attr)` (take all timestamped values). Count `Null`/missing into `null_count`.
- Numeric: gather f64 (Float(f); Integer(i) as f64), `min/max/mean`, 20-bin linear histogram (fewer if `min==max`).
- Time: parse to epoch-ms, min/max RFC3339, 20-bin histogram over ms.
- String: frequency map -> `distinct` + top-20 `top_values` desc.
- Bool: true/false counts.
- No non-null values -> `Empty`.
- Helper `fn linspace_hist(vals: &[f64], nbins: usize) -> (Vec<f64>, Vec<usize>)`.

- [ ] Write type + fn. Build `cargo build -p ocpq-shared`. Regenerate ts-rs (`cargo test -p ocpq-shared export_bindings`) -> `OcelAttributeStats.ts`, `AttrValueCount.ts`.

### A2: web-server endpoint
**Files:** `backend/web-server/src/main.rs`.
- Request struct `AttributeStatsReq { scope: AttrScope, type_name: String, attribute: String }` (ts-rs export or reuse serde).
- `POST /ocel/attribute-stats` -> handler using `with_ocel_from_state(|ocel| get_ocel_attribute_stats(ocel, req.scope, &req.type_name, &req.attribute))` -> `Json<Option<OcelAttributeStats>>`.
- Build `cargo build -p ocpq-web-server`.

### A3: tauri command
**Files:** `tauri/src-tauri/src/main.rs`. `#[tauri::command(async)] get_ocel_attribute_stats(scope, type_name, attribute)` mirroring A2; register in `generate_handler!`. `cargo check`.

### A4: binding + hook
**Files:** `frontend/src/BackendProviderContext.ts`, `tauri/src/main.tsx`, `frontend/src/hooks/useOcelInfo.ts` (or new `useAttributeStats.ts`).
- Binding: `"ocel/attribute-stats": (scope: "event"|"object", type: string, attribute: string) => Promise<OcelAttributeStats | undefined>` + error stub + web fetch (POST JSON body) + tauri invoke.
- Hook `useAttributeStats(scope, type, attr)` react-query, key `["ocel","attr-stats",scope,type,attr]`, `enabled: !!attr`, staleTime Infinity.
- `pnpm exec tsc --noEmit` = 0.

---

## Phase B — propel `AttributeValueStats` component

**Files:** Create `packages/components/src/attribute-value-stats.tsx`; export from `index.ts`.

Local view-model mirrors `OcelAttributeStats` (structurally assignable). Selection type:
```ts
export type AttributeValueSelection =
  | { type: "Float" | "Integer"; min: number | null; max: number | null }
  | { type: "String"; is_in: string[] }
  | { type: "Boolean"; is_true: boolean }
  | { type: "Time"; from: string | null; to: string | null };
```
Props: `{ stat: OcelAttributeStats; value?: AttributeValueSelection; onChange?: (sel: AttributeValueSelection) => void; }`. When `onChange` absent = read-only display.
- Float/Integer: `ThemedPlot` bar histogram from `hist_bin_edges`+`hist_counts`; `StatCards` [min,max,mean,count,null%]. Interactive: plotly `onRelayout` x-range or a min/max number pair overlaid -> emit `{type, min, max}`; shade selected range.
- Time: same via `hist_bin_edges_ms`; emit `{type:"Time", from, to}` (ms -> RFC3339).
- Str: `RankedBarList` of `top_values` (`onItemClick` multi-toggle when interactive -> `is_in`); `distinct`/`null` chips; `selectedKey`/highlight for chosen values.
- Bool: split bar true/false; toggle -> `{is_true}`.
- Empty: muted "No values".

- [ ] Write component + a Storybook story (`iframeHeight` set) with one numeric + one categorical fixture. `pnpm --filter @r4pm/components build`.

---

## Phase C — `/ocel-info` display integration

**Files:** `packages/components/src/ocel-count-info.tsx` (add `onAttributeClick?(scope,type,attr)` to attribute badges), `frontend/src/routes/ocel-info/OcelInfoViewer.tsx`.
- OCELCountInfo: make each attribute badge in `AttributeDetail` clickable, emit `onAttributeClick(scope, type, attr.name)`; visually mark the active attribute. Keep read-only when no handler.
- OCPQ: track selected `{scope,type,attr}`, `useAttributeStats(...)`, render propel `AttributeValueStats` (read-only, no `onChange`) below the card in an `R4pmIsland`.
- Rebuild propel dist; `tsc` 0; manual: click type -> click attribute -> histogram/stats show.

---

## Phase D — attribute filter editor integration (interactive)

**Files:** `frontend/src/routes/visual-editor/helper/box/filter-helpers.tsx` (`AttributeValueFilterSelector`, `NumberRangeInput`, `StringListInput`, `TimeRangeInput`).
- The chosen filter attribute is known (`AttributeNameSelector`) + its var's type (`getTypesForVariable`). Fetch `useAttributeStats(scope, typeName, attrName)` for the picked attribute (scope+type from the variable).
- Render propel `AttributeValueStats` interactive: `value` = current `ValueFilter` (structurally == `AttributeValueSelection`), `onChange` -> `setValueFilter(sel)`. Keep the manual number/string/time inputs as a fallback/secondary (histogram is the primary picker); or replace them.
- Guard: when no stats (attr has no values / not loaded), fall back to the existing inputs.
- `tsc` 0; manual: in constraint editor, add an attribute-value filter -> histogram appears, brushing sets the range/values, saved filter matches.

---

## Deferred
- data-extraction `ConditionBuilder` (separate `ChangeTableCondition` string model) — not in scope.
- Caching/perf for very large logs (per-attribute on-demand already bounds it).

## Self-review
- Covers: backend stats (A), reusable component (B), display (C), interactive filter (D).
- Type consistency: `OcelAttributeStats` identical Rust/TS; `AttributeValueSelection` structurally == `ValueFilter`.
- propel dist rebuild flagged wherever a public API changes (A n/a, B new export, C new prop).
