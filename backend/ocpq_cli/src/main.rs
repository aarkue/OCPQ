#![recursion_limit = "512"]
ocpq_shared::use_mimalloc!();

use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs::{self, File, OpenOptions},
    io::{BufWriter, Write},
    path::PathBuf,
    process::ExitCode,
    time::{Instant, SystemTime},
};

use chrono::{DateTime, Utc};
use clap::{Parser, Subcommand, ValueEnum};
use dbcon::DataSource;
use ocpq_shared::{
    binding_box::{evaluate_box_tree, Binding, BindingBoxTree},
    OCELInfo,
    db_translation::{
        corpus::{
            builtin_schemas, normalized_binding_set, compare_binding_sets_exact, generate_corpus,
            NormalizedBinding, CorpusBounds, CorpusSchema,
        },
        translate_to_cypher_shared, translate_to_sql_shared, validate_translatable,
        DBTranslationInput, DatabaseType, TableMappings,
    },
    duckdb,
    process_mining::{
        core::event_data::object_centric::linked_ocel::SlimLinkedOCEL, Importable, OCEL,
    },
};

#[derive(Parser, Debug)]
#[command(version, about = "OCPQ CLI tools", long_about = None)]
struct Args {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Evaluate a BindingBoxTree against an OCEL 2.0 file and write the result
    /// to a timestamped JSON file.
    Evaluate(EvaluateArgs),

    /// Translate a BindingBoxTree to SQL (SQLite/DuckDB) or Cypher.
    Translate(TranslateArgs),

    /// Translate a BindingBoxTree to SQL, execute it against a relational
    /// database (SQLite or PostgreSQL), apply CEL post-processing, and write
    /// the bindings to a timestamped JSON file.
    Exec(ExecArgs),

    /// Benchmark BindingBoxTree evaluation across one or more queries.
    Bench(BenchArgs),

    /// Benchmark root-only evaluation across one or more queries.
    BenchRoot(BenchArgs),

    /// Benchmark SQL-translated evaluation against a relational database
    /// (SQLite/PostgreSQL via dbcon, DuckDB via the embedded engine).
    /// Loads the OCEL + database connection once and times only the
    /// per-query translation + execution + CEL post-processing pass.
    BenchSql(BenchSqlArgs),

    /// Measure peak resident set size of the OCPQ process while evaluating
    /// one query (either via the in-memory engine or via a SQL backend).
    /// Reports the maximum RSS observed at the end of the run via
    /// getrusage(RUSAGE_SELF). Intended for the memory-scaling sweep in
    /// the paper's RQ2.
    BenchMem(BenchMemArgs),

    /// Import an OCEL 2.0 file (JSON, SQLite, or DuckDB based on extension)
    /// and re-export it as a DuckDB OCEL 2.0 database.
    ExportDuckdb(ExportDuckdbArgs),

    /// Import an OCEL 2.0 file and re-export it as an SQLite OCEL 2.0
    /// database. Useful when the source is a JSON OCEL that needs to be
    /// loaded into the eval pipeline's SQL paths.
    ExportSqlite(ExportDuckdbArgs),

    /// Import an OCEL 2.0 file (any supported source format) and re-export
    /// it as an OCEL 2.0 JSON file. Lets the eval pipeline feed JSON into
    /// the streaming SlimLinkedOCEL load path.
    ExportJson(ExportDuckdbArgs),

    /// Summarize a JSONL file produced by bench or bench-root.
    BenchSummary(BenchSummaryArgs),

    /// Generate a bounded corpus of OCPQ trees and run a differential-
    /// correctness probe between the in-memory engine and DuckDB across the
    /// corpus. Reports per-tree agreement and per-shape aggregates.
    BenchCorpus(BenchCorpusArgs),

    /// Evaluate ONE tree on the in-memory engine AND DuckDB, append a
    /// single JSONL row to the output file. Designed to be invoked under a
    /// per-process memory cap (e.g. `systemd-run --user --scope
    /// -p MemoryMax=16G --quiet --`) so the driver wrapper can isolate
    /// per-tree OOMs and resume.
    EvalTreeOnce(EvalTreeOnceArgs),

    /// Generate the bench-corpus tree pool for a given schema/bounds and
    /// dump each tree as a separate JSON file plus an index.jsonl carrying
    /// the per-tree tag metadata. The sandboxed driver wrapper consumes
    /// these files.
    DumpCorpusTrees(DumpCorpusTreesArgs),

    /// Profile the current binding-step plan by prefix cardinality.
    PlanProfile(PlanProfileArgs),
}

#[derive(Parser, Debug)]
struct EvalTreeOnceArgs {
    /// Path to the BindingBoxTree JSON (an array, the same shape produced
    /// by `dump-corpus-trees`).
    #[arg(short, long)]
    tree: PathBuf,
    /// Path to the OCEL 2.0 source file (in-memory engine reads it as the
    /// source; the SQL path uses the SlimLinkedOCEL it builds for CEL
    /// attribute lookups during post-processing).
    #[arg(short, long)]
    ocel: PathBuf,
    /// Path to the DuckDB OCEL 2.0 file (produced by
    /// `ocpq_cli export-duckdb`). Used for the DuckDB engine path.
    #[arg(short = 'd', long)]
    duckdb: PathBuf,
    /// JSONL output path; the per-tree row is appended (O_APPEND).
    #[arg(short = 'O', long)]
    out: PathBuf,
    /// Tree id recorded in the JSONL row. The driver wrapper uses this to
    /// detect already-completed trees on restart.
    #[arg(long)]
    tree_id: usize,
    /// Optional sidecar JSON file written by `dump-corpus-trees` with the
    /// CorpusTreeTag for this tree. If present its fields are merged into
    /// the JSONL row so the per-shape aggregates match the in-process
    /// `bench-corpus` output.
    #[arg(long)]
    tag: Option<PathBuf>,
    /// Schema label recorded in the JSONL row (e.g. `bpic2017`,
    /// `order-management`, `container-logistics`).
    #[arg(short = 's', long, default_value = "")]
    schema: String,
    /// Free-form label recorded in the JSONL row.
    #[arg(short, long, default_value = "corpus")]
    label: String,
    /// Skip the per-tree set-equality oracle (count-only). Default is to
    /// build the normalized (var -> ocel_id, label) set on every engine and
    /// compare; this flag disables it.
    #[arg(long, default_value_t = false)]
    no_set_check: bool,
    /// Optional SQLite connection string (e.g. `sqlite:/path/to/db.sqlite`).
    /// When set, the tree is also executed against SQLite via the id-native
    /// path; per-backend count/ms/err + normalized set agreement against
    /// in-memory are recorded.
    #[arg(long)]
    sqlite_connection: Option<String>,
    /// Optional PostgreSQL connection string (e.g.
    /// `postgres://user:pw@host/db`). When set, the tree is also executed
    /// against PostgreSQL via the id-native path; per-backend count/ms/err
    /// + normalized set agreement against in-memory are recorded.
    #[arg(long)]
    postgres_connection: Option<String>,
}

#[derive(Parser, Debug)]
struct DumpCorpusTreesArgs {
    /// Built-in schema to enumerate (`bpic2017`, `order-management`,
    /// `container-logistics`).
    #[arg(short = 's', long)]
    schema: String,
    /// Path to the OCEL 2.0 source file (the corpus generator reads its
    /// OCELInfo to filter type-invalid trees, identical to bench-corpus).
    #[arg(short, long)]
    ocel: PathBuf,
    /// Output directory. Each tree is written as `tree_<idx>.json`; a
    /// sidecar `index.jsonl` carries one row per tree with the tag.
    #[arg(short = 'D', long)]
    out_dir: PathBuf,
    /// Maximum number of event variables per node.
    #[arg(long, default_value_t = 2)]
    max_events: usize,
    /// Maximum number of object variables per node.
    #[arg(long, default_value_t = 2)]
    max_objects: usize,
    /// Maximum tree depth.
    #[arg(long, default_value_t = 2)]
    max_depth: usize,
}

#[derive(Parser, Debug)]
struct BenchCorpusArgs {
    /// Built-in schema to use: `bpic2017`, `order-management`, or
    /// `container-logistics`. Selects the type pool + CEL templates.
    #[arg(short = 's', long)]
    schema: String,

    /// Path to the OCEL 2.0 source file. The in-memory engine evaluates
    /// against this file; the DuckDB connection must point at a DuckDB OCEL
    /// 2.0 database carrying the same data.
    #[arg(short, long)]
    ocel: PathBuf,

    /// Path to the DuckDB OCEL 2.0 file (must match `--ocel` in content;
    /// produced by `ocpq_cli export-duckdb`).
    #[arg(short = 'd', long)]
    duckdb: PathBuf,

    /// Maximum number of event variables per node.
    #[arg(long, default_value_t = 2)]
    max_events: usize,

    /// Maximum number of object variables per node.
    #[arg(long, default_value_t = 2)]
    max_objects: usize,

    /// Maximum tree depth (0 = root only; 1 = parent + one child;
    /// 2 = parent + child + grandchild).
    #[arg(long, default_value_t = 2)]
    max_depth: usize,

    /// Output JSONL path; one row per corpus tree.
    #[arg(short, long, default_value = "bench-corpus-results.jsonl")]
    results: PathBuf,

    /// Free-form label recorded in every output row.
    #[arg(short, long, default_value = "corpus")]
    label: String,

    /// Optional cap on `|V_E^N| + |V_O^N|` per node (in addition to
    /// `--max-events` / `--max-objects`). Useful to rule out shapes with
    /// many fresh variables at one node (e.g. the 2/2/* family that
    /// triggers ER1xER2 cartesian self-joins on DuckDB).
    #[arg(long)]
    max_var_sum: Option<usize>,

    /// Print the generated corpus size + bin breakdown and exit, without
    /// connecting to DuckDB or running any tree. Useful for sizing a
    /// proposed bounds configuration before launching a long run.
    #[arg(long, default_value_t = false)]
    count_only: bool,

    /// Optional PostgreSQL connection string. When set, every tree is
    /// also executed against PostgreSQL via the id-native path
    /// and the per-tree row records `postgres_count`, `postgres_ms`,
    /// `postgres_err`, and a binding-set agreement flag against
    /// in-memory. Schema must match `--ocel` (typically produced by
    /// `pg_dump` from the SQLite OCEL via `migrate_sqlite_to_postgres.py`).
    #[arg(long)]
    postgres_connection: Option<String>,

    /// Optional SQLite connection string (e.g. `sqlite:/path/to/db.sqlite`).
    /// When set, every tree is also executed against SQLite via the
    /// id-native path; per-tree row records `sqlite_count`, `sqlite_ms`,
    /// `sqlite_err`, and a binding-set agreement flag against in-memory.
    /// Note: SQLite uses the per-parent re-execution path for AdvancedCEL
    /// or label-referencing trees, which is significantly slower than the
    /// DuckDB/PG batched LATERAL path, so expect long runs on large corpora.
    #[arg(long)]
    sqlite_connection: Option<String>,

    /// Per-tree wall-clock cap (seconds) for each SQL backend. Trees
    /// that exceed the cap record `_err = "timeout"` and the run
    /// continues. Default: 120 seconds (long enough for a planner-
    /// cliff tree to fail loudly without blocking the run).
    #[arg(long, default_value_t = 120)]
    sql_timeout_secs: u64,
}

#[derive(Parser, Debug)]
struct EvaluateArgs {
    /// Path to the input OCEL 2.0 file.
    #[arg(short, long)]
    ocel: PathBuf,

    /// Path to the input BindingBoxTree JSON file.
    #[arg(short, long)]
    bbox_tree: PathBuf,
}

#[derive(Parser, Debug)]
struct TranslateArgs {
    /// Path to a BindingBoxTree JSON file.
    #[arg(short, long)]
    tree: PathBuf,

    /// Optional JSON file mapping OCEL types to table/label names.
    #[arg(short, long)]
    mappings: Option<PathBuf>,

    /// Target query language.
    #[arg(short = 'T', long, value_enum, default_value_t = Target::Sqlite)]
    target: Target,

    /// Write output to this file. Defaults to stdout.
    #[arg(short, long)]
    output: Option<PathBuf>,

    /// If set, ALSO emit the batched LATERAL SQL for any AdvancedCEL
    /// / label-referencing children (the per-child SQL that
    /// `execute_via_batched` actually runs on DuckDB / Postgres).
    /// Useful for comparing the AdvancedCEL eval surface across
    /// backends. Output format: each batched query is preceded by a
    /// header line `-- batched child label=<L> target=<T>` and a
    /// terminator `-- end`.
    #[arg(long)]
    with_batched: bool,
}

#[derive(Copy, Clone, Debug, ValueEnum)]
enum Target {
    Sqlite,
    Duckdb,
    Postgres,
    Cypher,
}

#[derive(Parser, Debug)]
struct ExecArgs {
    /// Path to a BindingBoxTree JSON file.
    #[arg(short, long)]
    tree: PathBuf,

    /// Optional JSON file mapping OCEL types to table/label names.
    #[arg(short, long)]
    mappings: Option<PathBuf>,

    /// Database backend to target. CEL post-processing requires SQLite or
    /// PostgreSQL (DuckDB execution is not yet wired through dbcon).
    #[arg(short = 'b', long, value_enum, default_value_t = ExecBackend::Sqlite)]
    backend: ExecBackend,

    /// Connection string for the target database. Examples:
    ///   sqlite:/path/to/db.sqlite
    ///   postgres://user:pw@host/db
    ///   duckdb:/path/to/file.duckdb (or just the bare path)
    #[arg(short = 'c', long)]
    connection: String,

    /// Optional output JSON file. Defaults to a timestamped file in the CWD.
    #[arg(short = 'o', long)]
    output: Option<PathBuf>,
}

