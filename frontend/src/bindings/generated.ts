// AUTO-GENERATED from backend binding metadata. Do not edit.
// Regenerate with `pnpm codegen` in frontend/.

/** A registry-stored object referenced by id; never the value itself. */
export type Handle<T extends string> = string & { readonly __ref: T };

export type EvaluateBoxTreeResultHandle = Handle<"EvaluateBoxTreeResult">;
export type EventLogHandle = Handle<"EventLog">;
export type EventLogActivityProjectionHandle = Handle<"EventLogActivityProjection">;
export type IndexLinkedOCELHandle = Handle<"IndexLinkedOCEL">;
export type OCELHandle = Handle<"OCEL">;
export type SlimLinkedOCELHandle = Handle<"SlimLinkedOCEL">;

export type OCDeclareArcType = ("AS" | "EF" | "EP" | "DF" | "DP")

/**
 * Options for the automatic discovery of OC-DECLARE constraints
 */

export type ObjectTypeAssociation = ({
/**
 * The object type
 */
object_type: string
type: "Simple"
} | {
/**
 * First object type (for source event)
 */
first: string
/**
 * Specifies the direction of the O2O relationship.
 * 
 * If reversed is `False`, `(first,second)` is considered
 */
reversed: boolean
/**
 * Second object type (for target event)
 */
second: string
type: "O2O"
})

/**
 * OC-DECLARE Constraint arc/edge between two nodes (i.e., activities)
 */

export interface OCDeclareArcLabel {
/**
 * All (there must be the specified number of relevant target events involving all of the objects of this type involved in the source event)
 */
all: ObjectTypeAssociation[]
/**
 * Any (there must be the specified number of relevant target events involving at least one of the objects of this type involved in the source event)
 */
any: ObjectTypeAssociation[]
/**
 * Each (for each object of that type separately, there must be the specified number of relevant target events)
 */
each: ObjectTypeAssociation[]
}

export interface AttrValueCount {
count: number
value: string
}

export interface EventWithIndex {
event: OCELEvent
index: number
}
/**
 * OCEL Event
 */

export interface OCELEvent {
/**
 * Event attributes
 */
attributes?: OCELEventAttribute[]
/**
 * Event ID
 */
id: string
/**
 * E2O (Event-to-Object) relationships
 */
relationships?: OCELRelationship[]
/**
 * `DateTime` when event occured
 */
time: string
/**
 * Event Type (referring back to the `name` of an [`OCELType`])
 */
type: string
}
/**
 * OCEL Event Attributes
 */

export interface OCELEventAttribute {
/**
 * Name of event attribute
 */
name: string
/**
 * Value of attribute
 */
value: (number | boolean | string | null)
}
/**
 * OCEL Relationship (qualified; referring back to an [`OCELObject`])
 */

export interface OCELRelationship {
/**
 * ID of referenced [`OCELObject`]
 */
objectId: string
/**
 * Qualifier of relationship
 */
qualifier: string
}

export interface ObjectWithIndex {
index: number
object: OCELObject
}
/**
 * OCEL Object
 */

export interface OCELObject {
/**
 * Object attributes
 */
attributes?: OCELObjectAttribute[]
/**
 * Object ID
 */
id: string
/**
 * O2O (Object-to-Object) relationships
 */
relationships?: OCELRelationship[]
/**
 * Object Type (referring back to thte `name` of an [`OCELType`])
 */
type: string
}
/**
 * OCEL Object Attribute
 * 
 * Describing a named value _at a certain point in time_
 */

export interface OCELObjectAttribute {
/**
 * Name of attribute
 */
name: string
/**
 * Time of attribute value
 */
time: string
/**
 * Value of attribute
 */
value: (number | boolean | string | null)
}
/**
 * OCEL Relationship (qualified; referring back to an [`OCELObject`])
 */

export type GraphNode = (OCELEvent | OCELObject)

export interface OCELGraph {
links: GraphLink[]
nodes: GraphNode[]
}

export interface GraphLink {
qualifier: string
source: string
target: string
}
/**
 * OCEL Event
 */

export interface OCELType {
/**
 * Attributes (defining the _type_ of values)
 */
attributes?: OCELTypeAttribute[]
/**
 * Name
 */
name: string
}
/**
 * OCEL Attribute types
 */

export interface OCELTypeAttribute {
/**
 * Name of attribute
 */
name: string
/**
 * Type of attribute
 */
type: string
}

export type SelectionMode = ("All" | "First" | "Last" | "Closest")
/**
 * Temporal filter applied along discovered paths.
 */

export type TemporalMode = ("None" | "Forward" | "Bounded")

/**
 * Options for recomputing a single schema's detail.
 */

export interface PathTypeRef {
is_event: boolean
name: string
}

export interface PathSchemaDetail {
/**
 * Total number of connections (the `connections` list below may be capped).
 */
connection_count: number
connections: PathConnection[]
coverage: number
exclusivity: number
path_count: number
reach: number
schema: string
selectivity: number
/**
 * Distinct sources per target over all target entities (0 for targets reached by none).
 */
sources_per_target: number[]
support: number
/**
 * Distinct targets per source over all source entities (0 for sources with none).
 */
targets_per_source: number[]
throughput?: (ThroughputStats | null)
/**
 * Per-connection source-to-target durations in seconds (for the histogram).
 */
throughput_seconds: number[]
}
/**
 * A single discovered connection between two entities.
 */

export interface PathConnection {
source_id: string
source_time?: (string | null)
target_id: string
target_time?: (string | null)
}
/**
 * Throughput time statistics (seconds) over event-to-event connections.
 */

export interface ThroughputStats {
max: number
mean: number
median: number
min: number
}

export interface PathSchemaRow {
coverage: number
/**
 * Index of the connection-equivalence class this schema belongs to.
 */
equivalence_class: number
exclusivity: number
/**
 * Enumeration index (stable for given source/target/max_length/allowed_types); used for detail lookups.
 */
index: number
is_dead: boolean
length: number
limit_reached: boolean
path_count: number
reach: number
schema: string
selectivity: number
selectivity_pruned: boolean
source: PathTypeRef
support: number
target: PathTypeRef
throughput?: (ThroughputStats | null)
}
/**
 * A reference to an OCEL type: an event type or object type, by name. Mirrors rust4pm's
 * `TypeRef` (event and object type names are not disjoint, so the kind is carried along).
 */

export interface PathSchemaStep {
qualifier: string
reverse: boolean
source: PathTypeRef
target: PathTypeRef
}

export interface PathTypeEdge {
qualifier: string
source: PathTypeRef
target: PathTypeRef
}
/**
 * A reference to an OCEL type: an event type or object type, by name. Mirrors rust4pm's
 * `TypeRef` (event and object type names are not disjoint, so the kind is carried along).
 */

export interface PathTypeNode {
/**
 * Number of entities of this type.
 */
count: number
is_event: boolean
name: string
}

export type BindingBoxTreeNode = ({
/**
 * @minItems 2
 * @maxItems 2
 */
Box: [BindingBox, number[]]
} | {
/**
 * @minItems 2
 * @maxItems 2
 */
OR: [number, number]
} | {
/**
 * @minItems 2
 * @maxItems 2
 */
AND: [number, number]
} | {
NOT: number
})

export type Constraint = ({
filter: Filter
type: "Filter"
} | {
filter: SizeFilter
type: "SizeFilter"
} | {
child_names: string[]
type: "SAT"
} | {
child_names: string[]
type: "ANY"
} | {
child_names: string[]
type: "NOT"
} | {
child_names: string[]
type: "OR"
} | {
child_names: string[]
type: "AND"
})

export type Filter = ({
event: EventVariable
filterLabel?: (FilterLabel | null)
object: ObjectVariable
qualifier?: (string | null)
type: "O2E"
} | {
filterLabel?: (FilterLabel | null)
object: ObjectVariable
other_object: ObjectVariable
qualifier?: (string | null)
type: "O2O"
} | {
from_event: EventVariable
max_seconds?: (number | null)
min_seconds?: (number | null)
to_event: EventVariable
type: "TimeBetweenEvents"
} | {
type: "NotEqual"
var_1: Variable
var_2: Variable
} | {
attribute_name: string
event: EventVariable
type: "EventAttributeValueFilter"
value_filter: ValueFilter
} | {
at_time: ObjectValueFilterTimepoint
attribute_name: string
object: ObjectVariable
type: "ObjectAttributeValueFilter"
value_filter: ValueFilter
} | {
cel: string
type: "BasicFilterCEL"
})

export type EventVariable = number
/**
 * This interface was referenced by `undefined`'s JSON-Schema definition
 * via the `patternProperty` "^\d+$".
 * 
 * This interface was referenced by `undefined`'s JSON-Schema definition
 * via the `patternProperty` "^\d+$".
 */

export type FilterLabel = ("IGNORED" | "INCLUDED" | "EXCLUDED")

export type ObjectVariable = number

export type Variable = ({
Event: EventVariable
} | {
Object: ObjectVariable
})

export type ValueFilter = ({
max?: (number | null)
min?: (number | null)
type: "Float"
} | {
max?: (number | null)
min?: (number | null)
type: "Integer"
} | {
is_true: boolean
type: "Boolean"
} | {
is_in: string[]
type: "String"
} | {
from?: (string | null)
to?: (string | null)
type: "Time"
})

export type ObjectValueFilterTimepoint = ({
type: "Always"
} | {
type: "Sometime"
} | {
event: EventVariable
type: "AtEvent"
})

export type SizeFilter = ({
child_name: string
max?: (number | null)
min?: (number | null)
type: "NumChilds"
} | {
child_names: string[]
type: "BindingSetEqual"
} | {
child_name_with_var_name: [string, Variable][]
type: "BindingSetProjectionEqual"
} | {
child_name: string
max?: (number | null)
min?: (number | null)
type: "NumChildsProj"
var_name: Variable
} | {
cel: string
type: "AdvancedCEL"
})

export interface BindingBox {
constraints: Constraint[]
evVarLabels?: {
[k: string]: FilterLabel
}
filters: Filter[]
labels?: LabelFunction[]
newEventVars: {
/**
 * This interface was referenced by `undefined`'s JSON-Schema definition
 * via the `patternProperty` "^\d+$".
 */
[k: string]: string[]
}
newObjectVars: {
/**
 * This interface was referenced by `undefined`'s JSON-Schema definition
 * via the `patternProperty` "^\d+$".
 */
[k: string]: string[]
}
obVarLabels?: {
[k: string]: FilterLabel
}
sizeFilters: SizeFilter[]
}

export interface LabelFunction {
cel: string
label: string
}

export type DatabaseType = ("SQLite" | "DuckDB")

export interface TableMappings {
/**
 * E2O junction table. Defaults to `event_object` to match the OCEL SQL
 * schema produced by `process_mining`'s exporter.
 */
e2o_table?: string
event_tables?: {
[k: string]: string
}
/**
 * O2O junction table. Defaults to `object_object` (same exporter).
 */
o2o_table?: string
object_tables?: {
[k: string]: string
}
}

export interface BindingBoxTree {
edgeNames: [[number, number], string][]
nodes: BindingBoxTreeNode[]
}

export interface CountConstraintOptions {
coverFraction: number
eventTypes: string[]
objectTypes: string[]
}

export interface EventuallyFollowsConstraintOptions {
coverFraction: number
objectTypes: string[]
}

export interface ORConstraintOptions {
coverFraction: number
eventTypes: string[]
objectTypes: string[]
}

export type LabelValue = ({
type: "string"
value: string
} | {
type: "int"
value: number
} | {
type: "float"
value: number
} | {
type: "bool"
value: boolean
} | {
type: "null"
})

export type ViolationReason = (("NoChildrenOfORSatisfied" | "LeftChildOfANDUnsatisfied" | "RightChildOfANDUnsatisfied" | "BothChildrenOfANDUnsatisfied" | "ChildrenOfNOTSatisfied" | "ChildNotSatisfied" | "UnknownChildSet") | {
TooFewMatchingEvents: number
} | {
TooManyMatchingEvents: number
} | {
ConstraintNotSatisfied: number
})

export interface BindingRow {
events: [EventVariable, string][]
labels: [string, LabelValue][]
objects: [ObjectVariable, string][]
violation?: (ViolationReason | null)
}

export interface NodeSummary {
situationCount: number
situationViolatedCount: number
}

export interface DottedChartPoints {
/**
 * X-axis values (interpretation depends on [`DottedChartXAxis`]).
 */
x: number[]
/**
 * Y-axis indices into [`DottedChartData::y_values`].
 */
y: number[]
}

export interface AttributeChange {
/**
 * Timestamp of the change.
 */
time: string
/**
 * Attribute value at this point in time.
 */
value: (number | boolean | string | null)
}

export type Literal = (boolean | number | string | {
/**
 * The instant.
 */
timestamp: string
})

export type MappingEntry = (Mapping | {
/**
 * Mappings, in priority order.
 */
mappings: Mapping1[]
type: "ordered"
})
/**
 * _Types_ of attribute values in OCEL2
 */

export type OCELAttributeType = ("String" | "Time" | "Integer" | "Float" | "Boolean" | "Null")

export type TimestampFormat = ({
type: "auto"
} | {
/**
 * The format.
 */
format: string
type: "format-string"
} | {
type: "unix-seconds"
} | {
type: "unix-millis"
})
/**
 * Where an entity's timestamp comes from.
 * 
 * `deny_unknown_fields`: a misspelled key would otherwise be ignored, leaving a timestamp that
 * silently drops every row.
 */

export type TimestampSource = ({
/**
 * How to read it. `None` means auto-detection.
 */
format?: (TimestampFormat | null)
/**
 * Where the text comes from.
 */
source: ValueExpression
type: "value"
} | {
/**
 * Where the date comes from, if anywhere.
 */
date?: (TimestampPart | null)
/**
 * Where the time comes from, if anywhere.
 */
time?: (TimestampPart | null)
type: "components"
})

export interface Mapping {
type: "single"
}
/**
 * One mapping from a node's rows to entities.
 */

