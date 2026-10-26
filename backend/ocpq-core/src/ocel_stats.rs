use process_mining::core::event_data::object_centric::{
    linked_ocel::{LinkedOCELAccess, SlimLinkedOCEL},
    OCELAttributeValue,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Which side of the OCEL an attribute belongs to.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum AttrScope {
    Event,
    Object,
}

/// One distinct categorical value + how often it occurs.
#[derive(Debug, Serialize, Deserialize, JsonSchema, ts_rs::TS)]
#[ts(export)]
pub struct AttrValueCount {
    pub value: String,
    pub count: usize,
}

/// Per-attribute value distribution, tagged by the attribute's value type. Histograms follow the
/// `hist_bin_edges` (N+1) + `hist_counts` (N) convention.
#[derive(Debug, Serialize, Deserialize, JsonSchema, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "kind")]
pub enum OcelAttributeStats {
    Float {
        min: f64,
        max: f64,
        mean: f64,
        hist_bin_edges: Vec<f64>,
        hist_counts: Vec<usize>,
        count: usize,
        null_count: usize,
    },
    Integer {
        min: f64,
        max: f64,
        mean: f64,
        hist_bin_edges: Vec<f64>,
        hist_counts: Vec<usize>,
        count: usize,
        null_count: usize,
    },
    Str {
        top_values: Vec<AttrValueCount>,
        distinct: usize,
        count: usize,
        null_count: usize,
    },
    Bool {
        true_count: usize,
        false_count: usize,
        null_count: usize,
    },
    Time {
        min: String,
        max: String,
        hist_bin_edges_ms: Vec<f64>,
        hist_counts: Vec<usize>,
        count: usize,
        null_count: usize,
    },
    Empty,
}

const NBINS: usize = 20;
const TOP_K: usize = 20;

/// Linear-binned histogram: N+1 edges, N counts. Empty input -> empty vecs.
fn linspace_hist(vals: &[f64], nbins: usize) -> (Vec<f64>, Vec<usize>) {
    if vals.is_empty() {
        return (Vec::new(), Vec::new());
    }
    let min = vals.iter().cloned().fold(f64::INFINITY, f64::min);
    let max = vals.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    if !matches!(max.partial_cmp(&min), Some(std::cmp::Ordering::Greater)) {
        // Single distinct value: one degenerate bin.
        return (vec![min, min + 1.0], vec![vals.len()]);
    }
    // Interpolated and divided before subtracting, so values near opposite limits do not
    // overflow to infinity.
    let step = max / nbins as f64 - min / nbins as f64;
    let edges: Vec<f64> = (0..=nbins)
        .map(|i| {
            let t = i as f64 / nbins as f64;
            min * (1.0 - t) + max * t
        })
        .collect();
    let mut counts = vec![0usize; nbins];
    for &v in vals {
        let mut idx = (v / step - min / step).floor() as isize;
        if idx < 0 {
            idx = 0;
        }
        if idx as usize >= nbins {
            idx = nbins as isize - 1;
        }
        counts[idx as usize] += 1;
    }
    (edges, counts)
}

fn value_to_string(v: &OCELAttributeValue) -> String {
    match v {
        OCELAttributeValue::String(s) => s.clone(),
        OCELAttributeValue::Integer(i) => i.to_string(),
        OCELAttributeValue::Float(f) => f.to_string(),
        OCELAttributeValue::Boolean(b) => b.to_string(),
        OCELAttributeValue::Time(t) => t.to_rfc3339(),
        OCELAttributeValue::Null => "null".to_string(),
    }
}

fn numeric_stats(
    vals: &[&OCELAttributeValue],
    null_count: usize,
    integer: bool,
) -> OcelAttributeStats {
    let nums: Vec<f64> = vals
        .iter()
        .filter_map(|v| match v {
            OCELAttributeValue::Float(f) => Some(*f),
            OCELAttributeValue::Integer(i) => Some(*i as f64),
            _ => None,
        })
        .collect();
    // `get_ocel_attribute_stats` counts NaN and infinities as missing. Other callers get them
    // left out here, as a histogram has no place for them and JSON has no number for them.
    let nums: Vec<f64> = nums.into_iter().filter(|f| f.is_finite()).collect();
    if nums.is_empty() {
        return OcelAttributeStats::Empty;
    }
    let count = nums.len();
    let min = nums.iter().cloned().fold(f64::INFINITY, f64::min);
    let max = nums.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    // A running mean stays finite where the sum of large values would overflow. Dividing before
    // subtracting keeps it finite for values of opposite sign near the limits, too.
    let mean = nums.iter().enumerate().fold(0.0, |mean, (i, x)| {
        mean + (x / (i + 1) as f64 - mean / (i + 1) as f64)
    });
    let (edges, counts) = linspace_hist(&nums, NBINS);
    if integer {
        OcelAttributeStats::Integer {
            min,
            max,
            mean,
            hist_bin_edges: edges,
            hist_counts: counts,
            count,
            null_count,
        }
    } else {
        OcelAttributeStats::Float {
            min,
            max,
            mean,
            hist_bin_edges: edges,
            hist_counts: counts,
            count,
            null_count,
        }
    }
}

fn time_stats(vals: &[&OCELAttributeValue], null_count: usize) -> OcelAttributeStats {
    let times: Vec<(&OCELAttributeValue, f64)> = vals
        .iter()
        .filter_map(|v| match v {
            OCELAttributeValue::Time(t) => Some((*v, t.timestamp_millis() as f64)),
            _ => None,
        })
        .collect();
    if times.is_empty() {
        return OcelAttributeStats::Empty;
    }
    let count = times.len();
    let ms: Vec<f64> = times.iter().map(|(_, m)| *m).collect();
    let (min_v, _) = times
        .iter()
        .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap())
        .unwrap();
    let (max_v, _) = times
        .iter()
        .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap())
        .unwrap();
    let (edges, counts) = linspace_hist(&ms, NBINS);
    OcelAttributeStats::Time {
        min: value_to_string(min_v),
        max: value_to_string(max_v),
        hist_bin_edges_ms: edges,
        hist_counts: counts,
        count,
        null_count,
    }
}