#[derive(Copy, Clone, Debug, ValueEnum, PartialEq, Eq)]
enum ExecBackend {
    Sqlite,
    Postgres,
    Duckdb,
    /// In-memory engine (no SQL translation, no DB connection). Loads the
    /// OCEL via `SlimLinkedOCEL::import_from_path` once and evaluates the
    /// tree directly per timed run.
    Inmem,
}

/// Runtime-dispatched union over the connection kinds that the SQL+CEL
/// executor can sit on. SQLite / PostgreSQL are served through `dbcon`'s
/// sqlx-based pool; DuckDB is served through the embedded `duckdb` crate.
enum BackendConn {
    Dbcon(DataSource),
    DuckDb(duckdb::Connection),
}

#[derive(Parser, Debug)]
struct BenchSqlArgs {
    /// Path to the input OCEL 2.0 file. Required only for the `inmem`
    /// backend; SQL backends build a subset OCEL from the streamed ocel_ids.
    #[arg(short, long)]
    ocel: Option<PathBuf>,

    /// Directory with one subdirectory per query, each containing ocpq-tree.json.
    #[arg(short, long)]
    queries_dir: PathBuf,

    /// Database backend to target.
    #[arg(short = 'b', long, value_enum, default_value_t = ExecBackend::Sqlite)]
    backend: ExecBackend,

    /// Connection string for the target database. Required for
    /// `sqlite`/`postgres`/`duckdb`; ignored for `inmem`.
    #[arg(short = 'c', long)]
    connection: Option<String>,

    /// Optional JSON file mapping OCEL types to table/label names.
    #[arg(short = 'm', long)]
    mappings: Option<PathBuf>,

    /// Number of timed runs per query.
    #[arg(short = 'n', long, default_value_t = 10)]
    runs: usize,

    /// Number of untimed warmup runs per query.
    #[arg(short, long, default_value_t = 1)]
    warmup: usize,

    /// Label for this run (e.g. "baseline", "sqlite-warm").
    #[arg(short, long)]
    label: String,

    /// Path to append per-iteration results (JSONL).
    #[arg(short, long, default_value = "bench-sql-results.jsonl")]
    results: PathBuf,

    /// Query names to run (default: all).
    #[arg(long, num_args = 0..)]
    only: Vec<String>,

    /// Optional per-iteration wall-clock cap (seconds). When set, each
    /// timed run (and each warmup) is wrapped in a timeout; on timeout
    /// a JSONL row with `error: "timeout"` is appended and the loop
    /// over remaining iterations for that query is abandoned (one
    /// timeout means the rest will likely time out too). Subsequent
    /// queries continue. Useful for capping SQLite cells in long
    /// sweeps. Unset = no cap (current behaviour).
    #[arg(long)]
    per_iter_timeout_secs: Option<u64>,
}

#[derive(Parser, Debug)]
struct ExportDuckdbArgs {
    /// Path to the source OCEL file (any format `process_mining` recognises
    /// from the extension: .json, .sqlite, .duckdb).
    #[arg(short, long)]
    input: PathBuf,

    /// Output `.duckdb` path. Overwritten if it exists.
    #[arg(short, long)]
    output: PathBuf,
}

#[derive(Parser, Debug)]
struct BenchMemArgs {
    /// Path to the input OCEL 2.0 file. Required only for the `inmem`
    /// backend; SQL backends build a subset OCEL from the streamed ocel_ids.
    #[arg(short, long)]
    ocel: Option<PathBuf>,

    /// Path to a single BindingBoxTree JSON file.
    #[arg(short, long)]
    tree: PathBuf,

    /// Which engine to bench. `inmem` evaluates against the in-memory
    /// engine (no DB connection needed); the SQL backends require
    /// `--connection`.
    #[arg(short = 'b', long, value_enum, default_value_t = MemBackend::Inmem)]
    backend: MemBackend,

    /// Connection string when --backend is sqlite/postgres/duckdb.
    #[arg(short = 'c', long)]
    connection: Option<String>,

    /// Optional JSON file mapping OCEL types to table/label names.
    #[arg(short = 'm', long)]
    mappings: Option<PathBuf>,

    /// Number of timed query runs (peak RSS is the max across all of them).
    #[arg(short = 'n', long, default_value_t = 3)]
    runs: usize,

    /// Free-form label recorded in the output row.
    #[arg(short, long)]
    label: String,

    /// Free-form size tag (e.g. "31509-apps") recorded in the output row.
    #[arg(long, default_value = "")]
    size_tag: String,

    /// Output CSV path (rows are appended).
    #[arg(short, long, default_value = "bench-mem-results.csv")]
    results: PathBuf,

}

#[derive(Copy, Clone, Debug, ValueEnum)]
enum MemBackend {
    Inmem,
    Sqlite,
    Postgres,
    Duckdb,
}

#[derive(Parser, Debug)]
struct BenchArgs {
    /// Path to the input OCEL 2.0 file.
    #[arg(short, long)]
    ocel: PathBuf,

    /// Directory with one subdirectory per query, each containing ocpq-tree.json.
    #[arg(short, long)]
    queries_dir: PathBuf,

    /// Number of timed runs per query.
    #[arg(short = 'n', long, default_value_t = 10)]
    runs: usize,

    /// Number of untimed warmup runs per query.
    #[arg(short, long, default_value_t = 1)]
    warmup: usize,

    /// Label for this run (e.g. "baseline", "opt-1").
    #[arg(short, long)]
    label: String,

    /// Path to append per-iteration results (JSONL).
    #[arg(short, long, default_value = "bench-results.jsonl")]
    results: PathBuf,

    /// Query names to run (default: all).
    #[arg(long, num_args = 0..)]
    only: Vec<String>,
}

#[derive(Parser, Debug)]
struct BenchSummaryArgs {
    /// Path to the JSONL results file.
    #[arg(short, long, default_value = "bench-results.jsonl")]
    results: PathBuf,
}

#[derive(Parser, Debug)]
struct PlanProfileArgs {
    /// Path to the input OCEL 2.0 file.
    #[arg(short, long)]
    ocel: PathBuf,

    /// Directory with one subdirectory per query, each containing ocpq-tree.json.
    #[arg(short, long)]
    queries_dir: PathBuf,

    /// Query names to profile (default: all).
    #[arg(long, num_args = 0..)]
    only: Vec<String>,

    /// Max sampled parent bindings for non-root node profiles.
    #[arg(long, default_value_t = 1024)]
    sample_limit: usize,
}

fn run_evaluate(args: EvaluateArgs) {
    let bbox_reader = File::open(args.bbox_tree).expect("Could not find input bbox tree file");
    let bbox_tree: BindingBoxTree =
        serde_json::from_reader(bbox_reader).expect("Could not parse bbox_tree JSON");
    let now = Instant::now();
    let ocel = OCEL::import_from_path(args.ocel).expect("Could not import OCEL 2.0 file");
    println!("Imported OCEL 2.0 in {:?}", now.elapsed());
    let now = Instant::now();
    let index_linked_ocel = SlimLinkedOCEL::from_ocel(ocel);
    println!("Linked OCEL 2.0 in {:?}", now.elapsed());
    let res = evaluate_box_tree(bbox_tree, &index_linked_ocel, true);

    let now = Instant::now();
    // Avoid colons in the timestamp: Windows treats them as illegal path
    // characters and `File::create` would fail at runtime.
    let stamp = DateTime::<Utc>::from(SystemTime::now())
        .format("%Y%m%dT%H%M%SZ")
        .to_string();
    let res_writer = File::create(format!("ocpq-res-export-{stamp}.json"))
        .expect("Could not create res output file!");
    serde_json::to_writer(BufWriter::new(res_writer), &res).unwrap();
    println!("Exported result in {:?}", now.elapsed());
}

/// Read current peak RSS in kilobytes via `getrusage(RUSAGE_SELF)`.
/// On Linux `ru_maxrss` is reported in kilobytes (per `man 2 getrusage`).
fn peak_rss_kb() -> i64 {
    unsafe {
        let mut ru = std::mem::MaybeUninit::<libc::rusage>::uninit();
        if libc::getrusage(libc::RUSAGE_SELF, ru.as_mut_ptr()) != 0 {
            return -1;
        }
        ru.assume_init().ru_maxrss
    }
}

/// Drop relationships whose `object_id` does not appear in `ocel.objects`,
/// and drop attribute entries whose value is `Null`. Both are real-world
/// data hygiene fixes that the rust4pm SQL exporters need: the SQL schema
/// declares FOREIGN KEYs on the link tables, and the per-type attribute
/// columns are typed by first non-null occurrence so a later NULL append
/// fails. Returns the count of dropped E2O / O2O refs / null attrs.
fn clean_ocel_in_place(ocel: &mut ocpq_shared::process_mining::OCEL) -> (usize, usize, usize) {
    use ocpq_shared::process_mining::core::event_data::object_centric::OCELAttributeValue;
    let ob_ids: std::collections::HashSet<String> =
        ocel.objects.iter().map(|o| o.id.clone()).collect();
    let mut dropped_e2o = 0usize;
    let mut dropped_o2o = 0usize;
    let mut dropped_null_attrs = 0usize;
    for e in ocel.events.iter_mut() {
        let before = e.relationships.len();
        e.relationships.retain(|r| ob_ids.contains(&r.object_id));
        dropped_e2o += before - e.relationships.len();
        e.attributes.retain(|a| {
            if matches!(a.value, OCELAttributeValue::Null) {
                dropped_null_attrs += 1;
                false
            } else {
                true
            }
        });
    }
    for o in ocel.objects.iter_mut() {
        let before = o.relationships.len();
        o.relationships.retain(|r| ob_ids.contains(&r.object_id));
        dropped_o2o += before - o.relationships.len();
        o.attributes.retain(|a| {
            if matches!(a.value, OCELAttributeValue::Null) {
                dropped_null_attrs += 1;
                false
            } else {
                true
            }
        });
    }
    (dropped_e2o, dropped_o2o, dropped_null_attrs)
}

fn run_export_duckdb(args: ExportDuckdbArgs) -> anyhow::Result<()> {
    use ocpq_shared::process_mining::core::event_data::object_centric::ocel_sql::export_ocel_duckdb_to_path;

    let now = Instant::now();
    let mut ocel = OCEL::import_from_path(&args.input)
        .map_err(|e| anyhow::anyhow!("import {:?}: {e:?}", args.input))?;
    println!("Imported OCEL 2.0 in {:?}", now.elapsed());
    let (de2o, do2o, dattrs) = clean_ocel_in_place(&mut ocel);
    if de2o + do2o + dattrs > 0 {
        println!(
            "Dropped {} dangling E2O, {} dangling O2O, {} null attribute entries before export",
            de2o, do2o, dattrs
        );
    }
    if args.output.exists() {
        fs::remove_file(&args.output)
            .map_err(|e| anyhow::anyhow!("remove existing {:?}: {e}", args.output))?;
    }
    let now = Instant::now();
    export_ocel_duckdb_to_path(&ocel, &args.output)
        .map_err(|e| anyhow::anyhow!("export to duckdb {:?}: {e:?}", args.output))?;
    println!(
        "Exported to {:?} in {:?}",
        args.output,
        now.elapsed()
    );
    Ok(())
}

fn run_export_json(args: ExportDuckdbArgs) -> anyhow::Result<()> {
    use ocpq_shared::process_mining::core::event_data::object_centric::ocel_json::export_ocel_json_to_path;

    let now = Instant::now();
    let mut ocel = OCEL::import_from_path(&args.input)
        .map_err(|e| anyhow::anyhow!("import {:?}: {e:?}", args.input))?;
    println!("Imported OCEL 2.0 in {:?}", now.elapsed());
    let (de2o, do2o, dattrs) = clean_ocel_in_place(&mut ocel);
    if de2o + do2o + dattrs > 0 {
        println!(
            "Dropped {} dangling E2O, {} dangling O2O, {} null attribute entries before export",
            de2o, do2o, dattrs
        );
    }
    let now = Instant::now();
    export_ocel_json_to_path(&ocel, &args.output)
        .map_err(|e| anyhow::anyhow!("export to json {:?}: {e:?}", args.output))?;
    println!("Exported to {:?} in {:?}", args.output, now.elapsed());
    Ok(())
}

fn run_export_sqlite(args: ExportDuckdbArgs) -> anyhow::Result<()> {
    use ocpq_shared::process_mining::core::event_data::object_centric::ocel_sql::export_ocel_sqlite_to_path;

    let now = Instant::now();
    let mut ocel = OCEL::import_from_path(&args.input)
        .map_err(|e| anyhow::anyhow!("import {:?}: {e:?}", args.input))?;
    println!("Imported OCEL 2.0 in {:?}", now.elapsed());
    let (de2o, do2o, dattrs) = clean_ocel_in_place(&mut ocel);
    if de2o + do2o + dattrs > 0 {
        println!(
            "Dropped {} dangling E2O, {} dangling O2O, {} null attribute entries before export",
            de2o, do2o, dattrs
        );
    }
    if args.output.exists() {
        fs::remove_file(&args.output)
            .map_err(|e| anyhow::anyhow!("remove existing {:?}: {e}", args.output))?;
    }
    let now = Instant::now();
    export_ocel_sqlite_to_path(&ocel, &args.output)
        .map_err(|e| anyhow::anyhow!("export to sqlite {:?}: {e:?}", args.output))?;
    println!(
        "Exported to {:?} in {:?}",
        args.output,
        now.elapsed()
    );
    Ok(())
}