export interface Mapping1 {
/**
 * Display label, also used to name this mapping in diagnostics.
 */
label?: (string | null)
/**
 * The node whose rows this reads.
 */
node: string
/**
 * What to produce.
 */
target: ({
/**
 * Event attributes.
 */
attributes?: AttributeMapping[]
/**
 * Event type.
 */
event_type: ValueExpression
/**
 * Event id. `None` assigns a UUID, which is not reproducible across runs and cannot
 * be compiled to a view.
 * 
 * It is also what coalesces a fan-out: over a join of orders and their items, a `None`
 * id makes one event per item, an id naming the order one event per order, still related
 * to every item. The repeated rows count as
 * [`MappingStats::deduplicated`](super::report::MappingStats::deduplicated) while
 * `objects` below is emitted for each.
 */
id?: (ValueExpression | null)
/**
 * Objects related to this event.
 */
objects?: InlineObjectRef[]
/**
 * When it happened.
 */
timestamp: ({
/**
 * How to read it. `None` means auto-detection.
 */
format?: (TimestampFormat | null)
/**
 * Where the text comes from.
 */
source: ValueExpression
type: "value"
} | {
/**
 * Where the date comes from, if anywhere.
 */
date?: (TimestampPart | null)
/**
 * Where the time comes from, if anywhere.
 */
time?: (TimestampPart | null)
type: "components"
})
type: "event"
} | {
/**
 * Object attributes.
 */
attributes?: AttributeMapping[]
/**
 * Object id.
 */
id: ValueExpression
/**
 * Object type.
 */
object_type: ValueExpression
/**
 * When the attribute values below were observed. `None` records them as static
 * values stamped at the Unix epoch.
 */
timestamp?: (TimestampSource | null)
type: "object"
} | {
event: EventEndpoint
object: ObjectEndpoint1
/**
 * Relation qualifier.
 */
qualifier?: (ValueExpression | null)
type: "e2o"
} | {
/**
 * Relation qualifier.
 */
qualifier?: (ValueExpression | null)
source: ObjectEndpoint2
target: ObjectEndpoint3
type: "o2o"
})
/**
 * Only rows satisfying this produce anything. `None` accepts every row.
 */
when?: (Predicate | null)
}
/**
 * Maps a source column to a named OCEL attribute.
 */

export interface AttributeMapping {
/**
 * Attribute name in the resulting log.
 */
name: string
/**
 * Column to read.
 */
source_column: string
/**
 * Declared attribute type, or `None` to take the catalog's type for `source_column`.
 */
value_type?: (OCELAttributeType | null)
}
/**
 * An object related to an event declared by the same mapping.
 */

export interface InlineObjectRef {
object: ObjectEndpoint
/**
 * Relation qualifier.
 */
qualifier?: (ValueExpression | null)
}
/**
 * The object.
 */

export interface ObjectEndpoint {
/**
 * The object's id.
 */
id: ValueExpression
/**
 * The object's type. Required under [`IdRendering::TypePrefixed`] and under
 * [`MissingEndpointPolicy::Create`].
 */
object_type?: (ValueExpression | null)
/**
 * Split the id cell into several ids, producing one relation per part.
 */
split?: (SplitSpec | null)
}
/**
 * How to split one cell into several values.
 */

export interface SplitSpec {
/**
 * The splitting rule.
 */
kind: ({
/**
 * The separator.
 */
delimiter: string
type: "delimiter"
} | {
/**
 * The pattern.
 */
pattern: string
type: "regex"
})
/**
 * Trim surrounding whitespace from each part.
 */
trim: boolean
}
/**
 * One value read as a timestamp: where the text comes from, and how to read it.
 */

export interface TimestampPart {
/**
 * How to read it. `None` means auto-detection.
 */
format?: (TimestampFormat | null)
/**
 * Where the text comes from.
 */
source: ValueExpression
}
/**
 * The event.
 */

export interface EventEndpoint {
/**
 * The event's type. Required under [`IdRendering::TypePrefixed`].
 */
event_type?: (ValueExpression | null)
/**
 * The event's id.
 */
id: ValueExpression
}
/**
 * The object.
 */

export interface ObjectEndpoint1 {
/**
 * The object's id.
 */
id: ValueExpression
/**
 * The object's type. Required under [`IdRendering::TypePrefixed`] and under
 * [`MissingEndpointPolicy::Create`].
 */
object_type?: (ValueExpression | null)
/**
 * Split the id cell into several ids, producing one relation per part.
 */
split?: (SplitSpec | null)
}
/**
 * The source object.
 */

export interface ObjectEndpoint2 {
/**
 * The object's id.
 */
id: ValueExpression
/**
 * The object's type. Required under [`IdRendering::TypePrefixed`] and under
 * [`MissingEndpointPolicy::Create`].
 */
object_type?: (ValueExpression | null)
/**
 * Split the id cell into several ids, producing one relation per part.
 */
split?: (SplitSpec | null)
}
/**
 * The target object.
 */

export interface ObjectEndpoint3 {
/**
 * The object's id.
 */
id: ValueExpression
/**
 * The object's type. Required under [`IdRendering::TypePrefixed`] and under
 * [`MissingEndpointPolicy::Create`].
 */
object_type?: (ValueExpression | null)
/**
 * Split the id cell into several ids, producing one relation per part.
 */
split?: (SplitSpec | null)
}
/**
 * A node in the row graph.
 */

export interface Node {
/**
 * Unique id, referenced by other nodes and by mappings.
 */
id: string
/**
 * Display label. No semantic role.
 */
label?: (string | null)
/**
 * The operation.
 */
op: ({
/**
 * Source id, resolved to a connection at execution time.
 */
source_id: string
/**
 * Table name.
 */
table: string
type: "source"
} | {
/**
 * The condition.
 */
condition: Predicate
/**
 * Input node id.
 */
input: string
type: "filter"
} | {
/**
 * Left input node id.
 */
left: string
/**
 * Column pairs, as `(left column, right column)`.
 */
on: [string, string][]
/**
 * Right input node id.
 */
right: string
type: "join"
} | {
/**
 * Input node ids.
 */
inputs: string[]
type: "union"
})
}

export interface TablePreview {
/**
 * Column names, in the order the rows are aligned to.
 */
columns: string[]
/**
 * Rows, each the same length as `columns`.
 */
rows: (string | null)[][]
}
/**
 * One table's declared shape.
 */

export interface TableSchema {
/**
 * Columns, keyed by name.
 */
columns: {
[k: string]: ColumnSchema
}
/**
 * Table name.
 */
name: string
}
/**
 * One column's declared shape.
 */

export interface ColumnSchema {
/**
 * The source's own type name, verbatim, for example `INTEGER` or `timestamp`.
 */
col_type: string
/**
 * Column name.
 */
name: string
/**
 * Whether the source permits `NULL` here.
 */
nullable: boolean
}

export type SqlDialect = ("DuckDb" | "Postgres")
/**
 * Which OCEL surface the compiler emits.
 */

export type EmissionShape = ("PerType" | "Consolidated")

/**
 * A blueprint compiled to SQL.
 * 
 * Serializable but not deserializable: [`Self::errors`] holds [`CompileError`], which is not, so
 * neither is this. Crosses a bindings boundary outbound only, as a compile binding's return
 * value.
 */

export interface CompileError {
/**
 * The mapping this is about, or `None` for a blueprint-level problem.
 */
mapping?: (MappingRef | null)
/**
 * Why it could not be compiled.
 */
reason: ({
SynthesizedId: {
/**
 * The absent field.
 */
field: string
}
} | {
DynamicTypeName: {
/**
 * Why no domain was available.
 */
detail: string
/**
 * The position whose type is dynamic.
 */
field: string
}
} | {
TypeDomainTooLarge: {
/**
 * The cap.
 */
cap: number
/**
 * The column the domain came from.
 */
column: string
/**
 * How many values it has.
 */
size: number
}
} | {
ReservedTypeName: {
/**
 * The offending type name.
 */
name: string
}
} | {
UnknownNode: {
/**
 * The node id.
 */
node: string
}
} | {
UnresolvedNodeSchema: {
/**
 * The node id.
 */
node: string
}
} | {
NodeCycle: {
/**
 * A node id taking part in the cycle.
 */
node: string
}
} | {
EmptyProjection: {
/**
 * The node id.
 */
node: string
}
} | {
EmptyUnion: {
/**
 * The node id.
 */
node: string
}
} | {
UnknownColumn: {
/**
 * The column name.
 */
column: string
/**
 * Which position referenced it.
 */
field: string
}
} | {
UndeclaredColumnKind: {
/**
 * The catalog's own type string.
 */
col_type: string
/**
 * The column name.
 */
column: string
/**
 * Which position referenced it.
 */
field: string
}
} | {
UnstableIdentityRendering: {
/**
 * The catalog's own type string.
 */
col_type: string
/**
 * The column name.
 */
column: string
/**
 * Which position referenced it.
 */
field: string
}
} | {
UnstableDisplayRendering: {
/**
 * The catalog's own type string.
 */
col_type: string
/**
 * The column name.
 */
column: string
/**
 * Which position referenced it.
 */
field: string
}
} | {
ResidualTimestamp: {
/**
 * What about it is residual.
 */
detail: string
}
} | {
UndecidableJoinKey: {
/**
 * The catalog's own type string.
 */
col_type: string
/**
 * The column name.
 */
column: string
/**
 * The join node's id.
 */
node: string
/**
 * Which side the column is on.
 */
side: string
}
} | {
InvalidRegex: {
/**
 * The compiler's message.
 */
message: string
/**
 * The pattern.
 */
pattern: string
}
} | {
InvalidTemplate: {
/**
 * What is wrong with it.
 */
reason: string
/**
 * The template text.
 */
template: string
}
} | {
AttributeCoercion: {
/**
 * The attribute name.
 */
attribute: string
/**
 * The catalog's own type string.
 */
col_type: string
/**
 * The source column.
 */
column: string
/**
 * The declared OCEL attribute type.
 */
declared: string
}
} | {
DynamicTypeAttributeConflict: {
/**
 * The attribute name.
 */
attribute: string
}
} | {
ViewCycle: {
/**
 * The relation's name.
 */
view: string
}
} | {
Invalid: {
/**
 * The rendered validation error.
 */
detail: string
}
})
}
/**
 * Points a diagnostic back at the mapping it came from.
 */

export interface MappingRef {
/**
 * What this mapping produces, derived from its target: `event "appoint officer"`,
 * `event -> object relation`, and so on. Present whether or not a `label` was typed.
 */
describes: string
/**
 * Position in the desugared, flattened mapping list this run executed.
 */
index: number
/**
 * The mapping's own label, if it has one.
 */
label?: (string | null)
/**
 * The JSON path of the authored entry this mapping came from -- see
 * `desugar_with_paths` -- so a diagnostic points at
 * what the author wrote rather than a position in the flattened list.
 */
path: string
}
/**
 * A data-dependent assumption the compiled relations make, as SQL that returns zero rows when
 * the assumption holds.
 */

export interface Probe {
/**
 * What it guards.
 */
kind: ("AmbiguousObjectIdentity" | "AmbiguousEventIdentity" | "AmbiguousStaticObjectAttributes" | {
StaleTypeDomain: {
/**
 * The column the domain came from.
 */
column: string
}
})
/**
 * The mapping this is about, or `None` for a whole-log check.
 */
mapping?: (MappingRef | null)
/**
 * The check itself, as a `SELECT` returning zero rows when the guard holds.
 */
sql: string
}
/**
 * One compiled relation: a name and the bare `SELECT` that defines it.
 */

export interface ViewDef {
/**
 * A bare `SELECT` body with no `CREATE` wrapper, so the same text serves a view, a CTE and
 * a `CREATE TABLE AS`.
 */
body: string
/**
 * The relation's name, unquoted.
 */
name: string
}

export interface ExtractionCatalog {
/**
 * Column domains, keyed by source id, then table name, then column name.
 */
domains: {
[k: string]: {
[k: string]: {
[k: string]: string[]
}
}
}
/**
 * A handful of real rows per table, keyed by source id then table name, to show a person
 * what the data looks like.
 * 
 * Deliberately unreachable through the [`Catalog`] trait: unlike
 * [`domains`](ExtractionCatalog::domains), a preview is incomplete, so compiling from one
 * would emit views only for the types that happened to appear first.
 */
previews?: {
[k: string]: {
[k: string]: TablePreview
}
}
/**
 * Table schemas, keyed by source id then table name.
 */
tables: {
[k: string]: {
[k: string]: TableSchema
}
}
}
/**
 * A few real rows of one table, for display only.
 * 
 * Rows are aligned to [`TablePreview::columns`] so a wide table can be read across. A cell is
 * `None` for SQL `NULL`, distinct from `Some(String::new())`.
 */

export type ExtractionError = ({
Invalid: ValidationError[]
} | {
MissingProvider: {
/**
 * The missing source id.
 */
source_id: string
}
} | {
InvalidRegex: {
/**
 * The compiler's message.
 */
message: string
/**
 * The offending pattern.
 */
pattern: string
}
} | {
JoinKeyColumnMissing: {
/**
 * The key column, as named on that side.
 */
column: string
/**
 * The `Join` node.
 */
node: string
/**
 * `"left"` or `"right"`.
 */
side: string
}
} | {
Provider: {
/**
 * The node being read when the failure happened.
 */
node: string
/**
 * The underlying error.
 */
source: ({
UnknownTable: {
/**
 * The table name.
 */
table: string
}
} | {
UnknownColumn: {
/**
 * The column name.
 */
column: string
/**
 * The table name.
 */
table: string
}
} | "QueryUnsupported" | {
Backend: {
/**
 * The backend's error message.
 */
message: string
/**
 * The table being read when the failure happened.
 */
table: string
}
})
}
} | {
Sink: {
/**
 * What was being added when the failure happened.
 */
context: string
/**
 * The underlying error.
 */
source: ({
DuplicateEvent: {
/**
 * The repeated id.
 */
id: string
}
} | {
DuplicateObject: {
/**
 * The repeated id.
 */
id: string
}
} | {
IdTypeCollision: {
/**
 * The contested id.
 */
id: string
}
} | {
UnknownType: {
/**
 * `"event"` or `"object"`.
 */
kind: string
/**
 * The undeclared type name.
 */
name: string
}
} | "InvalidRef" | {
Backend: string
})
}
} | {
IdTypeCollision: {
/**
 * The contested id.
 */
id: string
mapping: MappingRef
/**
 * The type this row wanted the id for. The type that already holds it is whatever the
 * sink reports for that id.
 */
requested_type: string
}
} | {
ConflictingAttributeType: {
/**
 * The attribute.
 */
attribute: string
/**
 * The type the later declaration gave it.
 */
conflicting: ("String" | "Time" | "Integer" | "Float" | "Boolean" | "Null")
/**
 * The type it was declared with first.
 */
declared: ("String" | "Time" | "Integer" | "Float" | "Boolean" | "Null")
/**
 * `"event"` or `"object"`.
 */
kind: string
/**
 * The entity type.
 */
type_name: string
}
} | {
DuplicateObject: {
/**
 * The repeated id.
 */
id: string
mapping: MappingRef1
}
} | {
MissingEndpoint: {
/**
 * Which endpoint (`"event"`, `"object"`, `"source"`, `"target"`, ...).
 */
endpoint: string
/**
 * The unresolved id.
 */
id: string
mapping: MappingRef2
}
} | {
MissingEndpointsAtFinalize: {
/**
 * How many relations the sink could not resolve. Usually equals an eager sink's
 * [`MissingEndpoint`](Self::MissingEndpoint) count for the same run, but can exceed it:
 * a deferring sink also stages the inline references of a `Target::Event` whose event
 * this run dropped, which an eager sink never asks about.
 */
count: number
}
})
/**
 * A reason a blueprint cannot be executed or compiled.
 */

