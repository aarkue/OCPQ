import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { OC_DECLARE_LOCALSTORAGE_SAVE_KEY_CONSTRAINTS_META, OC_DECLARE_LOCALSTORAGE_SAVE_KEY_DATA, parseLocalStorageValue } from "@/lib/local-storage";
import clsx from "clsx";
import { startTransition, useEffect, useRef, useState } from "react";
import { RxPlusCircled } from "react-icons/rx";
import { TbTrash } from "react-icons/tb";
import { Link } from "react-router-dom";
import AutoSizer from "react-virtualized-auto-sizer";
import { FixedSizeList, ListChildComponentProps } from "react-window";
import { ConstraintInfo } from "../visual-editor/helper/types";
import { OCDeclareFlowData } from "./flow/oc-declare-flow-data";

export default function OCDeclareListPage() {
    const prevDataRef = useRef<OCDeclareFlowData[]>(parseLocalStorageValue(
        localStorage.getItem(OC_DECLARE_LOCALSTORAGE_SAVE_KEY_DATA) ?? "[]",
    ));
    const [constraints, setConstraints] = useState<ConstraintInfo[]>(parseLocalStorageValue(localStorage.getItem(OC_DECLARE_LOCALSTORAGE_SAVE_KEY_CONSTRAINTS_META) ?? "[]"));
    const [deletePromptForIndex, setDeletePromptForIndex] = useState<number>();

    function saveData() {
        // if (
        //   currentInstanceAndData.instance !== undefined &&
        //   activeIndex !== undefined &&
        //   currentInstanceAndData.getter !== undefined
        // ) {
        //   // First, save current data
        //   const prevOtherData = currentInstanceAndData.getter();
        //   prevDataRef.current[activeIndex] = {
        //     flowJson: currentInstanceAndData.instance.toObject(),
        //     violations: prevOtherData?.violations,
        //   };
        // }

        if (prevDataRef.current !== undefined) {
            console.log(JSON.stringify(prevDataRef.current));
            localStorage.setItem(
                OC_DECLARE_LOCALSTORAGE_SAVE_KEY_DATA,
                JSON.stringify(
                    prevDataRef.current.map((x) => ({ ...x, violations: undefined })),
                ),
            );
        }
        localStorage.setItem(
            OC_DECLARE_LOCALSTORAGE_SAVE_KEY_CONSTRAINTS_META,
            JSON.stringify(constraints),
        );
    }

    useEffect(() => {
        saveData();
    }, [constraints])

    return <div className="text-left h-full overflow-hidden">

        <h2 className="text-3xl font-black bg-clip-text text-transparent tracking-tighter bg-gradient-to-t from-orange-400 to-pink-600">OC-DECLARE</h2>
        <h4 className="font-medium text-lg tracking-tight">Object-Centric Declarative Constraints</h4>
        <Button
            // size="lg"
            onClick={() => {
                prevDataRef.current.splice(
                    constraints.length,
                    1,
                );
                setConstraints((cs) => [
                    ...cs,
                    {
                        name: `New Constraint (${cs.length + 1})`,
                        description: "",
                    },
                ]);
                startTransition(() => {
                    // changeIndex(
                    //     constraints.length,
                    //     constraints.length + 1,
                    // );
                })
            }}
        >
            <RxPlusCircled className="mr-1" />
            Add
        </Button>
        <AlertDialog
            open={deletePromptForIndex !== undefined}
            onOpenChange={(o) => {
                if (!o) {
                    setDeletePromptForIndex(undefined);
                }
            }}
        >
            <AlertDialogContent className="flex flex-col max-h-full justify-between">
                <AlertDialogHeader>
                    <AlertDialogTitle>Delete OC-DECLARE Constraint</AlertDialogTitle>
                </AlertDialogHeader>
                <div className="text-base text-gray-700 max-h-full overflow-auto px-2">
                    {deletePromptForIndex !== undefined && (
                        <>
                            <span className="">
                                Constraint:{" "}
                                <span className="font-semibold">
                                    {(constraints[deletePromptForIndex]?.name)
                                        .length > 0
                                        ? constraints[deletePromptForIndex]?.name
                                        : `Constraint ${deletePromptForIndex + 1}`}
                                </span>
                            </span>
                            <br />
                            <br />
                        </>
                    )}
                    Deleting this constraint cannot be undone.
                </div>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={() => {
                            if (deletePromptForIndex === undefined) return;
                            prevDataRef.current.splice(deletePromptForIndex, 1);
                            setConstraints((constraints) => {
                                const newConstraints = [...constraints];
                                newConstraints.splice(deletePromptForIndex, 1);
                                return newConstraints;
                            });
                        }}
                    >
                        Delete
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
        <div className="h-full overflow-auto my-1">
            <AutoSizer>
                {({ height, width }) => (
                    <FixedSizeList
                        height={height}
                        itemCount={constraints.length}
                        itemSize={45}
                        width={width}
                    >
                        {({
                            index,
                            style,
                        }: ListChildComponentProps) => {
                            const c = constraints[index];
                            if (c === undefined) {
                                return null;
                            }
                            return (
                                <div style={style} className="pb-1">
                                    <ConstraintMetaInfo
                                        constraint={c}
                                        index={index}
                                        onDelete={() => setDeletePromptForIndex(index)}
                                    />
                                </div>
                            );
                        }}
                    </FixedSizeList>
                )}
            </AutoSizer>
        </div>
    </div>
}

function ConstraintMetaInfo({
    constraint,
    index,
    onDelete
}: {
    constraint: ConstraintInfo;
    index: number;
    onDelete: () => unknown;
}) {
    return (
        <div
            className={clsx(
                "flex justify-between border rounded h-full w-full items-center",
                "bg-gray-50 border-gray-300",
                "bg-blue-200 border-blue-300 font-semibold",
            )}
        >
            <Link to={`/oc-declare/${index}`}
                onClick={() => {
                    // changeIndex(index);
                    // setShowConstraintSelection(false);

                }}
                className={clsx(
                    "w-full h-full block whitespace-nowrap overflow-hidden text-ellipsis px-2 text-left",
                )}
            >
                <h4
                    className="text-sm"
                    title={
                        constraint.name !== ""
                            ? constraint.name
                            : `Constraint ${index + 1}`
                    }
                >
                    {constraint.name !== ""
                        ? constraint.name
                        : `Constraint ${index + 1}`}
                </h4>
                <p className="text-xs font-light text-gray-700">
                    {constraint.description !== ""
                        ? constraint.description
                        : "No description"}
                </p>
            </Link>

            <button
                className="text-red-700 px-2 block hover:bg-red-300 h-full"
                onClick={() => onDelete()}
            >
                <TbTrash />
            </button>
        </div>
    );
}