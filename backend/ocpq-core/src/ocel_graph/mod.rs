use std::collections::{HashSet, VecDeque};

use process_mining::core::event_data::object_centric::{
    linked_ocel::{slim_linked_ocel::EventOrObjectIndex, LinkedOCELAccess, SlimLinkedOCEL},
    OCELEvent, OCELObject,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{
    discovery::graph_discovery::{get_symmetric_rels, SymmetricRel},
    preprocessing::linked_ocel::event_or_object_from_index,
};

#[derive(Serialize, Deserialize, Debug, JsonSchema)]
#[serde(untagged)]
pub enum GraphNode {
    Event(OCELEvent),
    Object(OCELObject),
}
#[derive(Serialize, Deserialize, Debug, JsonSchema)]
pub struct GraphLink {
    source: String,
    target: String,
    qualifier: String,
}

#[derive(Serialize, Deserialize, Debug, JsonSchema)]
pub struct OCELGraph {
    nodes: Vec<GraphNode>,
    links: Vec<GraphLink>,
    /// Whether nodes within `max_distance` were left out to stay within `max_nodes`.
    truncated: bool,
    /// Ids of the nodes whose relations are all in the graph. The others can be expanded further.
    expanded: Vec<String>,
}

/// The node limit when the options set no `max_nodes`.
pub const DEFAULT_MAX_GRAPH_NODES: usize = 500;

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[derive(TS)]
#[ts(export)]
pub struct OCELGraphOptions {
    max_distance: usize,
    root: String,
    root_is_object: bool,
    rels_size_ignore_threshold: usize,
    spanning_tree: bool,
    /// Stop adding nodes once the graph has this many. Defaults to [`DEFAULT_MAX_GRAPH_NODES`].
    #[serde(default)]
    #[ts(optional)]
    max_nodes: Option<usize>,
}

pub fn get_ocel_graph(ocel: &SlimLinkedOCEL, options: OCELGraphOptions) -> Option<OCELGraph> {
    let root_index_opt = match options.root_is_object {
        true => ocel
            .get_ob_by_id(options.root)
            .map(EventOrObjectIndex::Object),

        false => ocel
            .get_ev_by_id(options.root)
            .map(EventOrObjectIndex::Event),
    };
    if let Some(root_index) = root_index_opt {
        let max_nodes = options.max_nodes.unwrap_or(DEFAULT_MAX_GRAPH_NODES).max(1);
        // Breadth-first, so a graph cut off at `max_nodes` keeps the nodes closest to the root.
        let mut queue = VecDeque::from([(root_index, 0)]);
        let mut done_indices: Vec<EventOrObjectIndex> = vec![root_index];
        let mut done_set: HashSet<EventOrObjectIndex> = HashSet::from([root_index]);
        let mut expanded_arcs: Vec<(EventOrObjectIndex, EventOrObjectIndex, String)> = Vec::new();
        let mut seen_arcs: HashSet<(EventOrObjectIndex, EventOrObjectIndex, String)> =
            HashSet::new();
        let mut truncated = false;
        let mut expanded = Vec::new();
        let max_distance = options.max_distance;
        while let Some((index, distance)) = queue.pop_front() {
            if distance < max_distance {
                let rels = get_symmetric_rels(&index, ocel);
                // Check for rels_size_ignore_threshold but also continue if at the root node (root node always gets expanded)
                if root_index == index || rels.len() < options.rels_size_ignore_threshold {
                    let mut complete = true;
                    for SymmetricRel {
                        index: r,
                        reversed,
                        qualifier,
                    } in rels
                    {
                        let is_new = !done_set.contains(&r);
                        if is_new {
                            if done_indices.len() >= max_nodes {
                                truncated = true;
                                complete = false;
                                continue;
                            }
                            queue.push_back((r, distance + 1));
                            done_indices.push(r);
                            done_set.insert(r);
                        } else if options.spanning_tree {
                            // Its relation is left out, so the node is not fully expanded.
                            complete = false;
                            continue;
                        }
                        let arc = if !reversed {
                            (index, r, qualifier)
                        } else {
                            (r, index, qualifier)
                        };
                        // Both ends of a relation list it, so it turns up again when the other end is expanded.
                        if seen_arcs.insert(arc.clone()) {
                            expanded_arcs.push(arc);
                        }
                    }
                    if complete {
                        expanded.push(index);
                    }
                }
            }
        }
        let nodes = done_indices
            .iter()
            .map(|i| match i {
                EventOrObjectIndex::Object(o_index) => {
                    GraphNode::Object(ocel.get_full_ob(o_index).into_owned())
                }
                EventOrObjectIndex::Event(e_index) => {
                    GraphNode::Event(ocel.get_full_ev(e_index).into_owned())
                }
            })
            .collect();
        let links = expanded_arcs
            .iter()
            .map(|(from, to, qualifier)| {
                let from = event_or_object_from_index(*from, ocel);
                let to = event_or_object_from_index(*to, ocel);

                GraphLink {
                    source: from.get_id().clone(),
                    target: to.get_id().clone(),
                    qualifier: qualifier.clone(),
                }
            })
            .collect();
        let expanded = expanded
            .into_iter()
            .map(|i| event_or_object_from_index(i, ocel).get_id().clone())
            .collect();
        Some(OCELGraph {
            nodes,
            links,
            truncated,
            expanded,
        })
    } else {
        None
    }
}