export type ValidationError = ({
/**
 * The blueprint's version.
 */
found: number
/**
 * The newest version this build reads.
 */
supported: number
type: "unsupported-version"
} | {
/**
 * The repeated id.
 */
id: string
type: "duplicate-node-id"
} | {
/**
 * Who referred to it.
 */
from: string
/**
 * The missing id.
 */
id: string
type: "unknown-node-ref"
} | {
/**
 * One node id participating in the cycle.
 */
id: string
type: "node-cycle"
} | {
/**
 * The source id.
 */
source_id: string
type: "unknown-source"
} | {
/**
 * The source id.
 */
source_id: string
/**
 * The table name.
 */
table: string
type: "unknown-table"
} | {
/**
 * The column name.
 */
column: string
/**
 * The node whose rows were being read.
 */
node: string
type: "unknown-column"
} | {
/**
 * Which endpoint.
 */
endpoint: string
/**
 * Which mapping, by label or index.
 */
mapping: string
type: "missing-type-for-prefixing"
} | {
/**
 * Which endpoint.
 */
endpoint: string
/**
 * Which mapping, by label or index.
 */
mapping: string
type: "missing-type-for-create"
} | {
/**
 * The node id.
 */
node: string
type: "empty-union"
} | {
/**
 * The compiler's message.
 */
message: string
/**
 * The pattern.
 */
pattern: string
type: "invalid-regex"
} | {
/**
 * What is wrong with it.
 */
reason: string
/**
 * The template text.
 */
template: string
type: "invalid-template"
} | {
/**
 * The contested output column name.
 */
column: string
/**
 * The `Join` node.
 */
node: string
type: "ambiguous-join-column"
} | {
/**
 * That column's declared type, verbatim from the catalog.
 */
col_type: string
/**
 * The column compared against.
 */
column: string
/**
 * The kind `col_type` names: `text`, `integer`, `float`, `boolean` or `timestamp`.
 */
expected: string
/**
 * The literal, as authored.
 */
literal: string
/**
 * The mapping, by label or authored path, or the `Filter` node, the comparison sits in.
 */
location: string
type: "uncoercible-literal"
} | {
/**
 * The left operand's declared kind: `text`, `integer`, `float`, `boolean` or `timestamp`.
 */
left_kind: string
/**
 * The mapping, by label or authored path, or the `Filter` node, the comparison sits in.
 */
location: string
/**
 * The right operand's declared kind.
 */
right_kind: string
type: "incomparable-compare"
})

/**
 * What [`extract`](super::extract::extract) produced, beyond the OCEL itself.
 * 
 * Serializable but not deserializable: [`ExtractionError`] carries `&'static str` fields (a
 * borrow no deserializer can manufacture), so this only ever crosses a bindings boundary
 * outbound, as a `#[register_binding]` return value.
 */

export interface MappingRef1 {
/**
 * What this mapping produces, derived from its target: `event "appoint officer"`,
 * `event -> object relation`, and so on. Present whether or not a `label` was typed.
 */
describes: string
/**
 * Position in the desugared, flattened mapping list this run executed.
 */
index: number
/**
 * The mapping's own label, if it has one.
 */
label?: (string | null)
/**
 * The JSON path of the authored entry this mapping came from -- see
 * `desugar_with_paths` -- so a diagnostic points at
 * what the author wrote rather than a position in the flattened list.
 */
path: string
}
/**
 * The mapping whose row named the endpoint.
 */

export interface MappingRef2 {
/**
 * What this mapping produces, derived from its target: `event "appoint officer"`,
 * `event -> object relation`, and so on. Present whether or not a `label` was typed.
 */
describes: string
/**
 * Position in the desugared, flattened mapping list this run executed.
 */
index: number
/**
 * The mapping's own label, if it has one.
 */
label?: (string | null)
/**
 * The JSON path of the authored entry this mapping came from -- see
 * `desugar_with_paths` -- so a diagnostic points at
 * what the author wrote rather than a position in the flattened list.
 */
path: string
}
/**
 * What the sink did at [`ExtractionSink::finalize`](super::sink::ExtractionSink::finalize).
 * 
 * All zero for a sink that resolves relation endpoints eagerly, which reports everything
 * through [`per_mapping`](Self::per_mapping) instead. See
 * [`Resolution`](super::sink::Resolution).
 */

export interface FinalizeReport {
/**
 * Repeated entity ids removed at finalize -- a deferring sink's share of
 * [`MappingStats::deduplicated`](super::report::MappingStats::deduplicated).
 */
duplicates_removed: number
/**
 * Objects synthesised at finalize under `on_missing_endpoint: Create`, for deferred
 * endpoints that turned out not to exist.
 */
objects_created: number
/**
 * Relations written against a [`Resolution::Deferred`] endpoint that resolved to a real
 * entity at finalize.
 */
resolved_relations: number
/**
 * Relations whose deferred endpoint did not resolve. An eager sink counts these per mapping
 * as [`DropReason::UnresolvedEndpoint`](super::report::DropReason::UnresolvedEndpoint).
 */
unresolved_endpoints: number
}
/**
 * Counts for one mapping's run.
 */

export interface MappingStats {
/**
 * Rows that tried to create an entity **the sink already had**. Not a loss: an object mapping
 * at event grain names the same object on every row by design. See
 * [`DuplicateObjectPolicy::Error`](super::blueprint::DuplicateObjectPolicy::Error) for what
 * turns a repeat into a loss instead.
 * 
 * One increment per row whose entity-creating call found the entity already present, across
 * mappings, since the sink is what answers.
 * 
 * **Resolving a relation endpoint is never counted**, so an `E2O`/`O2O` mapping reports zero
 * however often its rows repeat an id: finding an existing endpoint is the normal successful
 * case. A blueprint that wants its inline references' repeats counted can name the objects
 * with their own [`Target::Object`](super::blueprint::Target::Object) mapping.
 */
deduplicated: number
/**
 * Rows dropped, by reason. A row that matches several reasons at once (rare) is counted
 * once, under the first one detected.
 */
dropped: {
[k: string]: number
}
/**
 * Entities or relations this mapping *handed to the sink*, which is not the same as
 * "survived the run" for a sink that defers resolution.
 * 
 * An eager sink refuses a dangling relation at the call site, so it lands in
 * [`DropReason::UnresolvedEndpoint`] and never here. A deferring sink writes it, counts it
 * here, and deletes it at [`finalize`](super::sink::ExtractionSink::finalize), reporting it
 * in [`FinalizeReport::unresolved_endpoints`](super::sink::FinalizeReport) instead. To count
 * what a run produced, subtract `ExtractionReport::finalize.unresolved_endpoints` from the
 * total.
 */
entities_emitted: number
mapping: MappingRef3
/**
 * Rows the mapping's node produced, before `when` was applied.
 */
rows_read: number
/**
 * Attribute values that would not convert to their attribute's declared type, stored as
 * `Null`. Not a dropped row: the entity was written, with one of its attributes empty.
 */
uncoercible_attributes?: number
}
/**
 * Which mapping.
 */

export interface MappingRef3 {
/**
 * What this mapping produces, derived from its target: `event "appoint officer"`,
 * `event -> object relation`, and so on. Present whether or not a `label` was typed.
 */
describes: string
/**
 * Position in the desugared, flattened mapping list this run executed.
 */
index: number
/**
 * The mapping's own label, if it has one.
 */
label?: (string | null)
/**
 * The JSON path of the authored entry this mapping came from -- see
 * `desugar_with_paths` -- so a diagnostic points at
 * what the author wrote rather than a position in the flattened list.
 */
path: string
}
/**
 * One node the compiler refused to push down to its source, and why.
 */

export interface PushdownDeclined {
/**
 * The node id, as the blueprint names it.
 */
node: string
/**
 * What the compiler objected to.
 */
reason: ({
SynthesizedId: {
/**
 * The absent field.
 */
field: string
}
} | {
DynamicTypeName: {
/**
 * Why no domain was available.
 */
detail: string
/**
 * The position whose type is dynamic.
 */
field: string
}
} | {
TypeDomainTooLarge: {
/**
 * The cap.
 */
cap: number
/**
 * The column the domain came from.
 */
column: string
/**
 * How many values it has.
 */
size: number
}
} | {
ReservedTypeName: {
/**
 * The offending type name.
 */
name: string
}
} | {
UnknownNode: {
/**
 * The node id.
 */
node: string
}
} | {
UnresolvedNodeSchema: {
/**
 * The node id.
 */
node: string
}
} | {
NodeCycle: {
/**
 * A node id taking part in the cycle.
 */
node: string
}
} | {
EmptyProjection: {
/**
 * The node id.
 */
node: string
}
} | {
EmptyUnion: {
/**
 * The node id.
 */
node: string
}
} | {
UnknownColumn: {
/**
 * The column name.
 */
column: string
/**
 * Which position referenced it.
 */
field: string
}
} | {
UndeclaredColumnKind: {
/**
 * The catalog's own type string.
 */
col_type: string
/**
 * The column name.
 */
column: string
/**
 * Which position referenced it.
 */
field: string
}
} | {
UnstableIdentityRendering: {
/**
 * The catalog's own type string.
 */
col_type: string
/**
 * The column name.
 */
column: string
/**
 * Which position referenced it.
 */
field: string
}
} | {
UnstableDisplayRendering: {
/**
 * The catalog's own type string.
 */
col_type: string
/**
 * The column name.
 */
column: string
/**
 * Which position referenced it.
 */
field: string
}
} | {
ResidualTimestamp: {
/**
 * What about it is residual.
 */
detail: string
}
} | {
UndecidableJoinKey: {
/**
 * The catalog's own type string.
 */
col_type: string
/**
 * The column name.
 */
column: string
/**
 * The join node's id.
 */
node: string
/**
 * Which side the column is on.
 */
side: string
}
} | {
InvalidRegex: {
/**
 * The compiler's message.
 */
message: string
/**
 * The pattern.
 */
pattern: string
}
} | {
InvalidTemplate: {
/**
 * What is wrong with it.
 */
reason: string
/**
 * The template text.
 */
template: string
}
} | {
AttributeCoercion: {
/**
 * The attribute name.
 */
attribute: string
/**
 * The catalog's own type string.
 */
col_type: string
/**
 * The source column.
 */
column: string
/**
 * The declared OCEL attribute type.
 */
declared: string
}
} | {
DynamicTypeAttributeConflict: {
/**
 * The attribute name.
 */
attribute: string
}
} | {
ViewCycle: {
/**
 * The relation's name.
 */
view: string
}
} | {
Invalid: {
/**
 * The rendered validation error.
 */
detail: string
}
})
}
/**
 * How long a run spent, split by phase, in milliseconds. Schema discovery is a fixed cost a
 * caller holding a catalog can skip, so it is reported apart from the row reading.
 */

export interface ExtractionTiming {
/**
 * Connecting to each source and reading its schema. Zero when the caller supplied a catalog.
 */
discovery_ms: number
/**
 * Reading rows and emitting entities: `extract` itself.
 */
extraction_ms: number
}

export interface ResolvedStep {
edge: TypeEdge
/**
 * Whether the edge is traversed in reverse direction.
 */
reverse: boolean
}
/**
 * The typed edge traversed in this step.
 */

export interface TypeEdge {
/**
 * Relationship qualifier this edge represents.
 */
qualifier: string
/**
 * Source type of the edge.
 */
source: ({
Event: string
} | {
Object: string
})
/**
 * Target type of the edge.
 */
target: ({
Event: string
} | {
Object: string
})
}

export type EventIndex = number
/**
 * An Object Index
 * 
 * Points to an object in the context of a given OCEL
 */

export type ObjectIndex = number

/**
 * Connections of a single schema, with metrics and throughput.
 */

export interface Connection {
/**
 * Source entity of the connection.
 */
source: ({
Event: EventIndex
} | {
Object: ObjectIndex
})
/**
 * Timestamp of the source (only present if the source is an event).
 */
source_time?: (string | null)
/**
 * Target entity of the connection.
 */
target: ({
Event: EventIndex
} | {
Object: ObjectIndex
})
/**
 * Timestamp of the target (only present if the target is an event).
 */
target_time?: (string | null)
}
/**
 * Metrics and throughput for the connections.
 */

export interface SchemaStats {
metrics: SchemaMetrics
/**
 * Event-to-event throughput times, if both endpoints are events.
 */
throughput?: (ThroughputStats | null)
}
/**
 * Schema quality metrics.
 */

export interface SchemaMetrics {
/**
 * Fraction of source-type instances with at least one connection.
 */
coverage: number
/**
 * Inverse average fan-in: `|distinct targets| / support`. High = each target reached by few sources.
 */
exclusivity: number
/**
 * Total number of connections.
 */
path_count: number
/**
 * Fraction of target-type instances reached.
 */
reach: number
/**
 * Inverse average fan-out: `1 / (avg distinct targets per connected source)`. High = discriminating.
 */
selectivity: number
/**
 * Number of distinct source entities with at least one connection.
 */
sources_with_paths: number
/**
 * Number of distinct (source, target) pairs connected.
 */
support: number
/**
 * Total number of source entities of this type.
 */
total_sources: number
}
/**
 * Throughput time statistics (seconds) over event-to-event connections.
 */

export type TypeRef = ({
Event: string
} | {
Object: string
})

/**
 * A discovery query: source/target types, max schema length, and connection params.
 */

export interface PathConnectionParams {
/**
 * Store only one connection per (source, target) pair.
 */
dedup_targets: boolean
/**
 * Global cap on the number of connections: a coarse safety limit, checked between
 * sources, so a single high-fan-out source can overshoot it.
 */
max_connections?: (number | null)
/**
 * Which target event(s) to keep per source.
 */
selection: ("All" | "First" | "Last" | "Closest")
/**
 * Terminate early once selectivity is provably below this threshold.
 */
selectivity_threshold?: (number | null)
/**
 * Temporal constraint applied along each path.
 */
temporal: ("None" | "Forward" | {
Bounded: number
})
}

export interface ConnectionEquivalenceClass {
/**
 * Number of unique (source, target) connections shared by every schema in the class.
 */
connection_count: number
/**
 * Representative schema (shortest display string in the class).
 */
representative: string
/**
 * All schemas in this class (display strings).
 */
schemas: string[]
}
/**
 * One enumerated schema with its computed stats and equivalence class.
 */

