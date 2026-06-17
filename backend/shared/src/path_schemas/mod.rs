use std::collections::{HashMap, HashSet};

use chrono::{DateTime, FixedOffset};
use process_mining::analysis::object_centric::path_schemas as ps;
use process_mining::core::event_data::object_centric::linked_ocel::{
    LinkedOCELAccess, SlimLinkedOCEL,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A reference to an OCEL type: an event type or object type, by name. Mirrors rust4pm's
/// `TypeRef` (event and object type names are not disjoint, so the kind is carried along).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PathTypeRef {
    pub name: String,
    pub is_event: bool,
}

impl PathTypeRef {
    fn to_ps(&self) -> ps::TypeRef {
        if self.is_event {
            ps::TypeRef::Event(self.name.clone())
        } else {
            ps::TypeRef::Object(self.name.clone())
        }
    }
}

impl From<ps::TypeRef> for PathTypeRef {
    fn from(value: ps::TypeRef) -> Self {
        PathTypeRef {
            name: value.name().to_string(),
            is_event: value.is_event(),
        }
    }
}

fn to_ps_allowed(allowed_types: &Option<Vec<PathTypeRef>>) -> Option<HashSet<ps::TypeRef>> {
    allowed_types
        .as_ref()
        .map(|types| types.iter().map(PathTypeRef::to_ps).collect())
}

/// A node (event or object type) in the OCEL type graph.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PathTypeNode {
    pub name: String,
    pub is_event: bool,
    /// Number of entities of this type.
    pub count: usize,
}

/// A qualified relationship edge in the OCEL type graph.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PathTypeEdge {
    pub source: PathTypeRef,
    pub target: PathTypeRef,
    pub qualifier: String,
}

/// The OCEL type graph for visualization.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PathTypeGraph {
    pub nodes: Vec<PathTypeNode>,
    pub edges: Vec<PathTypeEdge>,
}

/// Temporal filter applied along discovered paths.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum TemporalMode {
    None,
    Forward,
    Bounded,
}

/// Which target event to keep per source.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum SelectionMode {
    All,
    First,
    Last,
    Closest,
}

/// Options for path-schema discovery between two types.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PathSchemaOptions {
    pub source: PathTypeRef,
    pub target: Option<PathTypeRef>,
    pub max_length: usize,
    pub temporal: TemporalMode,
    pub selection: SelectionMode,
    /// Time window in seconds when `temporal` is `Bounded`.
    pub bounded_seconds: Option<i32>,
    /// Global cap on connections per schema (safety limit).
    pub max_connections: Option<usize>,
    /// Optional selectivity threshold for early termination.
    pub selectivity_threshold: Option<f64>,
    /// Keep only the top-k schemas (by selectivity) in the result.
    pub max_schemas: Option<usize>,
    /// Optional set of types the intermediate steps may pass through; `None` allows all. The
    /// source and target are always permitted, so only the steps in between are constrained.
    pub allowed_types: Option<Vec<PathTypeRef>>,
}

/// Throughput time statistics (seconds) over event-to-event connections.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ThroughputStats {
    pub min: f64,
    pub max: f64,
    pub mean: f64,
    pub median: f64,
}

impl From<ps::ThroughputStats> for ThroughputStats {
    fn from(t: ps::ThroughputStats) -> Self {
        ThroughputStats {
            min: t.min,
            max: t.max,
            mean: t.mean,
            median: t.median,
        }
    }
}

/// One enumerated schema with its metrics, for the heatmap table.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PathSchemaRow {
    /// Enumeration index (stable for given source/target/max_length/allowed_types); used for detail lookups.
    pub index: usize,
    pub schema: String,
    pub source: PathTypeRef,
    pub target: PathTypeRef,
    pub length: usize,
    pub support: usize,
    pub coverage: f64,
    pub selectivity: f64,
    pub reach: f64,
    pub exclusivity: f64,
    pub path_count: usize,
    pub is_dead: bool,
    pub selectivity_pruned: bool,
    pub limit_reached: bool,
    /// Index of the connection-equivalence class this schema belongs to.
    pub equivalence_class: usize,
    pub throughput: Option<ThroughputStats>,
}

