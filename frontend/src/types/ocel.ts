export type OCELTypeAttribute = { name: string; type: string };
export type OCELType = { name: string; attributes: OCELTypeAttribute[] };
export type OCELInfo = {
	num_objects: number;
	num_events: number;
	object_types: OCELType[];
	event_types: OCELType[];
	object_ids: string[];
	event_ids: string[];
	e2o_types: Record<string, Record<string, [number, Set<string>]>>;
	o2o_types: Record<string, Record<string, [number, Set<string>]>>;
};
export type OCELAttributeValue = string | number | boolean | null;
export type OCELObjectAttribute = {
	name: string;
	value: OCELAttributeValue;
	time: string;
};
export type OCELEventAttribute = { name: string; value: OCELAttributeValue };
export type OCELRelationship = { objectId: string; qualifier: string };
export type OCELObject = {
	id: string;
	type: string;
	attributes: OCELObjectAttribute[];
	relationships?: OCELRelationship[];
};

export type OCELEvent = {
	id: string;
	type: string;
	time: string;
	attributes: OCELEventAttribute[];
	relationships?: OCELRelationship[];
};

export type EventTypeQualifierInfo = {
	qualifier: string;
	// counts: number[];
	multiple: boolean;
	object_types: string[];
};
export type EventTypeQualifier = Record<string, EventTypeQualifierInfo>;

export type EventTypeQualifiers = Record<string, EventTypeQualifier>;

export type ObjectTypeQualifier = Set<[string, string]>;
export type ObjectTypeQualifiers = Record<string, ObjectTypeQualifier>;