async fn run_bench_mem(args: BenchMemArgs) -> anyhow::Result<()> {
    let tree_str = fs::read_to_string(&args.tree)
        .map_err(|e| anyhow::anyhow!("read tree {:?}: {e}", args.tree))?;
    let tree: BindingBoxTree = serde_json::from_str(&tree_str)
        .map_err(|e| anyhow::anyhow!("parse tree JSON: {e}"))?;

    let mappings = match &args.mappings {
        None => TableMappings::default(),
        Some(p) => {
            let content = fs::read_to_string(p)
                .map_err(|e| anyhow::anyhow!("read mappings {p:?}: {e}"))?;
            serde_json::from_str(&content)
                .map_err(|e| anyhow::anyhow!("parse mappings JSON: {e}"))?
        }
    };

    let rss_baseline = peak_rss_kb();
    // SQL backends use the id-native execution path: no host-side OCEL
    // load. The in-memory backend still needs the linked OCEL because its
    // evaluator dereferences indices into it directly.
    let load_locel = matches!(args.backend, MemBackend::Inmem);
    let locel_opt: Option<SlimLinkedOCEL> = if load_locel {
        let ocel_path = args
            .ocel
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("--ocel is required for the inmem backend"))?;
        println!("Loading OCEL from {:?} (baseline RSS {} KiB)", ocel_path, rss_baseline);
        Some(
            SlimLinkedOCEL::import_from_path(ocel_path)
                .map_err(|e| anyhow::anyhow!("import OCEL: {e:?}"))?,
        )
    } else {
        println!(
            "[id-native] skipping OCEL load for {:?} backend (baseline RSS {} KiB)",
            args.backend, rss_baseline
        );
        None
    };
    let rss_after_load = peak_rss_kb();

    let (median_ms, bindings_count) = match args.backend {
        MemBackend::Inmem => {
            let locel = locel_opt
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("inmem backend requires the linked OCEL"))?;
            let mut durations_ms = Vec::with_capacity(args.runs);
            let mut count = 0usize;
            for _ in 0..args.runs {
                let start = Instant::now();
                let (results, _) = tree
                    .evaluate(locel)
                    .map_err(|e| anyhow::anyhow!("evaluate: {e}"))?;
                durations_ms.push(start.elapsed().as_secs_f64() * 1000.0);
                count = results.len();
            }
            (median_of(&durations_ms), count)
        }
        sql_backend => {
            let conn_str = args
                .connection
                .clone()
                .ok_or_else(|| anyhow::anyhow!("--connection required for SQL backends"))?;
            let (database, backend_conn) = match sql_backend {
                MemBackend::Sqlite => (
                    DatabaseType::SQLite,
                    BackendConn::Dbcon(
                        DataSource::new_any_without_discovery(
                            "ocpq-bench-mem".to_string(),
                            conn_str.clone(),
                        )
                        .await
                        .map_err(|e| anyhow::anyhow!("connect: {e}"))?,
                    ),
                ),
                MemBackend::Postgres => (
                    DatabaseType::PostgreSQL,
                    BackendConn::Dbcon(
                        DataSource::new_any_without_discovery(
                            "ocpq-bench-mem".to_string(),
                            conn_str.clone(),
                        )
                        .await
                        .map_err(|e| anyhow::anyhow!("connect: {e}"))?,
                    ),
                ),
                MemBackend::Duckdb => {
                    let path = conn_str
                        .strip_prefix("duckdb:")
                        .unwrap_or(&conn_str)
                        .to_string();
                    let c = duckdb::Connection::open(&path)
                        .map_err(|e| anyhow::anyhow!("open duckdb {path}: {e}"))?;
                    // DuckDB's default buffer-pool target is 80% of system
                    // RAM, which dominates the host RSS even for tiny query
                    // result sets. Constrain it here so the host-side
                    // memory claim is dataset-independent. The same
                    // pragma is recognised across DuckDB 1.x.
                    if std::env::var("OCPQ_DUCKDB_MEMORY_CAP").is_ok() {
                        c.execute_batch("PRAGMA memory_limit='32MB'; PRAGMA threads=1;")
                            .map_err(|e| anyhow::anyhow!("set duckdb memory_limit: {e}"))?;
                    }
                    (DatabaseType::DuckDB, BackendConn::DuckDb(c))
                }
                MemBackend::Inmem => unreachable!(),
            };
            let mut durations_ms = Vec::with_capacity(args.runs);
            let mut count = 0usize;
            for _ in 0..args.runs {
                let input = DBTranslationInput {
                    tree: tree.clone(),
                    database,
                    table_mappings: mappings.clone(),
                };
                let start = Instant::now();
                count = match &backend_conn {
                    BackendConn::Dbcon(ds) => {
                        ocpq_shared::db_translation::sql_executor_id::execute_translated_query_id(
                            input, ds,
                        )
                        .await?
                        .len()
                    }
                    BackendConn::DuckDb(c) => {
                        ocpq_shared::db_translation::sql_executor_id::execute_translated_query_id_duckdb(
                            input, c,
                        )
                        .await?
                        .len()
                    }
                };
                durations_ms.push(start.elapsed().as_secs_f64() * 1000.0);
            }
            (median_of(&durations_ms), count)
        }
    };

    let rss_after_query = peak_rss_kb();

    let row = format!(
        "{label},{backend:?},{size_tag},{baseline},{after_load},{after_query},{median:.3},{count}\n",
        label = args.label,
        backend = args.backend,
        size_tag = args.size_tag,
        baseline = rss_baseline,
        after_load = rss_after_load,
        after_query = rss_after_query,
        median = median_ms,
        count = bindings_count
    );
    let needs_header = !args.results.exists();
    let mut out = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&args.results)
        .map_err(|e| anyhow::anyhow!("open results {:?}: {e}", args.results))?;
    if needs_header {
        out.write_all(
            b"label,backend,size_tag,rss_baseline_kb,rss_after_load_kb,rss_after_query_kb,median_ms,bindings\n",
        )?;
    }
    out.write_all(row.as_bytes())?;
    println!(
        "label={label} backend={backend:?} size={size_tag} rss_after_load={after_load} KiB rss_after_query={after_query} KiB median={median:.2} ms bindings={count}",
        label = args.label,
        backend = args.backend,
        size_tag = args.size_tag,
        after_load = rss_after_load,
        after_query = rss_after_query,
        median = median_ms,
        count = bindings_count
    );
    Ok(())
}

fn median_of(xs: &[f64]) -> f64 {
    if xs.is_empty() {
        return f64::NAN;
    }
    let mut s = xs.to_vec();
    s.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = s.len();
    if n % 2 == 1 {
        s[n / 2]
    } else {
        0.5 * (s[n / 2 - 1] + s[n / 2])
    }
}

async fn run_bench_sql(args: BenchSqlArgs) -> anyhow::Result<()> {
    let queries = discover_queries(&args.queries_dir, &args.only)
        .map_err(|e| anyhow::anyhow!(e))?;
    if queries.is_empty() {
        anyhow::bail!(
            "no queries found in {:?} (need subdirs containing ocpq-tree.json)",
            args.queries_dir
        );
    }

    if args.backend == ExecBackend::Inmem {
        return run_bench_inmem(args, queries).await;
    }

    let database = match args.backend {
        ExecBackend::Sqlite => DatabaseType::SQLite,
        ExecBackend::Postgres => DatabaseType::PostgreSQL,
        ExecBackend::Duckdb => DatabaseType::DuckDB,
        ExecBackend::Inmem => unreachable!(),
    };

    let conn_str = args
        .connection
        .clone()
        .ok_or_else(|| anyhow::anyhow!("--connection required for {:?} backend", args.backend))?;

    println!("[id-native] skipping OCEL load; subset OCEL built per query from the streamed ocel_ids");

    let backend_conn = match args.backend {
        ExecBackend::Sqlite | ExecBackend::Postgres => {
            let ds = DataSource::new_any_without_discovery(
                format!("ocpq-bench-{:?}", args.backend),
                conn_str.clone(),
            )
            .await
            .map_err(|e| anyhow::anyhow!("connect to {}: {e}", conn_str))?;
            BackendConn::Dbcon(ds)
        }
        ExecBackend::Duckdb => {
            // Strip an optional `duckdb:` scheme prefix so users can either
            // pass a raw filesystem path or a URL-like string.
            let path = conn_str
                .strip_prefix("duckdb:")
                .unwrap_or(&conn_str);
            let conn = duckdb::Connection::open(path)
                .map_err(|e| anyhow::anyhow!("open duckdb {path}: {e}"))?;
            BackendConn::DuckDb(conn)
        }
        ExecBackend::Inmem => unreachable!(),
    };

    let mappings = match &args.mappings {
        None => derive_process_mining_mappings(&backend_conn).await?,
        Some(p) => {
            let content = fs::read_to_string(p)
                .map_err(|e| anyhow::anyhow!("read mappings {p:?}: {e}"))?;
            serde_json::from_str(&content)
                .map_err(|e| anyhow::anyhow!("parse mappings JSON: {e}"))?
        }
    };

    // Install Mode-B views (if any) declared in the mappings file. The
    // `views` field is a list of CREATE-OR-REPLACE-VIEW DDL strings; each
    // runs against the connected backend before queries start. Empty for
    // the normalized OCEL-2.0 case.
    if !mappings.views.is_empty() {
        println!("[install_views] installing {} view(s)", mappings.views.len());
        install_mapping_views(&mappings, &backend_conn).await?;
    }

    let mut results_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&args.results)
        .map_err(|e| anyhow::anyhow!("open results file {:?}: {e}", args.results))?;

    println!(
        "\nBenchSql: label={} backend={:?} runs={} warmup={} queries={}",
        args.label,
        args.backend,
        args.runs,
        args.warmup,
        queries.len()
    );
    println!(
        "{:<8} {:>10} {:>10} {:>10} {:>10} {:>10} {:>10}",
        "query", "mean(ms)", "median", "min", "max", "stddev", "bindings"
    );
    println!("{:-<74}", "");

    for (qname, qdir) in &queries {
        let tree_path = qdir.join("ocpq-tree.json");
        let tree_str = fs::read_to_string(&tree_path)
            .map_err(|e| anyhow::anyhow!("read {:?}: {e}", tree_path))?;
        let tree: BindingBoxTree = serde_json::from_str(&tree_str)
            .map_err(|e| anyhow::anyhow!("parse {:?}: {e}", tree_path))?;

        if let Err(errs) = validate_translatable(&tree) {
            let msg: Vec<String> = errs.iter().map(|e| e.to_string()).collect();
            anyhow::bail!(
                "query {qname}: cannot translate to SQL:\n  {}",
                msg.join("\n  ")
            );
        }

        let mappings_clone = mappings.clone();
        let run_once = || async {
            let input = DBTranslationInput {
                tree: tree.clone(),
                database,
                table_mappings: mappings_clone.clone(),
            };
            let count: usize = match &backend_conn {
                BackendConn::Dbcon(ds) => {
                    ocpq_shared::db_translation::sql_executor_id::execute_translated_query_id(
                        input, ds,
                    )
                    .await?
                    .len()
                }
                BackendConn::DuckDb(c) => {
                    ocpq_shared::db_translation::sql_executor_id::execute_translated_query_id_duckdb(
                        input, c,
                    )
                    .await?
                    .len()
                }
            };
            Ok::<usize, anyhow::Error>(count)
        };

        let timeout_dur = args.per_iter_timeout_secs.map(std::time::Duration::from_secs);
        let mut warmup_timed_out = false;
        let mut dummy = 0usize;
        for _ in 0..args.warmup {
            let res = match timeout_dur {
                Some(d) => match tokio::time::timeout(d, run_once()).await {
                    Ok(r) => r,
                    Err(_) => {
                        warmup_timed_out = true;
                        break;
                    }
                },
                None => run_once().await,
            };
            dummy = res?;
        }
        let _ = dummy;

        let ts = DateTime::<Utc>::from(SystemTime::now()).to_rfc3339();
        if warmup_timed_out {
            // Skip the timed loop entirely; log a single timeout marker.
            // `duration_ms` is null because the true wall-clock is
            // unknown: the iteration was killed mid-flight; the
            // true value is >= timeout_secs.
            let row = serde_json::json!({
                "label": args.label,
                "query": qname,
                "run": -1,
                "duration_ms": serde_json::Value::Null,
                "bindings": 0,
                "backend": format!("{:?}", args.backend),
                "ts": ts,
                "mode": "sql_exec",
                "error": "timeout_warmup",
                "timeout_secs": timeout_dur.unwrap().as_secs(),
            });
            writeln!(results_file, "{}", serde_json::to_string(&row).unwrap())
                .map_err(|e| anyhow::anyhow!("write result row: {e}"))?;
            println!("{:<8} {:>54}  (warmup timeout, skipped)", qname, "");
            continue;
        }

        let mut durations_ms = Vec::with_capacity(args.runs);
        let mut binding_count = 0usize;
        let mut timed_out = false;
        for run in 0..args.runs {
            let start = Instant::now();
            let res = match timeout_dur {
                Some(d) => match tokio::time::timeout(d, run_once()).await {
                    Ok(r) => r,
                    Err(_) => {
                        timed_out = true;
                        // duration_ms is null, true wall-clock unknown
                        // (killed mid-flight; >= timeout_secs).
                        let row = serde_json::json!({
                            "label": args.label,
                            "query": qname,
                            "run": run,
                            "duration_ms": serde_json::Value::Null,
                            "bindings": binding_count,
                            "backend": format!("{:?}", args.backend),
                            "ts": ts,
                            "mode": "sql_exec",
                            "error": "timeout",
                            "timeout_secs": d.as_secs(),
                        });
                        writeln!(results_file, "{}", serde_json::to_string(&row).unwrap())
                            .map_err(|e| anyhow::anyhow!("write result row: {e}"))?;
                        break;
                    }
                },
                None => run_once().await,
            };
            let n = res?;
            let dur_ms = start.elapsed().as_secs_f64() * 1000.0;
            durations_ms.push(dur_ms);
            binding_count = n;
            let row = serde_json::json!({
                "label": args.label,
                "query": qname,
                "run": run,
                "duration_ms": dur_ms,
                "bindings": binding_count,
                "backend": format!("{:?}", args.backend),
                "ts": ts,
                "mode": "sql_exec",
            });
            writeln!(results_file, "{}", serde_json::to_string(&row).unwrap())
                .map_err(|e| anyhow::anyhow!("write result row: {e}"))?;
        }

        if durations_ms.is_empty() {
            println!("{:<8} {:>54}  (all iters timed out)", qname, "");
        } else {
            let s = stats(&durations_ms);
            let suffix = if timed_out { " (partial; remaining iters skipped after timeout)" } else { "" };
            println!(
                "{:<8} {:>10.2} {:>10.2} {:>10.2} {:>10.2} {:>10.2} {:>10}{}",
                qname, s.mean, s.median, s.min, s.max, s.stddev, binding_count, suffix
            );
        }
    }
    Ok(())
}

