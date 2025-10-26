// import type { EventTypeQualifiers } from "@/types/ocel";
// import type {
//   DiscoveredCountConstraint,
//   DiscoveredEFConstraint,
//   DiscoveredORConstraint,
//   EventTypeLinkData,
//   EventTypeNodeData,
//   GateLinkData,
//   GateNodeData,
//   ViolationsPerNodes,
// } from "./types";
// import { EVENT_TYPE_LINK_TYPE, GATE_LINK_TYPE, GATE_NODE_TYPE } from "./const";
// import { type Edge, MarkerType, type ReactFlowJsonObject } from "reactflow";

import type { BindingBoxTree } from "@/types/generated/BindingBoxTree";
import type {
  EventTypeLinkData,
  EventTypeNodeData,
  GateNodeData,
} from "./types";
import { type Node, type Edge, MarkerType } from "@xyflow/react";
import {
  EVENT_TYPE_LINK_TYPE,
  EVENT_TYPE_NODE_TYPE,
  GATE_NODE_TYPE,
} from "./const";
// export function constructDiscoveredCountConstraint(
//   c: DiscoveredCountConstraint,
//   qualifiers: EventTypeQualifiers,
// ) {
//   const countStr =
//     c.countConstraint.min === c.countConstraint.max
//       ? `=${c.countConstraint.min}`
//       : c.countConstraint.min === 0
//       ? `<=${c.countConstraint.max}`
//       : `${c.countConstraint.min} - ${c.countConstraint.max}`;
//   const name = `${countStr} "${
//     c.eventType.type === "exactly" ? c.eventType.value : "..."
//   }" per ${c.objectType}`;
//   const varName = c.objectType.substring(0, 2) + "_0";
//   const variable = {
//     name: varName,
//     type: c.objectType,
//     initiallyBound: true,
//   };
//   const constraintFlow: {
//     flowJson: ReactFlowJsonObject<EventTypeNodeData, EventTypeLinkData>;
//     violations?: ViolationsPerNodes;
//     objectVariables?: ObjectVariable[];
//   } = {
//     violations: undefined,
//     // TODO: Add object variable
//     objectVariables: [variable],
//     flowJson: {
//       nodes: [
//         {
//           id: Date.now() + "auto" + Math.random(),
//           type: "eventType",
//           position: { x: 200, y: 150 },
//           data: {
//             eventType: c.eventType,
//             eventTypeQualifier:
//               qualifiers[
//                 c.eventType.type === "exactly" ? c.eventType.value : ""
//               ],
//             countConstraint: c.countConstraint,
//             selectedVariables: [
//               {
//                 qualifier: undefined,
//                 variable,
//                 bound: false,
//               },
//             ],
//           },
//         },
//       ],
//       edges: [],
//       viewport: { x: 0, y: 0, zoom: 2.0 },
//     },
//   };
//   return {
//     constraint: constraintFlow,
//     name,
//     description: "Automatically Discovered Constraint",
//   };
// }

// export function constructDiscoveredEFConstraint(
//   c: DiscoveredEFConstraint,
//   qualifiers: EventTypeQualifiers,
// ) {
//   // updatedConstraints.push({
//   //   name,
//   //   description:
//   //     "Automatically Discovered Constraint",
//   // });

//   const varNames: string[] = [];
//   for (const ot of c.objectTypes) {
//     const shortOt = ot.substring(0, 2);
//     let i = 0;
//     let varName = shortOt + "_" + i;
//     while (varNames.includes(varName)) {
//       i++;
//       varName = shortOt + "_" + i;
//     }
//     varNames.push(varName);
//   }
//   const variables = varNames.map((varName, i) => ({
//     name: varName,
//     type: c.objectTypes[i],
//     initiallyBound: i === 0,
//   }));
//   const ids = [
//     Date.now() + "auto-ef-" + Math.random(),
//     Date.now() + "auto-ef2-" + Math.random(),
//   ] as const;
//   const name = `${c.fromEventType} -> ${c.toEventType} for ${c.objectTypes.join(
//     ", ",
//   )}`;

