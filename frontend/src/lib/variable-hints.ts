import { VisualEditorContextValue } from "@/routes/visual-editor/helper/VisualEditorContext";
import { BindingBox } from "@/types/generated/BindingBox";
import { EventVariable } from "@/types/generated/EventVariable";
import { ObjectVariable } from "@/types/generated/ObjectVariable";
import { OCELInfo } from "@/types/ocel";

export function deDupe<T>(values: T[]): T[] {
    return [...new Set(values).values()];
}


export function getNodeRelationshipSupport(ocelInfo: OCELInfo, getTypesForVariable: VisualEditorContextValue['getTypesForVariable'], nodeID: string, var1: ObjectVariable | EventVariable, var2: ObjectVariable, isE2O: boolean): number {
    const types1 = getTypesForVariable(nodeID, var1, isE2O ? "event" : "object");
    const types2 = getTypesForVariable(nodeID, var2, "object");
    return getTypesRelationshipSupport(ocelInfo, types1.map(t => t.name), types2.map(t => t.name), isE2O);
}


export function getTypesRelationshipSupport(ocelInfo: OCELInfo, firstTypes: string[], secondTypes: string[], isE2O: boolean): number {
    let support = 0;
    for (const type1 of firstTypes) {
        for (const type2 of secondTypes) {
            support += (isE2O ? ocelInfo?.e2o_types : ocelInfo?.o2o_types)[type1]?.[type2]?.[0] ?? 0;

        }
    }
    return support;

}

export function getPossibleE2OVariables(ocelInfo: OCELInfo | undefined, getTypesForVariable: VisualEditorContextValue['getTypesForVariable'], nodeID: string, objectVariables: ObjectVariable[], eventVariables: EventVariable[], allBoxes: BindingBox[] | undefined = undefined): { object: ObjectVariable, event: EventVariable } | {} {
    if (ocelInfo === undefined) {
        return {};
    }
    let backup: { object: ObjectVariable, event: EventVariable } | undefined = undefined;
    for (const evVar of eventVariables) {
        for (const obVar of objectVariables) {
            const support = getNodeRelationshipSupport(ocelInfo, getTypesForVariable, nodeID, evVar, obVar, true);
            if (support > 0) {
                if (allBoxes !== undefined) {
                    const existingE2OFilter = allBoxes.flatMap(b => b.filters).find(f => f.type === "O2E" && f.event == evVar && f.object == obVar);
                    if (existingE2OFilter !== undefined) {
                        if (backup === undefined) {
                            backup = { object: obVar, event: evVar };
                        }
                        continue;
                    }
                }
                return { object: obVar, event: evVar };
            }
        }
    }
    // if (backup !== undefined) {
    //     return backup;
    // }
    // if (objectVariables.length > 0 && eventVariables.length > 0) {
    //     return { object: objectVariables[0], event: eventVariables[0] };
    // }
    return {};
}


export function getPossibleO2OVariables(ocelInfo: OCELInfo | undefined, getTypesForVariable: VisualEditorContextValue['getTypesForVariable'], nodeID: string, objectVariables: ObjectVariable[], allBoxes: BindingBox[] | undefined = undefined): { object: ObjectVariable, other_object: ObjectVariable } | {} {
    if (ocelInfo === undefined) {
        return {};
    }
    let backup: { object: ObjectVariable, other_object: ObjectVariable } | undefined = undefined;
    for (const obVar1 of objectVariables) {
        for (const obVar2 of objectVariables) {
            console.log(obVar1, obVar2, backup);
            if (obVar1 === obVar2) {
                continue;
            }
            const support = getNodeRelationshipSupport(ocelInfo, getTypesForVariable, nodeID, obVar1, obVar2, false);
            if (support > 0) {
                if (allBoxes !== undefined) {
                    const existingO2OFilter = allBoxes.flatMap(b => b.filters).find(f => f.type === "O2O" && f.object == obVar1 && f.other_object == obVar2);
                    if (existingO2OFilter !== undefined) {
                        if (backup === undefined) {
                            backup = { object: obVar1, other_object: obVar2 };
                        }
                        continue;
                    }
                }
                return { object: obVar1, other_object: obVar2 };
            }
            const reverseSupport = getNodeRelationshipSupport(ocelInfo, getTypesForVariable, nodeID, obVar2, obVar1, false);
            if (reverseSupport > 0) {
                if (allBoxes !== undefined) {
                    // TODO: Also check parent nodes?!
                    const existingO2OFilter = allBoxes.flatMap(b => b.filters).find(f => f.type === "O2O" && f.object == obVar2 && f.other_object == obVar1);
                    if (existingO2OFilter !== undefined) {
                        if (backup === undefined) {
                            backup = { object: obVar2, other_object: obVar1 };
                        }
                        continue;
                    }
                }
                return { object: obVar2, other_object: obVar1 };
            }
        }
    }
    //     if (backup !== undefined) {
    //     return backup;
    // }
    // if (objectVariables.length > 1) {
    //     return { object: objectVariables[0], other_object: objectVariables[1] };
    // }
    return {};
}
