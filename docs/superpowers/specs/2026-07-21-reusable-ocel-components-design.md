# Reusable OCEL Components (propel `@r4pm/components`) consumed by OCPQ

Date: 2026-07-21
Status: Design in review (brainstorming). Ready for implementation planning once approved.

## Goal

Adopt propel's `@r4pm/components` as OCPQ's shared UI layer, building/extending **reusable, pure**
React components and consuming them from OCPQ. Four tracks:

1. **Log overview** (`/ocel-info`) — replace the thin counts-only page with per-type counts,
   attribute value stats, temporal span, and relationship structure (via the type-graph).
2. **Type-level path-schema graph** (`/path-schemas`) — replace the bespoke read-only `TypeGraphView`
   with a generic, host-driven, **view-only** OCEL type-graph viewer that scales to large graphs via
   filtering (search, scope, hub-collapse, neighbor-expand, focus).
3. **OC-DECLARE editor** (`/oc-declare/:id`) — extend propel's OC-DECLARE **viewer** into a full
   **editor** and replace OCPQ's bespoke `OCDeclareFlowEditor`.
4. **Strong-fit input/display reuse** — swap OCPQ's bespoke inputs onto propel equivalents (choosers,
   frequency picker, selection actions, dataset selector, sequence chips, json viewer).

The path-schema type-graph (track 2) is **view-only** (no add/remove/connect). OC-DECLARE (track 3)
**is** a genuine editor — different feature, no contradiction.

## Principles / constraints

