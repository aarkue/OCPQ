// Idea: given >1 (arbitrary) binding box subtrees where initial binding steps are missing
// with the same input bindings (or at least a common subset?) use sampling of bindings to evaluate the binding subtrees
// Detect patterns (e.g., OR) based on the boolean results for the sampled bindings (i..e., if the subtree is satisfied for the binding)

use std::{cmp::max, collections::HashMap};

use itertools::Itertools;

use process_mining::ocel::linked_ocel::{
    index_linked_ocel::EventOrObjectIndex, IndexLinkedOCEL, LinkedOCELAccess,
};
use rand::{rngs::StdRng, seq::IteratorRandom, SeedableRng};
use rayon::iter::{IntoParallelRefIterator, ParallelIterator};

use crate::binding_box::{
    structs::{BindingBoxTreeNode, Constraint, EventVariable, ObjectVariable, Variable},
    Binding, BindingBox, BindingBoxTree,
};

use super::{
    graph_discovery::discover_count_constraints_for_supporting_instances, RNG_SEED, SAMPLE_FRAC,
    SAMPLE_MIN_NUM_INSTANCES,
};

// 1st Step: Allow building of  (simple) sampled bindings based on object/event type
pub fn generate_sample_bindings(
    ocel: &IndexLinkedOCEL,
    ocel_types: &Vec<EventOrObjectType>,
    target_variable: Variable,
) -> Vec<Binding> {
    let mut rng = StdRng::seed_from_u64(RNG_SEED);
    match target_variable {
        Variable::Event(ev) => {
            let instances: Vec<_> = ocel_types
                .iter()
                .flat_map(|t| ocel.get_evs_of_type(t.inner()))
                .collect();
            let sample_count = if instances.len() >= SAMPLE_MIN_NUM_INSTANCES {
                (instances.len() as f32 * SAMPLE_FRAC).ceil() as usize
            } else {
                instances.len()
            };
            instances
                .iter()
                .choose_multiple(&mut rng, sample_count)
                .iter()
                .map(|i| Binding::default().expand_with_ev(ev, ***i))
                .collect()
        }
        Variable::Object(ov) => {
            let instances: Vec<_> = ocel_types
                .iter()
                .flat_map(|t| ocel.get_obs_of_type(t.inner()))
                .collect();
            let sample_count = if instances.len() >= SAMPLE_MIN_NUM_INSTANCES {
                (instances.len() as f32 * SAMPLE_FRAC).ceil() as usize
            } else {
                instances.len()
            };
            instances
                .iter()
                .choose_multiple(&mut rng, sample_count)
                .iter()
                .map(|i| Binding::default().expand_with_ob(ov, ***i))
                .collect()
        }
    }
}

pub fn binding_to_instances(
    bindings: &Vec<Binding>,
    variable: Variable,
) -> Vec<Option<EventOrObjectIndex>> {
    bindings
        .iter()
        .map(|b| b.get_any_index(&variable))
        .collect_vec()
}

// Given a list of bindings, check if the given subtree is violated (in some child binding)
// Results are a list of bools of the same size as the input bindings
// True: Subtree was satisfied for Binding, False: Subtree was violated for Binding
pub fn label_bindings(
    ocel: &IndexLinkedOCEL,
    bindings: &Vec<Binding>,
    subtree: &BindingBoxTree,
) -> Vec<bool> {
    bindings
        .par_iter()
        .map(|b| {
            let ((_x, y), _skipped) = subtree.nodes[0].evaluate(0, (*b).clone(), subtree, ocel);
            let is_violated = y.iter().any(|(_, v)| v.is_some());
            !is_violated
        })
        .collect()
}

pub fn get_labeled_instances(
    ocel: &IndexLinkedOCEL,
    ocel_type: &EventOrObjectType,
    subtree: BindingBoxTree,
) -> Vec<(EventOrObjectIndex, bool)> {
    let variable = match ocel_type {
        EventOrObjectType::Event(_) => Variable::Event(EventVariable(0)),
        EventOrObjectType::Object(_) => Variable::Object(ObjectVariable(0)),
    };
    let bindings = generate_sample_bindings(ocel, &vec![ocel_type.clone()], variable.clone());

    let violated_instances = bindings
        .iter()
        .flat_map(|b| {
            let ((_x, y), _skipped) = subtree.nodes[0].evaluate(0, (*b).clone(), &subtree, ocel);
            let is_violated = y.iter().any(|(_, v)| v.is_some());
            b.get_any_index(&variable)
                .map(|instance| (instance, !is_violated))
        })
        .collect_vec();
    violated_instances
}

