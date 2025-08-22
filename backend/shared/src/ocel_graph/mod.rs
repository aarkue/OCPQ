use process_mining::ocel::{
    linked_ocel::{index_linked_ocel::EventOrObjectIndex, IndexLinkedOCEL, LinkedOCELAccess},
    ocel_struct::{OCELEvent, OCELObject},
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{
    discovery::graph_discovery::{get_symmetric_rels, SymmetricRel},
    preprocessing::linked_ocel::event_or_object_from_index,
};

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
    let root_index_opt = match options.root_is_object {
        true => ocel
            .get_ob_index(options.root)
            .map(EventOrObjectIndex::Object),

        false => ocel
            .get_ev_index(options.root)
            .map(EventOrObjectIndex::Event),
    };
    if let Some(root_index) = root_index_opt {
        let mut queue = vec![(root_index, 0)];
        let mut done_indices: Vec<EventOrObjectIndex> = Vec::new();
        let mut expanded_arcs: Vec<(EventOrObjectIndex, EventOrObjectIndex, String)> = Vec::new();
        done_indices.push(root_index);
        let max_distance = options.max_distance;
        while let Some((index, distance)) = queue.pop() {
            if distance < max_distance {
                let rels = get_symmetric_rels(&index, ocel);
                // Check for rels_size_ignore_threshold but also continue if at the root node (root node always gets expanded)
                if root_index == index || rels.len() < options.rels_size_ignore_threshold {
                    for SymmetricRel {
                        index: r,
                        reversed,
                        qualifier,
                    } in rels
                    {
                        let arc = if !reversed {
                            (index, r, qualifier.clone())
                        } else {
                            (r, index, qualifier.clone())
                        };
                        if !done_indices.contains(&r) {
                            expanded_arcs.push(arc);
                            queue.push((r, distance + 1));
                            done_indices.push(r);
                        } else if !options.spanning_tree {
                            expanded_arcs.push(arc);
                        }
                    }
                }
            }
        }
        let nodes = done_indices
            .iter()
            .map(|i| match i {
                EventOrObjectIndex::Object(o_index) => {
                    GraphNode::Object(ocel.get_ob(o_index).clone())
                }
                EventOrObjectIndex::Event(e_index) => {
                    GraphNode::Event(ocel.get_ev(e_index).clone())
                }
            })
            .collect();
        let links = expanded_arcs
            .iter()
            .map(|(from, to, qualifier)| {
                let from = event_or_object_from_index(*from, ocel).cloned();
                let to = event_or_object_from_index(*to, ocel).cloned();

                GraphLink {
                    source: from.get_id().clone(),
                    target: to.get_id().clone(),
                    qualifier: qualifier.clone(),
                }
            })
            .collect();
        Some(OCELGraph { nodes, links })
    } else {
        None
    }
}
