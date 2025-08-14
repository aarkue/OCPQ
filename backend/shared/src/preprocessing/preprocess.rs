pub fn get_object_relationships(obj: &OCELObject) -> Vec<OCELRelationship> {
    obj.relationships.clone()
}

use std::collections::{HashMap, HashSet};

use process_mining::ocel::{
    linked_ocel::{IndexLinkedOCEL, LinkedOCELAccess},
    ocel_struct::{OCELObject, OCELRelationship},
};

use crate::ocel_qualifiers::qualifiers::QualifierAndObjectType;

///
/// Computes [HashMap] linking an object type to the [HashSet] of [QualifierAndObjectType] that objects of that type are linked to (through O2O Relationships)
pub fn get_object_rels_per_type(
    locel: &IndexLinkedOCEL,
) -> HashMap<String, HashSet<QualifierAndObjectType>> {
    let object_map: HashMap<_, _> = locel.get_all_obs().map(|ob| (ob.id.as_str(), ob)).collect();
    let ocel = locel.get_ocel_ref();
    let mut object_to_object_rels_per_type: HashMap<String, HashSet<QualifierAndObjectType>> = ocel
        .object_types
        .iter()
        .map(|t| (t.name.clone(), HashSet::new()))
        .collect();
    for o in &ocel.objects {
        let rels_for_type = object_to_object_rels_per_type
            .get_mut(&o.object_type)
            .unwrap();
        for rels in get_object_relationships(o) {
            match object_map.get(rels.object_id.as_str()) {
                Some(rel_obj) => {
                    rels_for_type.insert((rels.qualifier, rel_obj.object_type.clone()));
                }
                None => {
                    eprintln!("Malformed OCEL: Object {} has relationship to object ID {}, which does not belong to any object",o.id, rels.object_id);
                }
            }
        }
    }
    object_to_object_rels_per_type
}