/// Result of a path-schema discovery run.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PathSchemaResult {
    pub source: PathTypeRef,
    pub total_sources: usize,
    pub rows: Vec<PathSchemaRow>,
    /// Number of distinct connection-equivalence classes among all enumerated schemas.
    pub equivalence_class_count: usize,
}

/// Build the OCEL type graph with per-type entity counts.
pub fn path_type_graph(ocel: &SlimLinkedOCEL) -> PathTypeGraph {
    let tg = ps::TypeGraph::from_linked_ocel(ocel);

    let mut nodes: Vec<PathTypeNode> =
        Vec::with_capacity(tg.event_types.len() + tg.object_types.len());
    for name in &tg.event_types {
        nodes.push(PathTypeNode {
            name: name.clone(),
            is_event: true,
            count: ocel.get_evs_of_type(name).count(),
        });
    }
    for name in &tg.object_types {
        nodes.push(PathTypeNode {
            name: name.clone(),
            is_event: false,
            count: ocel.get_obs_of_type(name).count(),
        });
    }

    let edges = tg
        .edges
        .iter()
        .map(|e| PathTypeEdge {
            source: e.source.clone().into(),
            target: e.target.clone().into(),
            qualifier: e.qualifier.clone(),
        })
        .collect();

    PathTypeGraph { nodes, edges }
}

fn map_temporal(mode: TemporalMode, bounded_seconds: Option<i32>) -> ps::TemporalConstraint {
    match mode {
        TemporalMode::None => ps::TemporalConstraint::None,
        TemporalMode::Forward => ps::TemporalConstraint::Forward,
        // The bounded window is an absolute magnitude, so negatives clamp to 0.
        TemporalMode::Bounded => {
            ps::TemporalConstraint::Bounded(bounded_seconds.unwrap_or(0).max(0) as u64)
        }
    }
}

fn map_selection(mode: SelectionMode) -> ps::EventSelection {
    match mode {
        SelectionMode::All => ps::EventSelection::All,
        SelectionMode::First => ps::EventSelection::First,
        SelectionMode::Last => ps::EventSelection::Last,
        SelectionMode::Closest => ps::EventSelection::Closest,
    }
}

/// Enumerate path schemas for the given options and compute their metrics.
pub fn discover_path_schemas(
    ocel: &SlimLinkedOCEL,
    options: PathSchemaOptions,
) -> PathSchemaResult {
    let query = ps::PathSchemaQuery {
        source: options.source.to_ps(),
        target: options.target.as_ref().map(PathTypeRef::to_ps),
        max_length: options.max_length,
        allow_cycles: false,
        allowed_types: options
            .allowed_types
            .as_ref()
            .map(|types| types.iter().map(PathTypeRef::to_ps).collect()),
        params: ps::PathConnectionParams {
            temporal: map_temporal(options.temporal, options.bounded_seconds),
            selection: map_selection(options.selection),
            max_connections: options.max_connections,
            dedup_targets: true,
            selectivity_threshold: options.selectivity_threshold,
        },
    };

    let discovery = ps::discover_path_schemas(ocel, &query);

    let mut rows: Vec<PathSchemaRow> = discovery
        .schemas
        .into_iter()
        .map(|s| {
            let m = s.stats.metrics;
            PathSchemaRow {
                index: s.index,
                schema: s.schema,
                source: s.source.into(),
                target: s.target.into(),
                length: s.length,
                support: m.support,
                coverage: m.coverage,
                selectivity: m.selectivity,
                reach: m.reach,
                exclusivity: m.exclusivity,
                path_count: m.path_count,
                is_dead: s.is_dead,
                selectivity_pruned: s.selectivity_pruned,
                limit_reached: s.limit_reached,
                equivalence_class: s.equivalence_class,
                throughput: s.stats.throughput.map(Into::into),
            }
        })
        .collect();

    // Alive schemas first, then by selectivity then support (descending).
    rows.sort_by(|a, b| {
        a.is_dead
            .cmp(&b.is_dead)
            .then(b.selectivity.total_cmp(&a.selectivity))
            .then(b.support.cmp(&a.support))
    });

    if let Some(k) = options.max_schemas {
        rows.truncate(k);
    }

    PathSchemaResult {
        source: options.source,
        total_sources: discovery.total_sources,
        rows,
        equivalence_class_count: discovery.equivalence_classes.len(),
    }
}