async fn run_bench_inmem(
    args: BenchSqlArgs,
    queries: Vec<(String, PathBuf)>,
) -> anyhow::Result<()> {
    let ocel_path = args
        .ocel
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("--ocel is required for the inmem backend"))?;
    println!("[inmem] loading OCEL from {:?}", ocel_path);
    let locel = SlimLinkedOCEL::import_from_path(ocel_path)
        .map_err(|e| anyhow::anyhow!("import OCEL: {e:?}"))?;

    let mut results_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&args.results)
        .map_err(|e| anyhow::anyhow!("open results file {:?}: {e}", args.results))?;

    println!(
        "\nBenchSql: label={} backend=Inmem runs={} warmup={} queries={}",
        args.label, args.runs, args.warmup, queries.len()
    );
    println!(
        "{:<8} {:>10} {:>10} {:>10} {:>10} {:>10} {:>10}",
        "query", "mean(ms)", "median", "min", "max", "stddev", "bindings"
    );
    println!("{:-<74}", "");

    for (qname, qdir) in &queries {
        let tree_path = qdir.join("ocpq-tree.json");
        let tree_str = fs::read_to_string(&tree_path)
            .map_err(|e| anyhow::anyhow!("read {:?}: {e}", tree_path))?;
        let tree: BindingBoxTree = serde_json::from_str(&tree_str)
            .map_err(|e| anyhow::anyhow!("parse {:?}: {e}", tree_path))?;

        for _ in 0..args.warmup {
            let _ = tree.evaluate(&locel)
                .map_err(|e| anyhow::anyhow!("inmem evaluate warmup: {e}"))?;
        }

        let mut durations_ms = Vec::with_capacity(args.runs);
        let mut binding_count = 0usize;
        let ts = DateTime::<Utc>::from(SystemTime::now()).to_rfc3339();
        for run in 0..args.runs {
            let start = Instant::now();
            let (results, _) = tree.evaluate(&locel)
                .map_err(|e| anyhow::anyhow!("inmem evaluate: {e}"))?;
            let dur_ms = start.elapsed().as_secs_f64() * 1000.0;
            durations_ms.push(dur_ms);
            // Count all root bindings (including violated). Per OCPQ
            // constraint semantics, a constraint LABELS bindings as
            // satisfied/violated rather than dropping the violated ones;
            // both are part of the result set.
            binding_count = results
                .iter()
                .filter(|(node_idx, _, _)| *node_idx == 0)
                .count();
            let row = serde_json::json!({
                "label": args.label,
                "query": qname,
                "run": run,
                "duration_ms": dur_ms,
                "bindings": binding_count,
                "backend": "Inmem",
                "ts": ts,
                "mode": "inmem_exec",
            });
            writeln!(results_file, "{}", serde_json::to_string(&row).unwrap())
                .map_err(|e| anyhow::anyhow!("write result row: {e}"))?;
        }

        let s = stats(&durations_ms);
        println!(
            "{:<8} {:>10.2} {:>10.2} {:>10.2} {:>10.2} {:>10.2} {:>10}",
            qname, s.mean, s.median, s.min, s.max, s.stddev, binding_count
        );
    }
    Ok(())
}

// Equality oracle (sorted-vec byte compare): see
// `ocpq_shared::db_translation::corpus::normalize_binding` /
// `normalized_binding_set` / `compare_binding_sets_exact`. Replaces the prior
// per-binding String-formatted normalized key (HashSet<String>); the new oracle
// is deterministic, O(n log n), and avoids any probabilistic hashing.

/// Derive a `process_mining`-default table mapping (per-type tables named
/// `event_<T>` / `object_<T>`) from the connected backend by reading the
/// `event_map_type` + `object_map_type` lookup tables that the OCEL 2.0 SQL
/// exporter always populates. This matches the schema produced by OCPQ's
/// `export-sqlite` / `export-duckdb` subcommands and by the
/// `eval/migrate_sqlite_to_postgres.py` script. When `--mappings` is supplied
/// the user override wins; this is only the default fallback.
/// Run each DDL string in `mappings.views` against the backend. Used by
/// `bench-sql` to install the Mode-B view layer declared in a JSON
/// mappings file before queries start. `for_each_row_sql` is used as
/// the dbcon execution primitive (DDL returns zero rows; the handler
/// closure is never called). DuckDB uses `execute_batch` directly.
async fn install_mapping_views(
    mappings: &TableMappings,
    backend: &BackendConn,
) -> anyhow::Result<()> {
    for (name, ddl) in &mappings.views {
        match backend {
            BackendConn::Dbcon(ds) => {
                ds.for_each_row_sql(ddl, |_| {})
                    .await
                    .map_err(|e| anyhow::anyhow!("install view {name:?}: {e}"))?;
            }
            BackendConn::DuckDb(c) => {
                c.execute_batch(ddl)
                    .map_err(|e| anyhow::anyhow!("install view {name:?}: {e}"))?;
            }
        }
    }
    Ok(())
}

async fn derive_process_mining_mappings(
    backend: &BackendConn,
) -> anyhow::Result<TableMappings> {
    let (event_types, object_types) = match backend {
        BackendConn::Dbcon(ds) => derive_types_from_dbcon(ds).await?,
        BackendConn::DuckDb(conn) => derive_types_from_duckdb(conn)?,
    };
    Ok(TableMappings::process_mining_default(event_types, object_types))
}

async fn derive_types_from_dbcon(
    ds: &DataSource,
) -> anyhow::Result<(Vec<String>, Vec<String>)> {
    let ev = ds.get_distinct_values("event_map_type", "ocel_type").await?;
    let ob = ds.get_distinct_values("object_map_type", "ocel_type").await?;
    Ok((ev, ob))
}

fn derive_types_from_duckdb(
    conn: &duckdb::Connection,
) -> anyhow::Result<(Vec<String>, Vec<String>)> {
    let mut stmt = conn
        .prepare("SELECT DISTINCT ocel_type FROM event_map_type")
        .map_err(|e| anyhow::anyhow!("query event_map_type: {e}"))?;
    let ev: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| anyhow::anyhow!("query event_map_type rows: {e}"))?
        .filter_map(|r| r.ok())
        .collect();
    let mut stmt = conn
        .prepare("SELECT DISTINCT ocel_type FROM object_map_type")
        .map_err(|e| anyhow::anyhow!("query object_map_type: {e}"))?;
    let ob: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| anyhow::anyhow!("query object_map_type rows: {e}"))?
        .filter_map(|r| r.ok())
        .collect();
    Ok((ev, ob))
}

fn process_mining_mappings_from_duckdb(
    conn: &duckdb::Connection,
) -> anyhow::Result<TableMappings> {
    let (ev, ob) = derive_types_from_duckdb(conn)?;
    Ok(TableMappings::process_mining_default(ev, ob))
}

async fn process_mining_mappings_from_dbcon(
    ds: &DataSource,
) -> anyhow::Result<TableMappings> {
    let (ev, ob) = derive_types_from_dbcon(ds).await?;
    Ok(TableMappings::process_mining_default(ev, ob))
}

/// Maximum nesting depth of `SELECT` keywords inside parenthesised
/// subqueries. A rough proxy for SQL complexity. Counts open parens on the
/// nesting stack while a `SELECT` token is in scope; returns the maximum.
fn max_select_nesting_depth(sql: &str) -> usize {
    let bytes = sql.as_bytes();
    let mut max_depth = 0usize;
    let mut depth = 0usize;
    let mut i = 0usize;
    while i < bytes.len() {
        let c = bytes[i];
        match c {
            b'(' => {
                depth += 1;
                if depth > max_depth {
                    max_depth = depth;
                }
            }
            b')' => {
                depth = depth.saturating_sub(1);
            }
            _ => {}
        }
        i += 1;
    }
    // Approximate: report max paren nesting; nearly all parens in our emitted
    // SQL are subqueries (no expression-grouping parens in the boolean fragments
    // beyond CASE/WHERE constants).
    max_depth
}

/// Counts pushdown vs post-processing predicates across the whole tree.
/// Returns `(pushdown, post_processing)`.
fn predicate_counts(tree: &BindingBoxTree) -> (usize, usize) {
    use ocpq_shared::binding_box::structs::{
        BindingBoxTreeNode, Filter as F, SizeFilter as SF,
    };
    let mut pushdown = 0usize;
    let mut post = 0usize;
    for node in &tree.nodes {
        if let BindingBoxTreeNode::Box(b, _) = node {
            for f in &b.filters {
                match f {
                    F::O2E { .. }
                    | F::O2O { .. }
                    | F::TimeBetweenEvents { .. }
                    | F::EventAttributeValueFilter { .. }
                    | F::ObjectAttributeValueFilter { .. }
                    | F::NotEqual { .. } => pushdown += 1,
                    F::BasicFilterCEL { .. } => post += 1,
                }
            }
            for sf in &b.size_filters {
                match sf {
                    SF::NumChilds { .. }
                    | SF::NumChildsProj { .. }
                    | SF::BindingSetEqual { .. }
                    | SF::BindingSetProjectionEqual { .. } => pushdown += 1,
                    SF::AdvancedCEL { .. } => post += 1,
                }
            }
            // Constraint-slot composition counted as pushdown (emitted as
            // boolean combinations of EXISTS subqueries).
            for _c in &b.constraints {
                pushdown += 1;
            }
        }
    }
    (pushdown, post)
}