// 2nd Step: Test Combination of Trees
//
pub fn test_tree_combinations(
    ocel: &IndexLinkedOCEL,
    subtrees: Vec<BindingBoxTree>,
    input_bindings: Vec<Binding>,
    input_variable: Variable,
    ocel_type: &EventOrObjectType,
) -> Vec<BindingBoxTree> {
    let mut ret = Vec::new();
    // First index: Binding index, second index: subtree index;
    // Value: true if subtree is satisfied for binding, false otherwise
    let sat_subtrees_per_binding: Vec<_> = input_bindings
        .par_iter()
        .map(|b| {
            subtrees
                .iter()
                .map(|t| {
                    let ((_overall_res, root_res), _skipped) =
                        t.nodes[0].evaluate(0, b.clone(), t, ocel);
                    root_res.iter().any(|(_, v)| v.is_some())
                })
                .collect_vec()
        })
        .collect();

    let num_tree_sat = subtrees
        .iter()
        .enumerate()
        .map(|(t_index, _t)| {
            sat_subtrees_per_binding
                .iter()
                .filter(|r| r[t_index])
                .count()
        })
        .collect_vec();
    // Check combinations of subtrees
    for i in 0..subtrees.len() {
        for j in (i + 1)..subtrees.len() {
            let num_or_sat = sat_subtrees_per_binding
                .iter()
                .filter(|r| r[i] || r[j])
                .count();
            let good_or_frac = num_or_sat as f32 / max(num_tree_sat[i], num_tree_sat[j]) as f32;
            let good_sat_frac = num_or_sat as f32 / input_bindings.len() as f32;
            if (0.8..0.98).contains(&good_sat_frac) && good_or_frac >= 1.33 {
                let tree1 = &subtrees[i];
                let tree2 = &subtrees[j];
                let name1 = "A".to_string();
                let name2: String = "B".to_string();
                let mut bbox = BindingBox {
                    constraints: vec![Constraint::SAT {
                        child_names: vec![name1.clone(), name2.clone()],
                    }],
                    ..Default::default()
                };
                match ocel_type {
                    EventOrObjectType::Event(et) => bbox.new_event_vars.insert(
                        EventVariable(input_variable.to_inner()),
                        vec![et.clone()].into_iter().collect(),
                    ),
                    EventOrObjectType::Object(ot) => bbox.new_object_vars.insert(
                        ObjectVariable(input_variable.to_inner()),
                        vec![ot.clone()].into_iter().collect(),
                    ),
                };
                let or_box = BindingBoxTreeNode::Box(bbox, vec![1, 1 + tree1.nodes.len()]);
                let mut or_tree = BindingBoxTree {
                    nodes: vec![or_box],
                    edge_names: HashMap::default(),
                };
                for tn in &tree1.nodes {
                    if let BindingBoxTreeNode::Box(tn_box, tn_children) = tn {
                        or_tree.nodes.push(BindingBoxTreeNode::Box(
                            tn_box.clone(),
                            tn_children.iter().map(|c| c + 1).collect(),
                        ))
                    }
                }
                for tn in &tree2.nodes {
                    if let BindingBoxTreeNode::Box(tn_box, tn_children) = tn {
                        or_tree.nodes.push(BindingBoxTreeNode::Box(
                            tn_box.clone(),
                            tn_children
                                .iter()
                                .map(|c| c + 1 + tree1.nodes.len())
                                .collect(),
                        ))
                    }
                }
                or_tree.edge_names.insert((0, 1), name1.clone());
                or_tree
                    .edge_names
                    .insert((0, 1 + tree1.nodes.len()), name2.clone());
                or_tree.edge_names.extend(
                    tree1
                        .edge_names
                        .iter()
                        .map(|((from, to), name)| ((*from + 1, to + 1), name.clone())),
                );
                or_tree
                    .edge_names
                    .extend(tree2.edge_names.iter().map(|((from, to), name)| {
                        (
                            (*from + 1 + tree1.nodes.len(), to + 1 + tree1.nodes.len()),
                            name.clone(),
                        )
                    }));

                ret.push(or_tree);
                println!("Good OR candidate with {good_or_frac}");
                // println!("{:#?}\n{:#?}\n\n", tree1, tree1);
            }
        }
    }
    ret
}

/// Previous version of OR constraint discovery by combining previously discovered constraints
/// For the new version see [`graph_discovery::discover_or_constraints_new`]
///
///
/// The new version (as did the first) _specifically_ discovers constraints for violating/non-supporting bindings
pub fn discover_or_constraints_old(
    ocel: &IndexLinkedOCEL,
    ocel_type: &EventOrObjectType,
    input_variable: Variable,
    subtrees: Vec<BindingBoxTree>,
) -> Vec<BindingBoxTree> {
    let bindings = generate_sample_bindings(ocel, &vec![ocel_type.clone()], input_variable.clone());
    let mut all_subtrees = subtrees.clone();
    for st in &subtrees {
        let violated_instances = bindings
            .iter()
            .filter(|b| {
                let ((_x, y), _skipped) = st.nodes[0].evaluate(0, (*b).clone(), st, ocel);
                y.iter().any(|(_, v)| v.is_some())
            })
            .filter_map(|b| b.get_any_index(&input_variable))
            .collect_vec();
        let count_constraints = discover_count_constraints_for_supporting_instances(
            ocel,
            0.85,
            violated_instances.iter(),
            ocel_type,
        );
        for cc in count_constraints {
            all_subtrees.push(cc.to_subtree("A".to_string(), input_variable.to_inner(), 850))
        }
    }
    test_tree_combinations(ocel, all_subtrees, bindings, input_variable, ocel_type)
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum EventOrObjectType {
    Event(String),
    Object(String),
}

impl EventOrObjectType {
    pub fn inner(&self) -> &String {
        match self {
            EventOrObjectType::Event(et) => et,
            EventOrObjectType::Object(ot) => ot,
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum EventOrObjectTypeRef<'a> {
    Event(&'a str),
    Object(&'a str),
}

impl<'a> EventOrObjectTypeRef<'a> {
    pub fn inner(&'a self) -> &'a str {
        match self {
            EventOrObjectTypeRef::Event(et) => et,
            EventOrObjectTypeRef::Object(ot) => ot,
        }
    }
}
