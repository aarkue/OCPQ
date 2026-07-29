# Phase B: Multi-Dialect Emission + Per-Engine Differential Harness

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Successor to `2026-07-19-pushability-phase-a.md` (Phase A complete: VT compilation, canonical id rendering, multi-value split, regex guard, certified_ddl; 6 reference-extractor bugs fixed under user rulings).

**Goal:** Emit certified OCEL 2.0 views in PostgreSQL, SQLite, and MySQL/MariaDB as well as DuckDB, with a per-dialect reject taxonomy and a differential harness that runs the extractor-vs-views comparison inside each engine.

**Architecture:** `/home/aarkue/doc/projects/OCPQ/backend/shared/src/data_extraction/`. Today `SqlDialect` has ONE variant (DuckDB), 5 private methods, and ~34 additional hardcoded DuckDB-isms scattered through `compile.rs` (inventory in this plan's Task 1-2 file lists). Phase B first routes every emission point through the dialect (Tasks 1-3, DuckDB behaviour unchanged, existing suite as the safety net), parameterizes the harness (Task 4), then adds one engine per task (5-7), then exports the construct x dialect matrix as a test artifact (Task 8).

**Tech Stack:** Rust; DuckDB CLI + sqlite3 CLI (already used); PostgreSQL and MySQL/MariaDB reachable via connection-string env vars with skip-if-unavailable gating (same pattern as the existing `have_tools()`).

## Global Constraints

- NEVER run git state-changing commands. Working tree only; the user commits. (Phase A is also uncommitted — do not "clean up" the tree.)
- The extractor (`mod.rs`) is the reference semantics for ALL dialects. Reject rather than approximate. Certification framework is absolute: every construct, PER DIALECT, is exactly one of (a) compiles with an argument for agreement, (b) statically rejected with a typed reason, (c) compiles + emits a probe whose emptiness certifies agreement. No "probably agrees".
- Every RejectReason carries a FUNDAMENTAL / ENGINEERING / DIALECT marker. Phase B makes DIALECT real: the SAME construct may compile on one engine and reject on another. A reject that is dialect-relative must record WHICH dialects.
- Tasks 1-4 must not change ANY emitted DuckDB SQL. The existing suite (compile_tests 45/45, data_extraction 93/93) is the refactor's safety net: if a DuckDB test changes expectations in Tasks 1-4, that is a bug in the refactor, not a test to update.
- Test commands (from `/home/aarkue/doc/projects/OCPQ/backend`): `cargo test -p ocpq-shared compile_tests` and `cargo test -p ocpq-shared data_extraction`. Engine-backed tests skip when their engine is unreachable — print a skip line, never silently pass.
- Minimal comments, WHY-only.

## Verified engine facts (researched 2026-07-19/20; PG 18.3, SQLite 3.52, DuckDB 1.4.2 tested empirically, MySQL doc-based)

These drive the per-dialect rejects. Do not re-derive; DO re-verify empirically per engine when implementing its task.

| Construct | PostgreSQL | SQLite | MySQL 8.0.4+/MariaDB | DuckDB (baseline) |
|---|---|---|---|---|
| text cast type name | `text` | `TEXT` | `CHAR` only (VARCHAR/TEXT are syntax errors) | `VARCHAR` |
| float -> text (`5.0`) | `5` | `5.0` (17-digit printer) | `5` | `5.0` |
| bool -> text | `true`/`false` | `1`/`0` (no bool type) | `1`/`0` (TINYINT(1)) | `true`/`false` |
| `\|\|` concat | OK, NULL-propagating | OK | **logical OR** — must emit `CONCAT()` | OK |
| regex | `~`/`regexp_like` (PG15+), POSIX ARE **leftmost-longest** | **none built-in** (UDF opportunity) | ICU (MySQL) / PCRE (MariaDB); default case-sensitivity is COLLATION-driven | RE2 (matches Rust `regex`) |
| split to rows | `unnest(string_to_array(..))` | none (recursive CTE only, not view-composable) | none (`JSON_TABLE` hack unsound for values with `"`/`\`) | `unnest(string_split(..))` |
| trim with char SET | `TRIM(BOTH chars FROM x)` | `trim(x, chars)` | **impossible** — `remstr` is a substring, not a set | `trim(x, chars)` |
| timestamp -> RFC3339 | `to_char(.. AT TIME ZONE 'UTC', ..)` | `strftime` (**%f = ms only**) | `DATE_FORMAT` | `strftime` |
| persistent view over ATTACHed db | OK (FDW) | **REJECT** (TEMP views only) | n/a | OK |
| identifier quoting | `"x"`, unquoted folds LOWER | `"x"` | backtick default; table-name case = host-OS dependent | `"x"` |

Key consequences: float and boolean rendering are never uniformly OK (validates the existing `Unstable*Rendering` rejects); MySQL's failures are constructs that LOOK like they work (silent wrong OCEL without certification — the paper's strongest motivation); SQLite's regex absence flips to EXACT fidelity if the connection registers the Rust `regex` crate as the `regexp()` UDF (deployment-posture lever, worth a paper sentence).

---

### Task 1: Dialect abstraction — expression-level emission

Route every expression-level DuckDB-ism through `SqlDialect`. No behaviour change.

**Files:**
- Modify: `backend/shared/src/data_extraction/compile.rs`
- Test: `backend/shared/src/data_extraction/compile_tests.rs` (existing suite is the guard; add DDL-substring assertions only where a method's output is not already pinned)

**Interfaces:**
- Produces on `SqlDialect` (all `fn(&self, ..) -> String` unless noted), each currently returning today's DuckDB text verbatim:
  `text_type_name()`, `cast_to_text(expr)` (exists — must now use `text_type_name`), `null_text_literal()` (for `CAST(NULL AS VARCHAR)`), `null_timestamp_literal()`, `epoch_timestamp_literal()` (replaces the `EPOCH_LITERAL` const, compile.rs:22), `concat(parts: &[String])` (replaces the two `" || "` joins at 1240 and the prefix concat at 1518), `bool_to_text(qualified_col)` (replaces the CASE at 1089-1092), `unicode_trim(expr)` (replaces `trim(x, UNICODE_WHITE_SPACE)` at 1374-1378), `split_to_rows(raw_expr, delim_literal, out_alias)` -> `Option<String>` (None = dialect cannot; replaces the `unnest(string_split(..))` fragment at 1361-1368), `regex_match(expr, pattern)` (exists), `timestamp_literal(ts)` (exists), `coalesce(expr, default_literal)`.
- All existing call sites switch to these; `EPOCH_LITERAL` and `UNICODE_WHITE_SPACE` consts move behind dialect methods (the 25-codepoint literal stays a shared const consumed by `unicode_trim`).

- [ ] **Step 1: Pin current DuckDB output.** Before refactoring, add a test `duckdb_emission_is_unchanged_by_dialect_refactor` that compiles one blueprint exercising: template concat, prefix concat, a boolean identity column, a delimiter multi-value split (trim on), a constant timestamp, a per-type object view (epoch literal), an empty relation view. Snapshot the exact DDL string into the test as the expected value.
- [ ] **Step 2: Run it — passes (it just records today's output).**
- [ ] **Step 3: Add the methods** listed above to `SqlDialect`, each returning exactly the string the current hardcoded site produces for DuckDB.
- [ ] **Step 4: Replace every corresponding hardcoded site** with a call. Sites: compile.rs:22 (const), 1089-1092, 1103-1106, 1117-1120, 1240, 1243, 1309, 1327-1330+1374-1378, 1361-1368, 1518, 2315, 2341, 2350-2351, 2444-2445, 2476-2477.
- [ ] **Step 5: Run the full suite** — `cargo test -p ocpq-shared compile_tests && cargo test -p ocpq-shared data_extraction`. The snapshot test from Step 1 MUST still pass byte-identically. Any diff = refactor bug.

### Task 2: Dialect abstraction — structural emission (+ fix unaliased derived tables)

**Files:** as Task 1.

**Interfaces:**
- Produces on `SqlDialect`: `quote_ident(name)` (exists but currently ignores `self` — must branch), `string_literal(value)` (exists; must branch — MySQL backslash escaping), `create_view(name, body)`, `derived_table(sql, alias)` (ALWAYS emits an alias), `empty_relation(cols: &[(name, TypeHint)])`, `union_all(selects)`, `distinct_select(cols, from)`, `semi_join_in(expr, table, col)`, `true_predicate()` / `false_predicate()`, `statement_separator()`.
- **Bug fix in this task:** compile.rs:2322-2325, 2358-2361, 2389-2392, 2514-2520 emit `FROM (\n..\n)` with NO alias. Postgres AND MySQL both hard-error ("subquery in FROM must have an alias" / "Every derived table must have its own alias"). Route all four through `derived_table(..)` which always appends an alias. Same for the harness wrapper at compile_tests.rs:223.
- Also route the hardcoded quoted view names (2323, 2333, 2341, 2359, 2365, 2371, 2400, 2410, 2417, 2429-2430, 2437-2438) through `quote_ident`.

- [ ] **Step 1: Extend the Step-1 snapshot test** from Task 1 to also cover the assemble path (object/event/relation views + a probe), pinning current DuckDB DDL.
- [ ] **Step 2: Run — passes.**
- [ ] **Step 3: Implement the methods; replace the sites; alias every derived table.**
- [ ] **Step 4: Full suite green; snapshot unchanged EXCEPT the added aliases** (aliases are new text — update the snapshot deliberately in this step and note it in the report, since adding an alias is the intended fix, and confirm DuckDB still executes the aliased SQL identically by running the differential tests).

### Task 3: Per-dialect capability model + dialect-relative rejects

**Files:** as Task 1, plus the regex guard functions (compile.rs:2125-2219).

**Interfaces:**
- Produces: `struct DialectCaps { has_regex: bool, regex_family: RegexFamily, can_split_to_rows: bool, can_trim_charset: bool, bool_text: BoolText, float_text_matches_reference: bool, max_timestamp_precision: TimePrecision, ... }` returned by `SqlDialect::caps()`.
- `rendering_of(col_type)` (compile.rs:414-419) becomes `rendering_of(dialect, col_type)` — it drives 4 reject variants and IS per-dialect (float/timestamp text differ per engine).
- `portable_regex(pattern)` becomes `portable_regex(dialect, pattern)`; the 6 walker fns (2125-2219) take the `RegexFamily`. RE2 rules stay for DuckDB; other families get their own allowlists in Tasks 5-7.
- New/extended RejectReasons, each DIALECT-marked and recording the dialect: `DialectLacksRegex`, `DialectLacksSplitToRows`, `DialectLacksCharsetTrim`, `DialectTimestampPrecision`, `RegexFamilyMismatch { family, detail }`.
- `CompiledOcel` gains the dialect it was compiled for (so a caller can tell which taxonomy applies).
- **MANDATORY (flagged by the Task 1 review — otherwise Task 6 panics instead of rejecting):** `wrap_multi_value` currently `.expect()`s `split_to_rows`'s `Option`, which is unreachable only because DuckDB always returns `Some`. Before ANY dialect sets `can_split_to_rows: false`, change `wrap_multi_value`'s signature to `Result<(String, String), RejectReason>`, replace the `.expect(..)` with `?`-propagation returning `DialectLacksSplitToRows`, and update all 4 call sites (compile.rs ~1900, ~1959, ~1966, ~2134) to propagate. Do this in THIS task, not in Task 6.
- Decide explicitly (Task 1 review, Minor): the ChangeTableEvents `CASE .. WHEN .. THEN .. ELSE NULL END` skeleton (compile.rs ~2033) is ANSI-standard across all four engines and was deliberately left inline. Either route it through the dialect for uniformity or record the decision to leave it — state which in the report.

- [ ] **Step 1: Failing test** `duckdb_caps_are_unchanged`: assert `SqlDialect::DuckDB.caps()` reports has_regex=true, RE2, can_split_to_rows=true, can_trim_charset=true, bool_text=TrueFalse — and that every existing reject/compile outcome in the suite is unchanged.
- [ ] **Step 2: Run/fail. Step 3: Implement caps + thread dialect through `rendering_of` and `portable_regex`. Step 4: Full suite green, zero behaviour change for DuckDB.**

### Task 4: Parameterize the differential harness over a target engine

**Files:** `backend/shared/src/data_extraction/compile_tests.rs`.

**Interfaces:**
- Produces: `enum TargetEngine { DuckDb, Postgres, Sqlite, MySql }`; `fn engine_available(e) -> bool` (replaces `have_tools()` at :30 — DuckDB/SQLite via `which`, Postgres/MySQL via env var `OCPQ_TEST_PG_URL` / `OCPQ_TEST_MYSQL_URL` + a connectivity ping); `fn run_engine(e, fixture_path, blueprint, ddl, query) -> String` (replaces `run_duckdb` at :155); `fn surface_query(e) -> String` (replaces the const `SURFACE_QUERY` at :147 — the `strftime(ts,fmt)` call is dialect-specific); `fn assert_agrees_on(e, path, bp)` (generalizes `assert_agrees` at :231, which becomes `assert_agrees(path, bp) = assert_agrees_on(DuckDb, ..)` so existing call sites are untouched).
- Source-table ingestion per engine (the biggest change; DuckDB's `INSTALL sqlite; ATTACH; CREATE TABLE AS SELECT *` at :157-172 has no equivalent elsewhere): DuckDB keeps today's path; SQLite = no-op (the fixture file IS the database, views are created in it — note persistent views cannot cross an ATTACH, so never attach for SQLite); Postgres/MySQL = generate `CREATE TABLE` + `INSERT` from the fixture's rows into a per-test schema/database, then drop it. Implement a `load_fixture_into(e, path, blueprint)` helper.
- ~25 `if !have_tools() { return; }` guards become `if !engine_available(DuckDb) { return; }` (mechanical).

- [ ] **Step 1: Implement the parameterization with DuckDb as the ONLY wired engine** (other arms `unimplemented!()` or return "unavailable"). **Step 2: Full suite green — every existing test still runs through the parameterized path against DuckDB.** This task is done when the harness is engine-generic but behaviour is identical.

### Task 5: PostgreSQL dialect + harness backend

**Files:** compile.rs, compile_tests.rs.

**Interfaces:** `SqlDialect::Postgres`; caps: has_regex=true (family=PosixAre), can_split_to_rows=true, can_trim_charset=true, bool_text=TrueFalse, float_text_matches_reference=false.

Per-dialect specifics to implement and EMPIRICALLY verify (do not trust the table — re-run each against the live server):
- `text` cast type; `TRIM(BOTH '<25 codepoints>' FROM x)`; `unnest(string_to_array(x, delim))` (note: PG's select-list SRF semantics differ from DuckDB's — prefer a lateral join form and verify row multiplicity matches the extractor's cross-product exactly); `to_char(ts AT TIME ZONE 'UTC', ..)` with UTC pinned (session TimeZone must not leak into a view's output — verify determinism); identifiers always quoted (unquoted folds lower).
- **Regex: POSIX ARE is leftmost-longest for alternation** vs Rust/RE2 leftmost-first. A pattern with alternation can match a DIFFERENT substring on PG even when both engines accept it. Since `ColumnMatches` only needs a boolean "does it match", verify whether leftmost-longest vs leftmost-first can change the BOOLEAN result (it cannot for a pure match test — but CAN if the pattern is anchored in a way that interacts, or if capture semantics are ever used). Decide: if boolean-equivalent, allow the RE2 allowlist minus PG-unsupported constructs; if not, reject alternation. Document the argument — this is a paper-grade fragment boundary.
- Float in string positions stays rejected (existing `Unstable*Rendering`) — confirm the reject fires for PG too.

- [ ] **Step 1: Harness backend first** — `load_fixture_into(Postgres, ..)` + `run_engine(Postgres, ..)` (psql or a Rust client; JSON via `row_to_json`), gated on `OCPQ_TEST_PG_URL`.
- [ ] **Step 2: Failing differential test** `postgres_basic_surface_agrees`: the simplest existing fixture (objects+events+E2O), `assert_agrees_on(Postgres, ..)`. **Step 3: Implement the dialect until green.**
- [ ] **Step 4: Port the construct tests** — run the existing differential fixtures under Postgres via `assert_agrees_on`, recording per-construct outcome (compiles / rejects-with-reason). Where a construct rejects on PG, assert the reject explicitly. **Step 5: Full suite green (PG tests skip cleanly without the env var).**

### Task 6: SQLite dialect + harness backend

**Files:** as Task 5.

**Interfaces:** `SqlDialect::Sqlite`; caps: has_regex=**false**, can_split_to_rows=**false**, can_trim_charset=true, bool_text=OneZero, max_timestamp_precision=Milliseconds.

- `TEXT` cast; `trim(x, chars)` works (verified); `strftime` for timestamps but **`%f` is milliseconds only** -> sub-millisecond timestamps REJECT (`DialectTimestampPrecision`).
- `ColumnMatches` -> `DialectLacksRegex` reject. Document the deployment-posture lever in the reject's doc comment: registering the Rust `regex` crate as a `regexp()` UDF would make SQLite EXACTLY faithful (it would literally run the reference engine) — the sharpest instance of engine-relative fragment. Do NOT implement the UDF in this task (it requires owning the connection, which the view model does not); state it as the documented alternative.
- Multi-value split -> `DialectLacksSplitToRows` reject (recursive CTE is not view-composable).
- Boolean in identity position: SQLite renders 1/0 and the catalog cannot distinguish a boolean from an INTEGER — the `bool_to_text` CASE normalizer still produces the reference's `true`/`false` IF the mapping declares the column boolean; verify against the declared-type path and reject if the declared type cannot be trusted.
- **Never ATTACH for SQLite**: persistent views cannot reference an attached database. Views go in the same file as the source tables.

- [ ] Same step shape as Task 5 (harness backend -> failing differential test -> dialect -> port construct tests asserting the SQLite rejects -> full suite green).

### Task 7: MySQL/MariaDB dialect + harness backend + collation probe

**Files:** as Task 5.

**Interfaces:** `SqlDialect::MySql`; caps: has_regex=true (family=Icu/Pcre), can_split_to_rows=**false**, can_trim_charset=**false**, bool_text=OneZero.

This is the engine that justifies certification — every item below is a construct that LOOKS fine and silently produces wrong OCEL if emitted naively:
- `CHAR` cast type (VARCHAR/TEXT are syntax errors).
- **`||` is logical OR** -> `concat()` must emit `CONCAT(..)`. Verify NULL propagation matches (`CONCAT('a',NULL) IS NULL` — it does).
- **`TRIM` cannot trim a character set** -> `unicode_trim` returns the explicit 25-codepoint `REGEXP_REPLACE(x,'^[..]+|[..]+$','')` form on 8.0.4+/MariaDB 10.6+, and `DialectLacksCharsetTrim` REJECT below that. Verify the REGEXP_REPLACE form against all 25 codepoints AND the ZWSP control (must NOT be trimmed).
- Multi-value split -> `DialectLacksSplitToRows` REJECT (the `JSON_TABLE(REPLACE(JSON_ARRAY(..)))` idiom is unsound for values containing `"` or `\`; a certifying compiler must refuse it).
- Regex: default case-sensitivity is COLLATION-driven -> always emit an explicit `c` match_type; ICU/PCRE family allowlist.
- Backtick identifier quoting; **table-name case sensitivity is host-OS dependent** (`lower_case_table_names`) -> the compiler cannot certify MySQL table references from SQL text alone. Record this as a documented certification precondition.
- **Collation (user-ruled 2026-07-20): precondition + probe, NOT per-comparison COLLATE.** Emission stays simple. Add `ProbeKind::NonBinaryCollation`: a query over `information_schema.columns` returning any column that feeds a string comparison (id, qualifier, condition, join key) whose collation is not binary/case-sensitive. Zero rows certifies that MySQL `=`/`<>` agrees with Rust byte equality. Rationale for the doc comment: collation is not in the blueprint's declared schema (dbcon does not expose it), so it is decidable only against the live instance — exactly the probe category; and per-comparison `COLLATE` would defeat index usability, corrupting the Phase C benchmark.

- [ ] Same step shape as Task 5, plus: **Step N: failing probe test** — a fixture with a `utf8mb4_general_ci` column feeding an id, assert `NonBinaryCollation` probe FIRES (returns rows); then a `utf8mb4_bin` variant, assert it holds. This is the "deliberate disagreement per new probe kind" the Phase A convention requires.

### Task 8: Construct x dialect matrix as a test artifact

**Files:** `backend/shared/src/data_extraction/compile_tests.rs` (or a new `dialect_matrix.rs`), plus an exported artifact.

**Interfaces:** Produces `fn dialect_matrix() -> Vec<(Construct, Dialect, Outcome)>` where `Outcome = Compiles | Rejects(RejectReason discriminant) | Probes(ProbeKind)`, asserted by a test so the matrix cannot drift from reality, and serialized (JSON/markdown) to `docs/` for the paper.

Constructs to cover (rows): column-map id, template composite id, constant/dynamic type, native timestamp, Components timestamp, static attrs, qualifier, E2O/O2O, inline refs, change-table CASE rules, VT Filter, VT Inner Join (same-type / cross-type), VT Union (+pad), delimiter multi-value split (trim on/off), regex multi-value split, ColumnMatches (per regex family), ColumnNotEmpty (Text/Unknown), object attribute tracking, float/bool/timestamp in string position, prefix_id_with_type.

- [ ] **Step 1: Write the matrix test asserting the CURRENT outcome for every (construct, dialect) pair** — it must be derived by actually compiling a representative blueprint per construct per dialect, not hand-written. **Step 2: Run — it now documents reality. Step 3: Emit the serialized artifact. Step 4: Full suite green.**

---

## Out of scope (Phase C)

Benchmark harness ((c)/(b) same-engine overhead, per-construct query tags, index disclosure, crossover), real-ERP blueprint authoring (Odoo/ERPNext/Dolibarr/Tryton — schema dossiers already in the rust4pm repo at `docs/superpowers/research/2026-07-19-erp-schemas-*.md`), typed attribute values, ObjectAttributeTracking as views, backend endpoint + UI toggle.

## Self-review notes

- Tasks 1-4 are behaviour-preserving; the existing 45+93 suite is the guard. Tasks 5-7 each add exactly one engine and its reject column. Task 8 makes the paper's matrix a test.
- Carried Phase A minors (deferred, revisit opportunistically): `fetch_rows_for_key` defensive intersect; `apply_transform` too_many_arguments (context struct); `join_key_facts`/`column_facts_checked` dedup; Union-over-Filter differential direction; package-wide `cargo fmt` drift.
- Names used consistently: `DialectCaps`, `RegexFamily`, `BoolText`, `TargetEngine`, `run_engine`, `assert_agrees_on`, `load_fixture_into`, `dialect_matrix`.