//   const X: {
//     flowJson: ReactFlowJsonObject<EventTypeNodeData, EventTypeLinkData>;
//     violations?: ViolationsPerNodes;
//     objectVariables?: ObjectVariable[];
//   } = {
//     violations: undefined,
//     objectVariables: variables,
//     flowJson: {
//       nodes: [
//         {
//           id: ids[0],
//           type: "eventType",
//           position: { x: 200, y: 100 },
//           data: {
//             eventType: {
//               type: "exactly",
//               value: c.fromEventType,
//             },
//             eventTypeQualifier: qualifiers[c.fromEventType],
//             countConstraint: {
//               min: 0,
//               max: Infinity,
//             },
//             selectedVariables: variables.map((variable, i) => ({
//               qualifier: undefined,
//               variable,
//               bound: i > 0,
//             })),
//             hideViolations: true,
//           },
//         },
//         {
//           id: ids[1],
//           type: "eventType",
//           position: { x: 200, y: 350 },
//           data: {
//             eventType: {
//               type: "exactly",
//               value: c.toEventType,
//             },
//             eventTypeQualifier: qualifiers[c.toEventType],
//             countConstraint: {
//               min: 1,
//               max: Infinity,
//             },

//             selectedVariables: variables.map((variable) => ({
//               qualifier: undefined,
//               variable,
//               bound: false,
//             })),
//             hideViolations: false,
//           },
//         },
//       ],
//       edges: [
//         {
//           type: EVENT_TYPE_LINK_TYPE,
//           source: ids[0],
//           target: ids[1],
//           sourceHandle: ids[0] + "-source",
//           targetHandle: ids[1] + "-target",
//           id: Date.now() + "link-ef-" + Math.random(),
//           markerEnd: {
//             type: MarkerType.ArrowClosed,
//             width: 15,
//             height: 12,
//             color: "#000000ff",
//           },
//           style: {
//             strokeWidth: 2,
//             stroke: "#969696",
//           },
//           data: {
//             color: "#969696",
//             constraintType: "response",
//             timeConstraint: c.secondsRange,
//           },
//         },
//       ],
//       viewport: { x: 0, y: 0, zoom: 1.5 },
//     },
//   };
//   return {
//     constraint: X,
//     name,
//     description: "Automatically Discovered Constraint",
//   };
// }

// export function constructDiscoveredORConstraint(
//   c: DiscoveredORConstraint,
//   qualifiers: EventTypeQualifiers,
// ) {
//   if ("EfOrCount" in c) {
//     const [efConstr, countConstr] = c.EfOrCount;
//     const efFlow = constructDiscoveredEFConstraint(efConstr, qualifiers);
//     const countFlow = constructDiscoveredCountConstraint(
//       countConstr,
//       qualifiers,
//     );
//     countFlow.constraint.flowJson.nodes[0].position.x += 400;
//     const name = "OR " + efFlow.name + " / " + countFlow.name;
//     const orNodeID = Math.random() + "auto_OR" + Date.now();
//     const newEdges: Edge<GateLinkData>[] = [
//       {
//         id: Math.random() + "OR_AUTO_LINK" + Date.now(),
//         type: GATE_LINK_TYPE,
//         source: orNodeID,
//         sourceHandle: orNodeID + "-left-source",
//         target: efFlow.constraint.flowJson.nodes[0].id,
//         targetHandle: efFlow.constraint.flowJson.nodes[0].id + "-target",
//         markerEnd: {
//           type: MarkerType.ArrowClosed,
//           width: 15,
//           height: 12,
//           // color,
//         },
//         style: {
//           strokeWidth: 2,
//           // stroke: color,
//         },
//       },
//       {
//         id: Math.random() + "OR_AUTO_LINK" + Date.now(),
//         type: GATE_LINK_TYPE,
//         source: orNodeID,
//         sourceHandle: orNodeID + "-right-source",
//         target: countFlow.constraint.flowJson.nodes[0].id,
//         targetHandle: countFlow.constraint.flowJson.nodes[0].id + "-target",
//         markerEnd: {
//           type: MarkerType.ArrowClosed,
//           width: 15,
//           height: 12,
//           // color,
//         },
//         style: {
//           strokeWidth: 2,
//           // stroke: color,
//         },
//       },
//     ];
//     const constraint: {
//       flowJson: ReactFlowJsonObject<
//         EventTypeNodeData | GateNodeData,
//         EventTypeLinkData | GateLinkData
//       >;
//       violations?: ViolationsPerNodes;
//       objectVariables?: ObjectVariable[];
//     } = {
//       violations: undefined,
//       objectVariables: efFlow.constraint.objectVariables,
//       flowJson: {
//         nodes: [
//           {
//             type: GATE_NODE_TYPE,
//             id: orNodeID,
//             position: { x: 400, y: 20 },
//             data: { type: "or" },
//           },
//           ...efFlow.constraint.flowJson.nodes.map((n) => ({
//             ...n,
//             position: { ...n.position, y: n.position.y + 100 },
//           })),
//           ...countFlow.constraint.flowJson.nodes.map((n) => ({
//             ...n,
//             position: { ...n.position, y: n.position.y + 100 },
//           })),
//         ],
//         edges: [...newEdges, ...efFlow.constraint.flowJson.edges],
//         viewport: { x: 0, y: 0, zoom: 1.5 },
//         // nodes: [...efFlow.constraint.flowJson.nodes, ...countFlow.constraint.flowJson.nodes],
//       },
//     };
//     return {
//       constraint,
//       name,
//       description: "Automatically Discovered Constraint",
//     };
//   } else {
//     console.error("NOT IMPLEMENTED (YET)");
//     return undefined;
//     // const [countConstr, efConstr] = c.CountOrEf;
//   }
//   // TODO: Multiple object types?!
//   // const objectType = "EfOrCount" in c ? c.EfOrCount[0].objectTypes[0] : c.CountOrEf[1].objectTypes[0];
//   // const varName = objectType.substring(0, 2) + "_0";
//   // const variable = {
//   //   name: varName,
//   //   type: objectType,
//   //   initiallyBound: true,
//   // };
// }
const POS_SCALE = 0.333;