async fn run_bench_corpus(args: BenchCorpusArgs) -> anyhow::Result<()> {
    let schemas = builtin_schemas();
    let schema: CorpusSchema = schemas
        .into_iter()
        .find(|s| s.dataset_name == args.schema)
        .ok_or_else(|| {
            anyhow::anyhow!(
                "unknown schema {:?}; expected one of bpic2017, order-management, container-logistics",
                args.schema
            )
        })?;

    let bounds = CorpusBounds {
        max_events: args.max_events,
        max_objects: args.max_objects,
        max_depth: args.max_depth,
        max_var_sum: args.max_var_sum,
        ..CorpusBounds::default()
    };

    println!("Loading OCEL from {:?}", args.ocel);
    let load_start = Instant::now();
    let ocel = OCEL::import_from_path(&args.ocel)
        .map_err(|e| anyhow::anyhow!("import OCEL: {e:?}"))?;
    println!("  imported in {:.2?}", load_start.elapsed());
    let link_start = Instant::now();
    let locel = SlimLinkedOCEL::from_ocel(ocel);
    println!("  linked in {:.2?}", link_start.elapsed());

    // Discover type-level E2O / O2O connectivity from the loaded OCEL: same
    // support counts the OCPQ frontend reads when offering predicates.
    let info: OCELInfo = (&locel).into();
    let corpus = generate_corpus(&schema, &bounds, &info);
    println!(
        "Generated corpus: schema={} trees={} (bounds: events<={}, objects<={}, depth<={}, var_sum={:?})",
        schema.dataset_name,
        corpus.len(),
        bounds.max_events,
        bounds.max_objects,
        bounds.max_depth,
        bounds.max_var_sum,
    );

    if args.count_only {
        use std::collections::BTreeMap;
        let mut by_shape: BTreeMap<(usize, usize, usize), usize> = BTreeMap::new();
        for entry in &corpus {
            let key = (entry.tag.n_events, entry.tag.n_objects, entry.tag.depth);
            *by_shape.entry(key).or_insert(0) += 1;
        }
        println!("\nBreakdown (n_e, n_o, depth) -> trees:");
        for ((ne, no, dep), n) in &by_shape {
            println!("  ({ne}, {no}, depth={dep}): {n}");
        }
        println!("\nTotal: {} trees", corpus.len());
        return Ok(());
    }

    println!("Opening DuckDB at {:?}", args.duckdb);
    let duckdb_conn = duckdb::Connection::open(&args.duckdb)
        .map_err(|e| anyhow::anyhow!("open duckdb {:?}: {e}", args.duckdb))?;

    let postgres_ds: Option<DataSource> = if let Some(conn) = &args.postgres_connection {
        println!("Opening PostgreSQL at {}", conn);
        Some(
            DataSource::new_any_without_discovery("ocpq-bench-corpus".to_string(), conn.clone())
                .await
                .map_err(|e| anyhow::anyhow!("connect to postgres: {e}"))?,
        )
    } else {
        None
    };
    let sqlite_ds: Option<DataSource> = if let Some(conn) = &args.sqlite_connection {
        println!("Opening SQLite at {}", conn);
        Some(
            DataSource::new_any_without_discovery(
                "ocpq-bench-corpus-sqlite".to_string(),
                conn.clone(),
            )
            .await
            .map_err(|e| anyhow::anyhow!("connect to sqlite: {e}"))?,
        )
    } else {
        None
    };

    let mappings = process_mining_mappings_from_duckdb(&duckdb_conn)?;

    let mut results_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&args.results)
        .map_err(|e| anyhow::anyhow!("open results file {:?}: {e}", args.results))?;

    let mut translatable_ok = 0usize;
    let mut rejected = 0usize;
    let mut agree = 0usize;
    let mut disagree = 0usize;
    let mut sql_errors = 0usize;
    let mut set_checks = 0usize;
    let mut set_agree = 0usize;
    let mut set_disagree = 0usize;

    let mut both_empty = 0usize;

    println!(
        "{:<6} {:>4} {:>4} {:>4} {:>5} {:>5} {:>5} {:>9} {:>9} {:>9}",
        "tree", "n_e", "n_o", "dep", "o2o", "tbe", "cel", "inmem", "duckdb", "agree"
    );
    println!("{:-<70}", "");

    let ts_run = DateTime::<Utc>::from(SystemTime::now()).to_rfc3339();
    for (idx, entry) in corpus.iter().enumerate() {
        let tag = &entry.tag;
        let tree = entry.tree.clone();

        // validate translatability.
        let mut translatable = true;
        let mut reject_msg: Option<String> = None;
        if let Err(errs) = validate_translatable(&tree) {
            translatable = false;
            let m: Vec<String> = errs.iter().map(|e| e.to_string()).collect();
            reject_msg = Some(m.join("; "));
            rejected += 1;
        }

        // in-mem evaluation (always; serves as oracle).
        // Normalized binding set is computed on every tree; set-equality
        // is the only oracle (count-equality follows from it).
        let inmem_start = Instant::now();
        let inmem_eval = tree.evaluate(&locel);
        let inmem_ms = inmem_start.elapsed().as_secs_f64() * 1000.0;
        let (inmem_count, inmem_set): (Option<usize>, Option<Vec<NormalizedBinding>>) =
            match &inmem_eval {
                Ok((results, _)) => {
                    let roots: Vec<(&std::sync::Arc<Binding>, Option<&_>)> = results
                        .iter()
                        .filter(|(node_idx, _, _)| *node_idx == 0)
                        .map(|(_, b, v)| (b, v.as_ref()))
                        .collect();
                    let cnt = roots.iter().filter(|(_, v)| v.is_none()).count();
                    let set = Some(normalized_binding_set(
                        roots.iter().map(|(arc, v)| (arc.as_ref(), *v)),
                        &locel,
                    ));
                    (Some(cnt), set)
                }
                Err(_) => (None, None),
            };

        // translation metrics (RQ3 / RQ5).
        let (translation_ms, sql_chars, sql_inner_join_count, sql_nested_select_depth):
            (Option<f64>, Option<usize>, Option<usize>, Option<usize>) = if translatable {
            let start = Instant::now();
            let sql = ocpq_shared::db_translation::translate_to_sql_shared(DBTranslationInput {
                tree: tree.clone(),
                database: DatabaseType::DuckDB,
                table_mappings: mappings.clone(),
            });
            let ms = start.elapsed().as_secs_f64() * 1000.0;
            let chars = sql.len();
            let join_count = sql.matches("INNER JOIN").count();
            let nested = max_select_nesting_depth(&sql);
            (Some(ms), Some(chars), Some(join_count), Some(nested))
        } else {
            (None, None, None, None)
        };

        // predicate counts (pushdown ratio, RQ4).
        let pred_counts = predicate_counts(&tree);

        // DuckDB evaluation via the id-native path (no
        // SlimLinkedOCEL allocation on the SQL backend; normalized
        // bindings derived from BindingId ocel_ids).
        let mut duckdb_count: Option<usize> = None;
        let mut duckdb_set: Option<Vec<NormalizedBinding>> = None;
        let mut duckdb_ms: f64 = 0.0;
        let mut duckdb_err: Option<String> = None;
        if translatable {
            translatable_ok += 1;
            let input = DBTranslationInput {
                tree: tree.clone(),
                database: DatabaseType::DuckDB,
                table_mappings: mappings.clone(),
            };
            let start = Instant::now();
            let timeout = std::time::Duration::from_secs(args.sql_timeout_secs);
            match tokio::time::timeout(
                timeout,
                ocpq_shared::db_translation::sql_executor_id::execute_translated_query_id_duckdb(
                    input,
                    &duckdb_conn,
                ),
            )
            .await
            {
                Ok(Ok(bindings)) => {
                    duckdb_ms = start.elapsed().as_secs_f64() * 1000.0;
                    duckdb_count = Some(bindings.len());
                    duckdb_set = Some(
                        ocpq_shared::db_translation::corpus::normalized_binding_set_id(
                            bindings.iter().map(|(b, v)| (b, v.as_ref())),
                        ),
                    );
                }
                Ok(Err(e)) => {
                    duckdb_ms = start.elapsed().as_secs_f64() * 1000.0;
                    duckdb_err = Some(format!("{e}"));
                    sql_errors += 1;
                }
                Err(_) => {
                    duckdb_ms = start.elapsed().as_secs_f64() * 1000.0;
                    duckdb_err = Some("timeout".to_string());
                    sql_errors += 1;
                }
            }
        }

        // PostgreSQL evaluation iff requested.
        let mut postgres_count: Option<usize> = None;
        let mut postgres_set: Option<Vec<NormalizedBinding>> = None;
        let mut postgres_ms: f64 = 0.0;
        let mut postgres_err: Option<String> = None;
        if translatable {
            if let Some(ds) = &postgres_ds {
                let input = DBTranslationInput {
                    tree: tree.clone(),
                    database: DatabaseType::PostgreSQL,
                    table_mappings: mappings.clone(),
                };
                let start = Instant::now();
                let timeout = std::time::Duration::from_secs(args.sql_timeout_secs);
                match tokio::time::timeout(
                    timeout,
                    ocpq_shared::db_translation::sql_executor_id::execute_translated_query_id(
                        input, ds,
                    ),
                )
                .await
                {
                    Ok(Ok(bindings)) => {
                        postgres_ms = start.elapsed().as_secs_f64() * 1000.0;
                        postgres_count = Some(bindings.len());
                        postgres_set = Some(
                            ocpq_shared::db_translation::corpus::normalized_binding_set_id(
                                bindings.iter().map(|(b, v)| (b, v.as_ref())),
                            ),
                        );
                    }
                    Ok(Err(e)) => {
                        postgres_ms = start.elapsed().as_secs_f64() * 1000.0;
                        postgres_err = Some(format!("{e}"));
                    }
                    Err(_) => {
                        postgres_ms = start.elapsed().as_secs_f64() * 1000.0;
                        postgres_err = Some("timeout".to_string());
                    }
                }
            }
        }

        // SQLite evaluation iff requested.
        let mut sqlite_count: Option<usize> = None;
        let mut sqlite_set: Option<Vec<NormalizedBinding>> = None;
        let mut sqlite_ms: f64 = 0.0;
        let mut sqlite_err: Option<String> = None;
        if translatable {
            if let Some(ds) = &sqlite_ds {
                let input = DBTranslationInput {
                    tree: tree.clone(),
                    database: DatabaseType::SQLite,
                    table_mappings: mappings.clone(),
                };
                let start = Instant::now();
                let timeout = std::time::Duration::from_secs(args.sql_timeout_secs);
                match tokio::time::timeout(
                    timeout,
                    ocpq_shared::db_translation::sql_executor_id::execute_translated_query_id(
                        input, ds,
                    ),
                )
                .await
                {
                    Ok(Ok(bindings)) => {
                        sqlite_ms = start.elapsed().as_secs_f64() * 1000.0;
                        sqlite_count = Some(bindings.len());
                        sqlite_set = Some(
                            ocpq_shared::db_translation::corpus::normalized_binding_set_id(
                                bindings.iter().map(|(b, v)| (b, v.as_ref())),
                            ),
                        );
                    }
                    Ok(Err(e)) => {
                        sqlite_ms = start.elapsed().as_secs_f64() * 1000.0;
                        sqlite_err = Some(format!("{e}"));
                    }
                    Err(_) => {
                        sqlite_ms = start.elapsed().as_secs_f64() * 1000.0;
                        sqlite_err = Some("timeout".to_string());
                    }
                }
            }
        }

        // full set-equality matrix. Both engines emit the FULL
        // normalized set (including violators, tagged with `satisfied`);
        // the equality compares the full sets, satisfied flag included.
        let inmem_vs_duckdb: Option<bool> = match (&inmem_set, &duckdb_set) {
            (Some(a), Some(b)) => Some(compare_binding_sets_exact(a, b)),
            _ => None,
        };
        let inmem_vs_postgres: Option<bool> = match (&inmem_set, &postgres_set) {
            (Some(a), Some(b)) => Some(compare_binding_sets_exact(a, b)),
            _ => None,
        };
        let inmem_vs_sqlite: Option<bool> = match (&inmem_set, &sqlite_set) {
            (Some(a), Some(b)) => Some(compare_binding_sets_exact(a, b)),
            _ => None,
        };
        let duckdb_vs_postgres: Option<bool> = match (&duckdb_set, &postgres_set) {
            (Some(a), Some(b)) => Some(compare_binding_sets_exact(a, b)),
            _ => None,
        };

        // Legacy aggregate counters (set_agreement was duckdb vs in-mem only).
        let set_agreement = inmem_vs_duckdb;
        match set_agreement {
            Some(true) => {
                set_checks += 1;
                set_agree += 1;
            }
            Some(false) => {
                set_checks += 1;
                set_disagree += 1;
            }
            None => {}
        }

        // count agreement (kept for backwards-compat in the
        // JSONL; the set-equality matrix is the new oracle).
        let agreement: Option<bool> = match (inmem_count, duckdb_count) {
            (Some(a), Some(b)) => Some(a == b),
            _ => None,
        };
        match agreement {
            Some(true) => agree += 1,
            Some(false) => disagree += 1,
            None => {}
        }
        if matches!((inmem_count, duckdb_count), (Some(0), Some(0))) {
            both_empty += 1;
        }
        let both_empty_flag = matches!((inmem_count, duckdb_count), (Some(0), Some(0)));

        // On any disagreement, dump both normalized sets to a sidecar file
        // so the author can diff offline. Only fires when both engines
        // produced bindings (not when one errored).
        let mut disagreement_dump: Option<PathBuf> = None;
        let disagreed = inmem_vs_duckdb == Some(false)
            || inmem_vs_postgres == Some(false)
            || inmem_vs_sqlite == Some(false)
            || duckdb_vs_postgres == Some(false);
        if disagreed {
            let sidecar = args
                .results
                .parent()
                .unwrap_or(std::path::Path::new("."))
                .join(format!("disagreement_tree_{}.json", idx));
            let dump = serde_json::json!({
                "tree_idx": idx,
                "tree_json": &tree,
                "inmem_set": &inmem_set,
                "duckdb_set": &duckdb_set,
                "postgres_set": &postgres_set,
                "sqlite_set": &sqlite_set,
                "inmem_vs_duckdb": inmem_vs_duckdb,
                "inmem_vs_postgres": inmem_vs_postgres,
                "inmem_vs_sqlite": inmem_vs_sqlite,
                "duckdb_vs_postgres": duckdb_vs_postgres,
            });
            if let Err(e) = fs::write(&sidecar, serde_json::to_string_pretty(&dump).unwrap()) {
                eprintln!("warn: failed to write disagreement sidecar {sidecar:?}: {e}");
            }
            disagreement_dump = Some(sidecar);
        }

        let row = serde_json::json!({
            "label": args.label,
            "schema": schema.dataset_name,
            "tree_idx": idx,
            "n_events": tag.n_events,
            "n_objects": tag.n_objects,
            "has_o2o": tag.has_o2o,
            "has_tbe": tag.has_tbe,
            "has_cel": tag.has_cel,
            "has_not_equal": tag.has_not_equal,
            "has_num_childs_proj": tag.has_num_childs_proj,
            "has_adv_cel": tag.has_adv_cel,
            "has_binding_set_eq": tag.has_binding_set_eq,
            "has_binding_set_proj_eq": tag.has_binding_set_proj_eq,
            "has_attribute_filter": tag.has_attribute_filter,
            "has_label": tag.has_label,
            "composition": tag.composition,
            "has_constraint_layered": tag.has_constraint_layered,
            "constraint_layered_at": tag.constraint_layered_at,
            "depth": tag.depth,
            "n_children": tag.n_children,
            "translatable": translatable,
            "reject_msg": reject_msg,
            "inmem_count": inmem_count,
            "duckdb_count": duckdb_count,
            "duckdb_err": duckdb_err,
            "postgres_count": postgres_count,
            "postgres_err": postgres_err,
            "sqlite_count": sqlite_count,
            "sqlite_err": sqlite_err,
            "inmem_ms": inmem_ms,
            "duckdb_ms": duckdb_ms,
            "postgres_ms": postgres_ms,
            "sqlite_ms": sqlite_ms,
            "translation_ms": translation_ms,
            "sql_chars": sql_chars,
            "sql_inner_join_count": sql_inner_join_count,
            "sql_nested_select_depth": sql_nested_select_depth,
            "pushdown_predicates": pred_counts.0,
            "post_processing_predicates": pred_counts.1,
            "total_predicates": pred_counts.0 + pred_counts.1,
            "agreement": agreement,
            "set_agreement": set_agreement,
            "inmem_vs_duckdb": inmem_vs_duckdb,
            "inmem_vs_postgres": inmem_vs_postgres,
            "inmem_vs_sqlite": inmem_vs_sqlite,
            "duckdb_vs_postgres": duckdb_vs_postgres,
            "disagreement_dump": disagreement_dump.as_ref().and_then(|p| p.to_str()),
            "both_empty": both_empty_flag,
            "tree_json": tree,
            "ts": ts_run,
        });
        writeln!(results_file, "{}", serde_json::to_string(&row).unwrap())
            .map_err(|e| anyhow::anyhow!("write result row: {e}"))?;

        let inmem_disp = inmem_count
            .map(|c| c.to_string())
            .unwrap_or_else(|| "err".to_string());
        let duckdb_disp = duckdb_count
            .map(|c| c.to_string())
            .unwrap_or_else(|| {
                if !translatable {
                    "skip".to_string()
                } else {
                    "err".to_string()
                }
            });
        let agree_disp = match agreement {
            Some(true) => "yes".to_string(),
            Some(false) => "NO".to_string(),
            None => "-".to_string(),
        };
        println!(
            "{:<6} {:>4} {:>4} {:>4} {:>5} {:>5} {:>5} {:>9} {:>9} {:>9}",
            idx,
            tag.n_events,
            tag.n_objects,
            tag.depth,
            tag.has_o2o,
            tag.has_tbe,
            tag.has_cel,
            inmem_disp,
            duckdb_disp,
            agree_disp,
        );
    }

    println!("{:-<70}", "");
    println!(
        "Summary: {} trees | translatable={} rejected={} | agree={} disagree={} sql_err={} both_empty={}",
        corpus.len(),
        translatable_ok,
        rejected,
        agree,
        disagree,
        sql_errors,
        both_empty
    );
    println!(
        "Non-empty agreement: {} / {}",
        agree.saturating_sub(both_empty),
        corpus.len().saturating_sub(both_empty)
    );
    if set_checks > 0 {
        println!(
            "Set-equality: checked={} agree={} disagree={}",
            set_checks, set_agree, set_disagree
        );
    }
    Ok(())
}