fn categorical_stats(vals: &[&OCELAttributeValue], null_count: usize) -> OcelAttributeStats {
    use std::collections::HashMap;
    let mut freq: HashMap<String, usize> = HashMap::new();
    for v in vals {
        *freq.entry(value_to_string(v)).or_insert(0) += 1;
    }
    if freq.is_empty() {
        return OcelAttributeStats::Empty;
    }
    let count: usize = freq.values().sum();
    let distinct = freq.len();
    let mut top: Vec<AttrValueCount> = freq
        .into_iter()
        .map(|(value, count)| AttrValueCount { value, count })
        .collect();
    top.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
    top.truncate(TOP_K);
    OcelAttributeStats::Str {
        top_values: top,
        distinct,
        count,
        null_count,
    }
}

fn boolean_stats(vals: &[&OCELAttributeValue], null_count: usize) -> OcelAttributeStats {
    let mut true_count = 0;
    let mut false_count = 0;
    for v in vals {
        if let OCELAttributeValue::Boolean(b) = v {
            if *b {
                true_count += 1;
            } else {
                false_count += 1;
            }
        }
    }
    if true_count + false_count == 0 {
        return OcelAttributeStats::Empty;
    }
    OcelAttributeStats::Bool {
        true_count,
        false_count,
        null_count,
    }
}

