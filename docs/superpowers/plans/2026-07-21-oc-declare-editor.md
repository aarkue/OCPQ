# OC-DECLARE Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend propel's `@r4pm/components` `OCDeclareViz` with an `editable` mode that is a drop-in replacement for OCPQ's bespoke `OCDeclareFlowEditor`, then wire it into OCPQ and delete the bespoke `flow/`.

**Architecture:** Editing is an `editable` branch on `OCDeclareViz`. The controlled value is a lossless `DeclareFlowModel` (nodes+positions, edges with 9-template+label+cardinality); `OCDeclareArc[]` is a pure derivation feeding injected backend callbacks and the read-only render. The component stays backend-free; OCPQ injects `useBackend`/`useOcelInfo` and keeps localStorage persistence.

**Tech Stack:** React, `@xyflow/react`, `@r4pm/components/ui` (radix themes), ELK/rust layout seam, `ThemedPlot` (plotly), vitest, Storybook.

## Global Constraints

- Component is backend-free: no `useBackend`, `useOcelInfo`, `localStorage`, or `fetch` inside `packages/components`. Backend is injected as optional callbacks; a missing callback hides its affordance.
- Editing primitives use `@r4pm/components/ui` (radix), never OCPQ shadcn. Wrap propel usage in OCPQ with `R4pmIsland`.
- Read-only viewer path must stay unchanged when `editable` is falsy (existing `oc-declare.stories.tsx` viewer story stays green).
- Object-involvement default render = quantifier dots + gradient; `∀`/`ALL()`/`ANY()` text labels only when `showTextLabels` is true.
- EFEP/DFDP pair-collapse is display-only; never applied to the edit model.
- Any change to a propel component's public API requires `pnpm --filter @r4pm/components build` before OCPQ `pnpm exec tsc --noEmit` passes.
- Reference spec: `docs/superpowers/specs/2026-07-21-oc-declare-editor-design.md`. Reference source to port from: OCPQ `frontend/src/routes/oc-declare/flow/` (mapped in the spec's Track 3 + parity checklist).

---

## File Structure

**Propel** (`packages/components/src/oc-declare/`):
- `model.ts` (new) — `DeclareFlowModel`/`DeclareNode`/`DeclareEdge`/`EdgeTemplate`, `TEMPLATE_TO_ARC`, `toArcs`, `arcsToModel`, `cardinalitySugar`. Pure.
- `model.test.ts` (new).
- `auto-label.ts` (new) — `defaultConnectLabel` + `defaultTemplate`. Pure. + `auto-label.test.ts`.
- `clipboard.ts` (new) — MIME serialize/parse of a `{nodes,edges}` selection + `OCDeclareArc[]` fallback. + `clipboard.test.ts`.
- `edit/EdgeTypePicker.tsx` (new) — 9-template radix popover w/ `Legend` previews.
- `edit/CardinalityPopover.tsx` (new).
- `edit/ObjectLabelDialog.tsx` (new).
- `edit/DiscoveryPanel.tsx` (new).
- `edit/StatsSheet.tsx` (new) — activity/edge Plotly histograms via `ThemedPlot`.
- `edit/edit-context.ts` (new) — `EditContext` (value, apply mutations, callbacks, palette, getSupport).
- `ActivityNode.tsx` (modify) — connectable handles + node context menu (rename/delete/stats) under edit.
- `ConstraintEdge.tsx` (modify) — cardinality label, violation bar, negation slash, optional text labels, edit context menu.
- `OCDeclareViz.tsx` (modify) — `editable` branch, `value`/`onChange`, `onConnect`, palette context menu, discovery/evaluate/export toolbar.
- `index.tsx` (modify) — editable props on the public component + new type exports.
- `oc-declare.stories.tsx` (modify) — `Editors/OC-DECLARE` story w/ stubs.

**OCPQ** (`frontend/src/routes/oc-declare/`):
- `OCDeclareEditor.tsx` (new) — wraps `OCDeclareViz editable`, injects backend + `useOcelInfo`, maps localStorage flow-JSON ↔ `DeclareFlowModel`.
- `OCDeclareViewer.tsx` (modify) — render `OCDeclareEditor` instead of `OCDeclareFlowEditor`.
- Delete `flow/` (final task, after parity).

---

## Task 1: Model types + template↔arc table

**Files:**
- Create: `packages/components/src/oc-declare/model.ts`
- Test: `packages/components/src/oc-declare/model.test.ts`

**Interfaces:**
- Produces: `DeclareFlowModel`, `DeclareNode`, `DeclareEdge`, `EdgeTemplate`, `TEMPLATE_TO_ARC: Record<EdgeTemplate, {arc_type: ArcType; negated: boolean}>`, `templateCounts(t, cardinality): [number|null,number|null]`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { TEMPLATE_TO_ARC, templateCounts } from "./model";

describe("template↔arc", () => {
  it("maps every template to its arc type", () => {
    expect(TEMPLATE_TO_ARC.ef).toEqual({ arc_type: "EF", negated: false });
    expect(TEMPLATE_TO_ARC["ef-rev"]).toEqual({ arc_type: "EP", negated: false });
    expect(TEMPLATE_TO_ARC.nef).toEqual({ arc_type: "EF", negated: true });
    expect(TEMPLATE_TO_ARC["ndf-rev"]).toEqual({ arc_type: "DP", negated: true });
    expect(TEMPLATE_TO_ARC.as).toEqual({ arc_type: "AS", negated: false });
  });
  it("negated templates force [0,0] counts, else cardinality ?? [1,null]", () => {
    expect(templateCounts("nef", [3, 5])).toEqual([0, 0]);
    expect(templateCounts("ef", undefined)).toEqual([1, null]);
    expect(templateCounts("ef", [2, 4])).toEqual([2, 4]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/components && pnpm exec vitest run src/oc-declare/model.test.ts`
Expected: FAIL — cannot find module `./model`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/components/src/oc-declare/model.ts
import type { ArcType } from "./types";
import type { OCDeclareArcLabel, ObjectTypeAssociation } from "./index";

export type EdgeTemplate =
  | "as" | "ef" | "ef-rev" | "df" | "df-rev"
  | "nef" | "nef-rev" | "ndf" | "ndf-rev";

export interface DeclareNode {
  id: string;
  type: string;
  kind: "activity" | "init" | "exit";
  position?: { x: number; y: number };
}
export interface DeclareEdge {
  id: string;
  source: string;
  target: string;
  template: EdgeTemplate;
  cardinality?: [number | null, number | null];
  label: OCDeclareArcLabel;
  violation?: number;
}
export interface DeclareFlowModel {
  nodes: DeclareNode[];
  edges: DeclareEdge[];
}

export const TEMPLATE_TO_ARC: Record<EdgeTemplate, { arc_type: ArcType; negated: boolean }> = {
  as: { arc_type: "AS", negated: false },
  ef: { arc_type: "EF", negated: false },
  "ef-rev": { arc_type: "EP", negated: false },
  df: { arc_type: "DF", negated: false },
  "df-rev": { arc_type: "DP", negated: false },
  nef: { arc_type: "EF", negated: true },
  "nef-rev": { arc_type: "EP", negated: true },
  ndf: { arc_type: "DF", negated: true },
  "ndf-rev": { arc_type: "DP", negated: true },
};

export function templateCounts(
  t: EdgeTemplate,
  cardinality: [number | null, number | null] | undefined,
): [number | null, number | null] {
  if (TEMPLATE_TO_ARC[t].negated) return [0, 0];
  return cardinality ?? [1, null];
}

export type { ObjectTypeAssociation };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/components && pnpm exec vitest run src/oc-declare/model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/components/src/oc-declare/model.ts packages/components/src/oc-declare/model.test.ts
git commit -m "feat(oc-declare): editable model types + template↔arc table"
```

---

## Task 2: `toArcs` derivation (model → OCDeclareArc[])

**Files:**
- Modify: `packages/components/src/oc-declare/model.ts`
- Test: `packages/components/src/oc-declare/model.test.ts`

**Interfaces:**
- Consumes: Task 1 types + `templateCounts`.
- Produces: `toArcs(model: DeclareFlowModel): OCDeclareArc[]`. Node `type` is prefixed `"<init> "`/`"<exit> "` per `kind` in the arc `from`/`to`.

- [ ] **Step 1: Write the failing test**

```ts
import { toArcs } from "./model";

it("toArcs prefixes init/exit and derives arc_type+counts", () => {
  const model = {
    nodes: [
      { id: "n1", type: "order", kind: "init" as const },
      { id: "n2", type: "pay", kind: "activity" as const },
    ],
    edges: [
      { id: "e1", source: "n1", target: "n2", template: "nef" as const,
        label: { each: [], any: [], all: [] } },
    ],
  };
  expect(toArcs(model)).toEqual([
    { from: "<init> order", to: "pay", arc_type: "EF", counts: [0, 0],
      label: { each: [], any: [], all: [] } },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/components && pnpm exec vitest run src/oc-declare/model.test.ts`
Expected: FAIL — `toArcs` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `model.ts`:

```ts
import type { OCDeclareArc } from "./index";

const PREFIX: Record<DeclareNode["kind"], string> = { activity: "", init: "<init> ", exit: "<exit> " };
const nodeName = (n: DeclareNode) => `${PREFIX[n.kind]}${n.type}`;

export function toArcs(model: DeclareFlowModel): OCDeclareArc[] {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const arcs: OCDeclareArc[] = [];
  for (const e of model.edges) {
    const from = byId.get(e.source);
    const to = byId.get(e.target);
    if (!from || !to) continue;
    arcs.push({
      from: nodeName(from),
      to: nodeName(to),
      arc_type: TEMPLATE_TO_ARC[e.template].arc_type,
      counts: templateCounts(e.template, e.cardinality),
      label: e.label,
    });
  }
  return arcs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/components && pnpm exec vitest run src/oc-declare/model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/components/src/oc-declare/model.ts packages/components/src/oc-declare/model.test.ts
git commit -m "feat(oc-declare): toArcs derivation"
```

---

## Task 3: `arcsToModel` (import/paste) + round-trip

**Files:**
- Modify: `packages/components/src/oc-declare/model.ts`
- Test: `packages/components/src/oc-declare/model.test.ts`

**Interfaces:**
- Produces: `arcsToModel(arcs: OCDeclareArc[]): DeclareFlowModel`. Chooses `template` from `(arc_type, counts==[0,0])`; dedups nodes by prefixed name; parses `<init> `/`<exit> ` to `kind`; positions unset. `id`s are `` `n${i}` `` / `` `e${i}` `` deterministically (no `Math.random`/`uuid` — keep pure/testable).

- [ ] **Step 1: Write the failing test** (round-trip over all 9 templates)

```ts
import { arcsToModel, toArcs, TEMPLATE_TO_ARC, type EdgeTemplate } from "./model";

it("arcsToModel ∘ toArcs is identity on templates + O2O labels", () => {
  const templates = Object.keys(TEMPLATE_TO_ARC) as EdgeTemplate[];
  const model = {
    nodes: [
      { id: "a", type: "order", kind: "activity" as const },
      { id: "b", type: "item", kind: "exit" as const },
    ],
    edges: templates.map((t, i) => ({
      id: `e${i}`, source: "a", target: "b", template: t,
      label: { each: [{ object_type: "order", type: "Simple" as const }], any: [],
               all: [{ first: "order", second: "item", reversed: true, type: "O2O" as const }] },
    })),
  };
  const back = arcsToModel(toArcs(model));
  // node names + kinds preserved
  expect(back.nodes.map((n) => [n.type, n.kind]).sort()).toEqual([["item", "exit"], ["order", "activity"]]);
  // each edge's template + label survive
  expect(back.edges.map((e) => e.template).sort()).toEqual([...templates].sort());
  expect(back.edges[0].label.all[0]).toEqual({ first: "order", second: "item", reversed: true, type: "O2O" });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/components && pnpm exec vitest run src/oc-declare/model.test.ts`
Expected: FAIL — `arcsToModel` not exported.

- [ ] **Step 3: Implement**

Append to `model.ts`:

```ts
const ARC_TO_TEMPLATE: Record<string, EdgeTemplate> = {
  "AS|false": "as", "EF|false": "ef", "EP|false": "ef-rev", "DF|false": "df", "DP|false": "df-rev",
  "EF|true": "nef", "EP|true": "nef-rev", "DF|true": "ndf", "DP|true": "ndf-rev",
};

function parseName(name: string): { type: string; kind: DeclareNode["kind"] } {
  if (name.startsWith("<init> ")) return { type: name.slice(7), kind: "init" };
  if (name.startsWith("<exit> ")) return { type: name.slice(7), kind: "exit" };
  return { type: name, kind: "activity" };
}

export function arcsToModel(arcs: OCDeclareArc[]): DeclareFlowModel {
  const ids = new Map<string, string>();
  const nodes: DeclareNode[] = [];
  const idFor = (name: string) => {
    const ex = ids.get(name);
    if (ex) return ex;
    const id = `n${nodes.length}`;
    ids.set(name, id);
    const { type, kind } = parseName(name);
    nodes.push({ id, type, kind });
    return id;
  };
  const edges: DeclareEdge[] = arcs.map((a, i) => {
    const negated = a.counts[0] === 0 && a.counts[1] === 0;
    const template = ARC_TO_TEMPLATE[`${a.arc_type}|${negated}`];
    return {
      id: `e${i}`,
      source: idFor(a.from),
      target: idFor(a.to),
      template,
      cardinality: negated ? undefined : a.counts,
      label: a.label,
    };
  });
  return { nodes, edges };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/components && pnpm exec vitest run src/oc-declare/model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/components/src/oc-declare/model.ts packages/components/src/oc-declare/model.test.ts
git commit -m "feat(oc-declare): arcsToModel + round-trip test"
```

---

## Task 4: Cardinality sugar

**Files:**
- Modify: `packages/components/src/oc-declare/model.ts`
- Test: `packages/components/src/oc-declare/model.test.ts`

**Interfaces:**
- Produces: `cardinalitySugar(c: [number|null,number|null] | undefined): string | null`. Mirrors OCPQ `MinMaxSugar` (`flow/MinMaxSugar.tsx:14-52`): `null`→no label; `min===max`→`"= n"`; no max→`"≥ n"`; no min (or 0)→`"≤ n"`; else `"min – max"`. Treat `min===0`→null-min, `max===0`→min-forced-0.

- [ ] **Step 1: Failing test**

```ts
import { cardinalitySugar } from "./model";
it("cardinality sugar", () => {
  expect(cardinalitySugar(undefined)).toBeNull();
  expect(cardinalitySugar([3, 3])).toBe("= 3");
  expect(cardinalitySugar([2, null])).toBe("≥ 2");
  expect(cardinalitySugar([null, 5])).toBe("≤ 5");
  expect(cardinalitySugar([0, 5])).toBe("≤ 5");
  expect(cardinalitySugar([2, 5])).toBe("2 – 5");
});
```

- [ ] **Step 2: Run — FAIL** (`cd packages/components && pnpm exec vitest run src/oc-declare/model.test.ts`).

- [ ] **Step 3: Implement**

```ts
export function cardinalitySugar(c: [number | null, number | null] | undefined): string | null {
  if (!c) return null;
  let [min, max] = c;
  if (min === 0) min = null;
  if (max === 0) max = 0;
  if (min == null && max == null) return null;
  if (min != null && max != null && min === max) return `= ${min}`;
  if (max == null) return `≥ ${min}`;
  if (min == null) return `≤ ${max}`;
  return `${min} – ${max}`;
}
```

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Commit** `git commit -am "feat(oc-declare): cardinality sugar"`

---

## Task 5: Auto-label for drag-connect

**Files:**
- Create: `packages/components/src/oc-declare/auto-label.ts`
- Test: `packages/components/src/oc-declare/auto-label.test.ts`

**Interfaces:**
- Produces:
  - `defaultTemplate(sourceKind, targetKind): EdgeTemplate` — `"as"` if either endpoint is an object (`init`/`exit`), else `"ef"`.
  - `defaultConnectLabel(source: DeclareNode, target: DeclareNode, related: (activity: string) => Record<string, number>): OCDeclareArcLabel` — ports OCPQ `onConnect` intersection (`OCDeclareFlowEditor.tsx:160-210`): both activities → `all: Simple(t)` for object types related+>0 on both; object+activity → `any:[Simple(objectType)]`; both objects → `any:[O2O(source,target,reversed:false)]`.

- [ ] **Step 1: Failing test**

```ts
import { defaultConnectLabel, defaultTemplate } from "./auto-label";

const act = (type: string) => ({ id: type, type, kind: "activity" as const });
const obj = (type: string) => ({ id: type, type, kind: "init" as const });

it("defaultTemplate: as if any object endpoint, else ef", () => {
  expect(defaultTemplate("activity", "activity")).toBe("ef");
  expect(defaultTemplate("activity", "init")).toBe("as");
});

it("both activities → intersection of related object types as `all`", () => {
  const related = (a: string) => (a === "place" ? { order: 5, item: 2 } : { order: 3 });
  const label = defaultConnectLabel(act("place"), act("pay"), related);
  expect(label.all).toEqual([{ object_type: "order", type: "Simple" }]);
  expect(label.each).toEqual([]);
  expect(label.any).toEqual([]);
});

it("object + activity → any:[Simple(objectType)]", () => {
  const label = defaultConnectLabel(obj("order"), act("pay"), () => ({}));
  expect(label.any).toEqual([{ object_type: "order", type: "Simple" }]);
});

it("both objects → any:[O2O(source,target)]", () => {
  const label = defaultConnectLabel(obj("order"), obj("item"), () => ({}));
  expect(label.any).toEqual([{ first: "order", second: "item", reversed: false, type: "O2O" }]);
});
```

- [ ] **Step 2: Run — FAIL** (`cd packages/components && pnpm exec vitest run src/oc-declare/auto-label.test.ts`).

- [ ] **Step 3: Implement**

```ts
// packages/components/src/oc-declare/auto-label.ts
import type { DeclareNode, EdgeTemplate } from "./model";
import type { OCDeclareArcLabel } from "./index";

const isObj = (k: DeclareNode["kind"]) => k !== "activity";

export function defaultTemplate(
  s: DeclareNode["kind"], t: DeclareNode["kind"],
): EdgeTemplate {
  return isObj(s) || isObj(t) ? "as" : "ef";
}

export function defaultConnectLabel(
  source: DeclareNode,
  target: DeclareNode,
  related: (activity: string) => Record<string, number>,
): OCDeclareArcLabel {
  const empty: OCDeclareArcLabel = { each: [], any: [], all: [] };
  if (!isObj(source.kind) && !isObj(target.kind)) {
    const s = related(source.type);
    const t = related(target.type);
    const common = Object.keys(s).filter((k) => s[k] > 0 && (t[k] ?? 0) > 0);
    return { ...empty, all: common.map((object_type) => ({ object_type, type: "Simple" })) };
  }
  if (isObj(source.kind) && isObj(target.kind)) {
    return { ...empty, any: [{ first: source.type, second: target.type, reversed: false, type: "O2O" }] };
  }
  const objType = isObj(source.kind) ? source.type : target.type;
  return { ...empty, any: [{ object_type: objType, type: "Simple" }] };
}
```

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Commit**

```bash
git add packages/components/src/oc-declare/auto-label.ts packages/components/src/oc-declare/auto-label.test.ts
git commit -m "feat(oc-declare): drag-connect auto-label + default template"
```

---

## Task 6: Clipboard serialize/parse

**Files:**
- Create: `packages/components/src/oc-declare/clipboard.ts`
- Test: `packages/components/src/oc-declare/clipboard.test.ts`

**Interfaces:**
- Produces:
  - `CLIPBOARD_MIME = "application/json+oc-declare-flow"`.
  - `serializeSelection(sel: {nodes: DeclareNode[]; edges: DeclareEdge[]}): string`.
  - `parseClipboard(text: string): {nodes: DeclareNode[]; edges: DeclareEdge[]} | { arcs: OCDeclareArc[] } | null` — parses the selection JSON; if the JSON is a plain array, returns `{arcs}` (paste-of-`OCDeclareArc[]` fallback per OCPQ `pasteListener` `OCDeclareFlowEditor.tsx:385-391`); invalid → null.

- [ ] **Step 1: Failing test**

```ts
import { CLIPBOARD_MIME, parseClipboard, serializeSelection } from "./clipboard";

it("round-trips a selection", () => {
  const sel = { nodes: [{ id: "a", type: "x", kind: "activity" as const }], edges: [] };
  const out = parseClipboard(serializeSelection(sel));
  expect(out).toEqual(sel);
});
it("plain-array JSON → arcs fallback", () => {
  const arcs = [{ from: "a", to: "b", arc_type: "EF", counts: [1, null], label: { each: [], any: [], all: [] } }];
  expect(parseClipboard(JSON.stringify(arcs))).toEqual({ arcs });
});
it("garbage → null", () => {
  expect(parseClipboard("not json")).toBeNull();
});
it("exposes the MIME type", () => {
  expect(CLIPBOARD_MIME).toBe("application/json+oc-declare-flow");
});
```

- [ ] **Step 2: Run — FAIL** (`cd packages/components && pnpm exec vitest run src/oc-declare/clipboard.test.ts`).

- [ ] **Step 3: Implement**

```ts
// packages/components/src/oc-declare/clipboard.ts
import type { DeclareEdge, DeclareNode } from "./model";
import type { OCDeclareArc } from "./index";

export const CLIPBOARD_MIME = "application/json+oc-declare-flow";
export type Selection = { nodes: DeclareNode[]; edges: DeclareEdge[] };

export function serializeSelection(sel: Selection): string {
  return JSON.stringify(sel);
}

export function parseClipboard(text: string): Selection | { arcs: OCDeclareArc[] } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (Array.isArray(parsed)) return { arcs: parsed as OCDeclareArc[] };
  if (parsed && typeof parsed === "object" && "nodes" in parsed && "edges" in parsed) {
    return parsed as Selection;
  }
  return null;
}
```

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Commit**

```bash
git add packages/components/src/oc-declare/clipboard.ts packages/components/src/oc-declare/clipboard.test.ts
git commit -m "feat(oc-declare): clipboard serialize/parse + arcs fallback"
```

---

## Task 7: Edit context + `editable` scaffold on OCDeclareViz

**Files:**
- Create: `packages/components/src/oc-declare/edit/edit-context.ts`
- Modify: `packages/components/src/oc-declare/OCDeclareViz.tsx`, `packages/components/src/oc-declare/index.tsx`
- Modify: `packages/components/src/oc-declare/oc-declare.stories.tsx`

**Interfaces:**
- Produces:
  - `EditContext` (React context) carrying `{ model: DeclareFlowModel; mutate: (fn: (m: DeclareFlowModel) => DeclareFlowModel) => void; palette: { eventTypes: string[]; objectTypes: string[] }; getSupport?; callbacks: {...}; showTextLabels: boolean }` + `useEditContext()`.
  - `OCDeclareViz` accepts `editable?: boolean`, `value?: DeclareFlowModel`, `onChange?`, `eventTypes?`, `objectTypes?`, `getSupport?`, the 5 backend callbacks, `showTextLabels?`. When `editable`, the viz derives nodes/edges from `value` (via existing `RawConstraint` render path fed by `toArcs`→`toRawConstraint`) and provides `EditContext`.
- Consumes: Tasks 1–6.

- [ ] **Step 1: Write the story (visual gate — no unit assertion for the scaffold)**

Add to `oc-declare.stories.tsx` an `Editor` story rendering `<OCDeclareViz editable value={model} onChange={setModel} eventTypes={[...]} objectTypes={[...]} />` with a small seed `DeclareFlowModel` (2 activity nodes + 1 `ef` edge) and `parameters.docs.story.iframeHeight = 640`.

- [ ] **Step 2: Verify the viewer story still renders**

Run: `cd packages/components && pnpm exec tsc --noEmit`
Expected: PASS (types compile). Then `pnpm dev` (Storybook) and confirm the existing `Viewers/OC-DECLARE` story is unchanged and the new `Editors/OC-DECLARE` story renders the seed graph read-only-looking (editing wired in later tasks).

- [ ] **Step 3: Implement the context + prop plumbing**

Create `edit/edit-context.ts` with the context + `useEditContext`. In `OCDeclareViz.tsx`, add the new props; when `editable && value`, compute `constraints` via `collapseEfEpPairs(toArcs(value).map(toRawConstraint))` (reuse `toRawConstraint` from `index.tsx` — export it) and wrap the inner flow in `EditContext.Provider`. `mutate` calls `onChange(fn(value))`. In `index.tsx`, thread the new props from the public `OCDeclareViewer` into `OCDeclareViz` and export `DeclareFlowModel`, `DeclareEdge`, `DeclareNode`, `EdgeTemplate`, `toArcs`, `arcsToModel`.

- [ ] **Step 4: Build dist + typecheck**

Run: `cd packages/components && pnpm exec tsc --noEmit && pnpm build`
Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/components/src/oc-declare/edit/edit-context.ts packages/components/src/oc-declare/OCDeclareViz.tsx packages/components/src/oc-declare/index.tsx packages/components/src/oc-declare/oc-declare.stories.tsx
git commit -m "feat(oc-declare): editable scaffold + EditContext + exports"
```

---

## Task 8: Node editing — connectable handles, palette add, rename, delete

**Files:**
- Modify: `packages/components/src/oc-declare/ActivityNode.tsx`, `OCDeclareViz.tsx`

**Port from:** OCPQ `flow/OCDeclareFlowNode.tsx` (rename/prefix parse `:28-72`, context menu `:80-122`, handles `:207-218`) and `flow/OCDeclareFlowEditor.tsx` palette context menu (`:443-512`), `createNewNodeAtPosition` (`:284-299`), Alt+N (`:404-405`). Substitute OCPQ shadcn menu/dialog → `@r4pm/components/ui` (`ContextMenu`/`DropdownMenu`, `TextField`). Delete via `mutate` removing the node + its incident edges.

**Interfaces:**
- Consumes: `useEditContext`, `defaultTemplate` (unused here), model mutation.
- Produces: node-level mutations only (no new exports).

- [ ] **Step 1: Story gate** — extend the `Editor` story: palette add works, double-click renames, `<init> ` prefix produces an `init` node. (Manual Storybook verification — interaction, not unit.)

- [ ] **Step 2: Baseline** — `cd packages/components && pnpm exec tsc --noEmit` (PASS before edits).

- [ ] **Step 3: Implement**

In `ActivityNode.tsx`: when `useEditContext()` present, set Handles `isConnectableStart`/connectable true; add a radix `ContextMenu` with "Edit Type" (inline `TextField` rename → parse `<init> `/`<exit> ` → `mutate` node `type`+`kind`), "Delete Node" (`mutate` drop node + incident edges), "View Statistics" (calls `callbacks.onActivityStatistics` → opens the stats sheet from Task 13). In `OCDeclareViz.tsx`: set `nodesConnectable={editable}`; add a canvas `ContextMenu` palette (Add Activity/Init/Exit from `palette.eventTypes`/`palette.objectTypes`) that `mutate`s a new node at the cursor (id via a module counter or `crypto.randomUUID()` — allowed at runtime in the component, only the pure `model.ts` stays deterministic); wire `Alt+N`.

- [ ] **Step 4: Typecheck + build** — `pnpm exec tsc --noEmit && pnpm build` (exit 0). Storybook manual check of add/rename/delete.

- [ ] **Step 5: Commit**

```bash
git add packages/components/src/oc-declare/ActivityNode.tsx packages/components/src/oc-declare/OCDeclareViz.tsx
git commit -m "feat(oc-declare): node add/rename/delete + connectable handles"
```

---

## Task 9: `onConnect` — create edges by dragging

**Files:**
- Modify: `packages/components/src/oc-declare/OCDeclareViz.tsx`

**Port from:** OCPQ `onConnect` (`OCDeclareFlowEditor.tsx:160-226`). Uses Task 5 `defaultConnectLabel`/`defaultTemplate`. `related(activity)` is derived from the host `getSupport`/palette; for the component, pass a `relatedTypes?: (activity: string) => Record<string, number>` prop (OCPQ supplies from `e2o_types`/`o2o_types`); absent → empty label.

**Interfaces:**
- Consumes: `defaultConnectLabel`, `defaultTemplate`, `mutate`.
- Produces: `OCDeclareVizEditProps.relatedTypes?`.

- [ ] **Step 1: Story gate** — dragging from one node handle to another creates an edge with a sensible default label/template; self-loops rejected.

- [ ] **Step 2: Baseline typecheck** (`pnpm exec tsc --noEmit`).

- [ ] **Step 3: Implement** — add `onConnect` to the ReactFlow in edit mode: reject `source===target`; build a `DeclareEdge` with `id = crypto.randomUUID()`, `template = defaultTemplate(...)`, `label = defaultConnectLabel(sourceNode, targetNode, relatedTypes ?? (() => ({})))`; `mutate` append. Add `relatedTypes` to props + thread through `index.tsx`.

- [ ] **Step 4: Typecheck + build** (exit 0). Storybook manual check.

- [ ] **Step 5: Commit** `git commit -am "feat(oc-declare): drag-connect edge creation"`

---

## Task 10: Edge-type picker popover (9 templates) + edge context menu

**Files:**
- Create: `packages/components/src/oc-declare/edit/EdgeTypePicker.tsx`
- Modify: `packages/components/src/oc-declare/ConstraintEdge.tsx`

**Port from:** OCPQ edge-type submenu (`OCDeclareFlowEdge.tsx:297-337`) + `getArcTypeDisplayName` (`oc-declare-flow-type-conversions.ts:41-62`). Previews reuse propel `Legend` mini-arcs (`Legend.tsx:83` `LegendArc`) with a `//` negation overlay for `nef*`/`ndf*`.

**Interfaces:**
- Produces: `EdgeTypePicker({ value: EdgeTemplate; onChange: (t: EdgeTemplate) => void })` — radix `Popover` listing all 9 templates with preview + display name.
- Consumes: `EDGE_TEMPLATES` (add `export const EDGE_TEMPLATES: EdgeTemplate[]` to `model.ts`), `EditContext`.

- [ ] **Step 1: Story gate** — right-click an edge → "Edit type" → popover with 9 previews; selecting changes the rendered arrowhead.

- [ ] **Step 2: Baseline typecheck.**

- [ ] **Step 3: Implement** — build `EdgeTypePicker`. In `ConstraintEdge.tsx`, when `useEditContext()` present, add a radix `ContextMenu` on the edge hit-path with items: "Edit type" (opens `EdgeTypePicker` → `mutate` edge `template`), plus placeholders wired in Tasks 11–12 (cardinality, object types), "Switch direction" (`mutate` swap source/target), "Delete edge" (`mutate` drop edge). Add `export const EDGE_TEMPLATES` to `model.ts`.

- [ ] **Step 4: Typecheck + build** (exit 0). Storybook check of all 9 previews + selection.

- [ ] **Step 5: Commit**

```bash
git add packages/components/src/oc-declare/edit/EdgeTypePicker.tsx packages/components/src/oc-declare/ConstraintEdge.tsx packages/components/src/oc-declare/model.ts
git commit -m "feat(oc-declare): edge-type picker popover + edge context menu"
```

---

## Task 11: Cardinality popover

**Files:**
- Create: `packages/components/src/oc-declare/edit/CardinalityPopover.tsx`
- Modify: `packages/components/src/oc-declare/ConstraintEdge.tsx`

**Replaces:** OCPQ's two native `prompt()`s (`OCDeclareFlowEdge.tsx:348-379`). Display uses `cardinalitySugar` (Task 4).

**Interfaces:**
- Produces: `CardinalityPopover({ value?: [number|null,number|null]; onChange: (c?: [number|null,number|null]) => void })` — radix `Popover` with two numeric `TextField`s (min, max, blank = null); both blank → `undefined`.

- [ ] **Step 1: Story gate** — "Edit cardinality" opens a popover; entering `2`/`5` shows `2 – 5` on the edge; clearing both removes the label.

- [ ] **Step 2: Baseline typecheck.**

- [ ] **Step 3: Implement** — `CardinalityPopover`; wire the edge context-menu "Edit cardinality" item to it (`mutate` edge `cardinality`); render `cardinalitySugar(edge.cardinality)` as a small label near the edge (in `EdgeLabelRenderer`).

- [ ] **Step 4: Typecheck + build** (exit 0). Storybook check.

- [ ] **Step 5: Commit**

```bash
git add packages/components/src/oc-declare/edit/CardinalityPopover.tsx packages/components/src/oc-declare/ConstraintEdge.tsx
git commit -m "feat(oc-declare): cardinality popover + sugar label"
```

---

## Task 12: Object-label dialog (each/all/any × Simple/O2O + support hints)

**Files:**
- Create: `packages/components/src/oc-declare/edit/ObjectLabelDialog.tsx`
- Modify: `packages/components/src/oc-declare/ConstraintEdge.tsx`

**Port from:** OCPQ `EditEdgeLabelsDialog` (`OCDeclareFlowEdge.tsx:582-876`). Substitute shadcn → radix (`Dialog`, `Tabs`, `ToggleGroup`, `TextField` w/ native `datalist`). Support hints via injected `getSupport(assoc, ctx)` (Task 7 context), replacing OCPQ `getTypesRelationshipSupport`.

**Interfaces:**
- Produces: `ObjectLabelDialog({ open; value: OCDeclareArcLabel; source: DeclareNode; target: DeclareNode; onClose: (v?: OCDeclareArcLabel) => void })`.

- [ ] **Step 1: Story gate** — "Edit object types" opens the dialog; add a Simple `each` chip and an O2O `all` chip with reverse toggle; support hints show; Save writes the label; the edge dots/labels update.

- [ ] **Step 2: Baseline typecheck.**

- [ ] **Step 3: Implement** — port the dialog structure (three groups with removable chips; add-form with Each/All/Any toggle; Simple vs O2O tabs; datalist from `palette.objectTypes`; reverse toggle; E2O/O2O support hints via `getSupport`). Wire the edge context-menu "Edit object types" item → `mutate` edge `label`.

- [ ] **Step 4: Typecheck + build** (exit 0). Storybook check.

- [ ] **Step 5: Commit**

```bash
git add packages/components/src/oc-declare/edit/ObjectLabelDialog.tsx packages/components/src/oc-declare/ConstraintEdge.tsx
git commit -m "feat(oc-declare): object-label dialog + support hints"
```

---

## Task 13: ConstraintEdge render extensions — violation bar, negation, optional text labels

**Files:**
- Modify: `packages/components/src/oc-declare/ConstraintEdge.tsx`

**Port from:** OCPQ violation bar + color (`OCDeclareFlowEdge.tsx:421-448`, `getColorForViolationPercentage :931-954`), negation slash on arrowheads (`getMarkersForEdge` negated variants), and `∀`/`ALL()`/`ANY()` text labels (`:191-212, :400-420`). Dots stay the default; text labels gated on `showTextLabels` from `EditContext`/props.

**Interfaces:**
- Consumes: `edge.violation`, `edge.template` (negation), `showTextLabels`.

- [ ] **Step 1: Story gate** — an `nef` edge shows a negation slash; setting `violation` on an edge shows a % bar with threshold color; `showTextLabels` renders `∀`/`ALL()`/`ANY()` alongside the dots.

- [ ] **Step 2: Baseline typecheck.**

- [ ] **Step 3: Implement** — add a `Progress`-style bar + `%` label + threshold color when `data.violation != null`; render negation slash for negated templates; when `showTextLabels`, add the text labels next to the dot badges. Keep dots + gradient as the default.

- [ ] **Step 4: Typecheck + build** (exit 0). Storybook check across states.

- [ ] **Step 5: Commit** `git commit -am "feat(oc-declare): edge violation bar + negation + optional text labels"`

---

## Task 14: Stats sheet (activity + edge histograms)

**Files:**
- Create: `packages/components/src/oc-declare/edit/StatsSheet.tsx`
- Modify: `packages/components/src/oc-declare/OCDeclareViz.tsx`

**Port from:** OCPQ `InfoSheetViewer.tsx` (`ActivityFrequenciesSheet :47-167`, `EdgeDurationSheet :169-310`). Use propel `ThemedPlot` + radix sheet. Fed by `onActivityStatistics`/`onEdgeStatistics` results.

**Interfaces:**
- Produces: `StatsSheet` rendered inside `OCDeclareViz` (edit mode), controlled by an internal `statsState: {kind:"activity"; activity} | {kind:"edge"; arc} | null` set from node/edge "View Statistics".

- [ ] **Step 1: Story gate** — with stubbed `onActivityStatistics`/`onEdgeStatistics` returning fixture data, "View Statistics" opens a bottom sheet with the histograms.

- [ ] **Step 2: Baseline typecheck.**

- [ ] **Step 3: Implement** — port the two histogram renderers onto `ThemedPlot`; render inside a radix bottom sheet/panel; wire the node/edge menu actions to fetch (via callbacks) + open.

- [ ] **Step 4: Typecheck + build** (exit 0). Storybook check with stubs.

- [ ] **Step 5: Commit**

```bash
git add packages/components/src/oc-declare/edit/StatsSheet.tsx packages/components/src/oc-declare/OCDeclareViz.tsx
git commit -m "feat(oc-declare): activity/edge statistics sheet (ThemedPlot)"
```

---

## Task 15: Toolbar — evaluate, clear, export, ELK layout

**Files:**
- Modify: `packages/components/src/oc-declare/OCDeclareViz.tsx`

**Port from:** OCPQ Evaluate/Clear (`OCDeclareFlowEditor.tsx:688-730`), Export dialog (`:594-675`), Layout button (`:862-875`). Use `onEvaluate`/`onTemplateString`; layout uses the existing `DeclareLayoutFn` seam. Each toolbar button hidden if its callback is absent.

**Interfaces:**
- Consumes: `toArcs`, callbacks, layout.

- [ ] **Step 1: Story gate** — Evaluate (stub returns fractions) fills bars on all/selected edges; Clear resets; Export (stub `onTemplateString`) opens a dialog with Text/JSON + copy/download; Layout button re-lays-out + fits.

- [ ] **Step 2: Baseline typecheck.**

- [ ] **Step 3: Implement** — add an edit-mode toolbar Panel: Evaluate (`onEvaluate(toArcs(selectedOrAll))` → set `edge.violation`), Clear evaluation, Export dialog (Text via `onTemplateString`, JSON via `JSON.stringify(toArcs(model))`, copy + download), ELK Layout button (invoke layout + `fitView`). Auto-layout after paste/discovery reuses the same layout call.

- [ ] **Step 4: Typecheck + build** (exit 0). Storybook check with stubs.

- [ ] **Step 5: Commit** `git commit -am "feat(oc-declare): evaluate/clear/export/layout toolbar"`

---

## Task 16: Discovery panel

**Files:**
- Create: `packages/components/src/oc-declare/edit/DiscoveryPanel.tsx`
- Modify: `packages/components/src/oc-declare/OCDeclareViz.tsx`

**Port from:** OCPQ `OCDeclareDiscoveryButton.tsx` (all options `:21-282`). Substitute shadcn Select/MultiSelect/Switch → radix equivalents (`Select`, a checkbox list, `Switch`). Drives `onDiscover(options)`; result → `arcsToModel` merged into the model + auto-layout.

**Interfaces:**
- Produces: `DiscoveryPanel({ eventTypes; onDiscover; onResult: (arcs: OCDeclareArc[]) => void })`; `DiscoveryOptions` type (mirror OCPQ `OCDeclareDiscoveryOptions`).

- [ ] **Step 1: Story gate** — Discover button opens the options dialog; Run (stub `onDiscover` returns a couple arcs) merges them + auto-lays-out.

- [ ] **Step 2: Baseline typecheck.**

- [ ] **Step 3: Implement** — port the options UI (O2O mode, noise threshold, count filters, reduction, refinement, arrow-type checklist, activity subset) onto radix; on Run, call `onDiscover`, merge via `arcsToModel` (append new nodes/edges, dedup nodes by name), run auto-layout.

- [ ] **Step 4: Typecheck + build** (exit 0). Storybook check with stub.

- [ ] **Step 5: Commit**

```bash
git add packages/components/src/oc-declare/edit/DiscoveryPanel.tsx packages/components/src/oc-declare/OCDeclareViz.tsx
git commit -m "feat(oc-declare): discovery panel"
```

---

## Task 17: Copy/paste + select-all keyboard

**Files:**
- Modify: `packages/components/src/oc-declare/OCDeclareViz.tsx`

**Port from:** OCPQ copy/paste listeners (`OCDeclareFlowEditor.tsx:306-399`), select-all (`:419-425`). Uses Task 6 clipboard helpers. Paste re-IDs + offsets to cursor; `{arcs}` fallback → `arcsToModel` + auto-layout.

- [ ] **Step 1: Story gate** — select nodes+edges, copy, paste → duplicated offset selection; paste an `OCDeclareArc[]` JSON → nodes/edges added + laid out.

- [ ] **Step 2: Baseline typecheck.**

- [ ] **Step 3: Implement** — copy/paste event handlers writing/reading `CLIPBOARD_MIME` + `text/plain` via `serializeSelection`/`parseClipboard`; re-ID with a fresh prefix, offset to cursor, select pasted, drop edges whose endpoints are absent; `{arcs}` → merge + layout; `Ctrl/Cmd+A` selects all. Gate on edit mode + editor focus.

- [ ] **Step 4: Typecheck + build** (exit 0). Storybook check.

- [ ] **Step 5: Commit** `git commit -am "feat(oc-declare): copy/paste + select-all"`

---

## Task 18: OCPQ wiring — `OCDeclareEditor`

**Files:**
- Create: `frontend/src/routes/oc-declare/OCDeclareEditor.tsx`
- Modify: `frontend/src/routes/oc-declare/OCDeclareViewer.tsx`

**Interfaces:**
- Consumes: propel `OCDeclareViz` (editable) + `DeclareFlowModel`/`toArcs`/`arcsToModel`.
- Produces: `OCDeclareEditor({ name; initialModel; onChange })` mapping OCPQ flow-JSON ↔ `DeclareFlowModel`.

- [ ] **Step 1: Baseline** — `cd frontend && pnpm exec tsc --noEmit` (PASS before edits).

- [ ] **Step 2: Implement** — `OCDeclareEditor` renders `<R4pmIsland><OCDeclareViz editable value={model} onChange={...} eventTypes={ocelInfo.event_types.map(t=>t.name)} objectTypes={...} relatedTypes={...from e2o/o2o} getSupport={...} onDiscover={backend["ocel/discover-oc-declare"]} onEvaluate={backend["ocel/evaluate-oc-declare-arcs"]} onActivityStatistics={backend["ocel/get-activity-statistics"]} onEdgeStatistics={backend["ocel/get-oc-declare-edge-statistics"]} onTemplateString={backend["oc-declare/template-string"]} /></R4pmIsland>`. Map the persisted `ReactFlowJsonObject` ↔ `DeclareFlowModel` (nodes: `{id, data.type, data.isObject→kind, position}`; edges: `{id, source, target, data.type→template, data.cardinality, data.objectTypes→label}`). In `OCDeclareViewer.tsx`, replace `<OCDeclareFlowEditor .../>` with `<OCDeclareEditor .../>`, keeping the same localStorage read/write (`oced-ocdeclare-data`+id) and name-edit dialog.

- [ ] **Step 3: Typecheck** — `cd packages/components && pnpm build` then `cd ../../frontend && pnpm exec tsc --noEmit` (exit 0). Run `pnpm exec vite build` (exit 0).

- [ ] **Step 4: Parity pass** — with the app running (Tauri dev), walk the **parity checklist** in the spec against `/oc-declare/:id`. Note any gaps; file follow-up tasks before deletion.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/routes/oc-declare/OCDeclareEditor.tsx frontend/src/routes/oc-declare/OCDeclareViewer.tsx
git commit -m "feat(oc-declare): wire propel editor into OCPQ"
```

---

## Task 19: Delete bespoke `flow/` after parity

**Files:**
- Delete: `frontend/src/routes/oc-declare/flow/` (all files)

- [ ] **Step 1: Confirm parity checklist fully passes** (Task 18 Step 4) — every item verified.

- [ ] **Step 2: Delete** — `git rm -r frontend/src/routes/oc-declare/flow` and remove any now-dead imports (e.g. `InfoSheet` context if fully superseded — verify with grep first; keep whatever `OCDeclareViewer`/list still use).

- [ ] **Step 3: Typecheck + build** — `cd frontend && pnpm exec tsc --noEmit && pnpm exec vite build` (exit 0). Grep for dangling references: `grep -rn "OCDeclareFlow\|flow/oc-declare" frontend/src` → only intended results.

- [ ] **Step 4: Full storybook + parity re-check** — viewer + editor stories green; parity checklist re-verified once more.

- [ ] **Step 5: Commit**

```bash
git rm -r frontend/src/routes/oc-declare/flow
git commit -m "chore(oc-declare): remove bespoke flow editor (replaced by propel component)"
```

---

## Self-Review

**Spec coverage:** §1 model → Tasks 1–4; §2 component API/boundary → Task 7 (+ callbacks threaded through 8–16); §3 node editing → Task 8; §4 edge editing → Tasks 9–12; §5 render extensions → Task 13; §6 discovery/evaluate/stats/export → Tasks 14–16; §7 interactions → Tasks 9,15,17; §8 OCPQ wiring → Tasks 18–19; §10 testing → per-task tests + stories + Task 18/19 parity. All spec sections mapped.

**Type consistency:** `DeclareFlowModel`/`DeclareNode`/`DeclareEdge`/`EdgeTemplate`/`OCDeclareArcLabel`/`ObjectTypeAssociation` used identically across tasks; `toArcs`/`arcsToModel`/`templateCounts`/`cardinalitySugar`/`defaultConnectLabel`/`defaultTemplate`/`serializeSelection`/`parseClipboard`/`CLIPBOARD_MIME`/`EDGE_TEMPLATES` names stable.

**Placeholder scan:** UI-porting tasks (8–18) intentionally reference exact OCPQ source `file:line` to port from with explicit radix substitutions rather than reproducing 900-line components verbatim; pure-logic tasks (1–6) carry complete code + tests. Storybook stories are the gate for interaction-heavy UI (unit assertions don't meaningfully cover xyflow drag/menus).
