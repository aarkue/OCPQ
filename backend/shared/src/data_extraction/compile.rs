//! Compile a [`DataExtractionBlueprint`] into SQL presenting the OCEL 2.0 surface over
//! the untouched source tables.
//!
//! [`super::execute_extraction`] is the reference semantics. A usage is only compiled
//! when the emitted SQL provably agrees with it; everything else becomes a
//! [`CompileError`] naming the usage and the reason. Cases that are decidable only
//! against the data (rather than against the blueprint) become a [`Probe`]: SQL that
//! must return zero rows for the emitted relations to agree.
//!
//! Each relation is stored as a bare `SELECT` body ([`ViewDef`]), which
//! [`CompiledOcel`] can emit three ways: [`CompiledOcel::ddl`] wraps them in
//! `CREATE VIEW`; [`CompiledOcel::with_prelude`] inlines them as a `WITH` prelude in
//! front of an analysis query (no DDL -- runs against a read-only database, no
//! `CREATE VIEW` right needed); [`CompiledOcel::materialize_ddl`] emits
//! `CREATE TABLE ... AS` for callers that have write rights and want the relations
//! computed once. All three share the same bodies and the same [`Probe`]s
//! ([`CompiledOcel::probe_statements`] runs the probes view-free), so certification is
//! identical across them. Emission does not change which usages are pushable: an
//! un-viewable usage is un-inlineable too. Caveat: a relation referenced many times is
//! re-inlined by `with_prelude` each time -- prefer `ddl`/`materialize_ddl` there.

use std::collections::{BTreeMap, BTreeSet, HashSet};

use crate::data_extraction::blueprint::{
    build_column_index, ChangeTableCondition, DataExtractionBlueprint, IndexedRow,
    InlineObjectReference, JoinType, MultiValueConfig, ObjectTypeSpec, TableExtractionConfig,
    TableUsageData, TimestampSource, TransformOperation, TransformSource, ValueExpression,
    VirtualTableConfig,
};
use crate::data_source::DataSourceTableInfo;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SqlDialect {
    #[default]
    DuckDB,
}

/// A typed placeholder column in an always-empty relation (`empty_relation`): which NULL
/// literal to cast, since `object_object`'s empty branch needs a text NULL but the empty
/// event union also needs a timestamp NULL.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TypeHint {
    Text,
    Timestamp,
}

impl SqlDialect {
    fn quote_ident(&self, name: &str) -> String {
        match self {
            SqlDialect::DuckDB => format!("\"{}\"", name.replace('"', "\"\"")),
        }
    }

    fn string_literal(&self, value: &str) -> String {
        match self {
            SqlDialect::DuckDB => format!("'{}'", value.replace('\'', "''")),
        }
    }

    /// `CREATE VIEW <name> AS\n<body>`, always quoting `name` through `quote_ident` --
    /// callers pass the bare view name, never a pre-quoted literal.
    fn create_view(&self, name: &str, body: &str) -> String {
        format!("CREATE VIEW {} AS\n{}", self.quote_ident(name), body)
    }

    /// A parenthesized subquery in FROM position, always aliased. Postgres and MySQL both
    /// hard-error on an unaliased derived table ("subquery in FROM must have an alias" /
    /// "Every derived table must have its own alias"); DuckDB alone tolerates it, which is
    /// why the bug this method fixes went unnoticed. The 2-space indent matches the
    /// pre-existing formatting at every call site (kept so this refactor's diff is
    /// alias-only).
    fn derived_table(&self, sql: &str, alias: &str) -> String {
        format!("(\n  {}\n) AS {}", sql, alias)
    }

    /// An always-empty relation with typed NULL placeholder columns, e.g. `object_object`
    /// when no O2ORelation usage exists, or `event_map_type` over an empty type set.
    fn empty_relation(&self, cols: &[(&str, TypeHint)]) -> String {
        let projections: Vec<String> = cols
            .iter()
            .map(|(name, hint)| {
                let lit = match hint {
                    TypeHint::Text => self.null_text_literal(),
                    TypeHint::Timestamp => self.null_timestamp_literal(),
                };
                format!("{} AS {}", lit, name)
            })
            .collect();
        format!(
            "SELECT {} WHERE {}",
            projections.join(", "),
            self.false_predicate()
        )
    }

    /// Concatenate already-rendered `SELECT` branches into one `UNION ALL` chain.
    fn union_all(&self, selects: &[String]) -> String {
        selects.join("\n  UNION ALL ")
    }

    fn distinct_select(&self, cols: &[&str], from: &str) -> String {
        format!("SELECT DISTINCT {} FROM {}", cols.join(", "), from)
    }

    /// `expr IN (SELECT col FROM table)`: the semi-join an E2O/O2O relation view uses to
    /// drop a row whose endpoint the extractor's own lookup would have rejected. `table`
    /// is an already-rendered FROM target (e.g. `self.quote_ident(..)`'s result), not a
    /// bare name.
    fn semi_join_in(&self, expr: &str, table: &str, col: &str) -> String {
        format!("{} IN (SELECT {} FROM {})", expr, col, table)
    }

    /// An always-true predicate, e.g. an empty `ChangeTableCondition::And`'s `iter().all()`.
    fn true_predicate(&self) -> &'static str {
        "1 = 1"
    }

    /// An always-false predicate, e.g. an empty `ChangeTableCondition::Or`'s `iter().any()`,
    /// or a constant timestamp that failed to parse (no row survives).
    fn false_predicate(&self) -> &'static str {
        "1 = 0"
    }

    /// Terminates one `CREATE VIEW` statement in `CompiledOcel::ddl`'s output.
    fn statement_separator(&self) -> &'static str {
        ";"
    }

    /// The dialect's name for a variable-length text type, e.g. `CAST(.. AS <this>)`.
    fn text_type_name(&self) -> String {
        match self {
            SqlDialect::DuckDB => "VARCHAR".to_string(),
        }
    }

    fn cast_to_text(&self, expr: &str) -> String {
        format!("CAST({} AS {})", expr, self.text_type_name())
    }

    /// `CAST(NULL AS <text type>)`: an empty projection's placeholder text column.
    fn null_text_literal(&self) -> String {
        self.cast_to_text("NULL")
    }

    /// An empty projection's placeholder timestamp column.
    fn null_timestamp_literal(&self) -> String {
        match self {
            SqlDialect::DuckDB => "CAST(NULL AS TIMESTAMP)".to_string(),
        }
    }

    /// Objects without attribute changes are exported as a single row stamped with the
    /// Unix epoch (see `write_object_changes_*` in `process_mining`).
    fn epoch_timestamp_literal(&self) -> String {
        match self {
            SqlDialect::DuckDB => "TIMESTAMP '1970-01-01 00:00:00'".to_string(),
        }
    }

    /// Concatenate already-rendered SQL fragments (string literals and/or column
    /// expressions), parenthesized as a single expression.
    fn concat(&self, parts: &[String]) -> String {
        match self {
            SqlDialect::DuckDB => format!("({})", parts.join(" || ")),
        }
    }

    /// A boolean column rendered at an identity position: `get_id_string`'s rendering,
    /// matched literally rather than relying on the dialect's own boolean-to-text cast.
    fn bool_to_text(&self, qualified_col: &str) -> String {
        match self {
            SqlDialect::DuckDB => {
                format!("CASE WHEN {} THEN 'true' ELSE 'false' END", qualified_col)
            }
        }
    }

    /// Strip the full Unicode `White_Space` set from `expr`, matching Rust's `str::trim`
    /// (see `UNICODE_WHITE_SPACE`).
    fn unicode_trim(&self, expr: &str) -> String {
        match self {
            SqlDialect::DuckDB => {
                format!("trim({}, {})", expr, self.string_literal(UNICODE_WHITE_SPACE))
            }
        }
    }

    /// One row per delimiter-split part of `raw_expr`, aliased `out_alias`, mirroring
    /// `MultiValueConfig::split`'s delimiter branch. `None` means this dialect cannot
    /// express split-to-rows as a single selectable expression.
    fn split_to_rows(&self, raw_expr: &str, delim_literal: &str, out_alias: &str) -> Option<String> {
        match self {
            SqlDialect::DuckDB => Some(format!(
                "unnest(string_split({}, {})) AS {}",
                raw_expr, delim_literal, out_alias
            )),
        }
    }

    fn regex_match(&self, expr: &str, pattern: &str) -> String {
        match self {
            SqlDialect::DuckDB => {
                format!("regexp_matches({}, {})", expr, self.string_literal(pattern))
            }
        }
    }

    fn timestamp_literal(&self, ts: &chrono::DateTime<chrono::FixedOffset>) -> String {
        match self {
            SqlDialect::DuckDB => format!(
                "TIMESTAMP '{}'",
                ts.naive_utc().format("%Y-%m-%d %H:%M:%S%.f")
            ),
        }
    }

    /// `COALESCE(expr, default_literal)`; `default_literal` is an already-formatted SQL
    /// literal (e.g. `self.string_literal("")`).
    fn coalesce(&self, expr: &str, default_literal: &str) -> String {
        match self {
            SqlDialect::DuckDB => format!("COALESCE({}, {})", expr, default_literal),
        }
    }
}

/// Identifies the blueprint usage a diagnostic refers to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UsageRef {
    pub table_index: usize,
    pub table_name: String,
    pub mode: &'static str,
}

impl std::fmt::Display for UsageRef {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "tables[{}] ({} on '{}')",
            self.table_index, self.mode, self.table_name
        )
    }
}