export interface DiscoveredSchema {
/**
 * Index into [`PathSchemaDiscovery::equivalence_classes`].
 */
equivalence_class: number
/**
 * Enumeration index (stable for a given `source`/`target`/`max_length`/`allowed_types`).
 */
index: number
/**
 * Whether the schema has zero connections.
 */
is_dead: boolean
/**
 * Number of steps in the schema.
 */
length: number
/**
 * Whether the connection limit was reached (results may be incomplete).
 */
limit_reached: boolean
/**
 * Human-readable schema string.
 */
schema: string
/**
 * Whether selectivity-based early termination was triggered.
 */
selectivity_pruned: boolean
/**
 * Source type.
 */
source: ({
Event: string
} | {
Object: string
})
stats: SchemaStats
/**
 * Target type.
 */
target: ({
Event: string
} | {
Object: string
})
}
/**
 * Computed metrics and throughput.
 */

export interface PathSchemaTypeNode {
/**
 * Number of entities of this type.
 */
count: number
/**
 * Whether this is an event type (`true`) or object type (`false`).
 */
is_event: boolean
/**
 * Type name (activity / object class).
 */
name: string
}

export type OCELAttributeValue = (number | boolean | string | null)

export interface Arc {
/**
 * Source and target of Arc
 */
from_to: ({
/**
 * @minItems 2
 * @maxItems 2
 */
nodes: [string, string]
type: "PlaceTransition"
} | {
/**
 * @minItems 2
 * @maxItems 2
 */
nodes: [string, string]
type: "TransitionPlace"
})
/**
 * Weight (i.e., how many tokens this arc moves)
 */
weight: number
}
/**
 * Place in a Petri net
 */

export interface Place {
id: string
}
/**
 * Transition in a Petri net
 */

export interface Transition {
id: string
/**
 * Transition label (None if this transition is _invisible_)
 */
label?: (string | null)
}

export interface CostFunction {
/**
 * Default cost for a log move (log event not matched by model)
 */
log_move_cost: number
/**
 * Default cost for a model move (visible transition fires without matching log event)
 */
model_move_cost: number
/**
 * Default cost for a silent/tau move
 */
silent_move_cost: number
/**
 * Default cost for a synchronous move
 */
sync_move_cost: number
}

export type AlignmentMove = ({
SyncMove: {
/**
 * Index of the event in the trace
 */
trace_event_index: number
/**
 * The transition that was fired
 */
transition: string
}
} | {
ModelMove: {
/**
 * The transition that was fired
 */
transition: string
}
} | {
LogMove: {
/**
 * Index of the event in the trace
 */
trace_event_index: number
}
})

/**
 * Alignment Result
 */

export type AlignmentError = ({
SearchError: SearchError
} | {
SyncProdNetConstructionFailed: SyncProdNetConstructionError
})
/**
 * Reason [`search`] found no path
 */

export type SearchError = ("LimitReached" | "Unreachable" | "MaxEdgeCostTooLarge")
/**
 * Error when constructing the sync product net
 */

export type SyncProdNetConstructionError = ({
InvalidPlaceInMarking: PlaceID
} | "NoFinalMarking" | "NoInitialMarking")
/**
 * Place ID
 */

export type PlaceID = string

/**
 * Alignment result for a single trace variant
 */

export interface AlignmentResult {
/**
 * Total cost of the alignment
 */
cost: number
/**
 * The sequence of alignment moves
 */
moves: AlignmentMove[]
/**
 * Number of states visited during search
 */
states_visited: number
}

export interface DirectlyFollowsGraph {
/**
 * Activities
 */
activities: {
[k: string]: number
}
/**
 * Directly-follows relations
 */
directly_follows_relations: [[string, string], number][]
/**
 * End activities
 */
end_activities: string[]
/**
 * Start activities
 */
start_activities: string[]
}

export interface ActivityStatistics {
num_evs_per_ot_type: {
[k: string]: number[]
}
num_obs_of_ot_per_ev: {
[k: string]: number[]
}
}

export interface OCDeclareDiscoveryOptions {
/**
 * Activities to use for the discovery. If this is `None`, all activities of the OCEL are used
 */
acts_to_use?: (string[] | null)
/**
 * The arrow types to consider when deriving the final constraints
 * 
 * Should be non-empty!
 */
considered_arrow_types: OCDeclareArcType[]
/**
 * What min/max counts to use for the candidate filtering step (when the arrow type is determined)
 * 
 * @minItems 2
 * @maxItems 2
 */
counts_for_filter: [(number | null), (number | null)]
/**
 * What min/max counts to use for the candidate generation steps
 * 
 * @minItems 2
 * @maxItems 2
 */
counts_for_generation: [(number | null), (number | null)]
/**
 * Noise threshold (i.e., what fraction of events are allowed to violate a discovered constraint)
 */
noise_threshold: number
/**
 * Determines if/how object-to-object relationships are considered
 */
o2o_mode: ("None" | "Direct" | "Reversed" | "Bidirectional")
/**
 * If/how the discovered constraints should be reduced
 */
reduction: ("None" | "Lossless" | "Lossy")
/**
 * Determines if the object involvement of discovered constraints should be made more precise/strict after initial discovery and reduction
 */
refinement: boolean
}

export interface OCDeclareArc {
/**
 * Arc type, modeling temporal relation
 */
arc_type: ("AS" | "EF" | "EP" | "DF" | "DP")
/**
 * First tuple element: min count (optional), Second: max count (optional)
 * 
 * @minItems 2
 * @maxItems 2
 */
counts: [(number | null), (number | null)]
/**
 * Source node (e.g., triggering activity)
 */
from: string
label: OCDeclareArcLabel
/**
 * Target node (e.g., target activity)
 */
to: string
}
/**
 * Arc label specifying object involvement criteria
 */

export interface BinnedEdgeDurationStats {
/**
 * Bin center values (in milliseconds)
 */
bin_centers_ms: number[]
/**
 * Human-readable bin edge labels
 */
bin_labels: string[]
/**
 * Maximum duration in milliseconds
 */
max_ms: number
/**
 * Minimum duration in milliseconds
 */
min_ms: number
/**
 * Percentage of total for each bin
 */
percentages: number[]
/**
 * Total number of duration values
 */
total_count: number
}

export type OCDeclareReductionMode = ("None" | "Lossless" | "Lossy")

export type AttrScope = ("event" | "object")

export type OcelAttributeStats = ({
count: number
hist_bin_edges: number[]
hist_counts: number[]
kind: "Float"
max: number
mean: number
min: number
null_count: number
} | {
count: number
hist_bin_edges: number[]
hist_counts: number[]
kind: "Integer"
max: number
mean: number
min: number
null_count: number
} | {
count: number
distinct: number
kind: "Str"
null_count: number
top_values: AttrValueCount[]
} | {
false_count: number
kind: "Bool"
null_count: number
true_count: number
} | {
count: number
hist_bin_edges_ms: number[]
hist_counts: number[]
kind: "Time"
max: string
min: string
null_count: number
} | {
kind: "Empty"
})

/**
 * One distinct categorical value + how often it occurs.
 */

export type IndexOrID = ({
id: string
} | {
index: number
})

export type Nullable_EventWithIndex = (EventWithIndex | null)

export type Nullable_ObjectWithIndex = (ObjectWithIndex | null)

export interface OCELGraphOptions {
maxDistance: number
relsSizeIgnoreThreshold: number
root: string
rootIsObject: boolean
spanningTree: boolean
}

export type Nullable_OCELGraph = (OCELGraph | null)

export interface OCELInfo {
/**
 * Per activity and object type: (min, max) number of objects of that type per event.
 */
activity_involvements: {
[k: string]: {
/**
 * @minItems 2
 * @maxItems 2
 */
[k: string]: [number, number]
}
}
e2o_types: {
[k: string]: {
/**
 * @minItems 2
 * @maxItems 2
 */
[k: string]: [number, string[]]
}
}
event_types: OCELType[]
num_events: number
num_objects: number
o2o_types: {
[k: string]: {
/**
 * @minItems 2
 * @maxItems 2
 */
[k: string]: [number, string[]]
}
}
object_types: OCELType[]
}
/**
 * OCEL Event/Object Type
 */

export interface SampleIds {
event_ids: string[]
object_ids: string[]
}

export interface OCELTypeStats {
event_type_counts: {
[k: string]: number
}
object_type_counts: {
[k: string]: number
}
}

export interface PathSchemaDetailOptions {
/**
 * Must match the value used for enumeration/discovery so `schema_index` stays valid.
 */
allowed_types?: (PathTypeRef[] | null)
bounded_seconds?: (number | null)
max_connections?: (number | null)
max_length: number
schema_index: number
selection: SelectionMode
source: PathTypeRef
target?: (PathTypeRef | null)
temporal: TemporalMode
}
/**
 * A reference to an OCEL type: an event type or object type, by name. Mirrors rust4pm's
 * `TypeRef` (event and object type names are not disjoint, so the kind is carried along).
 */

export type Nullable_PathSchemaDetail = (PathSchemaDetail | null)

/**
 * Detailed result for one schema under chosen temporal / selection options.
 */

export interface PathSchemaOptions {
/**
 * Optional set of types the intermediate steps may pass through; `None` allows all. The
 * source and target are always permitted, so only the steps in between are constrained.
 */
allowed_types?: (PathTypeRef[] | null)
/**
 * Time window in seconds when `temporal` is `Bounded`.
 */
bounded_seconds?: (number | null)
/**
 * Global cap on connections per schema (safety limit).
 */
max_connections?: (number | null)
max_length: number
/**
 * Keep only the top-k schemas (by selectivity) in the result.
 */
max_schemas?: (number | null)
selection: SelectionMode
/**
 * Optional selectivity threshold for early termination.
 */
selectivity_threshold?: (number | null)
source: PathTypeRef
target?: (PathTypeRef | null)
temporal: TemporalMode
}
/**
 * A reference to an OCEL type: an event type or object type, by name. Mirrors rust4pm's
 * `TypeRef` (event and object type names are not disjoint, so the kind is carried along).
 */

export interface PathSchemaResult {
/**
 * Number of distinct connection-equivalence classes among all enumerated schemas.
 */
equivalence_class_count: number
rows: PathSchemaRow[]
source: PathTypeRef
total_sources: number
}
/**
 * One enumerated schema with its metrics, for the heatmap table.
 */

export interface PathEnumerateOptions {
/**
 * Optional set of types the intermediate steps may pass through; `None` allows all. The
 * source and target are always permitted, so only the steps in between are constrained.
 */
allowed_types?: (PathTypeRef[] | null)
max_length: number
source: PathTypeRef
target?: (PathTypeRef | null)
}
/**
 * A reference to an OCEL type: an event type or object type, by name. Mirrors rust4pm's
 * `TypeRef` (event and object type names are not disjoint, so the kind is carried along).
 */

export interface PathSchemaInfo {
index: number
length: number
schema: string
source: PathTypeRef
steps: PathSchemaStep[]
target: PathTypeRef
}
/**
 * A reference to an OCEL type: an event type or object type, by name. Mirrors rust4pm's
 * `TypeRef` (event and object type names are not disjoint, so the kind is carried along).
 */

export interface PathTypeGraph {
edges: PathTypeEdge[]
nodes: PathTypeNode[]
}
/**
 * A qualified relationship edge in the OCEL type graph.
 */

export type output_id = (string | null)

export interface DBTranslationInput {
database: DatabaseType
table_mappings: TableMappings
tree: BindingBoxTree
}

export interface AutoDiscoverConstraintsRequest {
countConstraints?: (CountConstraintOptions | null)
eventuallyFollowsConstraints?: (EventuallyFollowsConstraintOptions | null)
orConstraints?: (ORConstraintOptions | null)
}

export interface AutoDiscoverConstraintsResponse {
constraints: [string, BindingBoxTree][]
}

export interface EvalPageRequest {
evalVersion: number
limit: number
nodeIndex: number
offset: number
/**
 * None = both; Some(true) = only violated; Some(false) = only satisfied.
 */
violated?: (boolean | null)
}

export interface EvalPageResponse {
/**
 * Total rows after filtering (offset+limit applied AFTER).
 */
filteredCount: number
rows: BindingRow[]
}

export interface EvaluateBoxTreeSummary {
bindingsSkipped: boolean
/**
 * Monotonic version counter. Every new evaluation bumps it; page requests
 * must carry the version they think is current, or the server rejects.
 */
evalVersion: number
/**
 * One entry per evaluation node, index-aligned with `evaluation_results`.
 */
nodeSummaries: NodeSummary[]
}

export interface DottedChartOptions {
/**
 * Color-axis mode.
 */
color_axis: ("Activity" | "Resource" | "Case" | {
EventAttribute: string
} | {
CaseAttribute: string
})
/**
 * Event attribute key used to extract the timestamp.
 */
timestamp_key: string
/**
 * X-axis mode.
 */
x_axis: ("Time" | "TimeSinceCaseStart" | "TimeRelativeToCaseDuration" | "StepNumberSinceCaseStart")
/**
 * Y-axis mode.
 */
y_axis: ("Case" | "Resource" | {
EventAttribute: string
} | {
CaseAttribute: string
})
}

export interface DottedChartData {
/**
 * Points grouped by color-axis value.
 */
dots_per_color: {
[k: string]: DottedChartPoints
}
/**
 * Ordered list of y-axis labels (index corresponds to [`DottedChartPoints::y`] values).
 */
y_values: string[]
}
/**
 * A series of (x, y) coordinates for one color group in a dotted chart.
 */

export interface EventTimestampOptions {
/**
 * Event attribute key used to identify the activity name.
 */
activity_key: string
/**
 * Number of time bins to aggregate events into.
 */
num_bins: number
/**
 * Event attribute key used to extract the timestamp.
 */
timestamp_key: string
}

export interface AggregatedEventTimestamps {
/**
 * All distinct activity names found in the log.
 */
activities: string[]
/**
 * Width of each bin in milliseconds, which is also the spacing of the bin centers.
 * 
 * Bins are keyed by their center, so one spans
 * `[center - bin_width_ms / 2, center + bin_width_ms / 2)`. `0` means there are no bins.
 */
bin_width_ms: number
/**
 * Event counts per bin timestamp (millis) per activity name.
 */
events_per_timestamp: {
/**
 * This interface was referenced by `undefined`'s JSON-Schema definition
 * via the `patternProperty` "^-?\d+$".
 */
[k: string]: {
[k: string]: number
}
}
}

export interface ObjectAttributeChanges {
/**
 * Attribute change traces keyed by attribute name.
 * 
 * Each entry contains the chronological list of value changes
 * for that attribute.
 */
traces: {
[k: string]: AttributeChange[]
}
}
/**
 * A single attribute value change at a point in time.
 */

export type Nullable_uint = (number | null)

export interface Map_of_string {
[k: string]: string
}

