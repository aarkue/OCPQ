# OC-DECLARE Editor — Design Spec

Status: approved design (2026-07-21). Extends Track 3 of
`2026-07-21-reusable-ocel-components-design.md` into a full standalone spec.

## Goal

Extend propel's `@r4pm/components` `oc-declare` **viewer** into an **editor**, as a drop-in
replacement for OCPQ's bespoke `OCDeclareFlowEditor` (`routes/oc-declare/flow/`, ~3k lines). The
component stays backend-free: all backend work is injected by the host as callbacks. After parity is
verified against a checklist, OCPQ's `flow/` implementation is deleted.

## Locked decisions

- **Editing lives as an `editable` mode on `OCDeclareViz`** (single component, mode flag), not a
  sibling component.
- **One comprehensive spec** (this doc), one implementation plan.
- **Editable value = a lossless flow model** (`DeclareFlowModel`, positions included); `OCDeclareArc[]`
  is a pure *derivation* feeding backend callbacks + the read-only render.
- **Object-involvement rendering: quantifier dots + gradient is the default and the path forward**;
  the `∀`/`ALL()`/`ANY()` text labels are supported behind an opt-in prop.
- **Statistics sheets render inside the component** (Plotly histograms move into propel, fed by
  injected stats data).
- **Persistence stays the host's concern** — OCPQ keeps its localStorage flow-JSON, mapping ↔
  `DeclareFlowModel`. The component is controlled via `value`/`onChange`.
- Editing primitives reimplemented on radix (`@r4pm/components/ui`), not OCPQ's shadcn set.

## 1. Editable model & data flow

The component's `value`/`onChange` expose the editable model. `OCDeclareArc[]` is derived from it.

```ts
interface DeclareFlowModel {
  nodes: DeclareNode[];
  edges: DeclareEdge[];
}

interface DeclareNode {
  id: string;
  type: string;                       // activity name or object-type name
  kind: "activity" | "init" | "exit"; // object init/exit vs plain activity
  position?: { x: number; y: number };
}

type EdgeTemplate =
  | "as" | "ef" | "ef-rev" | "df" | "df-rev"
  | "nef" | "nef-rev" | "ndf" | "ndf-rev"; // 9 UI templates; negation = [0,0] counts

interface DeclareEdge {
  id: string;
  source: string;                     // node id
  target: string;                     // node id
  template: EdgeTemplate;
  cardinality?: [number | null, number | null];
  label: OCDeclareArcLabel;           // each/any/all of ObjectTypeAssociation (O2O-lossless)
  violation?: number;                 // 0..1, set by onEvaluate; render-only
}

// Reused, lossless (already in index.tsx):
interface OCDeclareArcLabel { each: ObjectTypeAssociation[]; any: ObjectTypeAssociation[]; all: ObjectTypeAssociation[] }
type ObjectTypeAssociation =
  | { object_type: string; type: "Simple" }
  | { first: string; second: string; reversed: boolean; type: "O2O" };
```

**Template → backend arc + counts** (pure table; mirrors OCPQ `translateArcInfo`):

| template | arc_type | counts |
|---|---|---|
| `as` | AS | `cardinality ?? [1,null]` |
| `ef` | EF | `cardinality ?? [1,null]` |
| `ef-rev` | EP | `cardinality ?? [1,null]` |
| `df` | DF | `cardinality ?? [1,null]` |
| `df-rev` | DP | `cardinality ?? [1,null]` |
| `nef` | EF | `[0,0]` |
| `nef-rev` | EP | `[0,0]` |
| `ndf` | DF | `[0,0]` |
| `ndf-rev` | DP | `[0,0]` |

**Derivations (pure, unit-tested):**
- `toArcs(model): OCDeclareArc[]` — one arc per edge; `from`/`to` resolved from node `type` with
  `<init> `/`<exit> ` prefixing per node `kind`; `[arc_type, counts]` from the table; `label` passthrough.
- `arcsToModel(arcs): DeclareFlowModel` — inverse for import/paste; template chosen from
  `(arc_type, counts==[0,0])`; nodes deduped by name, `<init>`/`<exit>` prefixes parsed to `kind`.
  Positions unset (host or auto-layout assigns).
- The **read-only render** derives `RawConstraint[]` from the model exactly as today
  (`toRawConstraint` + `collapseEfEpPairs` for display only — collapse never mutates the edit model).

## 2. Component API

`OCDeclareViz` gains editing props; the read-only path is unchanged when `editable` is falsy.