- **Components are pure and backend-free** (propel's components-pure boundary). No fetch, no backend
  types imported. Backend-driven behavior is provided by the host through **injected callbacks / view-
  model props** (the pattern OC-DECLARE's viewer already uses for `activityColor`, `layoutOverride`,
  `renderSvg`).
- OCPQ **mirrors the needed Rust functions** to compute view-models and serializes them as plain JSON,
  structurally assignable from OCPQ's `ts-rs`-generated types.
- **Local link** for dev: OCPQ points at the local propel checkout (`file:`/link), both repos live
  side-by-side under `~/doc/projects`. No publish cycle to iterate.
- Stack matches: both use `@xyflow/react` + `elkjs` + `@radix-ui/themes` + plotly. No porting.
- Styling: components ship `@r4pm/components/styles.css` + `Theme`; OCPQ imports the stylesheet and
  wraps consumers in `Theme`. Adoption is incremental (components are individually importable), so the
  radix-`Theme` dependency lands page-by-page rather than as a big-bang migration.
- Follow propel conventions: Storybook story per component (with `docs.story.iframeHeight`) +
  view-model transform unit tests.
- Never auto-commit / never push (user rule). The user commits.

## Reuse inventory (already in `@r4pm/components`, no rebuild)

- Log: `OCELCountInfo`, `LogMetadataCard`, `StatCards`, `RankedBarList`, `CoverageBar`; charts
  (`EventsPerTime`, `ObjectAttributeChanges`, `DottedChart`, `CaseDuration`).
- Inputs: `inputs/choosers` (`ActivityChooser`, `ObjectTypeChooser`, `ObjectChooser`,
  `DatasetSelector`), `inputs/FrequencyPicker`, `inputs/SelectionActions`.
- Display: `shared/ActivitySequence` (`ActivityChip`, `ActivitySequence`), `shared/ObjectCentricSequence`,
  `json-viewer`, `softBadgeStyle`/`colorToHex`.
- OC-DECLARE: `oc-declare/` viewer — xyflow-based, self-contained extractable types (`RawConstraint`
  == backend `OCDeclareArc`; arc types AS/EF/EP/DF/DP; `ConstraintLabel` each/any/all; EFEP/DFDP
  pair-collapse for display), Rust/ELK layout, export, involvement dot strip. Read-only today.
- Infra: `graph-edit/` (RoutedEdge + routing), `viewer/export`, `viewer/dark-mode`, `Theme`.

Confirmed absent (genuinely new): OCEL type-graph viewer, per-type attribute value-stats card,
OC-DECLARE editing layer.

## Track 1 + 2 — new reusable components

### `OcelTypeGraph` — generic, host-driven, view-only (track 2)

New module `src/ocel-type-graph/`, modeled on `oc-declare/OCDeclareViz.tsx` (xyflow + ELK, injectable
layout, `useRegisterExport`, `useIsDarkMode`, `Theme`; reuse `graph-edit` routing).

- Props: `nodes: {id; kind:"event"|"object"; label; count?}[]`,
  `edges: {id; source; target; kind:"e2o"|"o2o"; qualifier?; count?}[]`.
- Host-driven styling/selection (path-schema-agnostic): `nodeRingColor?(id)`,
  `highlightedEdgeIds?: Set<string>` + `edgeStyle?(id)`, `onNodeClick?(id)`, `onEdgeClick?(id)`.
- Large-graph controls (built in, view-only): type **search**; **scope checklist** (port
  `TypeFilterPopover`, using `SelectionActions` for all/clear/invert); **hub-aware collapse** (render
  hub as a collapsible count-badged node instead of silently dropping past a cap — fixes the current
  `MAX_SCOPE_TYPES=50` silent skip); **focus-on-node**; **count badges**; layout runs on structural
  change but **fitView only on explicit action** (fixes viewport jump).
- Rendering: event near-square, object pill; E2O solid, O2O dashed; qualifier label; parallel qualified
  edges distinguishable. Knows nothing about path schemas — source/target rings and schema-edge
  highlight are host-supplied styling.
- Used in BOTH `/path-schemas` and the overview. Relationships surface **only** through this graph
  (no separate relationship table).

### `OcelAttributeList` — per-type attribute detail card (track 1)

Attribute rows: data-type icon + name + `(type)` (port OCPQ `IconForDataType`), plus **optional value
stats** per attribute: min/max (numeric/time), distinct count, null/missing rate, examples. Degrades to
name+type when stats absent. View-model `OcelAttributeStats`.

### `OcelOverview` — convenience composition (track 1)

Assembles `OCELCountInfo` + `LogMetadataCard`/`StatCards` (totals + temporal span) + `EventsPerTime`
(events-over-time) + `OcelAttributeList` + `OcelTypeGraph` (relationships). Sub-components stay
independently exported; `OcelOverview` is a ready-to-mount dashboard.

### View-models (pure TS, mirror Rust)

- `OCELTypeStats` (exists), `OcelAttributeStats`, `OcelTemporalSpan` (`{first_event, last_event,
  buckets:{t,count}[]}`), `OcelTypeGraphData` (`{nodes, edges}` in the prop shape).

## Track 3 — OC-DECLARE editor (`@r4pm/components`)

Extend `oc-declare/` from viewer to editor. Add an editing surface (either an `editable` mode on
`OCDeclareViz` or a sibling `OCDeclareEditor` sharing its node/edge components + layout) that is a
drop-in replacement for OCPQ's `OCDeclareFlowEditor`. The canonical `OCDeclareArc[]` remains a pure
derivation of the flow graph; component `value`/`onChange` expose the editable model.

**Node kinds** (single xyflow `activity` node type + `isObject` discriminator, label-prefix only):
Activity, Object **Init** (`<init> type`), Object **Exit** (`<exit> type`). Palette fed by host-supplied
`event_types` / `object_types`.

**Edge = constraint** with the 9-template UI layer over the 5 backend arc types:
`as, ef, ef-rev(EP), df, df-rev(DP), nef, nef-rev, ndf, ndf-rev` — negation is `[0,0]` counts, not a
separate concept. Editable: **edge-type** picker (context menu / popover with arrowhead previews),
**cardinality** `[min,max]` via a proper **popover** (replace OCPQ's native `prompt()`), **switch
direction**, **delete**, and the **object-label dialog** (each/all/any × Simple/O2O × direction, with
live E2O/O2O **support hints**).

**Interactions to replicate:** drag-connect handles with auto-derived default label (intersect
related object types), inline node-name edit (parses `<init>`/`<exit>` prefixes), copy/paste
(MIME `application/json+oc-declare-flow`, also accept raw `OCDeclareArc[]`), select-all, ELK layout
button + auto-layout after discovery/paste, keyboard shortcuts.

**Injected (host-supplied) backend-driven callbacks** — keep the component pure:
- `onDiscover(options) => Promise<OCDeclareArc[]>` (feeds `addArcsToFlow`).
- `onEvaluate(arcs) => Promise<number[]>` (per-arc violation fraction → edge % + color bar).
- `onActivityStatistics` / `onEdgeStatistics` (InfoSheet content).
- `onTemplateString(arcs) => Promise<string>` (text export).
- `getSupport(assoc)` for the object-label dialog hints.
- Color resolvers + layout override (already viewer props).
Discovery options UI (`OCDeclareDiscoveryButton`: O2O mode, noise threshold, reduction, refinement,
arrow-type multiselect, activity subset) ports alongside, driving `onDiscover`.

**Notes:** editing must not EFEP/DFDP pair-collapse (collapse is display-only). Persistence stays the
host's concern (OCPQ keeps localStorage flow-JSON); the component is controlled via `value`/`onChange`.
Editing primitives reimplemented on radix (`@r4pm/components/ui`) instead of OCPQ's shadcn set.

## Track 4 — strong-fit input/display reuse (in scope)

Swap these OCPQ spots onto existing propel components (pure input swaps, no backend work):

| OCPQ spot | propel component |
|---|---|
| Object/event **type variable** selection (`NewVariablesChooser`, `FilterChooser`, GateNode, path-schemas source/target) | `ObjectTypeChooser` / `ActivityChooser` / `ObjectChooser` |
| **Selectivity/threshold/support** sliders (path-schemas pruning; oc-declare discovery noise threshold) | `FrequencyPicker` |
| Scope checklist all/clear/invert (`TypeFilterPopover`, `multi-select`) | `SelectionActions` (key-set actions only; temporal All/First/Last/Closest **stays OCPQ**) |
| **Schema path** chips-and-arrows (`SchemaPathDiagram`, `KindBadge`) | `ObjectCentricSequence` / `ActivitySequence` / `ActivityChip` |
| Dataset/OCEL picker (`OcelSelector`) | `DatasetSelector` |
| Raw **JSON** displays (`InfoSheetViewer`, `ViolationDetailsSheet`, HPC config, data-extraction) | `json-viewer` |

Deferred (needs view-model shaping, later): path-schema metrics heatmap cells → `CoverageBar`/`StatCards`.

## OCPQ integration

### Backend (`backend/shared`, `backend/web-server`, `tauri`)
- Mirror a Rust function computing overview stats from `SlimLinkedOCEL`: per-type counts, per-attribute
  value stats, temporal span (first/last + histogram buckets). Expose via a **separate lazy
  `ocel/stats` request** (not on `OCELInfo`), mirrored across web-server route + Tauri command +
  `BackendProviderContext` binding (follow the `ocel/info` pattern). E2O/O2O + qualifiers already
  computed in `OCELInfo`, reused for the graph.
- OC-DECLARE backend endpoints already exist (`discover-oc-declare`, `evaluate-oc-declare-arcs`,
  `template-string`, activity/edge statistics) — wired into the editor via injected callbacks, no new
  backend needed for track 3.

### Frontend
- `/ocel-info`: rebuild `OcelInfoViewer` onto `OcelOverview`; drop the marketing panel; keep
  export/unload; lazy-fetch `ocel/stats`.
- `/path-schemas`: replace `TypeGraphView` with `OcelTypeGraph`; `PathSchemasViewer` keeps
  enumerate/metrics logic, drives source/target + schema highlight via generic props. Adopt choosers +
  `FrequencyPicker` + `SelectionActions` + schema-chip components here.
- `/oc-declare/:id`: replace `OCDeclareFlowEditor` with propel's OC-DECLARE editor, injecting OCPQ's
  backend calls; delete the bespoke `flow/` implementation once parity is verified.
- Global: `DatasetSelector`, `json-viewer` swaps where they appear.

## Testing

- Per new/extended component: view-model transform unit tests + Storybook story (with `iframeHeight`).
- OC-DECLARE editor: story with a stubbed `onEvaluate`/`onDiscover`; parity checklist against OCPQ's
  current editor before deleting the bespoke one.
- Backend: unit-test the `ocel/stats` function against a small fixture OCEL.
- OCPQ: verify all four tracks against a sample OCEL (order-management OCEL 2.0).

## Out of scope

- Structural editing of the **path-schema type-graph** (track 2 stays view-only).
- Required-waypoint pins / per-qualifier path constraints / cycles / multi-target in path-schemas
  (backend-driven; separate future work).
- Path-schema metrics heatmap migration (deferred, track 4 note).

## Decisions (resolved in brainstorming)

Consumption = local link. Overview stats = mirror Rust function, separate lazy `ocel/stats`. Graph API
= generic + host-driven. Overview = ship both pieces and dashboard. Relationships = graph-only.
Path-schema type-graph = view-only. Strong-fit input reuse folded in now. OC-DECLARE = extend propel
viewer into an editor and replace OCPQ's.
