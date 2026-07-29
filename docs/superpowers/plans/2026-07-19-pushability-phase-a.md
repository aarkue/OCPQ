# Pushability Phase A: Semantics Cleanup + Virtual-Table Compilation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

SUPERSEDES `2026-07-18-certified-fragment-expansion.md` (angle changed: paper = "which
constructs push to views, at what cost"; certification is method, not pitch; stringified
semantics gets FIXED, not certified around).

**Goal:** (0) Replace accidental Display-based semantics with a canonical id-rendering
rule + typed same-type join keys (extractor semantics change, approved by aarkue
2026-07-19); (1-4) compile virtual tables (Filter/Inner Join/Union); (5) delimiter
multi-value split; (6-8) small soundness/API fixes carried over.

**Architecture:** `/home/aarkue/doc/projects/OCPQ/backend/shared/src/data_extraction/`:
`blueprint.rs` (mapping language + row evaluation), `mod.rs` (extractor = reference
semantics), `compile.rs` (blueprint -> DuckDB CREATE VIEW DDL, typed RejectReasons +
instance Probes), `compile_tests.rs` (differential harness: extractor vs views on same
SQLite fixture, byte-equal Surface, probes must return 0 rows).

**Tech Stack:** Rust; DuckDB CLI + sqlite extension for tests; `regex-syntax` (Task 7).

## Global Constraints

- NEVER run git state-changing commands (no commit/add/stash/branch). Working tree only;
  the user commits. Snapshots for review diffs are handled by the controller.
- The extractor is the reference semantics. Task 0 is an APPROVED semantics change;
  every other task mirrors the (post-Task-0) extractor exactly. Reject, never
  approximate; prefer a probe over widening a compile path on a hunch.
- Every RejectReason carries a classification doc comment: FUNDAMENTAL (no relational
  denotation in principle) / ENGINEERING (not yet implemented) / DIALECT (engine-
  specific). Add the marker as the first line of each variant's doc comment.
- Test commands (from `/home/aarkue/doc/projects/OCPQ/backend`):
  `cargo test -p ocpq-shared compile_tests` and `cargo test -p ocpq-shared data_extraction`.
  `sqlite3` and `duckdb` are on PATH; differential tests skip without them, so check.
- Minimal comments, WHY-only, matching existing compile.rs style.

---

### Task 0: Canonical id rendering + typed join keys (extractor semantics change)

**Files:**
- Modify: `backend/shared/src/data_extraction/blueprint.rs` (IndexedRow ~:19-41,
  ValueExpression::evaluate ~:64-100)
- Modify: `backend/shared/src/data_extraction/mod.rs` (join keys ~:403-417,
  ChangeTableEvents id fallback ~:1018-1046, Event id ~:770-777)
- Modify: `backend/shared/src/data_extraction/compile.rs` (column_as_text ~:296-318,
  probe_nullable_identity ~:321-346, NULL_RENDERING const :25, ProbeKind ~:202-221)
- Modify: `backend/shared/src/data_extraction/compile_tests.rs`,
  `backend/shared/src/data_extraction/tests.rs` (assertions on old semantics)

**Interfaces:**
- Produces: `NormalizedValue`-consuming helper on IndexedRow:
  `pub fn get_id_string(&self, column: &str) -> Option<String>` — Text -> Some(identity),
  Integer -> Some(decimal), Boolean -> Some("true"/"false"), Null -> None,
  Float/Timestamp/Json/Unknown -> None. `ValueExpression::evaluate` switches from
  `get_string` to `get_id_string` (Constant unchanged; Template placeholders use
  `get_id_string`, any None placeholder -> whole template None).
- Semantics now guaranteed: identity-position evaluation returning None SKIPS the row —
  never synthesizes. Later tasks rely on: "id/type/endpoint expressions never render
  NULL, and rows with null identity inputs are dropped by both interpreters."

Steps:

- [ ] **Step 1: Failing extractor unit tests** in `tests.rs`: (a) Object usage over rows
  where the id column is NULL -> no object created (previously an object named "NULL");
  (b) Template `"{a}-{b}"` with `b` NULL -> row dropped; (c) qualifier NULL still
  becomes `""` (qualifier path keeps `unwrap_or_default`); (d) ChangeTableEvents with id
  expression present but NULL value -> row dropped, NOT counter-numbered. Write against
  the in-memory row-processing helpers the existing tests in tests.rs use.
- [ ] **Step 2: Run** `cargo test -p ocpq-shared data_extraction` — new tests fail.
- [ ] **Step 3: Implement extractor side.** `get_id_string` as specified;
  `ValueExpression::evaluate` uses it; in `mod.rs` ChangeTableEvents replace the
  `unwrap_or_else(counter)` fallback (mod.rs:1027-1033) with: id expression present but
  evaluates None -> `continue` (skip row). Event usage: `id` expression present but
  None -> skip row (do not call add_event with None). Join keys (apply_transform
  :403-417): replace `v.to_string()` with the same id-rendering (`NormalizedValue` ->
  Option<String> helper); a None key on either side -> row does not participate
  (SQL inner-join null semantics). Missing-column `unwrap_or_default` -> also
  non-participating (None), not "".
- [ ] **Step 4: Run extractor tests — green.** Update any pre-existing tests asserting
  "NULL"-named entities or counter fallback (these are the approved semantics change;
  list every changed assertion in your report).
- [ ] **Step 5: Compiler side.** `column_as_text` for identity positions: drop the
  COALESCE-'NULL' wrapper; emit plain `CAST(col AS VARCHAR)` for Text/Integer and
  `CASE WHEN col THEN 'true' ELSE 'false' END` for Boolean; add `col IS NOT NULL` to the
  usage's filters for every column referenced by an identity expression (ids, endpoint
  ids, template placeholders — NOT qualifiers). Qualifier compilation keeps a
  NULL-tolerant path: qualifier column NULL must yield `''`? NO — check the extractor:
  qualifier goes through `evaluate` -> now None -> `unwrap_or_default` -> `""`. Mirror:
  `COALESCE(CAST(col AS VARCHAR), '')` for qualifier positions. Delete
  `ProbeKind::NullableIdentityColumn` and `probe_nullable_identity` (rule replaces it);
  delete `NULL_RENDERING`. Conditions (`compile_condition`) are NOT identity positions —
  they keep the existing `COALESCE(...,'NULL')` mirror of PreparedCondition's
  `get_string` behavior (which still renders Null as "NULL" — conditions are unchanged
  semantics; only `ValueExpression`/join paths changed).
- [ ] **Step 6: Update differential tests.** `nullable_identity_is_probed_not_uuid_synthesised`
  becomes `null_identity_rows_drop_on_both_sides`: fixture with NULL ids -> both surfaces
  omit those rows, no probe. Run `cargo test -p ocpq-shared compile_tests` — all green.
- [ ] **Step 7: Full suite** both commands green. Report every behavior delta.

### Task 1: Virtual-table schema resolver

**Files:** Modify `compile.rs`; test in `compile_tests.rs` (compile-only unit tests).

**Interfaces:**
- Consumes: `VirtualTableConfig`, `TransformOperation`, `TransformSource`, `JoinType`
  (blueprint.rs:884-937); `ColumnFacts`/`column_facts` (compile.rs:264-285).
- Produces:
  `struct VtSchema { columns: Vec<String>, facts: BTreeMap<String, ColumnFacts> }`;
  `fn resolve_vt_schemas(bp: &DataExtractionBlueprint) -> Result<BTreeMap<String, VtSchema>, RejectReason>`;
  new RejectReasons: `UnknownVirtualTable { id }` (ENGINEERING),
  `VirtualTableCycle { id }` (FUNDAMENTAL), `UnsupportedJoinType { join_type }`
  (ENGINEERING — extractor itself errors on non-Inner, mod.rs:359-363);
  `ColumnFacts` gains `derive(Clone)`.

