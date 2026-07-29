import {
	OcelSchemaPath,
	type OcelSchemaPathConnector,
	type OcelSchemaPathNode,
} from "@r4pm/components";
import { memo, useMemo } from "react";
import type { PathSchemaStep } from "@/types/generated/PathSchemaStep";
import type { PathTypeRef } from "@/types/generated/PathTypeRef";

interface Props {
	source: PathTypeRef;
	steps: PathSchemaStep[];
	compact?: boolean;
}

const toNode = (ref: PathTypeRef): OcelSchemaPathNode => ({
	name: ref.name,
	kind: ref.is_event ? "event" : "object",
});

function SchemaPathDiagramInner({ source, steps, compact = false }: Props) {
	const { nodes, connectors } = useMemo(() => {
		const nodes: OcelSchemaPathNode[] = [toNode(source)];
		const connectors: OcelSchemaPathConnector[] = [];
		for (const s of steps) {
			nodes.push(toNode(s.reverse ? s.source : s.target));
			connectors.push({ qualifier: s.qualifier, reverse: s.reverse });
		}
		return { nodes, connectors };
	}, [source, steps]);
	return <OcelSchemaPath nodes={nodes} connectors={connectors} compact={compact} />;
}

const SchemaPathDiagram = memo(SchemaPathDiagramInner);
export default SchemaPathDiagram;