```ts
interface OCDeclareVizEditProps {
  editable?: boolean;
  value?: DeclareFlowModel;                 // controlled edit model
  onChange?: (next: DeclareFlowModel) => void;

  // Host palette + support (from OCEL info)
  eventTypes?: string[];
  objectTypes?: string[];
  getSupport?: (assoc: ObjectTypeAssociation, ctx: SupportCtx) => number | undefined;

  // Injected backend callbacks (each optional; absent -> that affordance hides)
  onDiscover?: (options: DiscoveryOptions) => Promise<OCDeclareArc[]>;
  onEvaluate?: (arcs: OCDeclareArc[]) => Promise<number[]>;         // per-arc violation fraction
  onActivityStatistics?: (activity: string) => Promise<ActivityStatistics>;
  onEdgeStatistics?: (arc: OCDeclareArc) => Promise<BinnedEdgeDurationStats>;
  onTemplateString?: (arcs: OCDeclareArc[]) => Promise<string>;

  // Rendering
  showTextLabels?: boolean;                 // opt-in ∀/ALL()/ANY() text labels; default false (dots)
}
```

Existing viewer props (color resolvers, `layoutOverride`, `renderSvg`, `direction`) are unchanged and
apply in both modes. **Pure boundary:** no `useBackend`, no `useOcelInfo`, no localStorage inside the
component. A missing callback hides its button/menu item so the pure viewer path carries no editor
weight beyond the `editable` branch.

## 3. Node editing

- **Add** Activity / Object-Init / Object-Exit from a palette fed by `eventTypes`/`objectTypes`
  (canvas context menu; also `Alt+N` at cursor). Object nodes get `kind:"init"|"exit"`.
- **Rename** inline (double-click / menu), parsing `<init> `/`<exit> ` prefixes to set `kind` and
  stripping them from `type`.
- **Delete** (menu + Delete key).
- **Statistics:** node "View Statistics" → `onActivityStatistics(activity)` → component-rendered
  activity-frequencies sheet (see §6).
- Enable connectable handles + `nodesConnectable` only in `editable` (viewer keeps them hidden).

## 4. Edge / constraint editing

- **9-template picker** — a radix **popover with arrowhead previews** (reuse `Legend`'s mini-arc
  thumbnails; `//` overlay for `nef*`/`ndf*`), replacing OCPQ's checkbox list. Sets `edge.template`.
- **Cardinality `[min,max]`** — a radix **popover** with two numeric inputs (replaces the two native
  `prompt()`s); min/max sugar display (`= n`, `≥ n`, `≤ n`, `min–max`) reusing MinMax logic.
- **Switch direction** — swap `source`/`target`.
- **Delete** (menu + Delete key).
- **Object-label dialog** — radix dialog for `each`/`all`/`any` groups: chip add/remove, mode toggle
  (Each/All/Any), Simple vs O2O tabs (O2O with `first`/`second` + reverse toggle), datalist
  suggestions from `objectTypes`, and **E2O/O2O support hints** via `getSupport` (object endpoints
  count as support 1).
- **Drag-connect** — `onConnect` builds an edge with the auto-derived default label (intersect related
  object types of both endpoints; object endpoints contribute their own type/O2O) and default
  template (`as` if either endpoint is an object, else `ef`).

## 5. Rendering (extend `ConstraintEdge`)

Single edge component for view + edit. Additions over today's viewer edge:
- **Cardinality label** near the edge (sugar formatting), shown when `cardinality` set.
- **Violation bar** — when `edge.violation != null`, a % bar + threshold color (green→red) + label.
- **Negation** — `nef*`/`ndf*` render the arrowhead with a negation slash.
- **Object involvement** — quantifier dots + gradient (default). When `showTextLabels`, additionally
  render `∀ each` / `ALL(...)` / `ANY(...)` text labels. O2O associations render lossless
  (`first>second` / `first<second`).
Node/edge components, markers, layout seam, `bundleEdges`, geometry utils are reused as-is.

## 6. Discovery / evaluate / statistics / export

- **Discovery** — port `OCDeclareDiscoveryButton` onto radix: O2O mode (None/Direct/Reversed/
  Bidirectional), noise threshold, count filters (no-max / after / during), reduction, refinement,
  arrow-type multiselect (AS/EF/EP/DF/DP), activity subset (all vs selected). Drives
  `onDiscover(options)` → arcs merged into model via `arcsToModel` + auto-layout.
- **Evaluate** — button (selected edges, else all) + per-edge action → `onEvaluate(toArcs(...))` →
  `edge.violation` per arc → bars; "clear evaluation" resets all `violation`.