Column-composition rules (mirror extractor exactly):
- Filter: schema unchanged.
- Join (Inner only): out = left columns ++ right columns minus right join keys; a right
  column colliding with a left name (and not a join key) becomes `right_<name>`
  (mod.rs:377-391).
- Union: base = FIRST source's columns (mod.rs:447-461). Facts: type agreement across
  contributing sources keeps the type; disagreement -> `col_type: "Unknown"`
  (conservative: existing rules reject Unknown in string positions); nullable = any
  contributor nullable OR any source lacks the column (padded NULL).
- Resolution: recursive over `TransformSource::VirtualTable` with visited/in-progress
  set (cycle -> `VirtualTableCycle`); `TransformSource::Table` looks up the matching
  `blueprint.tables` entry's `table_info` (missing -> `UnknownVirtualTable` with the
  table name).

- [ ] **Step 1: failing unit tests** — (a) join renames collision to `right_x`, drops
  right key; (b) union pads (missing col -> nullable), type disagreement -> Unknown;
  (c) cycle detected. Hand-built configs, no fixture.
- [ ] **Step 2: run/fail. Step 3: implement. Step 4:** `cargo test -p ocpq-shared compile_tests` green.

### Task 2: Compile Filter virtual tables

**Files:** Modify `compile.rs`; differential test in `compile_tests.rs`.

**Interfaces:**
- Consumes: Task 1 `resolve_vt_schemas`/`VtSchema`.
- Produces: `fn vt_select(vt_id, bp, schemas, dialect) -> Result<String, RejectReason>`
  (recursive; Join arm lands Task 3, Union arm Task 4 — until then those arms return
  `UnsupportedJoinType`-style ENGINEERING rejects); usages with `virtual_table_id`
  compile with `FROM (\n<vt_select>\n) AS t` instead of rejecting; refactor
  `UsageCtx.info` into `enum ColumnSchema<'a> { Table(&'a DataSourceTableInfo),
  Virtual(&'a VtSchema) }` with `fn facts(&self, column) -> Option<ColumnFacts>`, used
  by all column lookups (column_as_text, timestamp_expr, compile_condition).

Filter SQL: `SELECT <cols> FROM <source sql or quoted table> AS t WHERE <condition>`,
condition via existing `compile_condition` (extractor uses the same `PreparedCondition`
for VT filters and change-table rules — mod.rs:333-352).

- [ ] **Step 1: failing differential test** `filter_virtual_table_agrees`: fixture
  `orders(id TEXT, status TEXT)` with rows incl. a NULL status; VT = Filter
  ColumnEquals(status, 'ok'); usage = Object over VT. `assert_agrees`. (NULL status:
  extractor compares "NULL"=="ok" false; SQL COALESCE mirror in conditions — both drop.)
- [ ] **Step 2: run — fails (VirtualTableSource reject). Step 3: implement + retire the
  blanket `VirtualTableSource` reject for Filter; update `rejected_constructs_are_named`.
  Step 4: full suite green.**

### Task 3: Compile Inner Join virtual tables (typed keys)

**Files:** Modify `compile.rs`; differential tests.

**Interfaces:** Consumes Tasks 0-2. Produces the Join arm of `vt_select` and
`RejectReason::JoinKeyTypeMismatch { left, right }` (FUNDAMENTAL under the typed rule:
cross-type joins are not defined) and reuse `UnstableStringRendering` for key columns
outside {Text, Integer, Boolean} (DIALECT/ENGINEERING per column type).

Post-Task-0 semantics: keys compared typed, same declared type required on both sides,
NULL keys don't participate. SQL:

```sql
SELECT l."a" AS "a", ..., r."x" AS "right_x", ...
FROM (<left>) AS l INNER JOIN (<right>) AS r
  ON l."k" = r."k2" AND ...
```

Native equality is exact for same-type Text/Integer/Boolean keys (injective rendering,
NULLs drop on both sides per Task 0). No CAST, no COALESCE — index-friendly, which the
paper's cost claims depend on.