export type ValueExpression = ({
/**
 * Column name.
 */
column: string
type: "column"
} | {
type: "constant"
/**
 * The value.
 */
value: string
} | {
/**
 * The template.
 */
template: string
type: "template"
} | {
/**
 * Parts, tried in order.
 */
parts: ValueExpression[]
type: "coalesce"
})

export type Predicate = ({
/**
 * Conditions.
 */
conditions: Predicate[]
type: "and"
} | {
/**
 * Conditions.
 */
conditions: Predicate[]
type: "or"
} | {
/**
 * The negated condition.
 */
condition: Predicate
type: "not"
} | {
/**
 * Left side.
 */
left: ({
/**
 * Column name.
 */
column: string
type: "column"
} | {
type: "literal"
/**
 * The literal.
 */
value: (boolean | number | string | {
/**
 * The instant.
 */
timestamp: string
})
})
/**
 * Operator.
 */
op: ("eq" | "ne" | "lt" | "le" | "gt" | "ge")
/**
 * Right side.
 */
right: ({
/**
 * Column name.
 */
column: string
type: "column"
} | {
type: "literal"
/**
 * The literal.
 */
value: (boolean | number | string | {
/**
 * The instant.
 */
timestamp: string
})
})
type: "compare"
} | {
/**
 * Column name.
 */
column: string
type: "is-null"
} | {
/**
 * Column name.
 */
column: string
type: "is-empty"
} | {
/**
 * Column name.
 */
column: string
/**
 * Regular expression.
 */
regex: string
type: "matches"
} | {
/**
 * Column name.
 */
column: string
type: "in"
/**
 * Accepted values.
 */
values: Literal[]
})

export interface Blueprint {
/**
 * How entity ids are rendered.
 */
id_rendering?: ("raw" | "type-prefixed")
/**
 * The mappings.
 */
mappings: MappingEntry[]
/**
 * The row graph.
 */
nodes: Node[]
/**
 * What to do about a repeated object id.
 */
on_duplicate_object?: ("first-wins" | "error")
/**
 * What to do about relations naming a missing entity.
 */
on_missing_endpoint?: ("drop" | "create" | "error")
/**
 * Schema version. Checked against [`super::MODEL_VERSION`] during validation.
 */
version: number
}
/**
 * One independent mapping.
 */

export interface CompiledOcel {
dialect: SqlDialect
errors: CompileError[]
probes: Probe[]
shape: EmissionShape
views: ViewDef[]
}
/**
 * A mapping that produced no view, and why.
 * 
 * Compilation never fails wholesale: an uncompilable mapping is skipped and recorded here, and
 * everything else still compiles.
 * 
 * Serializable but not deserializable: [`RejectReason`] is not, so neither is this.
 */

export type Nullable_ExtractionCatalog = (ExtractionCatalog | null)

/**
 * The concrete, serializable [`Catalog`].
 * 
 * This is the form that crosses a bindings boundary, that an editor holds and sends back, and
 * that gets pinned to disk so a compile can be reproduced against a schema that has since
 * changed.
 */

export interface ExtractionReport {
/**
 * Non-fatal problems collected while running: a policy configured to error
 * (`on_duplicate_object: Error`, `on_missing_endpoint: Error`), or an attribute type two
 * mappings disagreed on. Extraction continues past these. See [`ExtractionError`] for what
 * aborts it instead.
 * 
 * Capped at [`MAX_REPORTED_ERRORS`], with the remainder counted in
 * [`errors_suppressed`](Self::errors_suppressed).
 */
errors: ExtractionError[]
/**
 * Non-fatal problems the run hit past [`MAX_REPORTED_ERRORS`], which
 * [`errors`](Self::errors) therefore does not name. Zero for every run under the cap.
 */
errors_suppressed: number
finalize: FinalizeReport
/**
 * One entry per mapping executed, in **desugared blueprint order** -- the order the author
 * wrote the mappings in, with each ordered group expanded in place. Not execution order,
 * which is multi-pass and grouped by node. Each entry's [`MappingRef::path`] names the
 * authored entry.
 */
per_mapping: MappingStats[]
/**
 * Nodes whose source could have executed the whole node but the compiler declined to build
 * the query for, paired with the reason, and deduplicated per node.
 * 
 * Always safe, since the executor runs the node itself. Reported because falling back on a
 * `Join` is the one execution path whose memory grows with the data, so this explains a
 * non-zero [`rows_materialized`](Self::rows_materialized).
 */
pushdown_declined: PushdownDeclined[]
/**
 * Rows every `Join`/`Union` materialisation this run performed produced, summed across
 * materialisations rather than peaked: an upper bound on peak buffered rows. A cached
 * materialisation is counted once, when computed.
 * 
 * Zero when no mapping's node graph contains a `Join` or `Union`, since a pure
 * `Source -> Filter` chain streams -- which makes zero a witness that the run streamed.
 */
rows_materialized: number
/**
 * Where the run's wall-clock time went.
 * 
 * `None` from [`extract`](super::extract::extract) itself, which is handed open providers
 * and cannot know what they cost to obtain. The runner that owns the connections fills this
 * in, as the `extraction-dbcon` bindings do. Also kept out of `extract` because
 * `std::time::Instant` panics on `wasm32-unknown-unknown`.
 */
timing?: (ExtractionTiming | null)
}
/**
 * The mapping whose row collided.
 */

export interface ResolvedPathSchema {
/**
 * The starting type.
 */
source: ({
Event: string
} | {
Object: string
})
/**
 * Ordered traversal steps with embedded typed edges.
 */
steps: ResolvedStep[]
/**
 * The ending type.
 */
target: ({
Event: string
} | {
Object: string
})
}
/**
 * One step of a [`ResolvedPathSchema`]: a typed edge plus traversal direction.
 */

export interface PathSchemaConnections {
/**
 * The connections, with entities referenced by their OCEL index.
 */
connections: Connection[]
/**
 * Whether the connection limit was reached (results may be incomplete).
 */
limit_reached: boolean
/**
 * Human-readable schema string.
 */
schema: string
/**
 * Whether selectivity-based early termination was triggered.
 */
selectivity_pruned: boolean
stats: SchemaStats
}
/**
 * A discovered connection between two entities, with timestamps.
 * 
 * Only source and target are materialized (not the full intermediate path).
 */

export interface PathSchemaQuery {
/**
 * Whether a schema may revisit the same type.
 */
allow_cycles: boolean
/**
 * Optional set of types the intermediate steps may pass through; `None` allows all. The
 * source (the start) and the target (when one is given) are always permitted, so only the
 * steps in between are constrained.
 */
allowed_types?: (TypeRef[] | null)
/**
 * Maximum number of steps per schema.
 */
max_length: number
params: PathConnectionParams
/**
 * A reference to an OCEL type: an event type or an object type, by name.
 * 
 * Type-level analogue of [`EntityRef`] (which references an instance). Event and object
 * types live in separate namespaces, so the same name can denote both; carrying the kind
 * here keeps them distinct everywhere a type is named.
 */
source: ({
Event: string
} | {
Object: string
})
/**
 * Optional target type; if `None`, schemas to any type are enumerated.
 */
target?: (TypeRef | null)
}
/**
 * Connection-finding parameters.
 */

export interface PathSchemaDiscovery {
/**
 * Connection-equivalence classes over the enumerated schemas.
 */
equivalence_classes: ConnectionEquivalenceClass[]
/**
 * Enumerated schemas with their stats.
 */
schemas: DiscoveredSchema[]
/**
 * Source entity type the query started from.
 */
source_type: string
/**
 * Total number of source-type entities.
 */
total_sources: number
}
/**
 * A group of schemas that connect the same set of (source, target) pairs.
 */

export type Nullable_TypeRef = (TypeRef | null)
/**
 * A reference to an OCEL type: an event type or an object type, by name.
 * 
 * Type-level analogue of [`EntityRef`] (which references an instance). Event and object
 * types live in separate namespaces, so the same name can denote both; carrying the kind
 * here keeps them distinct everywhere a type is named.
 */

export type Nullable_Array_of_TypeRef = (TypeRef[] | null)
/**
 * A reference to an OCEL type: an event type or an object type, by name.
 * 
 * Type-level analogue of [`EntityRef`] (which references an instance). Event and object
 * types live in separate namespaces, so the same name can denote both; carrying the kind
 * here keeps them distinct everywhere a type is named.
 */

export interface PathSchemaTypeGraph {
/**
 * Qualified E2O / O2O relationship edges.
 */
edges: TypeEdge[]
/**
 * Event and object type nodes.
 */
nodes: PathSchemaTypeNode[]
}
/**
 * A directed, typed edge in the type graph (a qualified E2O or O2O relationship type).
 */

export type Nullable_Array_of_string = (string[] | null)

export type Nullable_string = (string | null)

export type Nullable_EventIndex = (EventIndex | null)
/**
 * An Event Index
 * 
 * Points to an event in the context of a given OCEL
 */

export type Nullable_ObjectIndex = (ObjectIndex | null)
/**
 * An Object Index
 * 
 * Points to an object in the context of a given OCEL
 */

export type Nullable_OCELAttributeValue = (OCELAttributeValue | null)
/**
 * OCEL Attribute Values
 */

export type Nullable_OCELType = (OCELType | null)

/**
 * OCEL Event/Object Type
 */

export interface PetriNet {
/**
 * Arcs
 */
arcs: Arc[]
/**
 * Final markings (any of them are accepted as a final marking)
 */
final_markings?: ({
[k: string]: number
}[] | null)
/**
 * Initial marking
 */
initial_marking?: ({
[k: string]: number
} | null)
/**
 * Places
 */
places: {
[k: string]: Place
}
/**
 * Transitions
 */
transitions: {
[k: string]: Transition
}
}
/**
 * Arc in a Petri net
 * 
 * Connecting a transition and a place (or the other way around)
 */

export interface AlignmentOptions {
cost_fn: CostFunction
/**
 * Maximum number of states to visit before aborting (per trace).
 * `None` means no limit.
 */
max_states?: (number | null)
}
/**
 * Cost function for alignment moves
 */

export interface VariantAlignmentResult {
/**
 * The variant's activity sequence
 */
activities: string[]
/**
 * How many traces follow this variant
 */
frequency: number
/**
 * The alignment result or error for this variant
 */
result: ({
Ok: AlignmentResult
} | {
Err: AlignmentError
})
}
/**
 * Alignment Result
 */

export interface FitnessResult {
/**
 * Average trace fitness (across all traces)
 */
average_fitness: number
/**
 * Log fitness, as the total computed fitness (summing up the costs for all traces)
 */
log_fitness: number
/**
 * Fraction of traces that perfectly fit (i.e., have an alignment cost of `0`)
 */
perfectly_fitting_frac: number
/**
 * The total cost, summed up from all traces
 */
total_costs: number
}

export interface ProcessVariant {
/**
 * The activity sequence of the variant as activity names
 */
activities: string[]
/**
 * Number of cases corresponding to this variant
 */
count: number
/**
 * Percentage of total cases corresponding to this variant
 */
percentage: number
}

export interface OCEL {
/**
 * Event Types in OCEL
 */
eventTypes: OCELType[]
/**
 * Events contained in OCEL
 */
events?: OCELEvent[]
/**
 * Object Types in OCEL
 */
objectTypes: OCELType[]
/**
 * Objects contained in OCEL
 */
objects?: OCELObject[]
}
/**
 * OCEL Event/Object Type
 */

export interface OCDirectlyFollowsGraph {
/**
 * The DFG per object type
 */
object_type_to_dfg: {
[k: string]: DirectlyFollowsGraph
}
}
/**
 * A directly-follows graph of [`Activity`]s.
 * Graph containing a set of activities, a set of directly-follows relations, a set of start
 * activities, and a set of end activities.
 * Both, the number of occurrences of activities and of directly follows relations are annotated
 * with their frequency.
 */

export interface AlphaPPPConfig {
/**
 * Absolute threshold for weighted DFG cleaning
 */
absolute_df_clean_thresh: number
/**
 * Balance threshold (for filtering place candidates)
 */
balance_thresh: number
/**
 * Fitness threshold (for filtering place candidates)
 */
fitness_thresh: number
/**
 * Log repair threshold for loops (wrt. to weighted DFG)
 */
log_repair_loop_df_thresh_rel: number
/**
 * Log repair threshold for skips (wrt. to weighted DFG)
 */
log_repair_skip_df_thresh_rel: number
/**
 * Relative threshold for weighted DFG cleaning
 */
relative_df_clean_thresh: number
/**
 * Replay threshold (for filtering place candidates)
 */
replay_thresh: number
}

