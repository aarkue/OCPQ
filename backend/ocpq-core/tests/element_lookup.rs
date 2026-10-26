//! Id search and the relations of one element, mostly on the hand-written `edge-cases` log.

mod common;

use common::fixture;
use ocpq_core::{
    element_lookup::{get_element_relations, search_elements, ElementSearchHit, RelatedElement},
    process_mining::core::event_data::object_centric::linked_ocel::LinkedOCELAccess,
};

fn ids(hits: &[ElementSearchHit]) -> Vec<&str> {
    hits.iter().map(|h| h.id.as_str()).collect()
}

#[test]
fn search_ranks_exact_then_prefix_then_substring() {
    let ocel = fixture("edge-cases.json");
    let hits = search_elements(&ocel, "E1", 10);
    assert_eq!(ids(&hits), ["e1", "e10"]);
    assert!(hits.iter().all(|h| h.is_event));
    assert_eq!(hits[0].type_name, "place");

    // `1` is a prefix of nothing but sits inside o1, c1, e1 and e10.
    let hits = search_elements(&ocel, "1", 10);
    assert_eq!(ids(&hits), ["o1", "c1", "e1", "e10"]);
}

#[test]
fn search_stops_at_the_limit() {
    let ocel = fixture("edge-cases.json");
    let hits = search_elements(&ocel, "o", 3);
    assert_eq!(ids(&hits), ["o1", "o2", "o3"]);
    assert!(search_elements(&ocel, "  ", 10).is_empty());
}

fn rels(rels: &[RelatedElement]) -> Vec<(&str, &str, &str)> {
    rels.iter()
        .map(|r| (r.id.as_str(), r.type_name.as_str(), r.qualifier.as_str()))
        .collect()
}

#[test]
fn object_relations_list_its_events_and_both_o2o_directions() {
    let ocel = fixture("edge-cases.json");
    let o1 = get_element_relations(&ocel, true, "o1", 10).unwrap();
    assert_eq!(
        o1.events
            .iter()
            .map(|r| (r.id.as_str(), r.type_name.as_str(), r.qualifier.as_str()))
            .collect::<Vec<_>>(),
        [
            ("e1", "place", "order"),
            ("e2", "pay", "order"),
            ("e3", "ship", "order")
        ]
    );
    assert_eq!(o1.num_events, 3);
    assert_eq!(rels(&o1.incoming_objects), [("c1", "customer", "places")]);
    assert_eq!(o1.num_incoming_objects, 1);
    assert!(o1.objects.is_empty());

    let c1 = get_element_relations(&ocel, true, "c1", 10).unwrap();
    assert_eq!(
        rels(&c1.objects),
        [("o1", "order", "places"), ("o2", "order", "places")]
    );
    assert_eq!(c1.num_objects, 2);
    assert!(c1.events.is_empty() && c1.incoming_objects.is_empty());
}

#[test]
fn event_relations_list_only_its_objects() {
    let ocel = fixture("edge-cases.json");
    let e1 = get_element_relations(&ocel, false, "e1", 10).unwrap();
    assert_eq!(rels(&e1.objects), [("o1", "order", "order")]);
    assert_eq!(e1.num_objects, 1);
    assert!(e1.events.is_empty() && e1.incoming_objects.is_empty());
    assert!(get_element_relations(&ocel, false, "o1", 10).is_none());
}

#[test]
fn element_relations_are_capped_but_counted_in_full() {
    let ocel = fixture("edge-cases.json");
    let o3 = get_element_relations(&ocel, true, "o3", 2).unwrap();
    assert_eq!(
        o3.events.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
        ["e6", "e7"]
    );
    assert_eq!(o3.num_events, 3);
    assert!(get_element_relations(&ocel, true, "nope", 2).is_none());
}

#[test]
fn object_events_come_oldest_first() {
    let ocel = fixture("order-management.xml.gz");
    let busiest = ocel
        .get_all_obs()
        .max_by_key(|ob| ocel.get_e2o_rev(ob).count())
        .unwrap();
    let id = ocel.get_ob_id(busiest);
    let rels = get_element_relations(&ocel, true, id, 1000).unwrap();
    assert!(rels.num_events > 100);
    assert_eq!(rels.events.len(), 1000.min(rels.num_events));
    assert!(rels.events.windows(2).all(|w| w[0].time <= w[1].time));
}