/// Options for fast type-level enumeration.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PathEnumerateOptions {
    pub source: PathTypeRef,
    pub target: Option<PathTypeRef>,
    pub max_length: usize,
    /// Optional set of types the intermediate steps may pass through; `None` allows all. The
    /// source and target are always permitted, so only the steps in between are constrained.
    pub allowed_types: Option<Vec<PathTypeRef>>,
}

/// One step of a schema: a directed typed edge (`source` --qualifier--> `target`) plus
/// whether it is traversed in reverse. Mirrors rust4pm's `ResolvedStep`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PathSchemaStep {
    pub qualifier: String,
    pub source: PathTypeRef,
    pub target: PathTypeRef,
    pub reverse: bool,
}

/// A type-level path schema without computed metrics. `steps` is a self-contained
/// structured form (no display-string parsing needed) for building OCPQ queries.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PathSchemaInfo {
    pub index: usize,
    pub schema: String,
    pub source: PathTypeRef,
    pub target: PathTypeRef,
    pub length: usize,
    pub steps: Vec<PathSchemaStep>,
}

/// Fast type-level enumeration of path schemas (no instance traversal).
pub fn enumerate_path_schemas(
    ocel: &SlimLinkedOCEL,
    options: PathEnumerateOptions,
) -> Vec<PathSchemaInfo> {
    let tg = ps::TypeGraph::from_linked_ocel(ocel);
    let source = options.source.to_ps();
    let target = options.target.as_ref().map(PathTypeRef::to_ps);
    let allowed = to_ps_allowed(&options.allowed_types);
    ps::enumerate_schemas(
        &tg,
        &source,
        target.as_ref(),
        options.max_length,
        false,
        allowed.as_ref(),
    )
    .iter()
    .enumerate()
    .map(|(i, s)| {
        let resolved = s.resolve(&tg);
        let steps = resolved
            .steps
            .iter()
            .map(|st| PathSchemaStep {
                qualifier: st.edge.qualifier.clone(),
                source: st.edge.source.clone().into(),
                target: st.edge.target.clone().into(),
                reverse: st.reverse,
            })
            .collect();
        PathSchemaInfo {
            index: i,
            schema: s.display(&tg),
            source: s.source.clone().into(),
            target: s.target.clone().into(),
            length: s.len(),
            steps,
        }
    })
    .collect()
}

/// Options for recomputing a single schema's detail.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PathSchemaDetailOptions {
    pub source: PathTypeRef,
    pub target: Option<PathTypeRef>,
    pub max_length: usize,
    pub schema_index: usize,
    pub temporal: TemporalMode,
    pub selection: SelectionMode,
    pub bounded_seconds: Option<i32>,
    pub max_connections: Option<usize>,
    /// Must match the value used for enumeration/discovery so `schema_index` stays valid.
    pub allowed_types: Option<Vec<PathTypeRef>>,
}

/// A single discovered connection between two entities.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PathConnection {
    pub source_id: String,
    pub target_id: String,
    pub source_time: Option<DateTime<FixedOffset>>,
    pub target_time: Option<DateTime<FixedOffset>>,
}

/// Detailed result for one schema under chosen temporal / selection options.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PathSchemaDetail {
    pub schema: String,
    pub support: usize,
    pub coverage: f64,
    pub selectivity: f64,
    pub reach: f64,
    pub exclusivity: f64,
    pub path_count: usize,
    pub throughput: Option<ThroughputStats>,
    /// Per-connection source-to-target durations in seconds (for the histogram).
    pub throughput_seconds: Vec<f64>,
    /// Distinct targets per source over all source entities (0 for sources with none).
    pub targets_per_source: Vec<u32>,
    /// Distinct sources per target over all target entities (0 for targets reached by none).
    pub sources_per_target: Vec<u32>,
    /// Total number of connections (the `connections` list below may be capped).
    pub connection_count: usize,
    pub connections: Vec<PathConnection>,
}

