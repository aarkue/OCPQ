//! Neighbourhood graphs on the hand-written `edge-cases` log, where customer c2 places o3, o4, o5
//! and events e6, e7, e8 all relate to o3.

mod common;

use common::fixture;
use ocpq_core::ocel_graph::{get_ocel_graph, OCELGraphOptions};
use serde_json::{json, Value};

fn graph(root: &str, root_is_object: bool, max_distance: usize, max_nodes: Option<usize>) -> Value {
    let options: OCELGraphOptions = serde_json::from_value(json!({
        "root": root,
        "rootIsObject": root_is_object,
        "maxDistance": max_distance,
        "relsSizeIgnoreThreshold": 100,
        "spanningTree": false,
        "maxNodes": max_nodes,
    }))
    .unwrap();
    serde_json::to_value(get_ocel_graph(&fixture("edge-cases.json"), options).unwrap()).unwrap()
}

fn node_ids(g: &Value) -> Vec<String> {
    g["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n["id"].as_str().unwrap().to_string())
        .collect()
}

fn links(g: &Value) -> Vec<(String, String)> {
    let mut l: Vec<_> = g["links"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| {
            (
                l["source"].as_str().unwrap().to_string(),
                l["target"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    l.sort();
    l
}

#[test]
fn each_relation_is_listed_once() {
    // o3 is reached from e6 and then expanded, which finds e6 -> o3 a second time from o3's side.
    let g = graph("e6", false, 2, None);
    assert_eq!(
        links(&g),
        [("c2", "o3"), ("e6", "o3"), ("e7", "o3"), ("e8", "o3")]
            .map(|(a, b)| (a.to_string(), b.to_string()))
    );
    assert_eq!(g["truncated"], false);
}

#[test]
fn lists_the_nodes_whose_relations_are_all_shown() {
    // e6 and o3 were expanded. c2, e7 and e8 sit at the edge, two hops out.
    let g = graph("e6", false, 2, None);
    assert_eq!(g["expanded"], json!(["e6", "o3"]));
    // Cut short by max_nodes, c2 itself is not complete.
    assert_eq!(graph("c2", true, 2, Some(3))["expanded"], json!([]));
}

#[test]
fn stops_at_max_nodes_keeping_the_closest_ones() {
    let g = graph("c2", true, 2, Some(3));
    let ids = node_ids(&g);
    assert_eq!(ids.len(), 3);
    assert_eq!(ids[0], "c2");
    // Breadth-first search keeps two orders c2 places over the events two hops away.
    assert!(ids[1..].iter().all(|id| id.starts_with('o')), "{ids:?}");
    assert_eq!(g["truncated"], true);
    for (from, to) in links(&g) {
        assert!(
            ids.contains(&from) && ids.contains(&to),
            "link {from} -> {to} leaves the graph"
        );
    }
}
