import EventTypeLink from "./EventTypeLink";
import EventTypeNode from "./node/EventTypeNode";
import GateNode from "./node/GateNode";

export const EVENT_TYPE_LINK_TYPE = "eventTypeLink";
export const EVENT_TYPE_NODE_TYPE = "eventType";
export const GATE_NODE_TYPE = "gate";

export const nodeTypes = {
	[EVENT_TYPE_NODE_TYPE]: EventTypeNode,
	[GATE_NODE_TYPE]: GateNode,
};
export const edgeTypes = {
	[EVENT_TYPE_LINK_TYPE]: EventTypeLink,
};

export const NODE_TYPE_SIZE = {
	[EVENT_TYPE_NODE_TYPE]: { width: 240, minHeight: 110.58 },
	[GATE_NODE_TYPE]: { width: 128, minHeight: 80 },
};