export interface Bindings {
  "app_bindings::app_ping": { args: {}; ret: string };
  "app_bindings::oc_declare::oc_declare_activity_statistics": { args: {
    "ocel": SlimLinkedOCELHandle;
    "activity": string;
    }; ret: ActivityStatistics };
  "app_bindings::oc_declare::oc_declare_discover": { args: {
    "ocel": SlimLinkedOCELHandle;
    "options"?: OCDeclareDiscoveryOptions;
    }; ret: OCDeclareArc[] };
  "app_bindings::oc_declare::oc_declare_edge_statistics": { args: {
    "ocel": SlimLinkedOCELHandle;
    "arc": OCDeclareArc;
    }; ret: BinnedEdgeDurationStats };
  "app_bindings::oc_declare::oc_declare_evaluate_arcs": { args: {
    "ocel": SlimLinkedOCELHandle;
    "arcs": OCDeclareArc[];
    }; ret: number[] };
  "app_bindings::oc_declare::oc_declare_project_arcs": { args: {
    "arcs": OCDeclareArc[];
    "activities": string[];
    "reduction"?: OCDeclareReductionMode;
    }; ret: OCDeclareArc[] };
  "app_bindings::oc_declare::oc_declare_template_string": { args: {
    "arcs": OCDeclareArc[];
    }; ret: string };
  "app_bindings::ocel::ocel_attribute_stats": { args: {
    "ocel": SlimLinkedOCELHandle;
    "scope": AttrScope;
    "type_name": string;
    "attribute": string;
    }; ret: OcelAttributeStats };
  "app_bindings::ocel::ocel_get_event": { args: {
    "ocel": SlimLinkedOCELHandle;
    "specifier": IndexOrID;
    }; ret: Nullable_EventWithIndex };
  "app_bindings::ocel::ocel_get_object": { args: {
    "ocel": SlimLinkedOCELHandle;
    "specifier": IndexOrID;
    }; ret: Nullable_ObjectWithIndex };
  "app_bindings::ocel::ocel_graph": { args: {
    "ocel": SlimLinkedOCELHandle;
    "options": OCELGraphOptions;
    }; ret: Nullable_OCELGraph };
  "app_bindings::ocel::ocel_info": { args: {
    "ocel": SlimLinkedOCELHandle;
    }; ret: OCELInfo };
  "app_bindings::ocel::ocel_sample_ids": { args: {
    "ocel": SlimLinkedOCELHandle;
    "limit": number;
    }; ret: SampleIds };
  "app_bindings::ocel::ocel_stats": { args: {
    "ocel": SlimLinkedOCELHandle;
    }; ret: OCELTypeStats };
  "app_bindings::path_schemas::ocpq_path_schema_detail": { args: {
    "ocel": SlimLinkedOCELHandle;
    "options": PathSchemaDetailOptions;
    }; ret: Nullable_PathSchemaDetail };
  "app_bindings::path_schemas::ocpq_path_schema_discover": { args: {
    "ocel": SlimLinkedOCELHandle;
    "options": PathSchemaOptions;
    }; ret: PathSchemaResult };
  "app_bindings::path_schemas::ocpq_path_schema_enumerate": { args: {
    "ocel": SlimLinkedOCELHandle;
    "options": PathEnumerateOptions;
    }; ret: PathSchemaInfo[] };
  "app_bindings::path_schemas::ocpq_path_schema_type_graph": { args: {
    "ocel": SlimLinkedOCELHandle;
    }; ret: PathTypeGraph };
  "app_bindings::query::check_constraints_box": { args: {
    "ocel": SlimLinkedOCELHandle;
    "tree": BindingBoxTree;
    "measure_performance"?: boolean;
    "output_id"?: output_id;
    }; ret: EvaluateBoxTreeResultHandle };
  "app_bindings::query::create_db_query": { args: {
    "input": DBTranslationInput;
    }; ret: string };
  "app_bindings::query::discover_constraints": { args: {
    "ocel": SlimLinkedOCELHandle;
    "options": AutoDiscoverConstraintsRequest;
    }; ret: AutoDiscoverConstraintsResponse };
  "app_bindings::query::eval_results_page": { args: {
    "ocel": SlimLinkedOCELHandle;
    "eval": EvaluateBoxTreeResultHandle;
    "request": EvalPageRequest;
    }; ret: EvalPageResponse };
  "app_bindings::query::eval_summary": { args: {
    "ocel": SlimLinkedOCELHandle;
    "eval": EvaluateBoxTreeResultHandle;
    }; ret: EvaluateBoxTreeSummary };
  "app_bindings::query::export_filter_box": { args: {
    "ocel": SlimLinkedOCELHandle;
    "tree": BindingBoxTree;
    "output_id"?: output_id;
    }; ret: SlimLinkedOCELHandle };
  "process_mining::analysis::case_centric::dotted_chart::get_dotted_chart": { args: {
    "xes": EventLogHandle;
    "options"?: DottedChartOptions;
    }; ret: DottedChartData };
  "process_mining::analysis::case_centric::event_timestamp_histogram::get_event_timestamps": { args: {
    "log": EventLogHandle;
    "options"?: EventTimestampOptions;
    }; ret: AggregatedEventTimestamps };
  "process_mining::analysis::object_centric::object_attribute_changes::get_object_attribute_changes": { args: {
    "ocel": SlimLinkedOCELHandle;
    "object_id": string;
    }; ret: ObjectAttributeChanges };
  "process_mining::analysis::object_centric::oc_performance::locel_oc_perf_sojourn_per_event": { args: {
    "ocel": SlimLinkedOCELHandle;
    "top_k"?: Nullable_uint;
    }; ret: [string, number][] };
  "process_mining::analysis::object_centric::oc_performance::locel_oc_perf_sync_per_event": { args: {
    "ocel": SlimLinkedOCELHandle;
    "top_k"?: Nullable_uint;
    }; ret: [string, number, string][] };
  "process_mining::analysis::object_centric::oc_statistics::locel_conversion_rate": { args: {
    "ocel": SlimLinkedOCELHandle;
    "activity": string;
    "source_type": string;
    "target_type": string;
    }; ret: number };
  "process_mining::analysis::object_centric::oc_statistics::locel_event_object_type_counts": { args: {
    "ocel": SlimLinkedOCELHandle;
    }; ret: [string, string, number][] };
  "process_mining::bindings::extraction_bindings::extraction_column_domain_items": { args: {
    "sources": Map_of_string;
    "source_id": string;
    "table": string;
    "column": string;
    }; ret: string[] };
  "process_mining::bindings::extraction_bindings::extraction_compile": { args: {
    "blueprint": Blueprint;
    "catalog": ExtractionCatalog;
    "shape": EmissionShape;
    "dialect"?: SqlDialect;
    }; ret: CompiledOcel };
  "process_mining::bindings::extraction_bindings::extraction_discover_catalog_items": { args: {
    "sources": Map_of_string;
    }; ret: ExtractionCatalog };
  "process_mining::bindings::extraction_bindings::extraction_run_items": { args: {
    "blueprint": Blueprint;
    "sources": Map_of_string;
    "catalog"?: Nullable_ExtractionCatalog;
    "output_id"?: output_id;
    }; ret: SlimLinkedOCELHandle };
  "process_mining::bindings::extraction_bindings::extraction_table_preview_items": { args: {
    "sources": Map_of_string;
    "source_id": string;
    "table": string;
    "limit"?: Nullable_uint;
    }; ret: TablePreview };
  "process_mining::bindings::extraction_bindings::extraction_validate": { args: {
    "blueprint": Blueprint;
    "catalog": ExtractionCatalog;
    }; ret: ValidationError[] };
  "process_mining::bindings::extraction_dbcon_bindings::extraction_column_domain": { args: {
    "connections": Map_of_string;
    "source_id": string;
    "table": string;
    "column": string;
    }; ret: string[] };
  "process_mining::bindings::extraction_dbcon_bindings::extraction_connection_kinds": { args: {}; ret: string[] };
  "process_mining::bindings::extraction_dbcon_bindings::extraction_discover_catalog": { args: {
    "connections": Map_of_string;
    }; ret: ExtractionCatalog };
  "process_mining::bindings::extraction_dbcon_bindings::extraction_run": { args: {
    "ocel": SlimLinkedOCELHandle;
    "blueprint": Blueprint;
    "connections": Map_of_string;
    "catalog"?: Nullable_ExtractionCatalog;
    }; ret: ExtractionReport };
  "process_mining::bindings::extraction_dbcon_bindings::extraction_table_preview": { args: {
    "connections": Map_of_string;
    "source_id": string;
    "table": string;
    "limit"?: Nullable_uint;
    }; ret: TablePreview };
  "process_mining::bindings::index_link_ocel": { args: {
    "ocel": OCELHandle;
    "output_id"?: output_id;
    }; ret: IndexLinkedOCELHandle };
  "process_mining::bindings::num_events": { args: {
    "ocel": SlimLinkedOCELHandle;
    }; ret: number };
  "process_mining::bindings::num_objects": { args: {
    "ocel": SlimLinkedOCELHandle;
    }; ret: number };
  "process_mining::bindings::ocel_type_stats": { args: {
    "ocel": SlimLinkedOCELHandle;
    }; ret: OCELTypeStats };
  "process_mining::bindings::path_schema_bindings::path_schema_connections": { args: {
    "ocel": SlimLinkedOCELHandle;
    "schema": ResolvedPathSchema;
    "params"?: PathConnectionParams;
    }; ret: PathSchemaConnections };
  "process_mining::bindings::path_schema_bindings::path_schema_discover": { args: {
    "ocel": SlimLinkedOCELHandle;
    "query": PathSchemaQuery;
    }; ret: PathSchemaDiscovery };
  "process_mining::bindings::path_schema_bindings::path_schema_enumerate": { args: {
    "ocel": SlimLinkedOCELHandle;
    "source": TypeRef;
    "target"?: Nullable_TypeRef;
    "max_length": number;
    "allow_cycles"?: boolean;
    "allowed_types"?: Nullable_Array_of_TypeRef;
    }; ret: ResolvedPathSchema[] };
  "process_mining::bindings::path_schema_bindings::path_schema_type_graph": { args: {
    "ocel": SlimLinkedOCELHandle;
    }; ret: PathSchemaTypeGraph };
  "process_mining::bindings::slim_link_ocel": { args: {
    "ocel": OCELHandle;
    "output_id"?: output_id;
    }; ret: SlimLinkedOCELHandle };
  "process_mining::bindings::slim_ocel_bindings::get_dfg_of_object_type": { args: {
    "ocel": SlimLinkedOCELHandle;
    "ob_type": string;
    }; ret: [[string, string], number][] };
  "process_mining::bindings::slim_ocel_bindings::get_e2o_ids": { args: {
    "ocel": SlimLinkedOCELHandle;
    "ev_id": string;
    }; ret: Nullable_Array_of_string };
  "process_mining::bindings::slim_ocel_bindings::get_e2o_rev_ids": { args: {
    "ocel": SlimLinkedOCELHandle;
    "ob_id": string;
    }; ret: Nullable_Array_of_string };
  "process_mining::bindings::slim_ocel_bindings::get_event_ids_of_type": { args: {
    "ocel": SlimLinkedOCELHandle;
    "ev_type": string;
    }; ret: string[] };
  "process_mining::bindings::slim_ocel_bindings::get_event_timestamp_of_id": { args: {
    "ocel": SlimLinkedOCELHandle;
    "ev_id": string;
    }; ret: Nullable_string };
  "process_mining::bindings::slim_ocel_bindings::get_event_type_of_id": { args: {
    "ocel": SlimLinkedOCELHandle;
    "ev_id": string;
    }; ret: Nullable_string };
  "process_mining::bindings::slim_ocel_bindings::get_o2o_ids": { args: {
    "ocel": SlimLinkedOCELHandle;
    "ob_id": string;
    }; ret: Nullable_Array_of_string };
  "process_mining::bindings::slim_ocel_bindings::get_obj_activity_trace": { args: {
    "ocel": SlimLinkedOCELHandle;
    "ob": number;
    }; ret: string[] };
  "process_mining::bindings::slim_ocel_bindings::get_object_ids_of_type": { args: {
    "ocel": SlimLinkedOCELHandle;
    "ob_type": string;
    }; ret: string[] };
  "process_mining::bindings::slim_ocel_bindings::get_object_type_of_id": { args: {
    "ocel": SlimLinkedOCELHandle;
    "ob_id": string;
    }; ret: Nullable_string };
  "process_mining::bindings::slim_ocel_bindings::get_variants_of_object_type": { args: {
    "ocel": SlimLinkedOCELHandle;
    "ob_type": string;
    }; ret: [string[], number][] };
  "process_mining::bindings::slim_ocel_bindings::locel_add_e2o": { args: {
    "ocel": SlimLinkedOCELHandle;
    "event": number;
    "object": number;
    "qualifier": string;
    }; ret: boolean };
  "process_mining::bindings::slim_ocel_bindings::locel_add_event": { args: {
    "ocel": SlimLinkedOCELHandle;
    "event_type": string;
    "time": string;
    "id"?: Nullable_string;
    "attributes"?: OCELAttributeValue[];
    "relationships"?: [string, number][];
    }; ret: Nullable_EventIndex };
  "process_mining::bindings::slim_ocel_bindings::locel_add_event_type": { args: {
    "ocel": SlimLinkedOCELHandle;
    "event_type": string;
    "attributes"?: OCELTypeAttribute[];
    }; ret: null };
  "process_mining::bindings::slim_ocel_bindings::locel_add_o2o": { args: {
    "ocel": SlimLinkedOCELHandle;
    "from_obj": number;
    "to_obj": number;
    "qualifier": string;
    }; ret: boolean };
  "process_mining::bindings::slim_ocel_bindings::locel_add_object": { args: {
    "ocel": SlimLinkedOCELHandle;
    "object_type": string;
    "id"?: Nullable_string;
    "attributes"?: [string, OCELAttributeValue][][];
    "relationships"?: [string, number][];
    }; ret: Nullable_ObjectIndex };
  "process_mining::bindings::slim_ocel_bindings::locel_add_object_type": { args: {
    "ocel": SlimLinkedOCELHandle;
    "object_type": string;
    "attributes"?: OCELTypeAttribute[];
    }; ret: null };
  "process_mining::bindings::slim_ocel_bindings::locel_construct_ocel": { args: {
    "ocel": SlimLinkedOCELHandle;
    "output_id"?: output_id;
    }; ret: OCELHandle };
  "process_mining::bindings::slim_ocel_bindings::locel_conversion_rate": { args: {
    "ocel": SlimLinkedOCELHandle;
    "activity": string;
    "source_type": string;
    "target_type": string;
    }; ret: number };
  "process_mining::bindings::slim_ocel_bindings::locel_delete_e2o": { args: {
    "ocel": SlimLinkedOCELHandle;
    "event": number;
    "object": number;
    }; ret: boolean };
  "process_mining::bindings::slim_ocel_bindings::locel_delete_o2o": { args: {
    "ocel": SlimLinkedOCELHandle;
    "from_obj": number;
    "to_obj": number;
    }; ret: boolean };
  "process_mining::bindings::slim_ocel_bindings::locel_event_object_type_counts": { args: {
    "ocel": SlimLinkedOCELHandle;
    }; ret: [string, string, number][] };
  "process_mining::bindings::slim_ocel_bindings::locel_get_e2o": { args: {
    "ocel": SlimLinkedOCELHandle;
    "ev": number;
    }; ret: [string, number][] };
  "process_mining::bindings::slim_ocel_bindings::locel_get_e2o_rev": { args: {
    "ocel": SlimLinkedOCELHandle;
    "ob": number;
    }; ret: [string, number][] };
  "process_mining::bindings::slim_ocel_bindings::locel_get_ev_attr_val": { args: {
    "ocel": SlimLinkedOCELHandle;
    "ev": number;
    "attr_name": string;
    }; ret: Nullable_OCELAttributeValue };
  "process_mining::bindings::slim_ocel_bindings::locel_get_ev_by_id": { args: {
    "ocel": SlimLinkedOCELHandle;
    "ev_id": string;
    }; ret: Nullable_EventIndex };
  "process_mining::bindings::slim_ocel_bindings::locel_get_ev_id": { args: {
    "ocel": SlimLinkedOCELHandle;
    "ev": number;
    }; ret: string };
  "process_mining::bindings::slim_ocel_bindings::locel_get_ev_time": { args: {
    "ocel": SlimLinkedOCELHandle;
    "ev": number;
    }; ret: string };
  "process_mining::bindings::slim_ocel_bindings::locel_get_ev_type": { args: {
    "ocel": SlimLinkedOCELHandle;
    "ev_type": string;
    }; ret: Nullable_OCELType };
  "process_mining::bindings::slim_ocel_bindings::locel_get_ev_type_of": { args: {
    "ocel": SlimLinkedOCELHandle;
    "ev": number;
    }; ret: string };
  "process_mining::bindings::slim_ocel_bindings::locel_get_ev_types": { args: {
    "ocel": SlimLinkedOCELHandle;
    }; ret: string[] };
  "process_mining::bindings::slim_ocel_bindings::locel_get_evs_of_type": { args: {
    "ocel": SlimLinkedOCELHandle;
    "ev_type": string;
    }; ret: number[] };
  "process_mining::bindings::slim_ocel_bindings::locel_get_full_ev": { args: {
    "ocel": SlimLinkedOCELHandle;
    "ev": number;
    }; ret: OCELEvent };
  "process_mining::bindings::slim_ocel_bindings::locel_get_full_ob": { args: {
    "ocel": SlimLinkedOCELHandle;
    "ob": number;
    }; ret: OCELObject };
  "process_mining::bindings::slim_ocel_bindings::locel_get_o2o": { args: {
    "ocel": SlimLinkedOCELHandle;
    "ob": number;
    }; ret: [string, number][] };
  "process_mining::bindings::slim_ocel_bindings::locel_get_o2o_rev": { args: {
    "ocel": SlimLinkedOCELHandle;
    "ob": number;
    }; ret: [string, number][] };
  "process_mining::bindings::slim_ocel_bindings::locel_get_ob_attr_vals": { args: {
    "ocel": SlimLinkedOCELHandle;
    "ob": number;
    "attr_name": string;
    }; ret: [string, OCELAttributeValue][] };
  "process_mining::bindings::slim_ocel_bindings::locel_get_ob_by_id": { args: {
    "ocel": SlimLinkedOCELHandle;
    "ob_id": string;
    }; ret: Nullable_ObjectIndex };
  "process_mining::bindings::slim_ocel_bindings::locel_get_ob_id": { args: {
    "ocel": SlimLinkedOCELHandle;
    "ob": number;
    }; ret: string };
  "process_mining::bindings::slim_ocel_bindings::locel_get_ob_type": { args: {
    "ocel": SlimLinkedOCELHandle;
    "ob_type": string;
    }; ret: Nullable_OCELType };
  "process_mining::bindings::slim_ocel_bindings::locel_get_ob_type_of": { args: {
    "ocel": SlimLinkedOCELHandle;
    "ob": number;
    }; ret: string };
  "process_mining::bindings::slim_ocel_bindings::locel_get_ob_types": { args: {
    "ocel": SlimLinkedOCELHandle;
    }; ret: string[] };
  "process_mining::bindings::slim_ocel_bindings::locel_get_obs_of_type": { args: {
    "ocel": SlimLinkedOCELHandle;
    "ob_type": string;
    }; ret: number[] };
  "process_mining::bindings::slim_ocel_bindings::locel_new": { args: {
    "output_id"?: output_id;
    }; ret: SlimLinkedOCELHandle };
  "process_mining::bindings::slim_ocel_bindings::locel_oc_perf_sojourn_per_event": { args: {
    "ocel": SlimLinkedOCELHandle;
    "top_k"?: Nullable_uint;
    }; ret: [string, number][] };
  "process_mining::bindings::slim_ocel_bindings::locel_oc_perf_sync_per_event": { args: {
    "ocel": SlimLinkedOCELHandle;
    "top_k"?: Nullable_uint;
    }; ret: [string, number, string][] };
  "process_mining::bindings::test_some_inputs": { args: {
    "s": string;
    "n": number;
    "i": number;
    "f": number;
    "b": boolean;
    }; ret: string };
  "process_mining::conformance::case_centric::alignments::align_empty_trace": { args: {
    "net": PetriNet;
    "options"?: AlignmentOptions;
    }; ret: AlignmentResult };
  "process_mining::conformance::case_centric::alignments::align_trace_binding": { args: {
    "net": PetriNet;
    "trace": string[];
    "options"?: AlignmentOptions;
    }; ret: AlignmentResult };
  "process_mining::conformance::case_centric::alignments::align_variants": { args: {
    "net": PetriNet;
    "projection": EventLogActivityProjectionHandle;
    "options"?: AlignmentOptions;
    }; ret: VariantAlignmentResult[] };
  "process_mining::conformance::case_centric::alignments::compute_fitness": { args: {
    "align_res": VariantAlignmentResult[];
    "net": PetriNet;
    "options"?: AlignmentOptions;
    }; ret: FitnessResult };
  "process_mining::conformance::object_centric::oc_declare::oc_declare_conformance": { args: {
    "ocel": SlimLinkedOCELHandle;
    "arc": OCDeclareArc;
    }; ret: number };
  "process_mining::core::event_data::case_centric::utils::activity_projection::get_num_cases": { args: {
    "projection": EventLogActivityProjectionHandle;
    }; ret: number };
  "process_mining::core::event_data::case_centric::utils::activity_projection::get_num_variants": { args: {
    "projection": EventLogActivityProjectionHandle;
    }; ret: number };
  "process_mining::core::event_data::case_centric::utils::activity_projection::get_projection_activities": { args: {
    "projection": EventLogActivityProjectionHandle;
    }; ret: string[] };
  "process_mining::core::event_data::case_centric::utils::activity_projection::get_top_n_variants": { args: {
    "projection": EventLogActivityProjectionHandle;
    "n": number;
    }; ret: ProcessVariant[] };
  "process_mining::core::event_data::case_centric::utils::activity_projection::get_variants": { args: {
    "projection": EventLogActivityProjectionHandle;
    }; ret: ProcessVariant[] };
  "process_mining::core::event_data::case_centric::utils::activity_projection::log_to_activity_projection": { args: {
    "log": EventLogHandle;
    "output_id"?: output_id;
    }; ret: EventLogActivityProjectionHandle };
  "process_mining::core::event_data::object_centric::utils::flatten::flatten_ocel_on": { args: {
    "ocel": SlimLinkedOCELHandle;
    "object_type": string;
    "output_id"?: output_id;
    }; ret: EventLogHandle };
  "process_mining::core::event_data::object_centric::utils::init_exit_events::add_init_exit_events_to_ocel": { args: {
    "ocel": OCEL;
    "output_id"?: output_id;
    }; ret: OCELHandle };
  "process_mining::core::process_models::object_centric::ocdfg::object_centric_dfg_struct::discover_dfg_from_ocel": { args: {
    "ocel": SlimLinkedOCELHandle;
    }; ret: OCDirectlyFollowsGraph };
  "process_mining::discovery::case_centric::alphappp::full::alphappp_discover_petri_net": { args: {
    "log_proj": EventLogActivityProjectionHandle;
    "config"?: AlphaPPPConfig;
    }; ret: PetriNet };
  "process_mining::discovery::case_centric::dfg::discover_dfg": { args: {
    "event_log": EventLogHandle;
    }; ret: DirectlyFollowsGraph };
  "process_mining::discovery::object_centric::dfg::get_dfg_of_object_type": { args: {
    "ocel": SlimLinkedOCELHandle;
    "ob_type": string;
    }; ret: [[string, string], number][] };
  "process_mining::discovery::object_centric::oc_declare::discover_behavior_constraints": { args: {
    "locel": SlimLinkedOCELHandle;
    "options"?: OCDeclareDiscoveryOptions;
    }; ret: OCDeclareArc[] };
  "process_mining::discovery::object_centric::variants::get_variants_of_object_type": { args: {
    "ocel": SlimLinkedOCELHandle;
    "ob_type": string;
    }; ret: [string[], number][] };
}