/// Generate the corpus tree pool for a schema/bounds (same generator that
/// `bench-corpus` uses) and write each tree to a separate JSON file plus an
/// `index.jsonl` carrying the per-tree tag. The sandboxed driver wrapper
/// iterates `index.jsonl` and invokes `eval-tree-once` per row.
fn run_dump_corpus_trees(args: DumpCorpusTreesArgs) -> anyhow::Result<()> {
    let schemas = builtin_schemas();
    let schema: CorpusSchema = schemas
        .into_iter()
        .find(|s| s.dataset_name == args.schema)
        .ok_or_else(|| {
            anyhow::anyhow!(
                "unknown schema {:?}; expected one of bpic2017, order-management, container-logistics",
                args.schema
            )
        })?;
    let bounds = CorpusBounds {
        max_events: args.max_events,
        max_objects: args.max_objects,
        max_depth: args.max_depth,
        ..CorpusBounds::default()
    };

    println!("Loading OCEL from {:?}", args.ocel);
    let ocel = OCEL::import_from_path(&args.ocel)
        .map_err(|e| anyhow::anyhow!("import OCEL: {e:?}"))?;
    let locel = SlimLinkedOCEL::from_ocel(ocel);
    let info: OCELInfo = (&locel).into();
    let corpus = generate_corpus(&schema, &bounds, &info);
    println!(
        "Generated corpus: schema={} trees={} (bounds: events<={}, objects<={}, depth<={})",
        schema.dataset_name,
        corpus.len(),
        bounds.max_events,
        bounds.max_objects,
        bounds.max_depth
    );

    fs::create_dir_all(&args.out_dir)
        .map_err(|e| anyhow::anyhow!("create out_dir {:?}: {e}", args.out_dir))?;
    let index_path = args.out_dir.join("index.jsonl");
    let mut index = File::create(&index_path)
        .map_err(|e| anyhow::anyhow!("create index {:?}: {e}", index_path))?;

    for (idx, entry) in corpus.iter().enumerate() {
        let tree_path = args.out_dir.join(format!("tree_{idx:05}.json"));
        let tree_file = File::create(&tree_path)
            .map_err(|e| anyhow::anyhow!("create tree file {:?}: {e}", tree_path))?;
        serde_json::to_writer(BufWriter::new(tree_file), &entry.tree)
            .map_err(|e| anyhow::anyhow!("write tree {:?}: {e}", tree_path))?;

        let tag_path = args.out_dir.join(format!("tree_{idx:05}.tag.json"));
        let tag_file = File::create(&tag_path)
            .map_err(|e| anyhow::anyhow!("create tag file {:?}: {e}", tag_path))?;
        serde_json::to_writer(BufWriter::new(tag_file), &entry.tag)
            .map_err(|e| anyhow::anyhow!("write tag {:?}: {e}", tag_path))?;

        let row = serde_json::json!({
            "tree_id": idx,
            "schema": schema.dataset_name,
            "tree_file": tree_path.file_name().and_then(|s| s.to_str()).unwrap_or(""),
            "tag_file": tag_path.file_name().and_then(|s| s.to_str()).unwrap_or(""),
            "tag": &entry.tag,
        });
        writeln!(index, "{}", serde_json::to_string(&row).unwrap())
            .map_err(|e| anyhow::anyhow!("write index row: {e}"))?;
    }
    println!(
        "Dumped {} trees to {:?} (index: {:?})",
        corpus.len(),
        args.out_dir,
        index_path
    );
    Ok(())
}

/// Evaluate ONE tree against both engines (in-memory + DuckDB) and append a
/// single JSONL row to `args.out`. Designed to be run under a per-process
/// memory cap (`systemd-run --scope -p MemoryMax=...`) by the sandboxed
/// driver wrapper. The row schema matches `bench-corpus` so that the existing
/// summary tooling reads both interchangeably.
async fn run_eval_tree_once(args: EvalTreeOnceArgs) -> anyhow::Result<()> {
    let tree_content = fs::read_to_string(&args.tree)
        .map_err(|e| anyhow::anyhow!("read tree {:?}: {e}", args.tree))?;
    let tree: BindingBoxTree = serde_json::from_str(&tree_content)
        .map_err(|e| anyhow::anyhow!("parse tree JSON: {e}"))?;

    // Optional sidecar tag (written by `dump-corpus-trees`). Falls back to
    // serde_json::Value::Null if absent so the JSONL row still validates.
    let tag_value: serde_json::Value = match &args.tag {
        Some(p) => {
            let s = fs::read_to_string(p)
                .map_err(|e| anyhow::anyhow!("read tag {:?}: {e}", p))?;
            serde_json::from_str(&s)
                .map_err(|e| anyhow::anyhow!("parse tag {:?}: {e}", p))?
        }
        None => serde_json::Value::Null,
    };
    let tag_get = |k: &str| -> serde_json::Value {
        tag_value
            .get(k)
            .cloned()
            .unwrap_or(serde_json::Value::Null)
    };

    eprintln!("[eval-tree-once] tree_id={} loading OCEL {:?}", args.tree_id, args.ocel);
    let ocel = OCEL::import_from_path(&args.ocel)
        .map_err(|e| anyhow::anyhow!("import OCEL: {e:?}"))?;
    let locel = SlimLinkedOCEL::from_ocel(ocel);
    eprintln!("[eval-tree-once] tree_id={} opening DuckDB {:?}", args.tree_id, args.duckdb);
    let duckdb_conn = duckdb::Connection::open(&args.duckdb)
        .map_err(|e| anyhow::anyhow!("open duckdb {:?}: {e}", args.duckdb))?;
    let mappings = process_mining_mappings_from_duckdb(&duckdb_conn)?;

    // validate translatability.
    let mut translatable = true;
    let mut reject_msg: Option<String> = None;
    if let Err(errs) = validate_translatable(&tree) {
        translatable = false;
        let m: Vec<String> = errs.iter().map(|e| e.to_string()).collect();
        reject_msg = Some(m.join("; "));
    }

    // in-memory evaluation.
    let inmem_start = Instant::now();
    let inmem_eval = tree.evaluate(&locel);
    let inmem_ms = inmem_start.elapsed().as_secs_f64() * 1000.0;
    let (inmem_count, inmem_set): (Option<usize>, Option<Vec<NormalizedBinding>>) =
        match &inmem_eval {
            Ok((results, _)) => {
                // Pass ALL root bindings (including constraint-violators)
                // through normalization so the `satisfied` flag in
                // `NormalizedBinding` reflects the engine's per-binding
                // `ViolationReason`. Cross-engine comparison includes the
                // satisfied flag in the equality (both engines emit full
                // normalized sets after the constraint-as-label fix).
                let roots: Vec<(&std::sync::Arc<Binding>, Option<&_>)> = results
                    .iter()
                    .filter(|(node_idx, _, _)| *node_idx == 0)
                    .map(|(_, b, v)| (b, v.as_ref()))
                    .collect();
                // Cardinality reported = ALL root bindings (satisfied +
                // violators). The SQL backends now expose per-binding
                // `ViolationReason` so cell-to-cell comparison against
                // duckdb_count / sqlite_count / postgres_count covers the
                // full root set.
                let cnt = roots.len();
                let set = if !args.no_set_check {
                    Some(normalized_binding_set(
                        roots.iter().map(|(arc, v)| (arc.as_ref(), *v)),
                        &locel,
                    ))
                } else {
                    None
                };
                (Some(cnt), set)
            }
            Err(_) => (None, None),
        };

    // translation metrics.
    let (translation_ms, sql_chars, sql_inner_join_count, sql_nested_select_depth):
        (Option<f64>, Option<usize>, Option<usize>, Option<usize>) = if translatable {
        let start = Instant::now();
        let sql = ocpq_shared::db_translation::translate_to_sql_shared(DBTranslationInput {
            tree: tree.clone(),
            database: DatabaseType::DuckDB,
            table_mappings: mappings.clone(),
        });
        let ms = start.elapsed().as_secs_f64() * 1000.0;
        let chars = sql.len();
        let join_count = sql.matches("INNER JOIN").count();
        let nested = max_select_nesting_depth(&sql);
        (Some(ms), Some(chars), Some(join_count), Some(nested))
    } else {
        (None, None, None, None)
    };
    let pred_counts = predicate_counts(&tree);

    // DuckDB evaluation iff translatable.
    let mut duckdb_count: Option<usize> = None;
    let mut duckdb_set: Option<Vec<NormalizedBinding>> = None;
    let mut duckdb_ms: f64 = 0.0;
    let mut duckdb_err: Option<String> = None;
    if translatable {
        let input = DBTranslationInput {
            tree: tree.clone(),
            database: DatabaseType::DuckDB,
            table_mappings: mappings.clone(),
        };
        let start = Instant::now();
        match ocpq_shared::db_translation::sql_executor_id::execute_translated_query_id_duckdb(
            input,
            &duckdb_conn,
        )
        .await
        {
            Ok(bindings) => {
                duckdb_ms = start.elapsed().as_secs_f64() * 1000.0;
                duckdb_count = Some(bindings.len());
                if !args.no_set_check {
                    duckdb_set = Some(
                        ocpq_shared::db_translation::corpus::normalized_binding_set_id(
                            bindings.iter().map(|(b, v)| (b, v.as_ref())),
                        ),
                    );
                }
            }
            Err(e) => {
                duckdb_ms = start.elapsed().as_secs_f64() * 1000.0;
                duckdb_err = Some(format!("{e}"));
            }
        }
    }

    // optional SQLite + PostgreSQL evaluation iff translatable + flag set.
    let (sqlite_count, sqlite_ms, sqlite_err, sqlite_set) = if translatable {
        if let Some(conn_str) = args.sqlite_connection.as_ref() {
            run_id_native_against_dbcon(
                &tree,
                DatabaseType::SQLite,
                conn_str,
                args.no_set_check,
            )
            .await
        } else {
            (None, 0.0, None, None)
        }
    } else {
        (None, 0.0, None, None)
    };
    let (postgres_count, postgres_ms, postgres_err, postgres_set) = if translatable {
        if let Some(conn_str) = args.postgres_connection.as_ref() {
            run_id_native_against_dbcon(
                &tree,
                DatabaseType::PostgreSQL,
                conn_str,
                args.no_set_check,
            )
            .await
        } else {
            (None, 0.0, None, None)
        }
    } else {
        (None, 0.0, None, None)
    };

    // Both in-mem and SQL normalized sets now carry ALL root bindings tagged
    // with `satisfied`. Compare full sets directly for strict (vars + labels
    // + satisfaction status) equality.
    let set_agreement_duckdb: Option<bool> = match (&inmem_set, &duckdb_set) {
        (Some(a), Some(b)) => Some(compare_binding_sets_exact(a, b)),
        _ => None,
    };
    let set_agreement_sqlite: Option<bool> = match (&inmem_set, &sqlite_set) {
        (Some(a), Some(b)) => Some(compare_binding_sets_exact(a, b)),
        _ => None,
    };
    let set_agreement_postgres: Option<bool> = match (&inmem_set, &postgres_set) {
        (Some(a), Some(b)) => Some(compare_binding_sets_exact(a, b)),
        _ => None,
    };
    let all_engines_agree: Option<bool> = {
        let parts = [
            set_agreement_duckdb,
            if args.sqlite_connection.is_some() { set_agreement_sqlite } else { Some(true) },
            if args.postgres_connection.is_some() { set_agreement_postgres } else { Some(true) },
        ];
        if parts.iter().any(|p| p.is_none()) {
            None
        } else {
            Some(parts.iter().all(|p| matches!(p, Some(true))))
        }
    };
    let agreement: Option<bool> = match (inmem_count, duckdb_count) {
        (Some(a), Some(b)) => Some(a == b),
        _ => None,
    };
    let both_empty_flag = matches!((inmem_count, duckdb_count), (Some(0), Some(0)));

    let ts_run = DateTime::<Utc>::from(SystemTime::now()).to_rfc3339();
    let row = serde_json::json!({
        "label": args.label,
        "schema": if args.schema.is_empty() {
            tag_get("schema")
        } else {
            serde_json::Value::String(args.schema.clone())
        },
        "tree_id": args.tree_id,
        "tree_idx": args.tree_id,
        "sandboxed": true,
        "n_events": tag_get("n_events"),
        "n_objects": tag_get("n_objects"),
        "has_o2o": tag_get("has_o2o"),
        "has_tbe": tag_get("has_tbe"),
        "has_cel": tag_get("has_cel"),
        "has_not_equal": tag_get("has_not_equal"),
        "has_num_childs_proj": tag_get("has_num_childs_proj"),
        "has_adv_cel": tag_get("has_adv_cel"),
        "has_binding_set_eq": tag_get("has_binding_set_eq"),
        "has_binding_set_proj_eq": tag_get("has_binding_set_proj_eq"),
        "has_attribute_filter": tag_get("has_attribute_filter"),
        "has_label": tag_get("has_label"),
        "composition": tag_get("composition"),
        "has_constraint_layered": tag_get("has_constraint_layered"),
        "constraint_layered_at": tag_get("constraint_layered_at"),
        "depth": tag_get("depth"),
        "n_children": tag_get("n_children"),
        "translatable": translatable,
        "reject_msg": reject_msg,
        "inmem_count": inmem_count,
        "duckdb_count": duckdb_count,
        "duckdb_err": duckdb_err,
        "sqlite_count": sqlite_count,
        "sqlite_ms": sqlite_ms,
        "sqlite_err": sqlite_err,
        "postgres_count": postgres_count,
        "postgres_ms": postgres_ms,
        "postgres_err": postgres_err,
        "inmem_ms": inmem_ms,
        "duckdb_ms": duckdb_ms,
        "translation_ms": translation_ms,
        "sql_chars": sql_chars,
        "sql_inner_join_count": sql_inner_join_count,
        "sql_nested_select_depth": sql_nested_select_depth,
        "pushdown_predicates": pred_counts.0,
        "post_processing_predicates": pred_counts.1,
        "total_predicates": pred_counts.0 + pred_counts.1,
        "agreement": agreement,
        "set_agreement": set_agreement_duckdb,
        "set_agreement_sqlite": set_agreement_sqlite,
        "set_agreement_postgres": set_agreement_postgres,
        "all_engines_agree": all_engines_agree,
        "both_empty": both_empty_flag,
        "tree_json": tree,
        "ts": ts_run,
    });

    append_jsonl_row(&args.out, &row)?;

    eprintln!(
        "[eval-tree-once] tree_id={} inmem={:?} duckdb={:?} sqlite={:?} postgres={:?} all_agree={:?}",
        args.tree_id, inmem_count, duckdb_count, sqlite_count, postgres_count, all_engines_agree
    );
    Ok(())
}