/// Why a usage could not be compiled to a view.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RejectReason {
    /// FUNDAMENTAL: `add_event`/`add_object` fall back to `Uuid::new_v4()`, a nondeterministic
    /// side effect with no relational denotation, so no view can reproduce it.
    SynthesizedId { field: &'static str },
    /// FUNDAMENTAL: `ChangeTableEvents` without an id expression numbers events with a shared
    /// counter in row order; SQL rows are unordered, so this has no relational denotation.
    SynthesizedChangeTableEventId,
    /// ENGINEERING: object change tracking materialises timed attribute values; not
    /// compiled yet, but expressible in SQL (e.g. via window functions).
    ObjectAttributeTracking,
    /// ENGINEERING: regex-configured multi-value splitting is not compiled -- unlike a
    /// delimiter split (`string_split` + `UNNEST`, see `wrap_multi_value`), `split`'s regex
    /// branch iterates `captures_iter` and, per match, every capture group in turn; that
    /// two-level iteration over a data-dependent number of groups has no single-expression
    /// SQL mirror.
    MultiValueRegexSplit { field: &'static str },
    /// ENGINEERING: the timestamp is parsed by a chrono cascade that is not translated to
    /// SQL yet; the cascade's priority order could in principle be mirrored with nested
    /// parse attempts.
    ResidualTimestamp { detail: String },
    /// ENGINEERING: `get_id_string` (identity positions -- ids, endpoint ids, template
    /// placeholders, qualifiers -- and join keys, `join_key` in mod.rs) returns `None`
    /// unconditionally for a column of this declared type (Float rounding/formatting,
    /// Timestamp offset formatting, and JSON key order are not canonical), so the
    /// position always folds to one fixed, already-known result -- the row is always
    /// dropped (identity), or the value is always `''` (qualifier) -- same rationale as
    /// `UnknownColumn`: not implemented, but not fundamentally impossible either.
    UnstableIdentityRendering {
        column: String,
        col_type: String,
        field: &'static str,
    },
    /// DIALECT: `ChangeTableCondition` reads a column through `get_string` (Rust
    /// `Display`), a genuinely different rendering rule from `get_id_string` -- it
    /// renders every type, but Rust's `Display` and a plain SQL cast can disagree for
    /// this one (Float drops a trailing `.0`, Timestamp keeps an offset, JSON reorders
    /// keys). A per-dialect emitter that special-cased these formats could close the
    /// gap, so this is a dialect limitation, not something with no possible rendering.
    UnstableConditionRendering {
        column: String,
        col_type: String,
        field: &'static str,
    },
    /// ENGINEERING: a referenced column is absent from the declared table schema, so
    /// `evaluate` is always None; not compiled, but foldable to an always-empty result.
    UnknownColumn { column: String, field: &'static str },
    /// ENGINEERING: a Union with zero sources has no columns to project (Task 1's
    /// `union_schema` returns `columns: []`), and SQL has no zero-column `SELECT` -- the
    /// extractor's own relation is real (a zero-column, zero-row table), just not one SQL
    /// can express directly; not fundamentally impossible, just not invented here since a
    /// blueprint declaring a Union with no sources has nothing meaningful to derive a view
    /// from either way.
    EmptyUnion { virtual_table_id: String },
    /// FUNDAMENTAL: per-type views (`event_<T>`/`object_<T>`) are named `CREATE VIEW`
    /// statements, which require a statically known type name; a data-dependent type has
    /// no such name to give the view.
    DynamicTypeName { field: &'static str },
    /// FUNDAMENTAL: `prefix_id_with_type` is keyed by type name in shared, order-dependent
    /// extractor state, so a type must be prefixed consistently by every usage that
    /// declares it -- there is no relational denotation for "depends on processing order".
    ConflictingPrefixFlag { object_type: String },
    /// FUNDAMENTAL: with prefixing in play, a dynamic type name cannot be resolved against
    /// `ExtractionContext::prefixed_types` at compile time (same root cause as
    /// `DynamicTypeName`: no static name to reason about).
    DynamicTypeWithPrefixing { field: &'static str },
    /// ENGINEERING: a `Template` placeholder names no declared column, so it is never
    /// substituted and the whole expression evaluates to `None`; not compiled, but
    /// foldable to an always-empty result (same rationale as `UnknownColumn`).
    UnresolvableTemplatePlaceholder { placeholder: String },
    /// ENGINEERING: a `TransformSource` names a table or virtual table that is not
    /// declared in the blueprint; a fixed-up blueprint would resolve fine.
    UnknownVirtualTable { id: String },
    /// FUNDAMENTAL: a virtual table's transform graph refers back to itself, so there is
    /// no dependency order in which it could be materialised as a view.
    VirtualTableCycle { id: String },
    /// ENGINEERING: `apply_transform` itself only implements `JoinType::Inner`
    /// (mod.rs) -- Left/Right/Full are unimplemented in the reference too, not a SQL
    /// limitation.
    UnsupportedJoinType { join_type: String },
    /// FUNDAMENTAL: same-declared-type join keys are a language restriction, not a SQL
    /// dialect quirk or an unimplemented case -- the extractor's `apply_transform`
    /// (mod.rs) rejects a cross-type `on` pair too (comparing declared types the same
    /// way this reject does, via `compile::rendering_of`), so there is no cross-type join
    /// either interpreter actually computes for this variant to disagree about. Not
    /// DIALECT (a smarter emitter closes nothing here -- the reference semantics itself
    /// excludes cross-type keys) and not ENGINEERING (there is no cross-type join
    /// behavior left to wire up).
    JoinKeyTypeMismatch { left: String, right: String },
    /// DIALECT: `ColumnNotEmpty` on an `Unknown`-typed column emptiness-checks the
    /// extractor's `as_str` payload (blueprint.rs `PreparedCondition::ColumnNotEmpty`) --
    /// an empty string is "not empty" == false there, but Unknown has no declared
    /// rendering to check emptiness against in SQL, so only `IS NOT NULL` could be
    /// emitted, which is true for an empty string. Whether that gap is even observable
    /// depends on how the engine surfaces the underlying value for an Unknown column.
    UnknownTypedNotEmpty { column: String },
    /// DIALECT: `ColumnMatches` runs the pattern through Rust `regex` in the extractor
    /// (blueprint.rs `PreparedCondition::ColumnMatches`), but the compiled view uses
    /// DuckDB's `regexp_matches`, backed by RE2 -- the two engines mostly agree but
    /// diverge on word boundaries, `\p{...}` Unicode classes, character-class set
    /// operations, and several inline flags. `portable_regex` allowlists only the
    /// constructs proven identical in both rather than risk a silent mismatch.
    UnportableRegex { pattern: String, detail: String },
}

impl std::fmt::Display for RejectReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RejectReason::SynthesizedId { field } => write!(
                f,
                "'{}' is absent, so the extractor synthesises a random UUID per row",
                field
            ),
            RejectReason::SynthesizedChangeTableEventId => write!(
                f,
                "no id expression: ids are numbered by a shared counter in row order, \
                 which SQL cannot reproduce"
            ),
            RejectReason::ObjectAttributeTracking => {
                write!(
                    f,
                    "object change tracking (attribute_config) is not compiled"
                )
            }
            RejectReason::MultiValueRegexSplit { field } => write!(
                f,
                "regex-configured multi-value splitting on '{}' is not compiled",
                field
            ),
            RejectReason::ResidualTimestamp { detail } => {
                write!(f, "timestamp is residual: {}", detail)
            }
            RejectReason::UnstableIdentityRendering {
                column,
                col_type,
                field,
            } => write!(
                f,
                "column '{}' ({}) has no canonical identity rendering, so '{}' always \
                 evaluates to a fixed result (the extractor's own answer is already \
                 known, just not folded into SQL here)",
                column, col_type, field
            ),
            RejectReason::UnstableConditionRendering {
                column,
                col_type,
                field,
            } => write!(
                f,
                "column '{}' ({}) feeds '{}' through Rust Display, which a plain SQL \
                 cast does not reproduce for this type",
                column, col_type, field
            ),
            RejectReason::UnknownColumn { column, field } => write!(
                f,
                "column '{}' used by '{}' is not declared in the table schema",
                column, field
            ),
            RejectReason::EmptyUnion { virtual_table_id } => write!(
                f,
                "virtual table '{}' is a Union with no sources, which has no columns to \
                 select and no SQL representation",
                virtual_table_id
            ),
            RejectReason::DynamicTypeName { field } => write!(
                f,
                "'{}' is data-dependent, so the per-type view name is unknown at compile time",
                field
            ),
            RejectReason::ConflictingPrefixFlag { object_type } => write!(
                f,
                "object type '{}' is declared both with and without prefix_id_with_type; \
                 the resulting ids depend on processing order",
                object_type
            ),
            RejectReason::DynamicTypeWithPrefixing { field } => write!(
                f,
                "'{}' is data-dependent and the blueprint uses prefix_id_with_type, so the \
                 prefix cannot be resolved at compile time",
                field
            ),
            RejectReason::UnresolvableTemplatePlaceholder { placeholder } => write!(
                f,
                "template placeholder '{{{}}}' names no declared column, so the expression \
                 always evaluates to None",
                placeholder
            ),
            RejectReason::UnknownVirtualTable { id } => write!(
                f,
                "'{}' does not name a table or virtual table declared in the blueprint",
                id
            ),
            RejectReason::VirtualTableCycle { id } => write!(
                f,
                "virtual table '{}' is part of a cycle in the transform graph",
                id
            ),
            RejectReason::UnsupportedJoinType { join_type } => write!(
                f,
                "join type {} is not supported; only Inner is implemented",
                join_type
            ),
            RejectReason::JoinKeyTypeMismatch { left, right } => write!(
                f,
                "join key '{}' and '{}' have different declared types; same-declared-type \
                 join keys are a language restriction both interpreters enforce",
                left, right
            ),
            RejectReason::UnknownTypedNotEmpty { column } => write!(
                f,
                "column '{}' is declared Unknown and used by ColumnNotEmpty; Unknown has no \
                 declared rendering to check emptiness against in SQL",
                column
            ),
            RejectReason::UnportableRegex { pattern, detail } => write!(
                f,
                "regex '{}' is not provably identical between Rust regex (extractor) and \
                 RE2 (DuckDB): {}",
                pattern, detail
            ),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompileError {
    /// None for a declared virtual table that no usage ever reaches -- there is no
    /// `UsageRef` to name, but the reference extractor's `resolve_virtual_tables`
    /// (mod.rs) still resolves every declared VT eagerly and errors on a broken one
    /// regardless of use, so "compiles cleanly" must catch this too (`origin_vt` names
    /// the VT in that case).
    pub usage: Option<UsageRef>,
    /// Set together with `usage: None`: the declared virtual table id this diagnostic is
    /// about. `RejectReason` variants encountered here carry an id of their own
    /// (`UnknownVirtualTable`/`VirtualTableCycle`) or not (`UnsupportedJoinType` names
    /// only the join type), so this is carried alongside rather than reconstructed from
    /// the reason.
    pub origin_vt: Option<String>,
    pub reason: RejectReason,
}

impl std::fmt::Display for CompileError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.usage {
            Some(usage) => write!(f, "{}: {}", usage, self.reason),
            None => write!(
                f,
                "virtual_tables['{}']: {}",
                self.origin_vt.as_deref().unwrap_or("?"),
                self.reason
            ),
        }
    }
}

/// What a probe guards. A probe holds when its SQL returns zero rows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProbeKind {
    /// A substituted template value containing a brace makes `evaluate` return None.
    TemplateBraceInjection {
        column: String,
    },
    /// The extractor keeps the first entity to claim an id and drops later ones. The
    /// views deduplicate with DISTINCT, which agrees only when no id carries two
    /// different payloads.
    AmbiguousObjectIdentity,
    AmbiguousEventIdentity,
    /// With inline object references, a repeated event id drops the later row's
    /// relationships but still creates its objects.
    DuplicateEventIdWithInlineRefs,
    /// `prefixed_types` only gains a type once a row for it is processed, so a prefixed
    /// usage over an empty table emits unprefixed ids.
    PrefixedTypeEmptyTable {
        object_type: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Probe {
    pub usage: Option<UsageRef>,
    pub kind: ProbeKind,
    pub sql: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ViewDef {
    pub name: String,
    /// Bare `SELECT` body, no `CREATE VIEW` wrapper. Wrapped into a view by
    /// [`CompiledOcel::ddl`], or emitted view-free via `with_prelude`/`materialize_ddl`.
    pub body: String,
}

#[derive(Debug, Clone, Default)]
pub struct CompiledOcel {
    /// Which dialect's `statement_separator` terminates each view in `ddl` -- set once at
    /// construction in `compile_blueprint`, never mutated afterwards.
    dialect: SqlDialect,
    pub views: Vec<ViewDef>,
    pub probes: Vec<Probe>,
    pub errors: Vec<CompileError>,
}

impl CompiledOcel {
    /// All `CREATE VIEW` statements, in dependency order, each terminated by the dialect's
    /// statement separator.
    pub fn ddl(&self) -> String {
        self.views
            .iter()
            .map(|v| {
                format!(
                    "{}{}",
                    self.dialect.create_view(&v.name, &v.body),
                    self.dialect.statement_separator()
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// The DDL, only if every usage compiled. The caller must still execute `probes`
    /// against the data and check they return zero rows before treating the views as
    /// equivalent to the extractor.
    pub fn certified_ddl(&self) -> Result<String, &[CompileError]> {
        if self.errors.is_empty() {
            Ok(self.ddl())
        } else {
            Err(&self.errors)
        }
    }

    /// The bare relation bodies (`name` -> SELECT `body`), in dependency order. The
    /// view-free counterpart to [`Self::ddl`]: the caller wraps them however it likes
    /// (see [`Self::with_prelude`] / [`Self::materialize_ddl`]).
    pub fn relations(&self) -> &[ViewDef] {
        &self.views
    }

    /// A `WITH` prelude binding every OCEL relation as a CTE (dependency order),
    /// followed by `analysis_sql`. Lets an analysis query reference the relation names
    /// (`event`, `object`, `event_object`, ...) without creating any views -- no DDL
    /// required, so it runs against a read-only database. Unused CTEs are ignored by the
    /// engine, so passing every relation is harmless.
    pub fn with_prelude(&self, analysis_sql: &str) -> String {
        if self.views.is_empty() {
            return analysis_sql.to_string();
        }
        let ctes: Vec<String> = self
            .views
            .iter()
            .map(|v| format!("{} AS (\n{}\n)", self.dialect.quote_ident(&v.name), v.body))
            .collect();
        format!("WITH {}\n{}", ctes.join(",\n"), analysis_sql)
    }

    /// `CREATE TABLE <name> AS <body>` for every relation, in dependency order -- a
    /// one-time materialization alternative to views for callers that DO have write
    /// rights (a multiply-referenced relation is then computed once instead of inlined
    /// repeatedly). Each statement is terminated by the dialect separator.
    pub fn materialize_ddl(&self) -> String {
        self.views
            .iter()
            .map(|v| {
                format!(
                    "CREATE TABLE {} AS\n{}{}",
                    self.dialect.quote_ident(&v.name),
                    v.body,
                    self.dialect.statement_separator()
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// Each probe rewritten to run with no views present: the same 0-row check with the
    /// relation CTEs ([`Self::with_prelude`]) prepended so the probe's relation
    /// references resolve. Pairs with the view-free emission paths; a probe that only
    /// touches raw tables simply ignores the unused CTEs.
    pub fn probe_statements(&self) -> Vec<String> {
        self.probes
            .iter()
            .map(|p| self.with_prelude(&p.sql))
            .collect()
    }
}

/// How a column's value renders through `IndexedRow::get_string`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rendering {
    /// Rust `Display` and a SQL cast to text agree.
    Stable,
    /// They disagree (`Float` drops the `.0`, `Timestamp` keeps an offset, `Json`
    /// reformats), so the column cannot feed a string position.
    Unstable,
}

/// Rendering is a pure function of the declared type; shared by `column_facts` (real
/// columns), `union_schema` (a synthesised "Unknown" on type disagreement), and mod.rs's
/// extractor-side join-key type check (`pub(crate)` so it stays the single source of
/// truth for the stable-rendering set on both sides, rather than a second copy drifting).
pub(crate) fn rendering_of(col_type: &str) -> Rendering {
    match col_type {
        "Text" | "Integer" | "Boolean" => Rendering::Stable,
        _ => Rendering::Unstable,
    }
}

#[derive(Debug, Clone)]
pub struct ColumnFacts {
    pub rendering: Rendering,
    pub col_type: String,
    pub nullable: bool,
    /// The column's declared type is a native timestamp, so `get_timestamp` short-circuits
    /// `TimestampSource::parse` before any string parsing happens.
    pub native_timestamp: bool,
}

fn column_facts(info: &DataSourceTableInfo, column: &str) -> Option<ColumnFacts> {
    let col = info.columns.get(column)?;
    Some(ColumnFacts {
        rendering: rendering_of(&col.col_type),
        col_type: col.col_type.clone(),
        nullable: col.is_nullable,
        native_timestamp: col.col_type == "Timestamp",
    })
}

/// A virtual table's output schema, computed without touching data by mirroring the
/// column-composition rules of `apply_transform` (mod.rs).
#[derive(Debug, Clone)]
pub struct VtSchema {
    pub columns: Vec<String>,
    pub facts: BTreeMap<String, ColumnFacts>,
}

/// Resolve every virtual table's output schema. Recurses over `TransformSource::VirtualTable`
/// with a visited/in-progress set so a self-referential transform graph is rejected
/// (`VirtualTableCycle`) instead of looping forever.
/// Takes `tables`/`virtual_tables` as separate slices rather than a whole
/// `DataExtractionBlueprint` -- schema resolution never reads `bp.sources`, and mod.rs's
/// `resolve_virtual_tables` (the extractor's own VT resolver) already has exactly these
/// two slices on hand (`downstream_tables`/`virtual_tables`) without needing a
/// `DataExtractionBlueprint` to exist, so it can call this directly to get declared
/// column types for join-key type-checking (see `RejectReason::JoinKeyTypeMismatch`'s
/// extractor-side mirror).
pub fn resolve_vt_schemas(
    tables: &[TableExtractionConfig],
    virtual_tables: &[VirtualTableConfig],
) -> Result<BTreeMap<String, VtSchema>, RejectReason> {
    let mut resolved: BTreeMap<String, VtSchema> = BTreeMap::new();
    for vt in virtual_tables {
        if !resolved.contains_key(&vt.id) {
            // `resolve_vt_schema` caches its own result; a fresh in-progress set per
            // top-level entry keeps cycle detection scoped to one DFS path.
            let mut in_progress: BTreeSet<String> = BTreeSet::new();
            resolve_vt_schema(tables, virtual_tables, &vt.id, &mut resolved, &mut in_progress)?;
        }
    }
    Ok(resolved)
}

/// `pub(crate)` (not just `pub fn resolve_vt_schemas`'s private helper) so mod.rs can
/// resolve one specific VT id on demand, memoized in a cache it owns across a whole
/// extraction run -- one broken, unrelated VT elsewhere in the blueprint then only fails
/// resolution for *its own* dependents, not every VT's declared-type lookup (unlike
/// calling the eager, all-or-nothing `resolve_vt_schemas` and discarding the whole map on
/// any single failure).
pub(crate) fn resolve_vt_schema(
    tables: &[TableExtractionConfig],
    virtual_tables: &[VirtualTableConfig],
    id: &str,
    resolved: &mut BTreeMap<String, VtSchema>,
    in_progress: &mut BTreeSet<String>,
) -> Result<VtSchema, RejectReason> {
    if let Some(existing) = resolved.get(id) {
        return Ok(existing.clone());
    }
    if !in_progress.insert(id.to_string()) {
        return Err(RejectReason::VirtualTableCycle { id: id.to_string() });
    }
    let vt = virtual_tables
        .iter()
        .find(|v| v.id == id)
        .ok_or_else(|| RejectReason::UnknownVirtualTable { id: id.to_string() })?;
    let schema = resolve_operation(tables, virtual_tables, &vt.operation, resolved, in_progress)?;
    in_progress.remove(id);
    resolved.insert(id.to_string(), schema.clone());
    Ok(schema)
}

fn resolve_operation(
    tables: &[TableExtractionConfig],
    virtual_tables: &[VirtualTableConfig],
    operation: &TransformOperation,
    resolved: &mut BTreeMap<String, VtSchema>,
    in_progress: &mut BTreeSet<String>,
) -> Result<VtSchema, RejectReason> {
    match operation {
        // Filter: schema unchanged (mod.rs).
        TransformOperation::Filter { source, .. } => {
            resolve_source(tables, virtual_tables, source, resolved, in_progress)
        }
        TransformOperation::Join {
            left,
            right,
            join_type,
            on,
        } => {
            // The extractor itself errors on non-Inner before touching either side
            // (mod.rs); mirror that check before recursing.
            if !matches!(join_type, JoinType::Inner) {
                return Err(RejectReason::UnsupportedJoinType {
                    join_type: format!("{:?}", join_type),
                });
            }
            let left_schema = resolve_source(tables, virtual_tables, left, resolved, in_progress)?;
            let right_schema =
                resolve_source(tables, virtual_tables, right, resolved, in_progress)?;
            Ok(join_schema(&left_schema, &right_schema, on))
        }
        TransformOperation::Union { sources } => {
            if sources.is_empty() {
                return Ok(VtSchema {
                    columns: Vec::new(),
                    facts: BTreeMap::new(),
                });
            }
            let schemas = sources
                .iter()
                .map(|s| resolve_source(tables, virtual_tables, s, resolved, in_progress))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(union_schema(&schemas))
        }
    }
}

fn resolve_source(
    tables: &[TableExtractionConfig],
    virtual_tables: &[VirtualTableConfig],
    source: &TransformSource,
    resolved: &mut BTreeMap<String, VtSchema>,
    in_progress: &mut BTreeSet<String>,
) -> Result<VtSchema, RejectReason> {
    match source {
        TransformSource::Table {
            source_id,
            table_name,
        } => {
            let table = tables
                .iter()
                .find(|t| &t.source_id == source_id && &t.table_name == table_name)
                .ok_or_else(|| RejectReason::UnknownVirtualTable {
                    id: table_name.clone(),
                })?;
            Ok(table_schema(&table.table_info))
        }
        TransformSource::VirtualTable { virtual_table_id } => {
            resolve_vt_schema(tables, virtual_tables, virtual_table_id, resolved, in_progress)
        }
    }
}

/// A base table's schema, sorted for determinism -- the extractor reads column order off
/// a `HashMap` (mod.rs `fetch_source_rows`), which makes no ordering guarantee to mirror.
fn table_schema(info: &DataSourceTableInfo) -> VtSchema {
    let mut columns: Vec<String> = info.columns.keys().cloned().collect();
    columns.sort();
    let facts = columns
        .iter()
        .filter_map(|c| column_facts(info, c).map(|f| (c.clone(), f)))
        .collect();
    VtSchema { columns, facts }
}

/// Mirrors mod.rs (fixed): out = left columns ++ right columns, dropping a right join key
/// only when its name collides with a left column (SQL JOIN...ON semantics -- a
/// differently-named key survives under its own name); a colliding non-key right column
/// becomes `right_<name>`.
fn join_schema(left: &VtSchema, right: &VtSchema, on: &[(String, String)]) -> VtSchema {
    let right_keys: BTreeSet<&str> = on.iter().map(|(_, r)| r.as_str()).collect();
    let left_names: BTreeSet<&str> = left.columns.iter().map(|s| s.as_str()).collect();

    let mut columns = left.columns.clone();
    let mut facts = left.facts.clone();
    for rc in &right.columns {
        let out_name = if left_names.contains(rc.as_str()) {
            if right_keys.contains(rc.as_str()) {
                continue;
            }
            format!("right_{}", rc)
        } else {
            rc.clone()
        };
        if let Some(f) = right.facts.get(rc) {
            facts.insert(out_name.clone(), f.clone());
        }
        columns.push(out_name);
    }
    VtSchema { columns, facts }
}

/// Mirrors mod.rs: base = first source's columns; other sources pad a missing column
/// with NULL (hence nullable), and a type disagreement across contributing sources
/// collapses to "Unknown" rather than picking a side.
fn union_schema(schemas: &[VtSchema]) -> VtSchema {
    let columns = schemas[0].columns.clone();
    let mut facts = BTreeMap::new();
    for col in &columns {
        let mut agreed_type: Option<&str> = None;
        let mut type_conflict = false;
        let mut nullable = false;
        for schema in schemas {
            match schema.facts.get(col) {
                Some(f) => {
                    if f.nullable {
                        nullable = true;
                    }
                    match agreed_type {
                        None => agreed_type = Some(f.col_type.as_str()),
                        Some(t) if t == f.col_type => {}
                        Some(_) => type_conflict = true,
                    }
                }
                // Column absent from this source: `apply_transform` pads NULL for it.
                None => nullable = true,
            }
        }
        let col_type = if type_conflict {
            "Unknown".to_string()
        } else {
            agreed_type.unwrap_or("Unknown").to_string()
        };
        facts.insert(
            col.clone(),
            ColumnFacts {
                rendering: rendering_of(&col_type),
                native_timestamp: col_type == "Timestamp",
                col_type,
                nullable,
            },
        );
    }
    VtSchema { columns, facts }
}

/// Every declared virtual table id that fails to topologically order against the others,
/// i.e. is itself part of a `TransformSource::VirtualTable` cycle or transitively depends
/// on one. Mirrors mod.rs's `topological_sort_virtual_tables` (Kahn's algorithm, same
/// dependency edges -- a real `TransformSource::Table` is always a leaf, never a
/// dependency), but returns the offending ids instead of a single opaque error string:
/// mod.rs collapses any topological-sort failure into one "Circular dependency detected"
/// error for the whole graph, and `compile_blueprint`'s unreferenced-VT pass needs the
/// same one-error-per-graph-failure granularity (not one error per cycle member) plus the
/// member ids, to both name a representative and skip re-resolving the rest individually.
fn cyclic_vt_ids(bp: &DataExtractionBlueprint) -> BTreeSet<String> {
    fn source_dep(source: &TransformSource) -> Option<&str> {
        match source {
            TransformSource::Table { .. } => None,
            TransformSource::VirtualTable { virtual_table_id } => Some(virtual_table_id.as_str()),
        }
    }
    fn op_deps(op: &TransformOperation) -> Vec<&str> {
        match op {
            TransformOperation::Filter { source, .. } => source_dep(source).into_iter().collect(),
            TransformOperation::Join { left, right, .. } => source_dep(left)
                .into_iter()
                .chain(source_dep(right))
                .collect(),
            TransformOperation::Union { sources } => {
                sources.iter().filter_map(source_dep).collect()
            }
        }
    }

    let n = bp.virtual_tables.len();
    let id_to_idx: BTreeMap<&str, usize> = bp
        .virtual_tables
        .iter()
        .enumerate()
        .map(|(i, vt)| (vt.id.as_str(), i))
        .collect();
    let mut in_degree = vec![0usize; n];
    let mut adj: Vec<Vec<usize>> = vec![Vec::new(); n];
    for (i, vt) in bp.virtual_tables.iter().enumerate() {
        for dep in op_deps(&vt.operation) {
            if let Some(&dep_idx) = id_to_idx.get(dep) {
                adj[dep_idx].push(i);
                in_degree[i] += 1;
            }
        }
    }

    let mut queue: Vec<usize> = (0..n).filter(|&i| in_degree[i] == 0).collect();
    let mut ordered = vec![false; n];
    for &i in &queue {
        ordered[i] = true;
    }
    while let Some(idx) = queue.pop() {
        for &next in &adj[idx] {
            in_degree[next] -= 1;
            if in_degree[next] == 0 && !ordered[next] {
                ordered[next] = true;
                queue.push(next);
            }
        }
    }

    bp.virtual_tables
        .iter()
        .enumerate()
        .filter(|(i, _)| !ordered[*i])
        .map(|(_, vt)| vt.id.clone())
        .collect()
}

/// SQL for a virtual table's rows, recursively. `schemas` must already hold a resolved
/// entry for `vt_id` and everything it (transitively) depends on -- callers get this by
/// running `resolve_vt_schema` first, which is what populates `schemas` in the first
/// place. `Filter`, `Inner` `Join`, and `Union` are all compiled; a non-Inner join type is
/// already rejected by `resolve_operation` before a schema exists to call this with, so it
/// can't reach here.
fn vt_select(
    vt_id: &str,
    bp: &DataExtractionBlueprint,
    schemas: &BTreeMap<String, VtSchema>,
    dialect: SqlDialect,
) -> Result<String, RejectReason> {
    let vt = bp
        .virtual_tables
        .iter()
        .find(|v| v.id == vt_id)
        .ok_or_else(|| RejectReason::UnknownVirtualTable {
            id: vt_id.to_string(),
        })?;
    match &vt.operation {
        TransformOperation::Filter { source, condition } => {
            let (from, source_schema) = source_from(bp, source, schemas, dialect)?;
            let vt_schema =
                schemas
                    .get(vt_id)
                    .ok_or_else(|| RejectReason::UnknownVirtualTable {
                        id: vt_id.to_string(),
                    })?;
            let mut ctx = UsageCtx {
                dialect,
                usage: UsageRef {
                    table_index: 0,
                    table_name: vt_id.to_string(),
                    mode: "virtual-table-filter",
                },
                info: source_schema,
                alias: "t".to_string(),
                probes: Vec::new(),
            };
            let cond_sql = compile_condition(&mut ctx, condition)?;
            let cols = vt_schema
                .columns
                .iter()
                .map(|c| format!("t.{}", dialect.quote_ident(c)))
                .collect::<Vec<_>>()
                .join(", ");
            Ok(format!(
                "SELECT {} FROM {} AS t WHERE {}",
                cols, from, cond_sql
            ))
        }
        TransformOperation::Join {
            left,
            right,
            join_type,
            on,
        } => {
            // Already excluded at schema-resolution time (`resolve_operation`), which
            // runs before `schemas` holds an entry for `vt_id` -- this can't actually
            // fire, but stays as a direct mirror of that check rather than an assert.
            if !matches!(join_type, JoinType::Inner) {
                return Err(RejectReason::UnsupportedJoinType {
                    join_type: format!("{:?}", join_type),
                });
            }
            let (left_from, left_schema) = source_from(bp, left, schemas, dialect)?;
            let (right_from, right_schema) = source_from(bp, right, schemas, dialect)?;

            let right_keys: BTreeSet<&str> = on.iter().map(|(_, r)| r.as_str()).collect();
            let mut on_conds = Vec::with_capacity(on.len());
            for (l, r) in on {
                let lf = join_key_facts(&left_schema, l)?;
                let rf = join_key_facts(&right_schema, r)?;
                if lf.col_type != rf.col_type {
                    return Err(RejectReason::JoinKeyTypeMismatch {
                        left: l.clone(),
                        right: r.clone(),
                    });
                }
                on_conds.push(format!(
                    "l.{} = r.{}",
                    dialect.quote_ident(l),
                    dialect.quote_ident(r)
                ));
            }

            // Reproduce `join_schema`'s column composition exactly: left columns as-is,
            // then right columns, dropping a right join key only on name collision with a
            // left column and renaming any other colliding right column `right_<name>`.
            let left_names: BTreeSet<String> = left_schema.columns().into_iter().collect();
            let mut select_cols: Vec<String> = left_schema
                .columns()
                .into_iter()
                .map(|c| format!("l.{0} AS {0}", dialect.quote_ident(&c)))
                .collect();
            for rc in right_schema.columns() {
                if left_names.contains(&rc) {
                    if right_keys.contains(rc.as_str()) {
                        continue;
                    }
                    select_cols.push(format!(
                        "r.{} AS {}",
                        dialect.quote_ident(&rc),
                        dialect.quote_ident(&format!("right_{}", rc))
                    ));
                } else {
                    select_cols.push(format!("r.{0} AS {0}", dialect.quote_ident(&rc)));
                }
            }

            Ok(format!(
                "SELECT {} FROM {} AS l INNER JOIN {} AS r ON {}",
                select_cols.join(", "),
                left_from,
                right_from,
                on_conds.join(" AND ")
            ))
        }
        TransformOperation::Union { sources } => {
            if sources.is_empty() {
                // mod.rs (line 469-471) returns (vec![], vec![]) for zero sources: a
                // relation with no columns and no rows. A placeholder `Ok` here (e.g. a
                // `WHERE FALSE` scalar select) would let a usage that references *no*
                // real column (fully constant id/type) sail through the column-facts
                // check untouched and reach `SELECT {} FROM ...` with an empty
                // projection list -- invalid SQL, certified as a clean compile with zero
                // `CompileError`s. Reject here instead: SQL has no zero-column SELECT,
                // and there is nothing meaningful to derive one from either way.
                return Err(RejectReason::EmptyUnion {
                    virtual_table_id: vt_id.to_string(),
                });
            }
            let vt_schema =
                schemas
                    .get(vt_id)
                    .ok_or_else(|| RejectReason::UnknownVirtualTable {
                        id: vt_id.to_string(),
                    })?;
            // Per-branch projection of the base (first source's) column list --
            // mirrors `union_schema`'s composition exactly. A branch missing a column
            // pads NULL for it; present columns are read from that branch's own "t".
            let mut branches = Vec::with_capacity(sources.len());
            for source in sources {
                let (from, source_schema) = source_from(bp, source, schemas, dialect)?;
                let cols = vt_schema
                    .columns
                    .iter()
                    .map(|c| {
                        let quoted = dialect.quote_ident(c);
                        if source_schema.facts(c).is_some() {
                            format!("t.{0} AS {0}", quoted)
                        } else {
                            format!("NULL AS {}", quoted)
                        }
                    })
                    .collect::<Vec<_>>()
                    .join(", ");
                branches.push(format!("SELECT {} FROM {} AS t", cols, from));
            }
            Ok(dialect.union_all(&branches))
        }
    }
}

/// A join key column's facts, validated the same way an identity position is (`join_key`,
/// mod.rs, is `get_id_string`-keyed): must exist, and must have a stable
/// (Text/Integer/Boolean) rendering, same ENGINEERING rationale as
/// `UnstableIdentityRendering`'s other identity-position uses.
fn join_key_facts(schema: &ColumnSchema, column: &str) -> Result<ColumnFacts, RejectReason> {
    let facts = schema
        .facts(column)
        .ok_or_else(|| RejectReason::UnknownColumn {
            column: column.to_string(),
            field: "join key",
        })?;
    if facts.rendering == Rendering::Unstable {
        return Err(RejectReason::UnstableIdentityRendering {
            column: column.to_string(),
            col_type: facts.col_type,
            field: "join key",
        });
    }
    Ok(facts)
}

/// The FROM-target fragment (no alias -- callers append `AS t`) and column schema for a
/// `TransformSource`, mirroring `resolve_source`'s table lookup for the real-table arm.
fn source_from<'a>(
    bp: &'a DataExtractionBlueprint,
    source: &TransformSource,
    schemas: &'a BTreeMap<String, VtSchema>,
    dialect: SqlDialect,
) -> Result<(String, ColumnSchema<'a>), RejectReason> {
    match source {
        TransformSource::Table {
            source_id,
            table_name,
        } => {
            let table = bp
                .tables
                .iter()
                .find(|t| &t.source_id == source_id && &t.table_name == table_name)
                .ok_or_else(|| RejectReason::UnknownVirtualTable {
                    id: table_name.clone(),
                })?;
            Ok((
                dialect.quote_ident(table_name),
                ColumnSchema::Table(&table.table_info),
            ))
        }
        TransformSource::VirtualTable { virtual_table_id } => {
            let inner_sql = vt_select(virtual_table_id, bp, schemas, dialect)?;
            let schema =
                schemas
                    .get(virtual_table_id)
                    .ok_or_else(|| RejectReason::UnknownVirtualTable {
                        id: virtual_table_id.clone(),
                    })?;
            Ok((
                format!("(\n{}\n)", inner_sql),
                ColumnSchema::Virtual(schema),
            ))
        }
    }
}

/// A usage's column schema: either a real source table, or a resolved virtual table.
/// Unifies column lookups so `UsageCtx` can compile a usage over either without the
/// Filter/Join/Union recursion in `vt_select` needing a `DataSourceTableInfo` to exist.
enum ColumnSchema<'a> {
    Table(&'a DataSourceTableInfo),
    Virtual(&'a VtSchema),
}

impl ColumnSchema<'_> {
    fn facts(&self, column: &str) -> Option<ColumnFacts> {
        match self {
            ColumnSchema::Table(info) => column_facts(info, column),
            ColumnSchema::Virtual(schema) => schema.facts.get(column).cloned(),
        }
    }

    /// Column names in the schema's canonical order: sorted for a real table (mirrors
    /// `table_schema`, since a `HashMap` makes no ordering guarantee), or the already
    /// resolved order for a virtual table.
    fn columns(&self) -> Vec<String> {
        match self {
            ColumnSchema::Table(info) => {
                let mut cols: Vec<String> = info.columns.keys().cloned().collect();
                cols.sort();
                cols
            }
            ColumnSchema::Virtual(schema) => schema.columns.clone(),
        }
    }
}

/// Per-usage compilation scratch space.
struct UsageCtx<'a> {
    dialect: SqlDialect,
    usage: UsageRef,
    info: ColumnSchema<'a>,
    alias: String,
    probes: Vec<Probe>,
}

/// Which position a `ValueExpression` fills, mirroring the two rendering rules the
/// extractor now uses: `get_id_string` for identity positions (ids, endpoint ids,
/// template placeholders), still `unwrap_or_default()` after `get_id_string` for
/// qualifiers. `ChangeTableCondition` is neither -- it stays on `column_as_condition_text`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Position {
    /// A None evaluation drops the row: no COALESCE fallback here, callers add
    /// `col IS NOT NULL` filters instead (`identity_null_filters`).
    Identity,
    /// A None evaluation becomes `""`: `COALESCE(..., '')`.
    Qualifier,
}

/// Which of the extractor's two column-to-string rules a text position mirrors -- the two
/// disagree on *why* an unstable-rendering type (Float/Timestamp/Json/Unknown) can't be
/// rendered, so an unstable column at each needs a differently-marked `RejectReason`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TextRendering {
    /// `get_id_string`: identity positions (ids, endpoint ids, template placeholders),
    /// qualifiers, and join keys. Returns `None` unconditionally for an unstable type, so
    /// the position always folds to one fixed, already-known result -- ENGINEERING
    /// (`RejectReason::UnstableIdentityRendering`), same rationale as `UnknownColumn`.
    IdString,
    /// `get_string` (`ChangeTableCondition` only): Rust `Display`, which renders every
    /// type but disagrees with a plain SQL cast for this one -- DIALECT
    /// (`RejectReason::UnstableConditionRendering`), since a per-dialect emitter that
    /// special-cased these formats could close the gap.
    Display,
}

impl<'a> UsageCtx<'a> {
    /// Validate a column exists and has a stable rendering (Text/Integer/Boolean).
    /// Float/Timestamp/Json/Unknown have no canonical identity rendering at all (rounding,
    /// offset formatting, key order are not dialect-stable), so they are rejected
    /// regardless of position; `rendering` picks which of the two rules -- and thus which
    /// `RejectReason` marker -- the caller's position mirrors.
    fn column_facts_checked(
        &self,
        column: &str,
        field: &'static str,
        rendering: TextRendering,
    ) -> Result<ColumnFacts, RejectReason> {
        let facts = self
            .info
            .facts(column)
            .ok_or_else(|| RejectReason::UnknownColumn {
                column: column.to_string(),
                field,
            })?;
        if facts.rendering == Rendering::Unstable {
            return Err(match rendering {
                TextRendering::IdString => RejectReason::UnstableIdentityRendering {
                    column: column.to_string(),
                    col_type: facts.col_type,
                    field,
                },
                TextRendering::Display => RejectReason::UnstableConditionRendering {
                    column: column.to_string(),
                    col_type: facts.col_type,
                    field,
                },
            });
        }
        Ok(facts)
    }

    /// A plain `CAST(col AS VARCHAR)`. NULL propagates through a SQL cast regardless of
    /// the source type, and DuckDB casts booleans to the same lowercase `true`/`false`
    /// Rust `Display` produces, so this fragment alone is NULL-safe and stable for every
    /// `Rendering::Stable` type.
    fn column_cast_fragment(
        &self,
        column: &str,
        field: &'static str,
        rendering: TextRendering,
    ) -> Result<String, RejectReason> {
        self.column_facts_checked(column, field, rendering)?;
        let qualified = format!("{}.{}", self.alias, self.dialect.quote_ident(column));
        Ok(self.dialect.cast_to_text(&qualified))
    }

    /// SQL for a column at an identity position: `get_id_string`'s rendering, with no
    /// NULL fallback. Booleans get an explicit `CASE` rather than relying on the
    /// dialect's own boolean-to-text cast, matching the extractor's canonical rendering
    /// literally. The caller must add `col IS NOT NULL` to the usage's filters
    /// (`identity_null_filters`) for every column an identity expression references, so a
    /// NULL input's value here is never observed downstream.
    fn column_as_identity_text(
        &self,
        column: &str,
        field: &'static str,
    ) -> Result<String, RejectReason> {
        let facts = self.column_facts_checked(column, field, TextRendering::IdString)?;
        let qualified = format!("{}.{}", self.alias, self.dialect.quote_ident(column));
        Ok(if facts.col_type == "Boolean" {
            self.dialect.bool_to_text(&qualified)
        } else {
            self.dialect.cast_to_text(&qualified)
        })
    }

    /// SQL for a column at a qualifier position: `get_id_string`'s rendering, defaulted
    /// to `''` -- mirrors `evaluate` -> None -> `unwrap_or_default()`.
    fn column_as_qualifier_text(
        &self,
        column: &str,
        field: &'static str,
    ) -> Result<String, RejectReason> {
        let cast = self.column_cast_fragment(column, field, TextRendering::IdString)?;
        Ok(self.dialect.coalesce(&cast, &self.dialect.string_literal("")))
    }

    /// SQL for a column read through `PreparedCondition`'s `get_string`: `Display` of the
    /// value, with NULL rendering as the literal "NULL". `ChangeTableCondition` evaluation
    /// is unchanged by this task, so this mirror is frozen as it was before.
    fn column_as_condition_text(
        &self,
        column: &str,
        field: &'static str,
    ) -> Result<String, RejectReason> {
        let cast = self.column_cast_fragment(column, field, TextRendering::Display)?;
        Ok(self.dialect.coalesce(&cast, &self.dialect.string_literal("NULL")))
    }

    /// Every column an identity expression (ids, endpoint ids, template placeholders)
    /// references must be non-null, or `get_id_string` would drop the row while the view
    /// still emitted it. Assumes `expr` was already validated (existing columns, stable
    /// rendering) by a prior `value_expr(.., Position::Identity)` call.
    fn identity_null_filters(&self, expr: &ValueExpression) -> Vec<String> {
        let mut cols = HashSet::new();
        expr.referenced_columns(&mut cols);
        cols.into_iter()
            .filter(|c| self.info.facts(c).map(|f| f.nullable).unwrap_or(false))
            .map(|c| format!("{}.{} IS NOT NULL", self.alias, self.dialect.quote_ident(c)))
            .collect()
    }

    fn value_expr(
        &mut self,
        expr: &ValueExpression,
        field: &'static str,
        from: &str,
        position: Position,
    ) -> Result<String, RejectReason> {
        match expr {
            ValueExpression::Constant { value } => Ok(self.dialect.string_literal(value)),
            ValueExpression::Column { column } => {
                if column.is_empty() {
                    // Never indexed, so `evaluate` is always None and the row is dropped.
                    return Err(RejectReason::UnknownColumn {
                        column: String::new(),
                        field,
                    });
                }
                match position {
                    Position::Identity => self.column_as_identity_text(column, field),
                    Position::Qualifier => self.column_as_qualifier_text(column, field),
                }
            }
            ValueExpression::Template { template } => {
                self.template_expr(template, field, from, position)
            }
        }
    }

    /// `ValueExpression::Template` substitutes every `{col}` it can resolve, then returns
    /// None if the result still contains both a `{` and a `}`. With every placeholder
    /// resolvable and no stray braces in the literal parts, that check can only fire on a
    /// substituted value, which is a data property -> probe.
    ///
    /// At a qualifier position, every placeholder is rendered through the NULL-safe
    /// `column_cast_fragment` and the whole concatenation is wrapped in one outer
    /// `COALESCE(.., '')`: SQL's `||` propagates NULL, so a NULL placeholder collapses the
    /// entire result to NULL before the outer COALESCE defaults it to `''` -- mirroring
    /// `evaluate`'s "any None placeholder makes the whole template None" exactly, with no
    /// per-placeholder fallback. At an identity position no such wrapping happens; the
    /// caller adds `col IS NOT NULL` filters for every placeholder instead.
    fn template_expr(
        &mut self,
        template: &str,
        field: &'static str,
        from: &str,
        position: Position,
    ) -> Result<String, RejectReason> {
        let mut parts: Vec<String> = Vec::new();
        let mut literal = String::new();
        let mut rest = template;
        let mut placeholders: Vec<String> = Vec::new();

        while let Some(open) = rest.find('{') {
            let after = &rest[open + 1..];
            let Some(close) = after.find('}') else {
                break;
            };
            let name = &after[..close];
            if name.is_empty() || self.info.facts(name).is_none() {
                return Err(RejectReason::UnresolvableTemplatePlaceholder {
                    placeholder: name.to_string(),
                });
            }
            literal.push_str(&rest[..open]);
            if !literal.is_empty() {
                parts.push(self.dialect.string_literal(&literal));
                literal.clear();
            }
            parts.push(match position {
                Position::Identity => self.column_as_identity_text(name, field)?,
                Position::Qualifier => {
                    self.column_cast_fragment(name, field, TextRendering::IdString)?
                }
            });
            placeholders.push(name.to_string());
            rest = &after[close + 1..];
        }
        literal.push_str(rest);
        if literal.contains('{') || literal.contains('}') {
            return Err(RejectReason::UnresolvableTemplatePlaceholder {
                placeholder: literal,
            });
        }
        if !literal.is_empty() {
            parts.push(self.dialect.string_literal(&literal));
        }
        if parts.is_empty() {
            return Ok(self.dialect.string_literal(""));
        }

        for name in placeholders {
            let col = format!("{}.{}", self.alias, self.dialect.quote_ident(&name));
            self.probes.push(Probe {
                usage: Some(self.usage.clone()),
                kind: ProbeKind::TemplateBraceInjection {
                    column: name.clone(),
                },
                sql: format!(
                    "SELECT 1 FROM {} AS {} WHERE {} LIKE '%{{%' OR {} LIKE '%}}%' LIMIT 1",
                    from, self.alias, col, col
                ),
            });
        }

        let concatenated = self.dialect.concat(&parts);
        Ok(match position {
            Position::Identity => concatenated,
            Position::Qualifier => self
                .dialect
                .coalesce(&concatenated, &self.dialect.string_literal("")),
        })
    }

    /// `TimestampSource::parse` semantics, as SQL.
    fn timestamp_expr(&mut self, ts: &TimestampSource) -> Result<TimeSql, RejectReason> {
        match ts {
            // Both arguments come from the blueprint, so this folds at compile time for
            // any format, Auto included.
            TimestampSource::Constant { .. } => {
                let index = build_column_index(&[]);
                let row = IndexedRow {
                    values: &[],
                    index: &index,
                };
                match ts.parse(&row) {
                    Some(folded) => Ok(TimeSql::Literal(self.dialect.timestamp_literal(&folded))),
                    // parse() failing means every row is dropped.
                    None => Ok(TimeSql::Never),
                }
            }
            TimestampSource::Column { column, format } => {
                let facts = self
                    .info
                    .facts(column)
                    .ok_or_else(|| RejectReason::UnknownColumn {
                        column: column.to_string(),
                        field: "timestamp",
                    })?;
                if facts.native_timestamp {
                    // `get_timestamp` returns early, so `format` is dead and no parsing runs.
                    return Ok(TimeSql::Column(format!(
                        "{}.{}",
                        self.alias,
                        self.dialect.quote_ident(column)
                    )));
                }
                Err(RejectReason::ResidualTimestamp {
                    detail: format!(
                        "column '{}' is declared {} rather than a native timestamp, so the value \
                         goes through chrono's {:?} string parsing",
                        column, facts.col_type, format
                    ),
                })
            }
            TimestampSource::Components { .. } => Err(RejectReason::ResidualTimestamp {
                detail: "Components tries three chrono strategies in order".to_string(),
            }),
        }
    }
}

/// A compiled timestamp, carrying whether the extractor can still drop the row.
enum TimeSql {
    /// A folded constant: present on every row.
    Literal(String),
    /// A native timestamp column: NULL parses to None, dropping the row.
    Column(String),
    /// A constant that failed to parse, so no row survives.
    Never,
}

impl TimeSql {
    fn sql(&self, dialect: SqlDialect) -> String {
        match self {
            TimeSql::Literal(s) | TimeSql::Column(s) => s.clone(),
            TimeSql::Never => dialect.null_timestamp_literal(),
        }
    }

    fn filter(&self, dialect: SqlDialect) -> Option<String> {
        match self {
            TimeSql::Literal(_) => None,
            TimeSql::Column(s) => Some(format!("{} IS NOT NULL", s)),
            TimeSql::Never => Some(dialect.false_predicate().to_string()),
        }
    }
}

/// The complete Unicode `White_Space` set (25 codepoints), matching exactly what Rust's
/// `char::is_whitespace` (and so `str::trim`) strips. Verified empirically against DuckDB
/// v1.4.2's two-argument `trim(x, chars)`: this literal makes it byte-identical to Rust's
/// `.trim()`, including mixed leading/trailing whitespace, while correctly leaving
/// non-whitespace lookalikes (e.g. U+200B ZERO WIDTH SPACE) untouched.
const UNICODE_WHITE_SPACE: &str =
    "\u{0009}\u{000A}\u{000B}\u{000C}\u{000D}\u{0020}\u{0085}\u{00A0}\
     \u{1680}\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\
     \u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}";

/// Mirrors the guard in `MultiValueConfig::split`: a regex pattern only takes over the
/// delimiter branch when non-empty.
fn multi_value_regex(cfg: Option<&MultiValueConfig>) -> bool {
    cfg.map(|c| c.enabled && c.regex_pattern.as_deref().is_some_and(|p| !p.is_empty()))
        .unwrap_or(false)
}

/// SQL for one multi-value endpoint, mirroring `MultiValueConfig::split`'s delimiter
/// branch (trim each part, drop empty parts) plus `split_value`'s whole-raw-empty check.
/// Returns the `FROM` source to use downstream and the SQL expression for one split part;
/// when `cfg` is disabled, absent, or has an empty delimiter, `split` returns the raw
/// value unmodified, so both are passed through unchanged.
///
/// Callers must reject a regex-configured `cfg` first (`multi_value_regex`) -- this only
/// mirrors the delimiter branch.
fn wrap_multi_value(
    dialect: SqlDialect,
    from: &str,
    raw_expr: &str,
    cfg: Option<&MultiValueConfig>,
    mv_col: &str,
) -> (String, String) {
    let Some(cfg) = cfg.filter(|c| c.enabled) else {
        return (from.to_string(), raw_expr.to_string());
    };
    if cfg.delimiter.is_empty() {
        return (from.to_string(), raw_expr.to_string());
    }
    let mv_ident = dialect.quote_ident(mv_col);
    let delim_literal = dialect.string_literal(&cfg.delimiter);
    // Every dialect wired up so far can express split-to-rows (this task adds no new
    // dialect); a `None` here is Task 2/3's problem, propagating a proper reject.
    let split_expr = dialect
        .split_to_rows(raw_expr, &delim_literal, &mv_ident)
        .expect("current dialect always supports split-to-rows");
    let new_from = format!(
        "(SELECT t.*, {split} FROM {from} AS t WHERE {raw} IS NOT NULL AND {raw} <> '')",
        split = split_expr,
        from = from,
        raw = raw_expr,
    );
    let part_expr = if cfg.trim_values {
        // DuckDB's single-argument `trim` only strips ASCII space; Rust's `str::trim`
        // strips the full Unicode `White_Space` set. `unicode_trim` covers that entire
        // set (`UNICODE_WHITE_SPACE`), so this is byte-identical to Rust's `.trim()`, not
        // an ASCII-only approximation.
        dialect.unicode_trim(&format!("t.{}", mv_ident))
    } else {
        format!("t.{}", mv_ident)
    };
    (new_from, part_expr)
}

/// A compiled event row: one source table projected to the event surface.
struct EventRows {
    usage: UsageRef,
    type_sql: String,
    id_sql: String,
    time_sql: String,
    from: String,
    alias: String,
    filters: Vec<String>,
    /// Statically known type names this usage can declare.
    static_types: Vec<String>,
    has_inline_refs: bool,
}

struct ObjectRows {
    type_sql: String,
    id_sql: String,
    from: String,
    alias: String,
    filters: Vec<String>,
    static_types: Vec<String>,
}

struct RelRows {
    left_sql: String,
    right_sql: String,
    qualifier_sql: String,
    from: String,
    alias: String,
    filters: Vec<String>,
}

impl EventRows {
    fn select(&self) -> String {
        let mut sql = format!(
            "SELECT {} AS ocel_id, {} AS ocel_type, {} AS ocel_time FROM {} AS {}",
            self.id_sql, self.type_sql, self.time_sql, self.from, self.alias
        );
        if !self.filters.is_empty() {
            sql.push_str(&format!(" WHERE {}", self.filters.join(" AND ")));
        }
        sql
    }
}

impl ObjectRows {
    fn select(&self) -> String {
        let mut sql = format!(
            "SELECT {} AS ocel_id, {} AS ocel_type FROM {} AS {}",
            self.id_sql, self.type_sql, self.from, self.alias
        );
        if !self.filters.is_empty() {
            sql.push_str(&format!(" WHERE {}", self.filters.join(" AND ")));
        }
        sql
    }
}

/// Resolve `prefix_id_with_type` across the blueprint. The extractor keys
/// `ExtractionContext::prefixed_types` by type name, and objects are processed before
/// events and relations, so by the time ids are looked up the set is final.
struct PrefixPlan {
    prefixed: BTreeSet<String>,
    conflicts: Vec<(String, UsageRef)>,
}

fn plan_prefixes(blueprint: &DataExtractionBlueprint) -> PrefixPlan {
    let mut prefixed: BTreeSet<String> = BTreeSet::new();
    let mut unprefixed: BTreeSet<String> = BTreeSet::new();
    let mut owner: BTreeMap<String, UsageRef> = BTreeMap::new();

    for (idx, table) in blueprint.tables.iter().enumerate() {
        if let TableUsageData::Object {
            object_type,
            prefix_id_with_type,
            ..
        } = &table.usage
        {
            let ValueExpression::Constant { value } = object_type else {
                continue;
            };
            if value.is_empty() {
                continue;
            }
            if *prefix_id_with_type {
                prefixed.insert(value.clone());
            } else {
                unprefixed.insert(value.clone());
            }
            owner
                .entry(value.clone())
                .or_insert_with(|| usage_ref(idx, table));
        }
    }

    let conflicts = prefixed
        .intersection(&unprefixed)
        .filter_map(|t| owner.get(t).map(|u| (t.clone(), u.clone())))
        .collect();

    PrefixPlan {
        prefixed,
        conflicts,
    }
}

fn usage_mode(usage: &TableUsageData) -> &'static str {
    match usage {
        TableUsageData::Event { .. } => "event",
        TableUsageData::Object { .. } => "object",
        TableUsageData::E2ORelation { .. } => "e2o-relation",
        TableUsageData::O2ORelation { .. } => "o2o-relation",
        TableUsageData::ChangeTableEvents { .. } => "change-table-events",
    }
}

fn usage_ref(idx: usize, table: &TableExtractionConfig) -> UsageRef {
    UsageRef {
        table_index: idx,
        table_name: table.table_name.clone(),
        mode: usage_mode(&table.usage),
    }
}

/// Apply `maybe_prefix_id` to an already-compiled raw id expression.
fn apply_prefix(
    dialect: SqlDialect,
    type_name: &str,
    raw_id_sql: &str,
    plan: &PrefixPlan,
) -> String {
    if plan.prefixed.contains(type_name) {
        dialect.concat(&[
            dialect.string_literal(&format!("{}-", type_name)),
            raw_id_sql.to_string(),
        ])
    } else {
        raw_id_sql.to_string()
    }
}

/// Static type name of an `ObjectTypeSpec`, mirroring `ObjectTypeSpec::evaluate`
/// (`Fixed("")` evaluates to None).
fn static_object_type(spec: &ObjectTypeSpec) -> Option<Option<String>> {
    match spec {
        ObjectTypeSpec::Fixed(s) if s.is_empty() => Some(None),
        ObjectTypeSpec::Fixed(s) => Some(Some(s.clone())),
        ObjectTypeSpec::Expression(ValueExpression::Constant { value }) if value.is_empty() => {
            Some(None)
        }
        ObjectTypeSpec::Expression(ValueExpression::Constant { value }) => {
            Some(Some(value.clone()))
        }
        ObjectTypeSpec::Expression(_) => None,
    }
}

pub fn compile_blueprint(blueprint: &DataExtractionBlueprint, dialect: SqlDialect) -> CompiledOcel {
    let mut out = CompiledOcel {
        dialect,
        ..Default::default()
    };
    let plan = plan_prefixes(blueprint);

    for (object_type, usage) in &plan.conflicts {
        out.errors.push(CompileError {
            usage: Some(usage.clone()),
            origin_vt: None,
            reason: RejectReason::ConflictingPrefixFlag {
                object_type: object_type.clone(),
            },
        });
    }
    let conflicted: BTreeSet<&str> = plan.conflicts.iter().map(|(t, _)| t.as_str()).collect();

    let mut event_rows: Vec<EventRows> = Vec::new();
    let mut object_rows: Vec<ObjectRows> = Vec::new();
    let mut e2o_rows: Vec<RelRows> = Vec::new();
    let mut o2o_rows: Vec<RelRows> = Vec::new();
    // `ChangeTableEvents` declares every rule's type up front, before any row matches.
    let mut unconditional_event_types: BTreeSet<String> = BTreeSet::new();
    // Populated lazily, per referenced virtual table id, and shared across usages so a VT
    // used by several usages is only resolved once.
    let mut vt_schema_cache: BTreeMap<String, VtSchema> = BTreeMap::new();
    // `resolve_vt_schema` only caches on success, so a referenced-and-broken id would
    // otherwise be re-attempted (and re-reported) by the unreferenced-VT pass below.
    let mut vt_resolution_failed: BTreeSet<String> = BTreeSet::new();

    for (idx, table) in blueprint.tables.iter().enumerate() {
        let usage = usage_ref(idx, table);
        if let TableUsageData::Object { object_type, .. } = &table.usage {
            if let ValueExpression::Constant { value } = object_type {
                if conflicted.contains(value.as_str()) {
                    continue;
                }
            }
        }

        let (from, info) = if let Some(vt_id) = &table.virtual_table_id {
            let mut in_progress = BTreeSet::new();
            if let Err(reason) = resolve_vt_schema(
                &blueprint.tables,
                &blueprint.virtual_tables,
                vt_id,
                &mut vt_schema_cache,
                &mut in_progress,
            ) {
                vt_resolution_failed.insert(vt_id.clone());
                out.errors.push(CompileError {
                    usage: Some(usage),
                    origin_vt: None,
                    reason,
                });
                continue;
            }
            let sql = match vt_select(vt_id, blueprint, &vt_schema_cache, dialect) {
                Ok(sql) => sql,
                Err(reason) => {
                    out.errors.push(CompileError {
                        usage: Some(usage),
                        origin_vt: None,
                        reason,
                    });
                    continue;
                }
            };
            let schema = vt_schema_cache.get(vt_id).expect("resolved above");
            (format!("(\n{}\n)", sql), ColumnSchema::Virtual(schema))
        } else {
            (
                dialect.quote_ident(&table.table_name),
                ColumnSchema::Table(&table.table_info),
            )
        };

        let mut ctx = UsageCtx {
            dialect,
            usage: usage.clone(),
            info,
            alias: "t".to_string(),
            probes: Vec::new(),
        };

        let result = compile_usage(
            &mut ctx,
            &table.usage,
            &from,
            &plan,
            &mut event_rows,
            &mut object_rows,
            &mut e2o_rows,
            &mut o2o_rows,
            &mut unconditional_event_types,
        );

        match result {
            Ok(()) => out.probes.append(&mut ctx.probes),
            Err(reason) => out.errors.push(CompileError {
                usage: Some(usage),
                origin_vt: None,
                reason,
            }),
        }
    }

    // Every declared virtual table must resolve, even if no usage's `virtual_table_id`
    // reaches it -- the reference extractor's `resolve_virtual_tables` (mod.rs:282-323)
    // resolves all of them eagerly and reports an error for a broken one regardless of
    // use, so "compiles cleanly" must be at least as strict. Only schema resolution runs
    // here (not `vt_select`): an unreferenced VT's SQL compilability is moot since nothing
    // downstream needs it, but its *validity* (the same thing `resolve_vt_schema` mirrors
    // from `apply_transform`'s own checks) must still agree with the extractor.
    //
    // A cycle is checked globally, once, before the per-vt loop: `resolve_vt_schema`'s own
    // DFS cycle detection reports one `VirtualTableCycle` per top-level id it's asked
    // about, so naively calling it for every declared id below would report the *same*
    // cycle once per member caught up in it. mod.rs's own `topological_sort_virtual_tables`
    // instead aborts the whole graph on the first cycle found and reports exactly one
    // error, so this mirrors that granularity: one `CompileError` for the whole cyclic set,
    // naming a representative member, with every member excluded from the per-vt loop
    // below (it would only rediscover the same cycle).
    let cyclic = cyclic_vt_ids(blueprint);
    if let Some(representative) = cyclic.iter().next() {
        out.errors.push(CompileError {
            usage: None,
            origin_vt: Some(representative.clone()),
            reason: RejectReason::VirtualTableCycle {
                id: representative.clone(),
            },
        });
    }
    vt_resolution_failed.extend(cyclic);

    for vt in &blueprint.virtual_tables {
        if vt_schema_cache.contains_key(&vt.id) || vt_resolution_failed.contains(&vt.id) {
            continue;
        }
        let mut in_progress = BTreeSet::new();
        if let Err(reason) = resolve_vt_schema(
            &blueprint.tables,
            &blueprint.virtual_tables,
            &vt.id,
            &mut vt_schema_cache,
            &mut in_progress,
        ) {
            out.errors.push(CompileError {
                usage: None,
                origin_vt: Some(vt.id.clone()),
                reason,
            });
        }
    }

    // A prefixed type over an empty table never enters `prefixed_types`, so the extractor
    // would emit unprefixed ids everywhere.
    for (idx, table) in blueprint.tables.iter().enumerate() {
        if let TableUsageData::Object {
            object_type,
            prefix_id_with_type: true,
            ..
        } = &table.usage
        {
            if let ValueExpression::Constant { value } = object_type {
                if plan.prefixed.contains(value) && !conflicted.contains(value.as_str()) {
                    out.probes.push(Probe {
                        usage: Some(usage_ref(idx, table)),
                        kind: ProbeKind::PrefixedTypeEmptyTable {
                            object_type: value.clone(),
                        },
                        sql: format!(
                            "SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM {})",
                            dialect.quote_ident(&table.table_name)
                        ),
                    });
                }
            }
        }
    }

    assemble(
        dialect,
        &mut out,
        event_rows,
        object_rows,
        e2o_rows,
        o2o_rows,
        unconditional_event_types,
    );
    out
}

#[allow(clippy::too_many_arguments)]
fn compile_usage(
    ctx: &mut UsageCtx,
    usage: &TableUsageData,
    from: &str,
    plan: &PrefixPlan,
    event_rows: &mut Vec<EventRows>,
    object_rows: &mut Vec<ObjectRows>,
    e2o_rows: &mut Vec<RelRows>,
    o2o_rows: &mut Vec<RelRows>,
    unconditional_event_types: &mut BTreeSet<String>,
) -> Result<(), RejectReason> {
    match usage {
        TableUsageData::Event {
            event_type,
            id,
            timestamp,
            inline_object_references,
        } => {
            let Some(id_expr) = id else {
                return Err(RejectReason::SynthesizedId { field: "id" });
            };
            let type_name = static_type_name(event_type, "event_type")?;
            let time = ctx.timestamp_expr(timestamp)?;
            let id_sql = ctx.value_expr(id_expr, "id", from, Position::Identity)?;

            let mut filters: Vec<String> = time.filter(ctx.dialect).into_iter().collect();
            filters.extend(ctx.identity_null_filters(id_expr));

            compile_inline_refs(
                ctx,
                inline_object_references,
                &id_sql,
                &filters,
                from,
                plan,
                object_rows,
                e2o_rows,
            )?;

            event_rows.push(EventRows {
                usage: ctx.usage.clone(),
                type_sql: ctx.dialect.string_literal(&type_name),
                id_sql,
                time_sql: time.sql(ctx.dialect),
                from: from.to_string(),
                alias: ctx.alias.clone(),
                filters,
                static_types: vec![type_name],
                has_inline_refs: !inline_object_references.is_empty(),
            });
            Ok(())
        }

        TableUsageData::Object {
            attribute_config: Some(_),
            timestamp: Some(_),
            ..
        } => Err(RejectReason::ObjectAttributeTracking),

        TableUsageData::Object {
            object_type,
            id,
            attribute_config,
            ..
        } => {
            // An attribute_config without a timestamp is inert in the extractor: the
            // streaming branch ignores it entirely.
            let _ = attribute_config;
            let type_name = static_type_name(object_type, "object_type")?;
            let raw_id = ctx.value_expr(id, "id", from, Position::Identity)?;
            let id_sql = apply_prefix(ctx.dialect, &type_name, &raw_id, plan);

            object_rows.push(ObjectRows {
                type_sql: ctx.dialect.string_literal(&type_name),
                id_sql,
                from: from.to_string(),
                alias: ctx.alias.clone(),
                filters: ctx.identity_null_filters(id),
                static_types: vec![type_name],
            });
            Ok(())
        }

        TableUsageData::E2ORelation {
            source_event,
            target_object,
            qualifier,
            target_object_type,
            target_object_multi,
        } => {
            if multi_value_regex(target_object_multi.as_ref()) {
                return Err(RejectReason::MultiValueRegexSplit {
                    field: "target_object_multi",
                });
            }
            let event_sql =
                ctx.value_expr(source_event, "source_event", from, Position::Identity)?;
            let raw_object =
                ctx.value_expr(target_object, "target_object", from, Position::Identity)?;
            let (mv_from, part_object) = wrap_multi_value(
                ctx.dialect,
                from,
                &raw_object,
                target_object_multi.as_ref(),
                "__mv0",
            );
            let object_sql = prefixed_endpoint(
                ctx,
                target_object_type.as_ref(),
                &part_object,
                plan,
                "target_object_type",
            )?;
            let qualifier_sql = optional_qualifier(ctx, qualifier.as_ref(), from)?;

            // `split_value` drops empty ids before the object lookup (post-split,
            // post-trim when the target is multi-valued).
            let mut filters = vec![format!("{} <> ''", part_object)];
            filters.extend(ctx.identity_null_filters(source_event));
            filters.extend(ctx.identity_null_filters(target_object));

            e2o_rows.push(RelRows {
                left_sql: event_sql,
                right_sql: object_sql,
                qualifier_sql,
                from: mv_from,
                alias: ctx.alias.clone(),
                filters,
            });
            Ok(())
        }

        TableUsageData::O2ORelation {
            source_object,
            target_object,
            qualifier,
            source_object_type,
            target_object_type,
            source_object_multi,
            target_object_multi,
        } => {
            if multi_value_regex(source_object_multi.as_ref()) {
                return Err(RejectReason::MultiValueRegexSplit {
                    field: "source_object_multi",
                });
            }
            if multi_value_regex(target_object_multi.as_ref()) {
                return Err(RejectReason::MultiValueRegexSplit {
                    field: "target_object_multi",
                });
            }
            let raw_source =
                ctx.value_expr(source_object, "source_object", from, Position::Identity)?;
            let raw_target =
                ctx.value_expr(target_object, "target_object", from, Position::Identity)?;
            // Chaining the two wraps (source, then target, over the source's own result)
            // nests the unnests, mirroring the extractor's nested for-loops as a cross
            // product; a side without multi-value config passes its `from`/expr through.
            let (from1, part_source) = wrap_multi_value(
                ctx.dialect,
                from,
                &raw_source,
                source_object_multi.as_ref(),
                "__mv0",
            );
            let (from2, part_target) = wrap_multi_value(
                ctx.dialect,
                &from1,
                &raw_target,
                target_object_multi.as_ref(),
                "__mv1",
            );
            let source_sql = prefixed_endpoint(
                ctx,
                source_object_type.as_ref(),
                &part_source,
                plan,
                "source_object_type",
            )?;
            let target_sql = prefixed_endpoint(
                ctx,
                target_object_type.as_ref(),
                &part_target,
                plan,
                "target_object_type",
            )?;
            let qualifier_sql = optional_qualifier(ctx, qualifier.as_ref(), from)?;

            let mut filters = vec![
                format!("{} <> ''", part_source),
                format!("{} <> ''", part_target),
            ];
            filters.extend(ctx.identity_null_filters(source_object));
            filters.extend(ctx.identity_null_filters(target_object));

            o2o_rows.push(RelRows {
                left_sql: source_sql,
                right_sql: target_sql,
                qualifier_sql,
                from: from2,
                alias: ctx.alias.clone(),
                filters,
            });
            Ok(())
        }

        TableUsageData::ChangeTableEvents {
            timestamp,
            id,
            event_rules,
            inline_object_references,
        } => {
            let Some(id_expr) = id else {
                return Err(RejectReason::SynthesizedChangeTableEventId);
            };
            let time = ctx.timestamp_expr(timestamp)?;
            let id_sql = ctx.value_expr(id_expr, "id", from, Position::Identity)?;

            // First match wins (`break` in `process_rows`), so rule order is a CASE.
            let mut arms = Vec::new();
            for rule in event_rules {
                let cond = compile_condition(ctx, &rule.conditions)?;
                arms.push(format!(
                    "WHEN {} THEN {}",
                    cond,
                    ctx.dialect.string_literal(&rule.event_type)
                ));
                unconditional_event_types.insert(rule.event_type.clone());
            }
            if arms.is_empty() {
                return Ok(());
            }
            let type_sql = format!("CASE {} ELSE NULL END", arms.join(" "));

            let mut filters = vec![format!("{} IS NOT NULL", type_sql)];
            filters.extend(time.filter(ctx.dialect));
            filters.extend(ctx.identity_null_filters(id_expr));

            compile_inline_refs(
                ctx,
                inline_object_references,
                &id_sql,
                &filters,
                from,
                plan,
                object_rows,
                e2o_rows,
            )?;

            event_rows.push(EventRows {
                usage: ctx.usage.clone(),
                type_sql,
                id_sql,
                time_sql: time.sql(ctx.dialect),
                from: from.to_string(),
                alias: ctx.alias.clone(),
                filters,
                static_types: event_rules.iter().map(|r| r.event_type.clone()).collect(),
                has_inline_refs: !inline_object_references.is_empty(),
            });
            Ok(())
        }
    }
}

fn static_type_name(expr: &ValueExpression, field: &'static str) -> Result<String, RejectReason> {
    match expr {
        ValueExpression::Constant { value } if !value.is_empty() => Ok(value.clone()),
        // `Constant("")` still evaluates to Some(""), producing a type literally named "".
        ValueExpression::Constant { value } => Ok(value.clone()),
        _ => Err(RejectReason::DynamicTypeName { field }),
    }
}

fn optional_qualifier(
    ctx: &mut UsageCtx,
    qualifier: Option<&ValueExpression>,
    from: &str,
) -> Result<String, RejectReason> {
    match qualifier {
        // `unwrap_or_default()` on a missing qualifier.
        None => Ok(ctx.dialect.string_literal("")),
        Some(expr) => ctx.value_expr(expr, "qualifier", from, Position::Qualifier),
    }
}

/// Endpoint id for a relation: the type only ever feeds `maybe_prefix_id`, never the
/// object lookup, which is by id alone.
fn prefixed_endpoint(
    ctx: &mut UsageCtx,
    spec: Option<&ObjectTypeSpec>,
    raw_id_sql: &str,
    plan: &PrefixPlan,
    field: &'static str,
) -> Result<String, RejectReason> {
    let Some(spec) = spec else {
        return Ok(raw_id_sql.to_string());
    };
    match static_object_type(spec) {
        Some(Some(type_name)) => Ok(apply_prefix(ctx.dialect, &type_name, raw_id_sql, plan)),
        // Type evaluates to None, so `maybe_prefix_id` is never reached.
        Some(None) => Ok(raw_id_sql.to_string()),
        None => {
            if plan.prefixed.is_empty() {
                // No type is prefixed, so `maybe_prefix_id` is the identity regardless.
                Ok(raw_id_sql.to_string())
            } else {
                Err(RejectReason::DynamicTypeWithPrefixing { field })
            }
        }
    }
}

/// Inline object references both create objects and contribute E2O rows.
#[allow(clippy::too_many_arguments)]
fn compile_inline_refs(
    ctx: &mut UsageCtx,
    refs: &[InlineObjectReference],
    event_id_sql: &str,
    event_filters: &[String],
    from: &str,
    plan: &PrefixPlan,
    object_rows: &mut Vec<ObjectRows>,
    e2o_rows: &mut Vec<RelRows>,
) -> Result<(), RejectReason> {
    for inline in refs {
        if multi_value_regex(inline.multi_value_config.as_ref()) {
            return Err(RejectReason::MultiValueRegexSplit {
                field: "multi_value_config",
            });
        }
        let raw_id = ctx.value_expr(&inline.object_id, "object_id", from, Position::Identity)?;
        let qualifier_sql = optional_qualifier(ctx, inline.qualifier.as_ref(), from)?;
        let (mv_from, part_id) = wrap_multi_value(
            ctx.dialect,
            from,
            &raw_id,
            inline.multi_value_config.as_ref(),
            "__mv0",
        );

        let static_type = match inline.object_type.as_ref() {
            None => None,
            Some(spec) => match static_object_type(spec) {
                Some(t) => t,
                None => {
                    return Err(RejectReason::DynamicTypeName {
                        field: "object_type",
                    })
                }
            },
        };

        let mut filters = event_filters.to_vec();
        // `extract_object_ids` drops empty ids (post-split, post-trim when multi-valued).
        filters.push(format!("{} <> ''", part_id));
        filters.extend(ctx.identity_null_filters(&inline.object_id));

        let id_sql = match &static_type {
            Some(t) => apply_prefix(ctx.dialect, t, &part_id, plan),
            None => part_id.clone(),
        };

        if let Some(type_name) = &static_type {
            object_rows.push(ObjectRows {
                type_sql: ctx.dialect.string_literal(type_name),
                id_sql: id_sql.clone(),
                from: mv_from.clone(),
                alias: ctx.alias.clone(),
                filters: filters.clone(),
                static_types: vec![type_name.clone()],
            });
        }

        e2o_rows.push(RelRows {
            left_sql: event_id_sql.to_string(),
            right_sql: id_sql,
            qualifier_sql,
            from: mv_from,
            alias: ctx.alias.clone(),
            filters,
        });
    }
    Ok(())
}

/// Rejects any regex construct whose Rust-`regex` and RE2 (DuckDB `regexp_matches`)
/// behaviour is not provably identical. Allowlist-based: everything not explicitly
/// recognised is rejected, so a future `regex-syntax` addition fails closed rather than
/// silently passing through.
fn portable_regex(pattern: &str) -> Result<(), String> {
    let ast = regex_syntax::ast::parse::Parser::new()
        .parse(pattern)
        .map_err(|e| format!("failed to parse as a regex: {}", e))?;
    portable_ast(&ast)
}

fn portable_ast(ast: &regex_syntax::ast::Ast) -> Result<(), String> {
    use regex_syntax::ast::Ast;
    match ast {
        Ast::Empty(_) | Ast::Literal(_) | Ast::Dot(_) | Ast::ClassPerl(_) => Ok(()),
        Ast::Flags(set_flags) => portable_flags(&set_flags.flags),
        Ast::Assertion(assertion) => portable_assertion(assertion),
        Ast::ClassUnicode(class) => Err(format!(
            "\\p{{...}}/\\P{{...}} Unicode class {:?} has no guaranteed-identical RE2 mapping",
            class.kind
        )),
        Ast::ClassBracketed(class) => portable_class_set(&class.kind),
        Ast::Repetition(rep) => portable_ast(&rep.ast),
        Ast::Group(group) => {
            if let regex_syntax::ast::GroupKind::NonCapturing(flags) = &group.kind {
                portable_flags(flags)?;
            }
            portable_ast(&group.ast)
        }
        Ast::Alternation(alt) => alt.asts.iter().try_for_each(portable_ast),
        Ast::Concat(concat) => concat.asts.iter().try_for_each(portable_ast),
    }
}

fn portable_assertion(assertion: &regex_syntax::ast::Assertion) -> Result<(), String> {
    use regex_syntax::ast::AssertionKind::*;
    match assertion.kind {
        StartLine | EndLine | StartText | EndText => Ok(()),
        ref other => Err(format!(
            "assertion {:?} (word-boundary assertions differ between Rust regex and RE2)",
            other
        )),
    }
}

/// Only `i`/`m`/`s` are allowed: `x` (verbose) changes how the pattern text itself is
/// parsed, `u`/`U` toggle Unicode mode / swap greediness, and `R` (CRLF) is RE2-only --
/// none of those are guaranteed to parse identically in both engines.
fn portable_flags(flags: &regex_syntax::ast::Flags) -> Result<(), String> {
    use regex_syntax::ast::{Flag, FlagsItemKind};
    for item in &flags.items {
        if let FlagsItemKind::Flag(flag) = &item.kind {
            match flag {
                Flag::CaseInsensitive | Flag::MultiLine | Flag::DotMatchesNewLine => {}
                other => {
                    return Err(format!(
                        "flag {:?} is not in the portable allowlist (i/m/s only)",
                        other
                    ))
                }
            }
        }
    }
    Ok(())
}

fn portable_class_set(set: &regex_syntax::ast::ClassSet) -> Result<(), String> {
    use regex_syntax::ast::ClassSet;
    match set {
        ClassSet::Item(item) => portable_class_set_item(item),
        ClassSet::BinaryOp(op) => Err(format!(
            "character class set operation {:?} has no guaranteed-identical RE2 mapping",
            op.kind
        )),
    }
}

fn portable_class_set_item(item: &regex_syntax::ast::ClassSetItem) -> Result<(), String> {
    use regex_syntax::ast::ClassSetItem;
    match item {
        ClassSetItem::Empty(_)
        | ClassSetItem::Literal(_)
        | ClassSetItem::Range(_)
        | ClassSetItem::Perl(_) => Ok(()),
        ClassSetItem::Ascii(class) => Err(format!(
            "POSIX class [:{}{}:] is not in the portable allowlist (literals/ranges/perl \
             classes only)",
            if class.negated { "^" } else { "" },
            format!("{:?}", class.kind).to_lowercase()
        )),
        ClassSetItem::Unicode(_) => Err(
            "\\p{...} inside a bracketed class has no guaranteed-identical RE2 mapping".to_string(),
        ),
        ClassSetItem::Bracketed(_) => {
            Err("nested bracketed classes are not in the portable allowlist".to_string())
        }
        ClassSetItem::Union(union) => union.items.iter().try_for_each(portable_class_set_item),
    }
}

fn compile_condition(
    ctx: &mut UsageCtx,
    condition: &ChangeTableCondition,
) -> Result<String, RejectReason> {
    match condition {
        ChangeTableCondition::Or { conditions } => {
            if conditions.is_empty() {
                // `iter().any()` on an empty set.
                return Ok(ctx.dialect.false_predicate().to_string());
            }
            let parts = conditions
                .iter()
                .map(|c| compile_condition(ctx, c))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(format!("({})", parts.join(" OR ")))
        }
        ChangeTableCondition::And { conditions } => {
            if conditions.is_empty() {
                // `iter().all()` on an empty set.
                return Ok(ctx.dialect.true_predicate().to_string());
            }
            let parts = conditions
                .iter()
                .map(|c| compile_condition(ctx, c))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(format!("({})", parts.join(" AND ")))
        }
        ChangeTableCondition::ColumnEquals { column, value } => {
            let col = ctx.column_as_condition_text(column, "condition")?;
            Ok(format!("{} = {}", col, ctx.dialect.string_literal(value)))
        }
        ChangeTableCondition::ColumnNotEquals { column, value } => {
            let col = ctx.column_as_condition_text(column, "condition")?;
            Ok(format!("{} <> {}", col, ctx.dialect.string_literal(value)))
        }
        ChangeTableCondition::ColumnMatches { column, regex } => {
            portable_regex(regex).map_err(|detail| RejectReason::UnportableRegex {
                pattern: regex.clone(),
                detail,
            })?;
            let col = ctx.column_as_condition_text(column, "condition")?;
            Ok(ctx.dialect.regex_match(&col, regex))
        }
        ChangeTableCondition::ColumnNotEmpty { column } => {
            let facts = ctx
                .info
                .facts(column)
                .ok_or_else(|| RejectReason::UnknownColumn {
                    column: column.to_string(),
                    field: "condition",
                })?;
            if facts.col_type == "Unknown" {
                return Err(RejectReason::UnknownTypedNotEmpty {
                    column: column.to_string(),
                });
            }
            let qualified = format!("{}.{}", ctx.alias, ctx.dialect.quote_ident(column));
            // Null is false; otherwise only Text/Unknown are emptiness-checked, every
            // other variant is unconditionally true.
            if facts.col_type == "Text" {
                Ok(format!(
                    "({} IS NOT NULL AND {} <> '')",
                    qualified, qualified
                ))
            } else {
                Ok(format!("{} IS NOT NULL", qualified))
            }
        }
    }
}

fn assemble(
    dialect: SqlDialect,
    out: &mut CompiledOcel,
    event_rows: Vec<EventRows>,
    object_rows: Vec<ObjectRows>,
    e2o_rows: Vec<RelRows>,
    o2o_rows: Vec<RelRows>,
    unconditional_event_types: BTreeSet<String>,
) {
    let mut object_types: BTreeSet<String> = BTreeSet::new();
    for rows in &object_rows {
        object_types.extend(rows.static_types.iter().cloned());
    }
    let mut event_types: BTreeSet<String> = unconditional_event_types;
    for rows in &event_rows {
        event_types.extend(rows.static_types.iter().cloned());
    }

    let object_union = if object_rows.is_empty() {
        dialect.empty_relation(&[("ocel_id", TypeHint::Text), ("ocel_type", TypeHint::Text)])
    } else {
        dialect.union_all(&object_rows.iter().map(|r| r.select()).collect::<Vec<_>>())
    };
    out.views.push(ViewDef {
        name: "object".to_string(),
        body: dialect.distinct_select(
            &["ocel_id", "ocel_type"],
            &dialect.derived_table(&object_union, "object_union"),
        ),
    });
    if !object_rows.is_empty() {
        // DISTINCT keeps every (id, type); the extractor keeps only the first type to
        // claim an id. They agree exactly when no id carries two types.
        out.probes.push(Probe {
            usage: None,
            kind: ProbeKind::AmbiguousObjectIdentity,
            sql: format!(
                "SELECT ocel_id FROM {} GROUP BY ocel_id HAVING COUNT(*) > 1",
                dialect.quote_ident("object")
            ),
        });
    }
    for object_type in &object_types {
        out.views.push(ViewDef {
            name: format!("object_{}", object_type),
            body: format!(
                "SELECT ocel_id, {} AS ocel_time, {} AS ocel_changed_field FROM {} \
                 WHERE ocel_type = {}",
                dialect.epoch_timestamp_literal(),
                dialect.null_text_literal(),
                dialect.quote_ident("object"),
                dialect.string_literal(object_type)
            ),
        });
    }

    let event_union = if event_rows.is_empty() {
        dialect.empty_relation(&[
            ("ocel_id", TypeHint::Text),
            ("ocel_type", TypeHint::Text),
            ("ocel_time", TypeHint::Timestamp),
        ])
    } else {
        dialect.union_all(&event_rows.iter().map(|r| r.select()).collect::<Vec<_>>())
    };
    out.views.push(ViewDef {
        name: "event_all".to_string(),
        body: dialect.distinct_select(
            &["ocel_id", "ocel_type", "ocel_time"],
            &dialect.derived_table(&event_union, "event_union"),
        ),
    });
    out.views.push(ViewDef {
        name: "event".to_string(),
        body: format!(
            "SELECT ocel_id, ocel_type FROM {}",
            dialect.quote_ident("event_all")
        ),
    });
    if !event_rows.is_empty() {
        out.probes.push(Probe {
            usage: None,
            kind: ProbeKind::AmbiguousEventIdentity,
            sql: format!(
                "SELECT ocel_id FROM {} GROUP BY ocel_id HAVING COUNT(*) > 1",
                dialect.quote_ident("event_all")
            ),
        });
    }

    // A repeated event id keeps the first row's relationships but still creates the later
    // rows' inline objects, so identity alone is not enough here.
    for rows in event_rows.iter().filter(|r| r.has_inline_refs) {
        let mut inner = format!(
            "SELECT {} AS ocel_id FROM {} AS {}",
            rows.id_sql, rows.from, rows.alias
        );
        if !rows.filters.is_empty() {
            inner.push_str(&format!(" WHERE {}", rows.filters.join(" AND ")));
        }
        out.probes.push(Probe {
            usage: Some(rows.usage.clone()),
            kind: ProbeKind::DuplicateEventIdWithInlineRefs,
            sql: format!(
                "SELECT ocel_id FROM {} GROUP BY ocel_id HAVING COUNT(*) > 1",
                dialect.derived_table(&inner, "dup")
            ),
        });
    }

    for event_type in &event_types {
        out.views.push(ViewDef {
            name: format!("event_{}", event_type),
            body: format!(
                "SELECT ocel_id, ocel_time FROM {} WHERE ocel_type = {}",
                dialect.quote_ident("event_all"),
                dialect.string_literal(event_type)
            ),
        });
    }

    out.views.push(ViewDef {
        name: "event_map_type".to_string(),
        body: type_map_select(dialect, &event_types),
    });
    out.views.push(ViewDef {
        name: "object_map_type".to_string(),
        body: type_map_select(dialect, &object_types),
    });

    // E2O/O2O are semi-joins: the extractor looks the endpoint up and drops the row when
    // it is absent, so a plain projection would emit rows the extractor never creates.
    emit_relation_view(
        dialect,
        out,
        "event_object",
        &e2o_rows,
        ("ocel_event_id", "event"),
        ("ocel_object_id", "object"),
    );
    emit_relation_view(
        dialect,
        out,
        "object_object",
        &o2o_rows,
        ("ocel_source_id", "object"),
        ("ocel_target_id", "object"),
    );
}

fn type_map_select(dialect: SqlDialect, types: &BTreeSet<String>) -> String {
    if types.is_empty() {
        return dialect.empty_relation(&[
            ("ocel_type", TypeHint::Text),
            ("ocel_type_map", TypeHint::Text),
        ]);
    }
    let rows: Vec<String> = types
        .iter()
        .map(|t| {
            format!(
                "SELECT {} AS ocel_type, {} AS ocel_type_map",
                dialect.string_literal(t),
                dialect.string_literal(t)
            )
        })
        .collect();
    dialect.union_all(&rows)
}

/// `left`/`right` carry the endpoint column name and the *bare* (unquoted) view name the
/// endpoint must exist in -- quoted here via `quote_ident`, never passed pre-quoted.
fn emit_relation_view(
    dialect: SqlDialect,
    out: &mut CompiledOcel,
    view_name: &str,
    rows: &[RelRows],
    left: (&str, &str),
    right: (&str, &str),
) {
    let (left_col, left_table) = left;
    let (right_col, right_table) = right;
    let left_ref = dialect.quote_ident(left_table);
    let right_ref = dialect.quote_ident(right_table);

    if rows.is_empty() {
        out.views.push(ViewDef {
            name: view_name.to_string(),
            body: dialect.empty_relation(&[
                (left_col, TypeHint::Text),
                (right_col, TypeHint::Text),
                ("ocel_qualifier", TypeHint::Text),
            ]),
        });
        return;
    }

    let selects: Vec<String> = rows
        .iter()
        .map(|r| {
            let mut filters = r.filters.clone();
            filters.push(dialect.semi_join_in(&r.left_sql, &left_ref, "ocel_id"));
            filters.push(dialect.semi_join_in(&r.right_sql, &right_ref, "ocel_id"));
            format!(
                "SELECT {} AS {}, {} AS {}, {} AS ocel_qualifier FROM {} AS {} WHERE {}",
                r.left_sql,
                left_col,
                r.right_sql,
                right_col,
                r.qualifier_sql,
                r.from,
                r.alias,
                filters.join(" AND ")
            )
        })
        .collect();

    out.views.push(ViewDef {
        name: view_name.to_string(),
        body: dialect.distinct_select(
            &[left_col, right_col, "ocel_qualifier"],
            &dialect.derived_table(&dialect.union_all(&selects), "rel_union"),
        ),
    });
}
