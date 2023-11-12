export type OCELTypeAttribute = { name: string, type: string };
export type OCELType = { name: string, attributes: OCELTypeAttribute[] };
export type OCELInfo = { num_objects: number, num_events: number, object_types: OCELType[], event_types: OCELType[] };
export type OCELAttributeValue = string | number | boolean | null;
export type OCELObjectAttribute = { name: string, value: OCELAttributeValue, time: string };
export type OCELEventAttribute = { name: string, value: OCELAttributeValue };
export type OCELRelationship = { objectId: string, qualifier: string };
export type OCELObject = {
  id: string
  type: string
  attributes: OCELObjectAttribute[]
  relationships?: OCELRelationship[]
};

export type OCELEvent = {
  id: string
  type: string
  time: string
  attributes: OCELEventAttribute[]
  relationships?: OCELRelationship[]
};