/// Execute one tree against a `dbcon`-backed engine (SQLite or PostgreSQL)
/// via the id-native path. Returns (count, ms, err, normalized set). The
/// normalized set is None when `no_set_check` is true OR execution errored.
async fn run_id_native_against_dbcon(
    tree: &BindingBoxTree,
    database: DatabaseType,
    connection: &str,
    no_set_check: bool,
) -> (Option<usize>, f64, Option<String>, Option<Vec<NormalizedBinding>>) {
    let label = format!("ocpq-eval-{:?}", database);
    let ds = match DataSource::new_any_without_discovery(label, connection.to_string()).await {
        Ok(ds) => ds,
        Err(e) => return (None, 0.0, Some(format!("connect: {e}")), None),
    };
    let mappings = match process_mining_mappings_from_dbcon(&ds).await {
        Ok(m) => m,
        Err(e) => return (None, 0.0, Some(format!("derive mappings: {e}")), None),
    };
    let input = DBTranslationInput {
        tree: tree.clone(),
        database,
        table_mappings: mappings,
    };
    let start = Instant::now();
    match ocpq_shared::db_translation::sql_executor_id::execute_translated_query_id(input, &ds).await {
        Ok(bindings) => {
            let ms = start.elapsed().as_secs_f64() * 1000.0;
            let count = Some(bindings.len());
            let set = if no_set_check {
                None
            } else {
                Some(
                    ocpq_shared::db_translation::corpus::normalized_binding_set_id(
                        bindings.iter().map(|(b, v)| (b, v.as_ref())),
                    ),
                )
            };
            (count, ms, None, set)
        }
        Err(e) => (None, start.elapsed().as_secs_f64() * 1000.0, Some(format!("{e}")), None),
    }
}

/// Append one serde_json::Value as a JSONL row to `path`. Opens with
/// O_APPEND and an advisory lock so concurrent invocations (driver wrapper
/// may spawn multiple sandboxed children in the future) do not interleave
/// partial rows.
fn append_jsonl_row(path: &PathBuf, row: &serde_json::Value) -> anyhow::Result<()> {
    use std::os::unix::io::AsRawFd;
    let line = serde_json::to_string(row)
        .map_err(|e| anyhow::anyhow!("serialize row: {e}"))?;
    let mut f = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| anyhow::anyhow!("open {:?}: {e}", path))?;
    // Advisory whole-file lock; released on drop/close.
    let fd = f.as_raw_fd();
    unsafe {
        if libc::flock(fd, libc::LOCK_EX) != 0 {
            // Best-effort; if flock is unavailable we still append O_APPEND.
            eprintln!("[eval-tree-once] flock failed (errno={})", *libc::__errno_location());
        }
    }
    let r = (|| -> std::io::Result<()> {
        f.write_all(line.as_bytes())?;
        f.write_all(b"\n")?;
        f.flush()?;
        Ok(())
    })();
    unsafe {
        let _ = libc::flock(fd, libc::LOCK_UN);
    }
    r.map_err(|e| anyhow::anyhow!("append row to {:?}: {e}", path))?;
    Ok(())
}

async fn run_exec(args: ExecArgs) -> anyhow::Result<()> {
    let tree_content = fs::read_to_string(&args.tree)
        .map_err(|e| anyhow::anyhow!("read tree {:?}: {e}", args.tree))?;
    let tree: BindingBoxTree = serde_json::from_str(&tree_content)
        .map_err(|e| anyhow::anyhow!("parse tree JSON: {e}"))?;

    if let Err(errors) = validate_translatable(&tree) {
        let mut msg =
            String::from("binding-box tree contains predicates the SQL emitter cannot translate:");
        for e in errors {
            msg.push_str("\n  - ");
            msg.push_str(&e.to_string());
        }
        anyhow::bail!(msg);
    }

    let database = match args.backend {
        ExecBackend::Sqlite => DatabaseType::SQLite,
        ExecBackend::Postgres => DatabaseType::PostgreSQL,
        ExecBackend::Duckdb => DatabaseType::DuckDB,
        ExecBackend::Inmem => anyhow::bail!(
            "`exec` requires a SQL backend; the in-memory engine has no SQL translation"
        ),
    };

    let backend_conn = match args.backend {
        ExecBackend::Sqlite | ExecBackend::Postgres => {
            let ds = DataSource::new_any_without_discovery(
                format!("ocpq-exec-{:?}", args.backend),
                args.connection.clone(),
            )
            .await
            .map_err(|e| anyhow::anyhow!("connect to {:?}: {e}", args.connection))?;
            BackendConn::Dbcon(ds)
        }
        ExecBackend::Duckdb => {
            let path = args
                .connection
                .strip_prefix("duckdb:")
                .unwrap_or(&args.connection);
            let conn = duckdb::Connection::open(path)
                .map_err(|e| anyhow::anyhow!("open duckdb {path}: {e}"))?;
            BackendConn::DuckDb(conn)
        }
        ExecBackend::Inmem => unreachable!(),
    };

    let mappings = match &args.mappings {
        None => derive_process_mining_mappings(&backend_conn).await?,
        Some(p) => {
            let content = fs::read_to_string(p)
                .map_err(|e| anyhow::anyhow!("read mappings {p:?}: {e}"))?;
            serde_json::from_str(&content)
                .map_err(|e| anyhow::anyhow!("parse mappings JSON: {e}"))?
        }
    };

    let now = Instant::now();
    let input = DBTranslationInput {
        tree,
        database,
        table_mappings: mappings,
    };
    let bindings = match &backend_conn {
        BackendConn::Dbcon(ds) => {
            ocpq_shared::db_translation::sql_executor_id::execute_translated_query_id(input, ds)
                .await?
        }
        BackendConn::DuckDb(c) => {
            ocpq_shared::db_translation::sql_executor_id::execute_translated_query_id_duckdb(
                input, c,
            )
            .await?
        }
    };
    println!(
        "Executed translated query in {:?} ({} bindings)",
        now.elapsed(),
        bindings.len()
    );

    let stamp = DateTime::<Utc>::from(SystemTime::now())
        .format("%Y%m%dT%H%M%SZ")
        .to_string();
    let out_path = args
        .output
        .unwrap_or_else(|| PathBuf::from(format!("ocpq-exec-result-{stamp}.json")));
    let writer = File::create(&out_path)
        .map_err(|e| anyhow::anyhow!("create output {out_path:?}: {e}"))?;
    serde_json::to_writer(BufWriter::new(writer), &bindings)
        .map_err(|e| anyhow::anyhow!("write output JSON: {e}"))?;
    println!("Wrote bindings to {}", out_path.display());
    Ok(())
}

fn run_translate(args: TranslateArgs) -> Result<(), String> {
    let tree_content =
        fs::read_to_string(&args.tree).map_err(|e| format!("read tree {:?}: {e}", args.tree))?;
    let tree: BindingBoxTree =
        serde_json::from_str(&tree_content).map_err(|e| format!("parse tree JSON: {e}"))?;

    let mappings = match &args.mappings {
        None => TableMappings::default(),
        Some(p) => {
            let content = fs::read_to_string(p).map_err(|e| format!("read mappings {p:?}: {e}"))?;
            serde_json::from_str(&content).map_err(|e| format!("parse mappings JSON: {e}"))?
        }
    };

    if !matches!(args.target, Target::Cypher) {
        if let Err(errors) = validate_translatable(&tree) {
            let mut msg = String::from(
                "binding-box tree contains predicates the SQL emitter cannot translate:",
            );
            for e in errors {
                msg.push_str("\n  - ");
                msg.push_str(&e.to_string());
            }
            return Err(msg);
        }
    }

    let db_for_batched = match args.target {
        Target::Sqlite => Some(DatabaseType::SQLite),
        Target::Duckdb => Some(DatabaseType::DuckDB),
        Target::Postgres => Some(DatabaseType::PostgreSQL),
        Target::Cypher => None,
    };

    let output = match args.target {
        Target::Cypher => translate_to_cypher_shared(tree.clone(), &mappings),
        Target::Sqlite => translate_to_sql_shared(DBTranslationInput {
            tree: tree.clone(),
            database: DatabaseType::SQLite,
            table_mappings: mappings.clone(),
        }),
        Target::Duckdb => translate_to_sql_shared(DBTranslationInput {
            tree: tree.clone(),
            database: DatabaseType::DuckDB,
            table_mappings: mappings.clone(),
        }),
        Target::Postgres => translate_to_sql_shared(DBTranslationInput {
            tree: tree.clone(),
            database: DatabaseType::PostgreSQL,
            table_mappings: mappings.clone(),
        }),
    };

    let mut full_output = output;
    if args.with_batched {
        if let Some(db) = db_for_batched {
            let (parent_sql, batched) =
                ocpq_shared::db_translation::translate_to_sql_shared_with_batched_children(
                    DBTranslationInput {
                        tree,
                        database: db,
                        table_mappings: mappings,
                    },
                );
            // (Optional) include the parent-only SQL header for context.
            full_output.push_str(&format!(
                "\n\n-- batched-mode parent SQL (target={:?})\n{}\n-- end\n",
                args.target, parent_sql
            ));
            for (label, sql) in &batched {
                full_output.push_str(&format!(
                    "\n-- batched child label={} target={:?}\n{}\n-- end\n",
                    label, args.target, sql
                ));
            }
        }
    }

    match args.output {
        Some(p) => fs::write(&p, full_output).map_err(|e| format!("write output {p:?}: {e}"))?,
        None => print!("{}", full_output),
    }
    Ok(())
}

struct Stats {
    mean: f64,
    median: f64,
    min: f64,
    max: f64,
    stddev: f64,
}

fn stats(xs: &[f64]) -> Stats {
    debug_assert!(!xs.is_empty());
    let n = xs.len() as f64;
    let mean = xs.iter().sum::<f64>() / n;
    let mut sorted: Vec<f64> = xs.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let median = if sorted.len() % 2 == 0 {
        (sorted[sorted.len() / 2 - 1] + sorted[sorted.len() / 2]) / 2.0
    } else {
        sorted[sorted.len() / 2]
    };
    let min = *sorted.first().unwrap();
    let max = *sorted.last().unwrap();
    let var = xs.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / n;
    Stats {
        mean,
        median,
        min,
        max,
        stddev: var.sqrt(),
    }
}

fn discover_queries(dir: &PathBuf, only: &[String]) -> Result<Vec<(String, PathBuf)>, String> {
    let mut out: Vec<(String, PathBuf)> = fs::read_dir(dir)
        .map_err(|e| format!("read queries dir {dir:?}: {e}"))?
        .filter_map(Result::ok)
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .map(|e| (e.file_name().to_string_lossy().into_owned(), e.path()))
        .filter(|(name, p)| {
            (only.is_empty() || only.iter().any(|n| n == name)) && p.join("ocpq-tree.json").exists()
        })
        .collect();
    out.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(out)
}

fn run_bench(args: BenchArgs) -> Result<(), String> {
    run_bench_inner(args, false)
}

fn run_bench_root(args: BenchArgs) -> Result<(), String> {
    run_bench_inner(args, true)
}