export type BindingId = keyof Bindings;

/** Typed dispatch. Runtime decodes the binding's Vec<u8> JSON; types are compile-time only.
 *  `opts.outputName` deterministically names a minted result handle (pipeline intermediates). */
export type CallBinding = <K extends BindingId>(id: K, args: Bindings[K]["args"], opts?: { outputName?: string }) => Promise<Bindings[K]["ret"]>;

/** The untyped dispatch each transport implements once (http fetch / tauri invoke / wasm direct);
 *  supplied by the host app, which is what keeps this file transport-agnostic. */
export type BindingTransport = (id: BindingId, args: unknown, opts?: { outputName?: string }) => Promise<unknown>;

/** Put the generated types back on top of a host-supplied transport. */
export function createBindingClient(transport: BindingTransport): CallBinding {
  return <K extends BindingId>(id: K, args: Bindings[K]["args"], opts?: { outputName?: string }) =>
    transport(id, args, opts) as Promise<Bindings[K]["ret"]>;
}

/** Distinct return-type titles, keyed for rename-safe reference from viewer `accepts` predicates. */
export const RETURN_TYPES = {
  "ActivityStatistics": "ActivityStatistics",
  "AggregatedEventTimestamps": "AggregatedEventTimestamps",
  "AlignmentResult": "AlignmentResult",
  "Array_of_EventIndex": "Array_of_EventIndex",
  "Array_of_OCDeclareArc": "Array_of_OCDeclareArc",
  "Array_of_ObjectIndex": "Array_of_ObjectIndex",
  "Array_of_PathSchemaInfo": "Array_of_PathSchemaInfo",
  "Array_of_ProcessVariant": "Array_of_ProcessVariant",
  "Array_of_ResolvedPathSchema": "Array_of_ResolvedPathSchema",
  "Array_of_Tuple_of_Array_of_string_and_uint": "Array_of_Tuple_of_Array_of_string_and_uint",
  "Array_of_Tuple_of_DateTime_and_OCELAttributeValue": "Array_of_Tuple_of_DateTime_and_OCELAttributeValue",
  "Array_of_Tuple_of_Tuple_of_string_and_string_and_uint": "Array_of_Tuple_of_Tuple_of_string_and_string_and_uint",
  "Array_of_Tuple_of_string_and_EventIndex": "Array_of_Tuple_of_string_and_EventIndex",
  "Array_of_Tuple_of_string_and_ObjectIndex": "Array_of_Tuple_of_string_and_ObjectIndex",
  "Array_of_Tuple_of_string_and_int64": "Array_of_Tuple_of_string_and_int64",
  "Array_of_Tuple_of_string_and_int64_and_string": "Array_of_Tuple_of_string_and_int64_and_string",
  "Array_of_Tuple_of_string_and_string_and_int64": "Array_of_Tuple_of_string_and_string_and_int64",
  "Array_of_ValidationError": "Array_of_ValidationError",
  "Array_of_VariantAlignmentResult": "Array_of_VariantAlignmentResult",
  "Array_of_double": "Array_of_double",
  "Array_of_string": "Array_of_string",
  "AutoDiscoverConstraintsResponse": "AutoDiscoverConstraintsResponse",
  "BinnedEdgeDurationStats": "BinnedEdgeDurationStats",
  "CompiledOcel": "CompiledOcel",
  "DateTime": "DateTime",
  "DirectlyFollowsGraph": "DirectlyFollowsGraph",
  "DottedChartData": "DottedChartData",
  "EvalPageResponse": "EvalPageResponse",
  "EvaluateBoxTreeResult": "EvaluateBoxTreeResult",
  "EvaluateBoxTreeSummary": "EvaluateBoxTreeSummary",
  "EventLog": "EventLog",
  "EventLogActivityProjection": "EventLogActivityProjection",
  "ExtractionCatalog": "ExtractionCatalog",
  "ExtractionReport": "ExtractionReport",
  "FitnessResult": "FitnessResult",
  "IndexLinkedOCEL": "IndexLinkedOCEL",
  "Nullable_Array_of_string": "Nullable_Array_of_string",
  "Nullable_EventIndex": "Nullable_EventIndex",
  "Nullable_EventWithIndex": "Nullable_EventWithIndex",
  "Nullable_OCELAttributeValue": "Nullable_OCELAttributeValue",
  "Nullable_OCELGraph": "Nullable_OCELGraph",
  "Nullable_OCELType": "Nullable_OCELType",
  "Nullable_ObjectIndex": "Nullable_ObjectIndex",
  "Nullable_ObjectWithIndex": "Nullable_ObjectWithIndex",
  "Nullable_PathSchemaDetail": "Nullable_PathSchemaDetail",
  "Nullable_string": "Nullable_string",
  "OCDirectlyFollowsGraph": "OCDirectlyFollowsGraph",
  "OCEL": "OCEL",
  "OCELEvent": "OCELEvent",
  "OCELInfo": "OCELInfo",
  "OCELObject": "OCELObject",
  "OCELTypeStats": "OCELTypeStats",
  "ObjectAttributeChanges": "ObjectAttributeChanges",
  "OcelAttributeStats": "OcelAttributeStats",
  "PathSchemaConnections": "PathSchemaConnections",
  "PathSchemaDiscovery": "PathSchemaDiscovery",
  "PathSchemaResult": "PathSchemaResult",
  "PathSchemaTypeGraph": "PathSchemaTypeGraph",
  "PathTypeGraph": "PathTypeGraph",
  "PetriNet": "PetriNet",
  "SampleIds": "SampleIds",
  "SlimLinkedOCEL": "SlimLinkedOCEL",
  "TablePreview": "TablePreview",
  "boolean": "boolean",
  "double": "double",
  "null": "null",
  "string": "string",
  "uint": "uint",
  "uint64": "uint64",
} as const;

/** Every value a binding's return type can be matched on by the viewer registry. */
export type ReturnTypeTitle = (typeof RETURN_TYPES)[keyof typeof RETURN_TYPES];

/** Return-type title -> decoded payload type, so a viewer registration can pin its per-title
 *  transform/component to the actual binding payload shape instead of trusting the title string. */