const MAX_DETAIL_CONNECTIONS: usize = 2000;
/// Cap on the duration / distribution samples returned (full stats stay exact).
const MAX_DETAIL_DURATIONS: usize = 50000;

/// Per-entity connection counts padded with zeros up to `total` entities, then uniformly
/// downsampled if it would exceed [`MAX_DETAIL_DURATIONS`] (proportions preserved).
fn distribution_with_zeros(counts: impl Iterator<Item = u32>, total: usize) -> Vec<u32> {
    let mut values: Vec<u32> = counts.collect();
    values.resize(total.max(values.len()), 0);
    if values.len() > MAX_DETAIL_DURATIONS {
        let step = values.len().div_ceil(MAX_DETAIL_DURATIONS);
        values = values.into_iter().step_by(step).collect();
    }
    values
}

/// Recompute connections, metrics, throughput and durations for a single schema
/// under the given temporal / event-selection options.
pub fn schema_detail(
    ocel: &SlimLinkedOCEL,
    options: PathSchemaDetailOptions,
) -> Option<PathSchemaDetail> {
    let tg = ps::TypeGraph::from_linked_ocel(ocel);
    let source = options.source.to_ps();
    let target = options.target.as_ref().map(PathTypeRef::to_ps);
    let allowed = to_ps_allowed(&options.allowed_types);
    let schemas = ps::enumerate_schemas(
        &tg,
        &source,
        target.as_ref(),
        options.max_length,
        false,
        allowed.as_ref(),
    );
    let sch = schemas.get(options.schema_index)?;

    let params = ps::PathConnectionParams {
        temporal: map_temporal(options.temporal, options.bounded_seconds),
        selection: map_selection(options.selection),
        max_connections: options.max_connections,
        dedup_targets: true,
        selectivity_threshold: None,
    };
    let resolved = sch.resolve(&tg);
    let sources = ps::get_entities_of_type(ocel, &resolved.source);
    let total_sources = sources.len();
    let total_targets = ps::get_entities_of_type(ocel, &resolved.target).len();
    let result = ps::find_connections_with_sources(ocel, &resolved, &sources, &params);
    let stats = ps::schema_stats(&result.connections, total_sources, total_targets);

    let throughput_seconds: Vec<f64> = result
        .connections
        .iter()
        .filter_map(|c| match (c.source_time, c.target_time) {
            (Some(s), Some(t)) => {
                Some(t.signed_duration_since(s).num_milliseconds() as f64 / 1000.0)
            }
            _ => None,
        })
        .take(MAX_DETAIL_DURATIONS)
        .collect();

    // Distributions over ALL source / target entities: sources (targets) with no connection
    // contribute 0, so the distribution lines up with coverage (reach).
    let mut per_source: HashMap<ps::EntityRef, u32> = HashMap::new();
    let mut per_target: HashMap<ps::EntityRef, u32> = HashMap::new();
    for c in &result.connections {
        *per_source.entry(c.source).or_insert(0) += 1;
        *per_target.entry(c.target).or_insert(0) += 1;
    }
    let targets_per_source = distribution_with_zeros(per_source.into_values(), total_sources);
    let sources_per_target = distribution_with_zeros(per_target.into_values(), total_targets);

    let connection_count = result.connections.len();
    let connections: Vec<PathConnection> = result
        .connections
        .iter()
        .take(MAX_DETAIL_CONNECTIONS)
        .map(|c| PathConnection {
            source_id: ps::entity_id(ocel, &c.source).to_string(),
            target_id: ps::entity_id(ocel, &c.target).to_string(),
            source_time: c.source_time,
            target_time: c.target_time,
        })
        .collect();

    let m = stats.metrics;
    Some(PathSchemaDetail {
        schema: resolved.display(),
        support: m.support,
        coverage: m.coverage,
        selectivity: m.selectivity,
        reach: m.reach,
        exclusivity: m.exclusivity,
        path_count: m.path_count,
        throughput: stats.throughput.map(Into::into),
        throughput_seconds,
        targets_per_source,
        sources_per_target,
        connection_count,
        connections,
    })
}