fn run_bench_inner(args: BenchArgs, root_only: bool) -> Result<(), String> {
    let queries = discover_queries(&args.queries_dir, &args.only)?;
    if queries.is_empty() {
        return Err(format!(
            "no queries found in {:?} (need subdirs containing ocpq-tree.json)",
            args.queries_dir
        ));
    }

    println!("Loading OCEL from {:?}", args.ocel);
    let load_start = Instant::now();
    let ocel = OCEL::import_from_path(&args.ocel).map_err(|e| format!("import OCEL: {e:?}"))?;
    println!("  imported in {:.2?}", load_start.elapsed());
    let link_start = Instant::now();
    let linked = SlimLinkedOCEL::from_ocel(ocel);
    println!("  linked in {:.2?}", link_start.elapsed());

    let mut results_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&args.results)
        .map_err(|e| format!("open results file {:?}: {e}", args.results))?;

    let row_col = if root_only { "root_rows" } else { "situations" };
    let mode_suffix = if root_only { " root" } else { "" };
    println!(
        "\nBench{}: label={} runs={} warmup={} queries={}",
        mode_suffix,
        args.label,
        args.runs,
        args.warmup,
        queries.len()
    );
    println!(
        "{:<8} {:>10} {:>10} {:>10} {:>10} {:>10} {:>10}",
        "query", "mean(ms)", "median", "min", "max", "stddev", row_col
    );
    println!("{:-<74}", "");

    for (qname, qdir) in &queries {
        let tree_path = qdir.join("ocpq-tree.json");
        let tree_str =
            fs::read_to_string(&tree_path).map_err(|e| format!("read {:?}: {e}", tree_path))?;
        let tree: BindingBoxTree =
            serde_json::from_str(&tree_str).map_err(|e| format!("parse {:?}: {e}", tree_path))?;
        let step_cache = root_only.then(|| tree.compute_step_cache(&linked));

        let run_eval = |row_count: &mut usize| -> Result<(), String> {
            if let Some(sc) = &step_cache {
                let mut c = 0usize;
                let mut sink =
                    |_: std::sync::Arc<Binding>, _| -> Result<(), String> { c += 1; Ok(()) };
                tree.nodes[0]
                    .evaluate_no_descendants(0, Binding::default(), &tree, &linked, sc, &mut sink)
                    .map_err(|e| format!("evaluate root {qname}: {e}"))?;
                *row_count = c;
            } else {
                let (results, _) =
                    tree.evaluate(&linked).map_err(|e| format!("evaluate {qname}: {e}"))?;
                *row_count = results.len();
            }
            Ok(())
        };

        let mut dummy = 0;
        for _ in 0..args.warmup {
            run_eval(&mut dummy)?;
        }

        let mut durations_ms = Vec::with_capacity(args.runs);
        let mut row_count = 0usize;
        let ts = DateTime::<Utc>::from(SystemTime::now()).to_rfc3339();
        for run in 0..args.runs {
            let start = Instant::now();
            run_eval(&mut row_count)?;
            let dur_ms = start.elapsed().as_secs_f64() * 1000.0;
            durations_ms.push(dur_ms);
            let row = serde_json::json!({
                "label": args.label,
                "query": qname,
                "run": run,
                "duration_ms": dur_ms,
                "situations": row_count,
                "ts": ts,
                "mode": if root_only { "root" } else { "full" },
            });
            writeln!(results_file, "{}", serde_json::to_string(&row).unwrap())
                .map_err(|e| format!("write result row: {e}"))?;
        }

        let s = stats(&durations_ms);
        println!(
            "{:<8} {:>10.2} {:>10.2} {:>10.2} {:>10.2} {:>10.2} {:>10}",
            qname, s.mean, s.median, s.min, s.max, s.stddev, row_count
        );
    }

    println!("\nResults appended to {:?}", args.results);
    Ok(())
}

fn run_bench_summary(args: BenchSummaryArgs) -> Result<(), String> {
    let content = fs::read_to_string(&args.results)
        .map_err(|e| format!("read results {:?}: {e}", args.results))?;

    let mut grouped: BTreeMap<(String, String), Vec<f64>> = BTreeMap::new();

    for (i, line) in content.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let v: serde_json::Value =
            serde_json::from_str(line).map_err(|e| format!("parse line {}: {e}", i + 1))?;
        let label = v["label"].as_str().ok_or("missing label")?.to_string();
        let query = v["query"].as_str().ok_or("missing query")?.to_string();
        let dur = v["duration_ms"].as_f64().ok_or("missing duration_ms")?;
        grouped
            .entry((label, query))
            .or_default()
            .push(dur);
    }

    if grouped.is_empty() {
        println!("(no data in {:?})", args.results);
        return Ok(());
    }

    let labels: Vec<String> = grouped
        .keys()
        .map(|k| k.0.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let queries: Vec<String> = grouped
        .keys()
        .map(|k| k.1.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();

    println!(
        "{:<20} {:<8} {:>5} {:>10} {:>10} {:>10} {:>10} {:>10}",
        "label", "query", "n", "mean(ms)", "median", "min", "max", "stddev"
    );
    println!("{:-<92}", "");
    for (key, durs) in &grouped {
        let s = stats(durs);
        println!(
            "{:<20} {:<8} {:>5} {:>10.2} {:>10.2} {:>10.2} {:>10.2} {:>10.2}",
            key.0,
            key.1,
            durs.len(),
            s.mean,
            s.median,
            s.min,
            s.max,
            s.stddev,
        );
    }

    if labels.len() > 1 {
        println!("\n--- Median (ms) by query x label ---");
        print!("{:<8}", "query");
        for l in &labels {
            print!(" {:>14}", l);
        }
        println!(" {:>10}", "delta_pct");
        println!("{:-<80}", "");

        let baseline = &labels[0];
        let last = labels.last().unwrap();
        for q in &queries {
            print!("{:<8}", q);
            for l in &labels {
                match grouped.get(&(l.clone(), q.clone())) {
                    Some(durs) => print!(" {:>14.2}", stats(durs).median),
                    None => print!(" {:>14}", "-"),
                }
            }
            let base = grouped
                .get(&(baseline.clone(), q.clone()))
                .map(|d| stats(d).median);
            let cur = grouped
                .get(&(last.clone(), q.clone()))
                .map(|d| stats(d).median);
            match (base, cur) {
                (Some(b), Some(c)) if b > 0.0 => {
                    let pct = (c - b) / b * 100.0;
                    println!(" {:>+9.1}%", pct);
                }
                _ => println!(" {:>10}", "-"),
            }
        }
        println!("\n(delta_pct compares last label `{last}` vs baseline `{baseline}`)");
    }

    Ok(())
}

fn parent_by_child(tree: &BindingBoxTree) -> Vec<Option<usize>> {
    let mut parent = vec![None; tree.nodes.len()];
    for (idx, node) in tree.nodes.iter().enumerate() {
        let (_bbox, children) = node.to_box();
        for &child in children.iter() {
            if child < parent.len() {
                parent[child] = Some(idx);
            }
        }
    }
    parent
}

fn node_profile_inputs(
    node_idx: usize,
    tree: &BindingBoxTree,
    ocel: &SlimLinkedOCEL,
    step_cache: &[Vec<ocpq_shared::binding_box::BindingStep>],
    parents: &[Option<usize>],
    memo: &mut HashMap<usize, Vec<Binding>>,
    sample_limit: usize,
) -> Result<Vec<Binding>, String> {
    if let Some(inputs) = memo.get(&node_idx) {
        return Ok(inputs.clone());
    }

    let inputs = if let Some(parent_idx) = parents[node_idx] {
        let parent_inputs = node_profile_inputs(
            parent_idx,
            tree,
            ocel,
            step_cache,
            parents,
            memo,
            sample_limit,
        )?;
        let (parent_box, _children) = tree.nodes[parent_idx].to_box();
        let mut out = Vec::new();
        for input in parent_inputs {
            let (mut expanded, _skipped) =
                parent_box.expand_with_steps(input, ocel, &step_cache[parent_idx])?;
            out.append(&mut expanded);
            if out.len() > sample_limit {
                out.truncate(sample_limit);
                break;
            }
        }
        out
    } else {
        vec![Binding::default()]
    };

    memo.insert(node_idx, inputs.clone());
    Ok(inputs)
}

fn run_plan_profile(args: PlanProfileArgs) -> Result<(), String> {
    let queries = discover_queries(&args.queries_dir, &args.only)?;
    if queries.is_empty() {
        return Err(format!(
            "no queries found in {:?} (need subdirs containing ocpq-tree.json)",
            args.queries_dir
        ));
    }

    println!("Loading OCEL from {:?}", args.ocel);
    let load_start = Instant::now();
    let ocel = OCEL::import_from_path(&args.ocel).map_err(|e| format!("import OCEL: {e:?}"))?;
    println!("  imported in {:.2?}", load_start.elapsed());

    let link_start = Instant::now();
    let linked = SlimLinkedOCEL::from_ocel(ocel);
    println!("  linked in {:.2?}", link_start.elapsed());

    for (qname, qdir) in &queries {
        let tree_path = qdir.join("ocpq-tree.json");
        let tree_str =
            fs::read_to_string(&tree_path).map_err(|e| format!("read {:?}: {e}", tree_path))?;
        let tree: BindingBoxTree =
            serde_json::from_str(&tree_str).map_err(|e| format!("parse {:?}: {e}", tree_path))?;
        let step_cache = tree.compute_step_cache(&linked);
        let parents = parent_by_child(&tree);
        let mut memo = HashMap::new();

        println!("\n=== {qname} ===");
        for node_idx in 0..tree.nodes.len() {
            let inputs = node_profile_inputs(
                node_idx,
                &tree,
                &linked,
                &step_cache,
                &parents,
                &mut memo,
                args.sample_limit,
            )?;
            let steps = &step_cache[node_idx];
            let (bbox, _children) = tree.nodes[node_idx].to_box();

            println!(
                "node {node_idx}: sampled_inputs={} steps={}",
                inputs.len(),
                steps.len()
            );
            if steps.is_empty() {
                println!("  (no binding steps)");
                continue;
            }

            let mut prev_count = inputs.len();
            for prefix_len in 1..=steps.len() {
                let start = Instant::now();
                let mut out_count = 0usize;
                let mut skipped = false;
                for input in &inputs {
                    let (expanded, step_skipped) =
                        bbox.expand_with_steps(input.clone(), &linked, &steps[..prefix_len])?;
                    out_count += expanded.len();
                    skipped |= step_skipped;
                }
                let factor = if prev_count == 0 {
                    0.0
                } else {
                    out_count as f64 / prev_count as f64
                };
                println!(
                    "  {:>2}. {:<80} in={:<8} out={:<8} x={:<8.2} cum_time={:>8.2?}{}",
                    prefix_len,
                    format!("{:?}", steps[prefix_len - 1]),
                    prev_count,
                    out_count,
                    factor,
                    start.elapsed(),
                    if skipped { " skipped" } else { "" }
                );
                prev_count = out_count;
            }
        }
    }

    Ok(())
}

fn main() -> ExitCode {
    let args = Args::parse();
    match args.command {
        Command::Evaluate(eval_args) => {
            run_evaluate(eval_args);
            ExitCode::SUCCESS
        }
        Command::Translate(translate_args) => match run_translate(translate_args) {
            Ok(()) => ExitCode::SUCCESS,
            Err(e) => {
                eprintln!("ocpq_cli translate: {e}");
                ExitCode::FAILURE
            }
        },
        Command::Exec(exec_args) => {
            let rt = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .expect("failed to build tokio runtime");
            match rt.block_on(run_exec(exec_args)) {
                Ok(()) => ExitCode::SUCCESS,
                Err(e) => {
                    eprintln!("ocpq_cli exec: {e}");
                    ExitCode::FAILURE
                }
            }
        }
        Command::Bench(bench_args) => match run_bench(bench_args) {
            Ok(()) => ExitCode::SUCCESS,
            Err(e) => {
                eprintln!("ocpq_cli bench: {e}");
                ExitCode::FAILURE
            }
        },
        Command::BenchRoot(bench_args) => match run_bench_root(bench_args) {
            Ok(()) => ExitCode::SUCCESS,
            Err(e) => {
                eprintln!("ocpq_cli bench-root: {e}");
                ExitCode::FAILURE
            }
        },
        Command::BenchSql(args) => {
            let rt = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .expect("failed to build tokio runtime");
            match rt.block_on(run_bench_sql(args)) {
                Ok(()) => ExitCode::SUCCESS,
                Err(e) => {
                    eprintln!("ocpq_cli bench-sql: {e}");
                    ExitCode::FAILURE
                }
            }
        }
        Command::BenchMem(args) => {
            let rt = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .expect("failed to build tokio runtime");
            match rt.block_on(run_bench_mem(args)) {
                Ok(()) => ExitCode::SUCCESS,
                Err(e) => {
                    eprintln!("ocpq_cli bench-mem: {e}");
                    ExitCode::FAILURE
                }
            }
        }
        Command::ExportDuckdb(args) => match run_export_duckdb(args) {
            Ok(()) => ExitCode::SUCCESS,
            Err(e) => {
                eprintln!("ocpq_cli export-duckdb: {e}");
                ExitCode::FAILURE
            }
        },
        Command::ExportJson(args) => match run_export_json(args) {
            Ok(()) => ExitCode::SUCCESS,
            Err(e) => {
                eprintln!("ocpq_cli export-json: {e}");
                ExitCode::FAILURE
            }
        },
        Command::ExportSqlite(args) => match run_export_sqlite(args) {
            Ok(()) => ExitCode::SUCCESS,
            Err(e) => {
                eprintln!("ocpq_cli export-sqlite: {e}");
                ExitCode::FAILURE
            }
        },
        Command::BenchSummary(args) => match run_bench_summary(args) {
            Ok(()) => ExitCode::SUCCESS,
            Err(e) => {
                eprintln!("ocpq_cli bench-summary: {e}");
                ExitCode::FAILURE
            }
        },
        Command::BenchCorpus(args) => {
            let rt = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .expect("failed to build tokio runtime");
            match rt.block_on(run_bench_corpus(args)) {
                Ok(()) => ExitCode::SUCCESS,
                Err(e) => {
                    eprintln!("ocpq_cli bench-corpus: {e}");
                    ExitCode::FAILURE
                }
            }
        }
        Command::EvalTreeOnce(args) => {
            let rt = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .expect("failed to build tokio runtime");
            match rt.block_on(run_eval_tree_once(args)) {
                Ok(()) => ExitCode::SUCCESS,
                Err(e) => {
                    eprintln!("ocpq_cli eval-tree-once: {e}");
                    ExitCode::FAILURE
                }
            }
        }
        Command::DumpCorpusTrees(args) => match run_dump_corpus_trees(args) {
            Ok(()) => ExitCode::SUCCESS,
            Err(e) => {
                eprintln!("ocpq_cli dump-corpus-trees: {e}");
                ExitCode::FAILURE
            }
        },
        Command::PlanProfile(args) => match run_plan_profile(args) {
            Ok(()) => ExitCode::SUCCESS,
            Err(e) => {
                eprintln!("ocpq_cli plan-profile: {e}");
                ExitCode::FAILURE
            }
        },
    }
}
