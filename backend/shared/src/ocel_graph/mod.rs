use process_mining::ocel::{
    linked_ocel::IndexLinkedOCEL,
    ocel_struct::{OCELEvent, OCELObject},
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Serialize, Deserialize, Debug)]
#[serde(untagged)]
pub enum GraphNode {
    Event(OCELEvent),
    Object(OCELObject),
}
#[derive(Serialize, Deserialize, Debug)]
pub struct GraphLink {
    source: String,
    target: String,
    qualifier: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct OCELGraph {
    nodes: Vec<GraphNode>,
    links: Vec<GraphLink>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(TS)]
#[ts(export, export_to = "../../../frontend/src/types/generated/")]
pub struct OCELGraphOptions {
    max_distance: usize,
    root: String,
    root_is_object: bool,
    rels_size_ignore_threshold: usize,
    spanning_tree: bool,
}

pub fn get_ocel_graph(ocel: &IndexLinkedOCEL, options: OCELGraphOptions) -> Option<OCELGraph> {
    None
    // // TODO:
    // let root_index_opt = match options.root_is_object {
    //     true => ocel
    //         .object_index_map
    //         .get(&options.root)
    //         .map(|o_index| EventOrObjectIndex::Object(*o_index)),

    //     false => ocel
    //         .event_index_map
    //         .get(&options.root)
    //         .map(|e_index| EventOrObjectIndex::Event(*e_index)),
    // };
    // if let Some(root_index) = root_index_opt {
    //     let mut queue = vec![(root_index, 0)];
    //     let mut done_indices: Vec<EventOrObjectIndex> = Vec::new();
    //     let mut expanded_arcs: Vec<(EventOrObjectIndex, EventOrObjectIndex, String)> = Vec::new();
    //     done_indices.push(root_index);
    //     let max_distance = options.max_distance;
    //     while let Some((index, distance)) = queue.pop() {
    //         if distance < max_distance {
    //             if let Some(rels) = ocel.symmetric_rels.get(&index) {
    //                 // Check for rels_size_ignore_threshold but also continue if at the root node (root node always gets expanded)
    //                 if root_index == index || rels.len() < options.rels_size_ignore_threshold {
    //                     for (r, reversed, qualifier) in rels {
    //                         let arc = if !reversed {
    //                             (index, *r, qualifier.clone())
    //                         } else {
    //                             (*r, index, qualifier.clone())
    //                         };
    //                         if !done_indices.contains(r) {
    //                             expanded_arcs.push(arc);
    //                             queue.push((*r, distance + 1));
    //                             done_indices.push(*r);
    //                         } else if !options.spanning_tree {
    //                             expanded_arcs.push(arc);
    //                         }
    //                     }
    //                 }
    //             }
    //         }
    //     }
    //     let nodes = done_indices
    //         .iter()
    //         .map(|i| match i {
    //             EventOrObjectIndex::Object(o_index) => {
    //                 GraphNode::Object(ocel.ob_by_index(o_index).unwrap().clone())
    //             }
    //             EventOrObjectIndex::Event(e_index) => {
    //                 GraphNode::Event(ocel.ev_by_index(e_index).unwrap().clone())
    //             }
    //         })
    //         .collect();
    //     let links = expanded_arcs
    //         .iter()
    //         .map(|(from, to, qualifier)| {
    //             let from = ocel.ob_or_ev_by_index(*from).unwrap().cloned();
    //             let to = ocel.ob_or_ev_by_index(*to).unwrap().cloned();

    //             GraphLink {
    //                 source: from.get_id().clone(),
    //                 target: to.get_id().clone(),
    //                 qualifier: qualifier.clone(),
    //             }
    //         })
    //         .collect();
    //     Some(OCELGraph { nodes, links })
    // } else {
    //     None
    // }
}