export interface ReturnTypeShape {
  "ActivityStatistics": ActivityStatistics;
  "AggregatedEventTimestamps": AggregatedEventTimestamps;
  "AlignmentResult": AlignmentResult;
  "Array_of_EventIndex": number[];
  "Array_of_OCDeclareArc": OCDeclareArc[];
  "Array_of_ObjectIndex": number[];
  "Array_of_PathSchemaInfo": PathSchemaInfo[];
  "Array_of_ProcessVariant": ProcessVariant[];
  "Array_of_ResolvedPathSchema": ResolvedPathSchema[];
  "Array_of_Tuple_of_Array_of_string_and_uint": [string[], number][];
  "Array_of_Tuple_of_DateTime_and_OCELAttributeValue": [string, OCELAttributeValue][];
  "Array_of_Tuple_of_Tuple_of_string_and_string_and_uint": [[string, string], number][];
  "Array_of_Tuple_of_string_and_EventIndex": [string, number][];
  "Array_of_Tuple_of_string_and_ObjectIndex": [string, number][];
  "Array_of_Tuple_of_string_and_int64": [string, number][];
  "Array_of_Tuple_of_string_and_int64_and_string": [string, number, string][];
  "Array_of_Tuple_of_string_and_string_and_int64": [string, string, number][];
  "Array_of_ValidationError": ValidationError[];
  "Array_of_VariantAlignmentResult": VariantAlignmentResult[];
  "Array_of_double": number[];
  "Array_of_string": string[];
  "AutoDiscoverConstraintsResponse": AutoDiscoverConstraintsResponse;
  "BinnedEdgeDurationStats": BinnedEdgeDurationStats;
  "CompiledOcel": CompiledOcel;
  "DateTime": string;
  "DirectlyFollowsGraph": DirectlyFollowsGraph;
  "DottedChartData": DottedChartData;
  "EvalPageResponse": EvalPageResponse;
  "EvaluateBoxTreeResult": EvaluateBoxTreeResultHandle;
  "EvaluateBoxTreeSummary": EvaluateBoxTreeSummary;
  "EventLog": EventLogHandle;
  "EventLogActivityProjection": EventLogActivityProjectionHandle;
  "ExtractionCatalog": ExtractionCatalog;
  "ExtractionReport": ExtractionReport;
  "FitnessResult": FitnessResult;
  "IndexLinkedOCEL": IndexLinkedOCELHandle;
  "Nullable_Array_of_string": Nullable_Array_of_string;
  "Nullable_EventIndex": Nullable_EventIndex;
  "Nullable_EventWithIndex": Nullable_EventWithIndex;
  "Nullable_OCELAttributeValue": Nullable_OCELAttributeValue;
  "Nullable_OCELGraph": Nullable_OCELGraph;
  "Nullable_OCELType": Nullable_OCELType;
  "Nullable_ObjectIndex": Nullable_ObjectIndex;
  "Nullable_ObjectWithIndex": Nullable_ObjectWithIndex;
  "Nullable_PathSchemaDetail": Nullable_PathSchemaDetail;
  "Nullable_string": Nullable_string;
  "OCDirectlyFollowsGraph": OCDirectlyFollowsGraph;
  "OCEL": OCELHandle;
  "OCELEvent": OCELEvent;
  "OCELInfo": OCELInfo;
  "OCELObject": OCELObject;
  "OCELTypeStats": OCELTypeStats;
  "ObjectAttributeChanges": ObjectAttributeChanges;
  "OcelAttributeStats": OcelAttributeStats;
  "PathSchemaConnections": PathSchemaConnections;
  "PathSchemaDiscovery": PathSchemaDiscovery;
  "PathSchemaResult": PathSchemaResult;
  "PathSchemaTypeGraph": PathSchemaTypeGraph;
  "PathTypeGraph": PathTypeGraph;
  "PetriNet": PetriNet;
  "SampleIds": SampleIds;
  "SlimLinkedOCEL": SlimLinkedOCELHandle;
  "TablePreview": TablePreview;
  "boolean": boolean;
  "double": number;
  "null": null;
  "string": string;
  "uint": number;
  "uint64": number;
}

/** Each binding's return-type title (null when the return type is unnamed, e.g. a tuple/primitive). */
export const BINDING_RETURN_TYPE: Record<BindingId, ReturnTypeTitle | null> = {
  "app_bindings::app_ping": "string",
  "app_bindings::oc_declare::oc_declare_activity_statistics": "ActivityStatistics",
  "app_bindings::oc_declare::oc_declare_discover": "Array_of_OCDeclareArc",
  "app_bindings::oc_declare::oc_declare_edge_statistics": "BinnedEdgeDurationStats",
  "app_bindings::oc_declare::oc_declare_evaluate_arcs": "Array_of_double",
  "app_bindings::oc_declare::oc_declare_project_arcs": "Array_of_OCDeclareArc",
  "app_bindings::oc_declare::oc_declare_template_string": "string",
  "app_bindings::ocel::ocel_attribute_stats": "OcelAttributeStats",
  "app_bindings::ocel::ocel_get_event": "Nullable_EventWithIndex",
  "app_bindings::ocel::ocel_get_object": "Nullable_ObjectWithIndex",
  "app_bindings::ocel::ocel_graph": "Nullable_OCELGraph",
  "app_bindings::ocel::ocel_info": "OCELInfo",
  "app_bindings::ocel::ocel_sample_ids": "SampleIds",
  "app_bindings::ocel::ocel_stats": "OCELTypeStats",
  "app_bindings::path_schemas::ocpq_path_schema_detail": "Nullable_PathSchemaDetail",
  "app_bindings::path_schemas::ocpq_path_schema_discover": "PathSchemaResult",
  "app_bindings::path_schemas::ocpq_path_schema_enumerate": "Array_of_PathSchemaInfo",
  "app_bindings::path_schemas::ocpq_path_schema_type_graph": "PathTypeGraph",
  "app_bindings::query::check_constraints_box": "EvaluateBoxTreeResult",
  "app_bindings::query::create_db_query": "string",
  "app_bindings::query::discover_constraints": "AutoDiscoverConstraintsResponse",
  "app_bindings::query::eval_results_page": "EvalPageResponse",
  "app_bindings::query::eval_summary": "EvaluateBoxTreeSummary",
  "app_bindings::query::export_filter_box": "SlimLinkedOCEL",
  "process_mining::analysis::case_centric::dotted_chart::get_dotted_chart": "DottedChartData",
  "process_mining::analysis::case_centric::event_timestamp_histogram::get_event_timestamps": "AggregatedEventTimestamps",
  "process_mining::analysis::object_centric::object_attribute_changes::get_object_attribute_changes": "ObjectAttributeChanges",
  "process_mining::analysis::object_centric::oc_performance::locel_oc_perf_sojourn_per_event": "Array_of_Tuple_of_string_and_int64",
  "process_mining::analysis::object_centric::oc_performance::locel_oc_perf_sync_per_event": "Array_of_Tuple_of_string_and_int64_and_string",
  "process_mining::analysis::object_centric::oc_statistics::locel_conversion_rate": "double",
  "process_mining::analysis::object_centric::oc_statistics::locel_event_object_type_counts": "Array_of_Tuple_of_string_and_string_and_int64",
  "process_mining::bindings::extraction_bindings::extraction_column_domain_items": "Array_of_string",
  "process_mining::bindings::extraction_bindings::extraction_compile": "CompiledOcel",
  "process_mining::bindings::extraction_bindings::extraction_discover_catalog_items": "ExtractionCatalog",
  "process_mining::bindings::extraction_bindings::extraction_run_items": "SlimLinkedOCEL",
  "process_mining::bindings::extraction_bindings::extraction_table_preview_items": "TablePreview",
  "process_mining::bindings::extraction_bindings::extraction_validate": "Array_of_ValidationError",
  "process_mining::bindings::extraction_dbcon_bindings::extraction_column_domain": "Array_of_string",
  "process_mining::bindings::extraction_dbcon_bindings::extraction_connection_kinds": "Array_of_string",
  "process_mining::bindings::extraction_dbcon_bindings::extraction_discover_catalog": "ExtractionCatalog",
  "process_mining::bindings::extraction_dbcon_bindings::extraction_run": "ExtractionReport",
  "process_mining::bindings::extraction_dbcon_bindings::extraction_table_preview": "TablePreview",
  "process_mining::bindings::index_link_ocel": "IndexLinkedOCEL",
  "process_mining::bindings::num_events": "uint",
  "process_mining::bindings::num_objects": "uint",
  "process_mining::bindings::ocel_type_stats": "OCELTypeStats",
  "process_mining::bindings::path_schema_bindings::path_schema_connections": "PathSchemaConnections",
  "process_mining::bindings::path_schema_bindings::path_schema_discover": "PathSchemaDiscovery",
  "process_mining::bindings::path_schema_bindings::path_schema_enumerate": "Array_of_ResolvedPathSchema",
  "process_mining::bindings::path_schema_bindings::path_schema_type_graph": "PathSchemaTypeGraph",
  "process_mining::bindings::slim_link_ocel": "SlimLinkedOCEL",
  "process_mining::bindings::slim_ocel_bindings::get_dfg_of_object_type": "Array_of_Tuple_of_Tuple_of_string_and_string_and_uint",
  "process_mining::bindings::slim_ocel_bindings::get_e2o_ids": "Nullable_Array_of_string",
  "process_mining::bindings::slim_ocel_bindings::get_e2o_rev_ids": "Nullable_Array_of_string",
  "process_mining::bindings::slim_ocel_bindings::get_event_ids_of_type": "Array_of_string",
  "process_mining::bindings::slim_ocel_bindings::get_event_timestamp_of_id": "Nullable_string",
  "process_mining::bindings::slim_ocel_bindings::get_event_type_of_id": "Nullable_string",
  "process_mining::bindings::slim_ocel_bindings::get_o2o_ids": "Nullable_Array_of_string",
  "process_mining::bindings::slim_ocel_bindings::get_obj_activity_trace": "Array_of_string",
  "process_mining::bindings::slim_ocel_bindings::get_object_ids_of_type": "Array_of_string",
  "process_mining::bindings::slim_ocel_bindings::get_object_type_of_id": "Nullable_string",
  "process_mining::bindings::slim_ocel_bindings::get_variants_of_object_type": "Array_of_Tuple_of_Array_of_string_and_uint",
  "process_mining::bindings::slim_ocel_bindings::locel_add_e2o": "boolean",
  "process_mining::bindings::slim_ocel_bindings::locel_add_event": "Nullable_EventIndex",
  "process_mining::bindings::slim_ocel_bindings::locel_add_event_type": "null",
  "process_mining::bindings::slim_ocel_bindings::locel_add_o2o": "boolean",
  "process_mining::bindings::slim_ocel_bindings::locel_add_object": "Nullable_ObjectIndex",
  "process_mining::bindings::slim_ocel_bindings::locel_add_object_type": "null",
  "process_mining::bindings::slim_ocel_bindings::locel_construct_ocel": "OCEL",
  "process_mining::bindings::slim_ocel_bindings::locel_conversion_rate": "double",
  "process_mining::bindings::slim_ocel_bindings::locel_delete_e2o": "boolean",
  "process_mining::bindings::slim_ocel_bindings::locel_delete_o2o": "boolean",
  "process_mining::bindings::slim_ocel_bindings::locel_event_object_type_counts": "Array_of_Tuple_of_string_and_string_and_int64",
  "process_mining::bindings::slim_ocel_bindings::locel_get_e2o": "Array_of_Tuple_of_string_and_ObjectIndex",
  "process_mining::bindings::slim_ocel_bindings::locel_get_e2o_rev": "Array_of_Tuple_of_string_and_EventIndex",
  "process_mining::bindings::slim_ocel_bindings::locel_get_ev_attr_val": "Nullable_OCELAttributeValue",
  "process_mining::bindings::slim_ocel_bindings::locel_get_ev_by_id": "Nullable_EventIndex",
  "process_mining::bindings::slim_ocel_bindings::locel_get_ev_id": "string",
  "process_mining::bindings::slim_ocel_bindings::locel_get_ev_time": "DateTime",
  "process_mining::bindings::slim_ocel_bindings::locel_get_ev_type": "Nullable_OCELType",
  "process_mining::bindings::slim_ocel_bindings::locel_get_ev_type_of": "string",
  "process_mining::bindings::slim_ocel_bindings::locel_get_ev_types": "Array_of_string",
  "process_mining::bindings::slim_ocel_bindings::locel_get_evs_of_type": "Array_of_EventIndex",
  "process_mining::bindings::slim_ocel_bindings::locel_get_full_ev": "OCELEvent",
  "process_mining::bindings::slim_ocel_bindings::locel_get_full_ob": "OCELObject",
  "process_mining::bindings::slim_ocel_bindings::locel_get_o2o": "Array_of_Tuple_of_string_and_ObjectIndex",
  "process_mining::bindings::slim_ocel_bindings::locel_get_o2o_rev": "Array_of_Tuple_of_string_and_ObjectIndex",
  "process_mining::bindings::slim_ocel_bindings::locel_get_ob_attr_vals": "Array_of_Tuple_of_DateTime_and_OCELAttributeValue",
  "process_mining::bindings::slim_ocel_bindings::locel_get_ob_by_id": "Nullable_ObjectIndex",
  "process_mining::bindings::slim_ocel_bindings::locel_get_ob_id": "string",
  "process_mining::bindings::slim_ocel_bindings::locel_get_ob_type": "Nullable_OCELType",
  "process_mining::bindings::slim_ocel_bindings::locel_get_ob_type_of": "string",
  "process_mining::bindings::slim_ocel_bindings::locel_get_ob_types": "Array_of_string",
  "process_mining::bindings::slim_ocel_bindings::locel_get_obs_of_type": "Array_of_ObjectIndex",
  "process_mining::bindings::slim_ocel_bindings::locel_new": "SlimLinkedOCEL",
  "process_mining::bindings::slim_ocel_bindings::locel_oc_perf_sojourn_per_event": "Array_of_Tuple_of_string_and_int64",
  "process_mining::bindings::slim_ocel_bindings::locel_oc_perf_sync_per_event": "Array_of_Tuple_of_string_and_int64_and_string",
  "process_mining::bindings::test_some_inputs": "string",
  "process_mining::conformance::case_centric::alignments::align_empty_trace": "AlignmentResult",
  "process_mining::conformance::case_centric::alignments::align_trace_binding": "AlignmentResult",
  "process_mining::conformance::case_centric::alignments::align_variants": "Array_of_VariantAlignmentResult",
  "process_mining::conformance::case_centric::alignments::compute_fitness": "FitnessResult",
  "process_mining::conformance::object_centric::oc_declare::oc_declare_conformance": "double",
  "process_mining::core::event_data::case_centric::utils::activity_projection::get_num_cases": "uint64",
  "process_mining::core::event_data::case_centric::utils::activity_projection::get_num_variants": "uint",
  "process_mining::core::event_data::case_centric::utils::activity_projection::get_projection_activities": "Array_of_string",
  "process_mining::core::event_data::case_centric::utils::activity_projection::get_top_n_variants": "Array_of_ProcessVariant",
  "process_mining::core::event_data::case_centric::utils::activity_projection::get_variants": "Array_of_ProcessVariant",
  "process_mining::core::event_data::case_centric::utils::activity_projection::log_to_activity_projection": "EventLogActivityProjection",
  "process_mining::core::event_data::object_centric::utils::flatten::flatten_ocel_on": "EventLog",
  "process_mining::core::event_data::object_centric::utils::init_exit_events::add_init_exit_events_to_ocel": "OCEL",
  "process_mining::core::process_models::object_centric::ocdfg::object_centric_dfg_struct::discover_dfg_from_ocel": "OCDirectlyFollowsGraph",
  "process_mining::discovery::case_centric::alphappp::full::alphappp_discover_petri_net": "PetriNet",
  "process_mining::discovery::case_centric::dfg::discover_dfg": "DirectlyFollowsGraph",
  "process_mining::discovery::object_centric::dfg::get_dfg_of_object_type": "Array_of_Tuple_of_Tuple_of_string_and_string_and_uint",
  "process_mining::discovery::object_centric::oc_declare::discover_behavior_constraints": "Array_of_OCDeclareArc",
  "process_mining::discovery::object_centric::variants::get_variants_of_object_type": "Array_of_Tuple_of_Array_of_string_and_uint",
};