- **Statistics sheets (in component)** — `onActivityStatistics` → two Plotly histograms
  (`num_evs_per_ot_type`, `num_obs_of_ot_per_ev`); `onEdgeStatistics` → duration histogram with
  auto time-unit scaling. Rendered via `ThemedPlot` inside a radix sheet/panel in the component.
- **Export** — `onTemplateString(arcs)` (Text) + `JSON.stringify(arcs)` (JSON); copy + download.
  Image export reuses the existing frame/export path.

## 7. Interactions

Drag-connect (§4); copy/paste (MIME `application/json+oc-declare-flow` + `text/plain`; plain-array
JSON accepted as `OCDeclareArc[]` → `arcsToModel`); select-all (`Ctrl/Cmd+A`); ELK layout button;
auto-layout after discovery/paste; keyboard `Alt+N/L/C`. Layout uses the existing `DeclareLayoutFn`
seam (rust `reroute`/`seed`/`pinned` already supported).

## 8. OCPQ wiring

- `/oc-declare/:id`: replace `OCDeclareFlowEditor` with `<OCDeclareViz editable value={model}
  onChange={...} .../>`, mapping OCPQ's persisted flow-JSON ↔ `DeclareFlowModel`.
- Inject callbacks from `useBackend`: `onDiscover`=`ocel/discover-oc-declare`,
  `onEvaluate`=`ocel/evaluate-oc-declare-arcs`, `onActivityStatistics`=`ocel/get-activity-statistics`,
  `onEdgeStatistics`=`ocel/get-oc-declare-edge-statistics`, `onTemplateString`=`oc-declare/template-string`.
  `eventTypes`/`objectTypes`/`getSupport` from `useOcelInfo` (`e2o_types`/`o2o_types`).
- Persistence unchanged (localStorage `oced-ocdeclare-data`+id; meta name edit stays in OCPQ Viewer).
- Wrap in `R4pmIsland`. No new backend needed (endpoints already exist).
- Delete `routes/oc-declare/flow/` once the parity checklist passes.

## 9. Reused as-is vs new

**Reused (from viewer):** `ActivityNode` (flip handles connectable in edit), `ConstraintEdge`
(extended per §5), `MultiDot`, `Legend` (palette/preview thumbnails), the `DeclareLayoutFn` seam +
geometry utils, `bundleEdges`, `constraintText`, `styled-graph` export, `VizContext`, `toRawConstraint`
/`collapseEfEpPairs`/`collectObjectTypes` (display only).

**New:** `editable` branch on `OCDeclareViz`; `DeclareFlowModel` + `toArcs`/`arcsToModel`;
palette/toolbar; 9-template picker popover; cardinality popover; object-label dialog; discovery panel;
evaluate wiring + violation rendering; stats sheets (Plotly in component); copy/paste + keyboard;
`onConnect` auto-label.

## 10. Testing

- Unit: `toArcs`/`arcsToModel` round-trip (all 9 templates incl. negation + O2O), auto-label
  intersection, cardinality sugar.
- Storybook: `Editors/OC-DECLARE` with stubbed `onDiscover`/`onEvaluate`/stats (+ `iframeHeight`);
  read-only viewer story stays green.
- Parity checklist (below) gated before deleting OCPQ `flow/`.

## Parity checklist

Canvas: pan/zoom; load model; debounced onChange persist; model-name edit (OCPQ). Nodes: add
activity/init/exit; add at cursor (Alt+N); inline rename + prefix parse; delete; object color +
involvement hint; activity statistics. Edges: drag-connect + auto-label + default template; 9-template
picker w/ previews + negation; cardinality popover + sugar; object-label dialog (each/all/any ×
Simple/O2O × reverse, chips, datalist, support hints); switch direction; delete; parallel-edge spread;
gradient coloring; (opt) text labels; edge duration statistics; evaluate single edge. Bulk: evaluate
selected/all + bar/color; clear evaluation; discovery dialog (all options) + auto-layout; export
Text/JSON copy+download. Layout/clipboard/keyboard: ELK layout button; auto-layout (Alt+L); copy
(MIME + Alt+C); paste (re-id+offset; arcs-JSON fallback); select-all; selection auto-includes edges;
image download PNG/SVG.

## Out of scope

- EFEP/DFDP pair-collapse during editing (collapse is display-only).
- Structural editing of the path-schema type-graph (separate track).
- New backend endpoints (all OC-DECLARE endpoints already exist).