- [ ] **Step 1: failing differential test** `inner_join_virtual_table_agrees`: fixture
  `a(k INTEGER, name TEXT)`, `b(k INTEGER, name TEXT, price REAL)`; rows incl. NULL keys
  both sides (must NOT join) and one left row matching two right rows (fanout); usage =
  Event over the VT with Template id `"{name}-{right_name}"` (exercises collision
  renaming), constant type, Constant timestamp. Second blueprint: `a.k INTEGER` vs
  `b.k TEXT` -> assert `JoinKeyTypeMismatch`.
- [ ] **Step 2: run/fail. Step 3: implement. Step 4: full suite green.**

### Task 4: Compile Union virtual tables + chaining

**Files:** Modify `compile.rs`; differential tests.

**Interfaces:** Consumes Tasks 1-3. Produces Union arm; recursion covers chained VTs.

Per-branch projection of the base (first source's) column list; missing column -> `NULL`:

```sql
SELECT "id" AS "id", "status" AS "status" FROM (<src1>) AS t
UNION ALL
SELECT "id" AS "id", NULL AS "status" FROM (<src2>) AS t
```

Empty `sources` -> extractor yields zero columns; any usage over it hits `UnknownColumn`
via the empty Task-1 schema — assert that, don't invent SQL.

- [ ] **Step 1: failing differential test:** `evts_web(id TEXT, ts TIMESTAMP)` union
  `evts_shop(id TEXT)` (missing ts -> NULL pad -> rows drop at timestamp on both sides);
  chained `vt2 = Filter(vt1)`; usage = Event over vt2 with
  `TimestampSource::Column("ts")`. If SQLite discovery does not type `ts` as Timestamp,
  fall back to Constant timestamp and cover pad-drop via a ColumnNotEmpty condition
  instead — state which in the report.
- [ ] **Step 2: run/fail. Step 3: implement. Step 4: full suite green.**

### Task 5: Delimiter multi-value split

**Files:** Modify `compile.rs` (relation emission ~:535-568, :840-968, :1018-1081);
differential tests.

**Interfaces:** Consumes existing `RelRows`/`emit_relation_view`/`apply_prefix`.
Produces: delimiter-configured `MultiValueConfig` compiles for E2O target, O2O
source/target, inline refs; regex-configured split stays rejected as
`MultiValueRegexSplit { field }` (ENGINEERING — captures_iter group-iteration has no
single-expression SQL mirror); rename/replace the old `MultiValueSplit` reject
accordingly and update `rejected_constructs_are_named`.

Mirror `split_value`/`MultiValueConfig::split` (blueprint.rs:557-615, delimiter branch
:591-603 — read it first and mirror EXACTLY, incl. trim and empty-part dropping):

```sql
FROM (
  SELECT t.*, unnest(string_split(<raw_expr>, '<delim>')) AS __mv0
  FROM "rel_table" AS t
  WHERE <raw_expr> IS NOT NULL AND <raw_expr> <> ''   -- split_value: empty/null raw -> no parts
) AS t
-- part expr: trim(__mv0) if trim_values else __mv0; filters add <part_expr> <> ''
```

O2O both-sides multi: nested unnests (`__mv0`, `__mv1`) = cross product, mirroring the
nested loops (mod.rs:934-951). `apply_prefix` wraps the part expression.

- [ ] **Step 1: failing differential tests:** (a) E2O delimiter "," with values
  `'o1, o2'`, `''`, `'o1,,o3'`, `' o1 '`, trim on and off; (b) O2O both-sides multi;
  (c) inline ref multi; (d) regex-configured split asserts `MultiValueRegexSplit`.
- [ ] **Step 2: run/fail. Step 3: implement. Step 4: full suite green.**

### Task 6: Reject `ColumnNotEmpty` over Unknown-typed columns

Soundness hole (verified): extractor emptiness-checks Unknown values via `as_str`
(blueprint.rs:474-480); compiled SQL emits only `IS NOT NULL` for non-Text types ->
divergence on empty-string Unknown values.

**Files:** `compile.rs` (compile_condition ColumnNotEmpty arm), `compile_tests.rs`.
**Interfaces:** Produces `RejectReason::UnknownTypedNotEmpty { column }` (DIALECT —
depends on how the engine surfaces the underlying value).

- [ ] Step 1: compile-only failing test (hand-built `DataSourceTableInfo` with a column
  declared `"Unknown"` feeding a ChangeTableEvents ColumnNotEmpty rule; assert the new
  reject). Step 2: run/fail. Step 3: in the ColumnNotEmpty arm, after `column_facts`:
  `if facts.col_type == "Unknown" { return Err(...) }`. Step 4: suite green.

### Task 7: Regex portability guard for `ColumnMatches`

Extractor uses Rust `regex`; DuckDB uses RE2. Guard: parse with `regex-syntax` AST,
allowlist constructs with identical behavior, reject the rest.

**Files:** `backend/shared/Cargo.toml` (add `regex-syntax`, version matching the
`regex` pin in Cargo.lock), `compile.rs`, `compile_tests.rs`.
**Interfaces:** Produces `fn portable_regex(pattern: &str) -> Result<(), String>` and
`RejectReason::UnportableRegex { pattern, detail }` (DIALECT).

Allow: Literal, Dot, Concat, Alternation, Repetition, Group (capture/non-capture),
Assertion Start/End Line/Text, ClassPerl d/s/w (negated ok), ClassBracketed with only
literals/ranges/perl classes, Empty; flags i/m/s only. Reject: word boundaries,
`\p{...}`, class set operations, flags x/u/U/R, anything else. Apply in the
ColumnMatches arm before emitting.

- [ ] Step 1: compile-only failing test — allowed: `^ORD-[0-9]+$`, `(a|b)+c?`,
  `foo.*bar`, `\d{2,4}`, `(?i)status`; rejected: `\bword\b`, `\p{Greek}+`, `(?x) a b`,
  `[[:alpha:]--[aeiou]]`. Step 2: run/fail. Step 3: implement. Step 4: suite green.

### Task 8: `certified_ddl()` API

**Files:** `compile.rs` (impl CompiledOcel), `compile_tests.rs`.
**Interfaces:** Produces on `CompiledOcel`:

```rust
/// The DDL, only if every usage compiled. The caller must still execute `probes`
/// against the data and check they return zero rows before treating the views as
/// equivalent to the extractor.
pub fn certified_ddl(&self) -> Result<String, &[CompileError]> {
    if self.errors.is_empty() { Ok(self.ddl()) } else { Err(&self.errors) }
}
```

- [ ] Step 1: failing test (fully-compilable blueprint -> Ok; blueprint with any reject
  -> Err, raw `ddl()` still non-empty). Step 2: run/fail. Step 3: implement.
  Step 4: suite green.

---

## Out of scope (later plans)

Phase B: dialect emitters (Postgres/SQLite/MySQL) + per-dialect fact tables + per-engine
differential harness. Phase C: typed attribute values (semantics change — needs aarkue
sign-off), ObjectAttributeTracking views, benchmark harness per aarkue's spec (strict
(c)/(b) same-engine, per-construct query tags, index disclosure, crossover), endpoint/UI.
FEDERATION: out of scope entirely.

## Self-review notes

- Task 0 is the only semantics change; every changed assertion must be listed in its
  report. Tasks 1-5 mirror post-Task-0 extractor; 6-8 are independent soundness/API.
- Names used consistently: `vt_select`, `VtSchema`, `ColumnSchema`, `get_id_string`,
  `JoinKeyTypeMismatch`, `MultiValueRegexSplit`, `UnportableRegex`,
  `UnknownTypedNotEmpty`, `certified_ddl`.
- Every RejectReason (new and existing) gets its FUNDAMENTAL/ENGINEERING/DIALECT marker
  during whichever task first touches it; Task 0 adds markers to all pre-existing ones.
