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
use ocpq_shared::{
    binding_box::{evaluate_box_tree, Binding, BindingBoxTree},
    db_translation::{
        translate_to_cypher_shared, translate_to_sql_shared, DBTranslationInput, DatabaseType,
        TableMappings,
    },
    process_mining::{
        core::event_data::object_centric::linked_ocel::SlimLinkedOCEL, Importable,
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

    /// Benchmark BindingBoxTree evaluation across one or more queries.
    Bench(BenchArgs),

    /// Benchmark root-only evaluation across one or more queries.
    BenchRoot(BenchArgs),

    /// Summarize a JSONL file produced by bench or bench-root.
    BenchSummary(BenchSummaryArgs),

    /// Profile the current binding-step plan by prefix cardinality.
    PlanProfile(PlanProfileArgs),
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
}

#[derive(Copy, Clone, Debug, ValueEnum)]
enum Target {
    Sqlite,
    Duckdb,
    Cypher,
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
    let index_linked_ocel =
        SlimLinkedOCEL::import_from_path(args.ocel).expect("Could not import OCEL 2.0 file");
    println!("Imported OCEL 2.0 in {:?}", now.elapsed());
    let res = evaluate_box_tree(bbox_tree, &index_linked_ocel, true);

    let now = Instant::now();
    // Avoid colons in the timestamp -- Windows treats them as illegal path
    // characters and `File::create` would fail at runtime.
    let stamp = DateTime::<Utc>::from(SystemTime::now())
        .format("%Y%m%dT%H%M%SZ")
        .to_string();
    let res_writer = File::create(format!("ocpq-res-export-{stamp}.json"))
        .expect("Could not create res output file!");
    serde_json::to_writer(BufWriter::new(res_writer), &res).unwrap();
    println!("Exported result in {:?}", now.elapsed());
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

    let output = match args.target {
        Target::Cypher => translate_to_cypher_shared(tree, &mappings),
        Target::Sqlite => translate_to_sql_shared(DBTranslationInput {
            tree,
            database: DatabaseType::SQLite,
            table_mappings: mappings,
        }),
        Target::Duckdb => translate_to_sql_shared(DBTranslationInput {
            tree,
            database: DatabaseType::DuckDB,
            table_mappings: mappings,
        }),
    };

    match args.output {
        Some(p) => fs::write(&p, output).map_err(|e| format!("write output {p:?}: {e}"))?,
        None => print!("{output}"),
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
    let linked = SlimLinkedOCEL::import_from_path(&args.ocel).map_err(|e| format!("import OCEL: {e:?}"))?;
    println!("imported & linked in {:.2?}", load_start.elapsed());

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
    let linked = SlimLinkedOCEL::import_from_path(&args.ocel).map_err(|e| format!("import OCEL: {e:?}"))?;
    println!("Loaded and linked in {:.2?}", load_start.elapsed());

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
        Command::BenchSummary(args) => match run_bench_summary(args) {
            Ok(()) => ExitCode::SUCCESS,
            Err(e) => {
                eprintln!("ocpq_cli bench-summary: {e}");
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
