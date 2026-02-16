use std::{
    fs::File,
    io::BufWriter,
    path::PathBuf,
    time::{Instant, SystemTime},
};

use chrono::{DateTime, Utc};
use clap::Parser;
use ocpq_shared::{
    binding_box::{evaluate_box_tree, BindingBoxTree},
    process_mining::{
        core::event_data::object_centric::linked_ocel::SlimLinkedOCEL, Importable, OCEL,
    },
};

#[derive(Parser, Debug)]
#[command(version, about, long_about = None)]
struct Args {
    /// File path where the input OCEL 2.0 file located
    #[arg(short, long)]
    ocel: PathBuf,

    /// File path where the input BindingBoxTree Serialization is located
    #[arg(short, long)]
    bbox_tree: PathBuf,
}

fn main() {
    let args = Args::parse();

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
    let res_writer = File::create(format!(
        "ocpq-res-export-{:?}.json",
        DateTime::<Utc>::from(SystemTime::now())
    ))
    .expect("Could not create res output file!");
    serde_json::to_writer(BufWriter::new(res_writer), &res).unwrap();
    println!("Exported result in {:?}", now.elapsed());
}
