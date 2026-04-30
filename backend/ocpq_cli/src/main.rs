use std::{
    fs::{self, File},
    io::BufWriter,
    path::PathBuf,
    process::ExitCode,
    time::{Instant, SystemTime},
};

use chrono::{DateTime, Utc};
use clap::{Parser, Subcommand, ValueEnum};
use ocpq_shared::{
    binding_box::{evaluate_box_tree, BindingBoxTree},
    db_translation::{
        translate_to_cypher_shared, translate_to_sql_shared, DBTranslationInput, DatabaseType,
        TableMappings,
    },
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
    /// Path to a JSON file containing a serialized BindingBoxTree (the same
    /// wire format the OCPQ frontend exports).
    #[arg(short, long)]
    tree: PathBuf,

    /// Optional JSON file mapping OCEL event/object types to backend table
    /// (or graph label) names. Format:
    ///     {"event_tables": {"pick item": "pickitem"}, "object_tables": {}}
    /// Missing entries fall back to the raw type name.
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
    let tree_content = fs::read_to_string(&args.tree)
        .map_err(|e| format!("read tree {:?}: {e}", args.tree))?;
    let tree: BindingBoxTree =
        serde_json::from_str(&tree_content).map_err(|e| format!("parse tree JSON: {e}"))?;

    let mappings = match &args.mappings {
        None => TableMappings::default(),
        Some(p) => {
            let content =
                fs::read_to_string(p).map_err(|e| format!("read mappings {p:?}: {e}"))?;
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
    }
}