export function bindingBoxTreeToNodes(
  tree: BindingBoxTree,
  index: number,
  positionX: number,
  positionY: number,
  idPrefix: string,
): [Node<EventTypeNodeData | GateNodeData>[], Edge<EventTypeLinkData>[]] {
  function getNodeID(nodeIndex: number) {
    return idPrefix + "-node-" + nodeIndex;
  }
  function getEdgeID(fromIndex: number, toIndex: number) {
    return idPrefix + "-edge-" + fromIndex + "-to-" + toIndex;
  }

  function getEdgeData(fromIndex: number, toIndex: number): EventTypeLinkData {
    const edgeData = tree.edgeNames.find(
      ([[a, b]]) => a === fromIndex && b === toIndex,
    );
    return {
      color: "#969696",
      minCount: null,
      maxCount: null,
      name: edgeData != null ? edgeData[1] : undefined,
    };
  }
  const treeNode = tree.nodes[index];
  const nodes: Node<EventTypeNodeData | GateNodeData>[] = [];
  const edges: Edge<EventTypeLinkData>[] = [];
  if ("Box" in treeNode) {
    nodes.push({
      type: EVENT_TYPE_NODE_TYPE,
      data: { box: treeNode.Box[0] },
      id: getNodeID(index),
      position: { x: positionX, y: positionY },
    });
    const WIDTH_SPREAD = treeNode.Box[1].length > 1 ? 500 : 0;
    const childSpacing = WIDTH_SPREAD / treeNode.Box[1].length;
    let childPositionX = positionX - WIDTH_SPREAD / 2;
    for (const childIndex of treeNode.Box[1]) {
      const [n1, e1] = bindingBoxTreeToNodes(
        tree,
        childIndex,
        childPositionX,
        positionY + POS_SCALE * 600,
        idPrefix,
      );
      edges.push({
        id: getEdgeID(index, childIndex),
        source: getNodeID(index),
        target: getNodeID(childIndex),
        sourceHandle: getNodeID(index) + "-source",
        targetHandle: getNodeID(childIndex) + "-target",
        type: EVENT_TYPE_LINK_TYPE,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 15,
          height: 12,
          color: "#000000ff",
        },
        style: {
          strokeWidth: 2,
          stroke: "#969696",
        },
        data: getEdgeData(index, childIndex),
      });
      nodes.push(...n1);
      edges.push(...e1);
      childPositionX += childSpacing;
    }
  } else if ("OR" in treeNode) {
    nodes.push({
      id: getNodeID(index),
      position: { x: positionX, y: positionY },
      data: { type: "or" },
      type: GATE_NODE_TYPE,
    });
    edges.push({
      id: getEdgeID(index, treeNode.OR[0]),
      source: getNodeID(index),
      target: getNodeID(treeNode.OR[0]),
      sourceHandle: getNodeID(index) + "-left-source",
      targetHandle: getNodeID(treeNode.OR[0]) + "-target",
      type: EVENT_TYPE_LINK_TYPE,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 15,
        height: 12,
        color: "#000000ff",
      },
      style: {
        strokeWidth: 2,
        stroke: "#969696",
      },
      data: getEdgeData(index, treeNode.OR[0]),
    });
    edges.push({
      id: getEdgeID(index, treeNode.OR[1]),
      source: getNodeID(index),
      target: getNodeID(treeNode.OR[1]),
      sourceHandle: getNodeID(index) + "-right-source",
      targetHandle: getNodeID(treeNode.OR[1]) + "-target",
      type: EVENT_TYPE_LINK_TYPE,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 15,
        height: 12,
        color: "#000000ff",
      },
      style: {
        strokeWidth: 2,
        stroke: "#969696",
      },
      data: getEdgeData(index, treeNode.OR[1]),
    });

    const [n1, e1] = bindingBoxTreeToNodes(
      tree,
      treeNode.OR[0],
      positionX - POS_SCALE * 400,
      positionY + POS_SCALE * 500,
      idPrefix,
    );
    const [n2, e2] = bindingBoxTreeToNodes(
      tree,
      treeNode.OR[1],
      positionX + POS_SCALE * 400,
      positionY + POS_SCALE * 500,
      idPrefix,
    );
    nodes.push(...n1, ...n2);
    edges.push(...e1, ...e2);
  } else if ("AND" in treeNode) {
    nodes.push({
      id: getNodeID(index),
      position: { x: positionX, y: positionY },
      data: { type: "and" },
      type: GATE_NODE_TYPE,
    });
    edges.push({
      id: getEdgeID(index, treeNode.AND[0]),
      source: getNodeID(index),
      target: getNodeID(treeNode.AND[0]),
      sourceHandle: getNodeID(index) + "-left-source",
      targetHandle: getNodeID(treeNode.AND[0]) + "-target",
      type: EVENT_TYPE_LINK_TYPE,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 15,
        height: 12,
        color: "#000000ff",
      },
      style: {
        strokeWidth: 2,
        stroke: "#969696",
      },
      data: getEdgeData(index, treeNode.AND[0]),
    });
    edges.push({
      id: getEdgeID(index, treeNode.AND[1]),
      source: getNodeID(index),
      target: getNodeID(treeNode.AND[1]),
      sourceHandle: getNodeID(index) + "-right-source",
      targetHandle: getNodeID(treeNode.AND[1]) + "-target",
      type: EVENT_TYPE_LINK_TYPE,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 15,
        height: 12,
        color: "#000000ff",
      },
      style: {
        strokeWidth: 2,
        stroke: "#969696",
      },
      data: getEdgeData(index, treeNode.AND[1]),
    });

    const [n1, e1] = bindingBoxTreeToNodes(
      tree,
      treeNode.AND[0],
      positionX - POS_SCALE * 400,
      positionY + POS_SCALE * 500,
      idPrefix,
    );
    const [n2, e2] = bindingBoxTreeToNodes(
      tree,
      treeNode.AND[1],
      positionX + POS_SCALE * 400,
      positionY + POS_SCALE * 500,
      idPrefix,
    );
    nodes.push(...n1, ...n2);
    edges.push(...e1, ...e2);
  } else if ("NOT" in treeNode) {
    nodes.push({
      id: getNodeID(index),
      position: { x: positionX, y: positionY },
      data: { type: "not" },
      type: GATE_NODE_TYPE,
    });
    edges.push({
      id: getEdgeID(index, treeNode.NOT),
      source: getNodeID(index),
      target: getNodeID(treeNode.NOT),
      sourceHandle: getNodeID(index) + "-source",
      targetHandle: getNodeID(treeNode.NOT) + "-target",
      type: EVENT_TYPE_LINK_TYPE,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 15,
        height: 12,
        color: "#000000ff",
      },
      style: {
        strokeWidth: 2,
        stroke: "#969696",
      },
      data: getEdgeData(index, treeNode.NOT),
    });
    const [n1, e1] = bindingBoxTreeToNodes(
      tree,
      treeNode.NOT,
      positionX,
      positionY + POS_SCALE * 500,
      idPrefix,
    );
    nodes.push(...n1);
    edges.push(...e1);
  }
  return [nodes, edges];
}
