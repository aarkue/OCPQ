use core::f32;
use std::collections::HashMap;

use advanced::EventOrObjectType;
use graph_discovery::{
    discover_count_constraints, discover_ef_constraints, discover_or_constraints_new,
};
use itertools::Itertools;

use process_mining::core::event_data::object_centric::linked_ocel::SlimLinkedOCEL;
use serde::{Deserialize, Serialize};

use crate::binding_box::BindingBoxTree;

// use self::evaluation::{get_count_constraint_fraction, get_ef_constraint_fraction};

pub mod advanced;
pub mod evaluation;
pub mod graph_discovery;

pub static SAMPLE_MIN_NUM_INSTANCES: usize = 3000;
pub static SAMPLE_FRAC: f32 = 0.1;
pub static RNG_SEED: u64 = 13375050;

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CountConstraintOptions {
    pub object_types: Vec<String>,
    pub event_types: Vec<String>,
    pub cover_fraction: f32,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EventuallyFollowsConstraintOptions {
    pub object_types: Vec<String>,
    pub cover_fraction: f32,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ORConstraintOptions {
    pub object_types: Vec<String>,
    pub event_types: Vec<String>,
    pub cover_fraction: f32,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AutoDiscoverConstraintsRequest {
    pub count_constraints: Option<CountConstraintOptions>,
    pub eventually_follows_constraints: Option<EventuallyFollowsConstraintOptions>,
    pub or_constraints: Option<ORConstraintOptions>,
}
#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AutoDiscoverConstraintsResponse {
    pub constraints: Vec<(String, BindingBoxTree)>,
}

pub fn auto_discover_constraints_with_options(
    ocel: &SlimLinkedOCEL,
    options: AutoDiscoverConstraintsRequest,
) -> AutoDiscoverConstraintsResponse {
    let mut trees_per_type: HashMap<EventOrObjectType, Vec<BindingBoxTree>> = HashMap::new();
    let mut ret = AutoDiscoverConstraintsResponse {
        constraints: Vec::new(),
    };
    if let Some(eventually_follows_options) = options.eventually_follows_constraints {
        for ot in &eventually_follows_options.object_types {
            for c in discover_ef_constraints(ocel, eventually_follows_options.cover_fraction, ot) {
                ret.constraints
                    .push((c.get_constraint_name(), c.get_full_tree()));
                trees_per_type
                    .entry(EventOrObjectType::Object(ot.clone()))
                    .or_default()
                    .push(c.to_subtree("X".to_string(), 0, 2, 3))
            }
        }
    };
    if let Some(count_opts) = &options.count_constraints {
        let mut types = count_opts
            .object_types
            .iter()
            .map(|ot| EventOrObjectType::Object(ot.clone()))
            .collect_vec();

        types.extend(
            count_opts
                .event_types
                .iter()
                .map(|et| EventOrObjectType::Event(et.clone())),
        );
        for t in types {
            for cc in discover_count_constraints(ocel, count_opts.cover_fraction, t.clone()) {
                ret.constraints
                    .push((cc.get_constraint_name(), cc.get_full_tree()));

                trees_per_type
                    .entry(t.clone())
                    .or_default()
                    .push(cc.to_subtree("X".to_string(), 0, 2));
            }
        }
    }
    if let Some(or_constraint_option) = options.or_constraints {
        for ot in &or_constraint_option.object_types {
            let ocel_type = EventOrObjectType::Object(ot.clone());
            ret.constraints.extend(discover_or_constraints_new(
                ocel,
                &ocel_type,
                or_constraint_option.cover_fraction,
            ));
        }
        for et in &or_constraint_option.event_types {
            let ocel_type = EventOrObjectType::Event(et.clone());
            ret.constraints.extend(discover_or_constraints_new(
                ocel,
                &ocel_type,
                or_constraint_option.cover_fraction,
            ));
        }
    }

    ret
}
