#[cfg(test)]
#[test]
pub fn test() {
    use std::time::Instant;

    

    use crate::{
        load_ocel::load_ocel_file,
        preprocessing::preprocess::link_ocel_info,
    };

    let mut now = Instant::now();
    let ocel = load_ocel_file("ContainerLogistics").unwrap();
    println!(
        "Loaded OCEL with {} events and {} objects in {:?}",
        ocel.events.len(),
        ocel.objects.len(),
        now.elapsed()
    );
    // let ocel_relations : HashMap<String,Vec<OCELRelationship>> = ocel.objects.iter().map(|obj| (obj.id.clone(),get_object_relationships(obj))).collect();
    let linked_ocel = link_ocel_info(&ocel);
    println!("{:#?}", linked_ocel.object_rels_per_type);
    // println!("First object: {:?}",o);
}