/// Compute value stats for one `(scope, type, attribute)` from the loaded OCEL. Dispatches on the
/// attribute's declared value type; falls back to categorical when the type is unknown.
pub fn get_ocel_attribute_stats(
    ocel: &SlimLinkedOCEL,
    scope: AttrScope,
    type_name: &str,
    attr: &str,
) -> OcelAttributeStats {
    let declared = match scope {
        AttrScope::Event => ocel.get_ev_type(type_name),
        AttrScope::Object => ocel.get_ob_type(type_name),
    }
    .and_then(|t| t.attributes.iter().find(|a| a.name == attr))
    .map(|a| a.value_type.to_lowercase());

    // NaN and infinities count as missing, since they cannot be charted or written as JSON numbers.
    let has_value = |v: &OCELAttributeValue| match v {
        OCELAttributeValue::Null => false,
        OCELAttributeValue::Float(f) => f.is_finite(),
        _ => true,
    };
    let mut vals: Vec<&OCELAttributeValue> = Vec::new();
    let mut null_count = 0usize;
    match scope {
        AttrScope::Event => {
            for ev in ocel.get_evs_of_type(type_name) {
                match ocel.get_ev_attr_val(ev, attr) {
                    Some(v) if has_value(v) => vals.push(v),
                    _ => null_count += 1,
                }
            }
        }
        AttrScope::Object => {
            for ob in ocel.get_obs_of_type(type_name) {
                let before = vals.len();
                for (_t, v) in ocel.get_ob_attr_vals(ob, attr) {
                    if has_value(v) {
                        vals.push(v);
                    }
                }
                if vals.len() == before {
                    null_count += 1;
                }
            }
        }
    }

    match declared.as_deref() {
        Some("float") => numeric_stats(&vals, null_count, false),
        Some("integer") => numeric_stats(&vals, null_count, true),
        Some("boolean") => boolean_stats(&vals, null_count),
        Some("time") => time_stats(&vals, null_count),
        Some("string") => categorical_stats(&vals, null_count),
        _ if vals.is_empty() => OcelAttributeStats::Empty,
        _ => categorical_stats(&vals, null_count),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn floats(vals: &[f64]) -> Vec<OCELAttributeValue> {
        vals.iter().map(|f| OCELAttributeValue::Float(*f)).collect()
    }

    #[test]
    fn numeric_stats_leave_out_nan_and_infinity() {
        let vals = floats(&[1.0, f64::NAN, 3.0, f64::INFINITY]);
        let refs: Vec<&OCELAttributeValue> = vals.iter().collect();
        let stats = numeric_stats(&refs, 2, false);
        let OcelAttributeStats::Float {
            min,
            max,
            mean,
            count,
            null_count,
            ..
        } = stats
        else {
            panic!("expected float stats, got {stats:?}");
        };
        assert_eq!((min, max, mean, count, null_count), (1.0, 3.0, 2.0, 2, 2));
        // JSON has no NaN, so serde writes `null`, which the UI cannot format.
        let json = serde_json::to_string(&numeric_stats(&refs, 0, false)).unwrap();
        assert!(!json.contains(":null"), "{json}");
    }

    #[test]
    fn numeric_stats_mean_stays_finite_for_huge_values() {
        let vals = floats(&[f64::MAX, f64::MAX]);
        let refs: Vec<&OCELAttributeValue> = vals.iter().collect();
        let OcelAttributeStats::Float { mean, .. } = numeric_stats(&refs, 0, false) else {
            panic!("expected float stats");
        };
        assert_eq!(mean, f64::MAX);
    }

    #[test]
    fn numeric_stats_stay_finite_for_values_near_opposite_limits() {
        let vals = floats(&[f64::MAX, -f64::MAX]);
        let refs: Vec<&OCELAttributeValue> = vals.iter().collect();
        let stats = numeric_stats(&refs, 0, false);
        let OcelAttributeStats::Float {
            mean,
            hist_bin_edges,
            hist_counts,
            ..
        } = &stats
        else {
            panic!("expected float stats, got {stats:?}");
        };
        assert_eq!(*mean, 0.0);
        assert!(
            hist_bin_edges.iter().all(|e| e.is_finite()),
            "{hist_bin_edges:?}"
        );
        assert_eq!((hist_counts[0], hist_counts[NBINS - 1]), (1, 1));
    }
}
