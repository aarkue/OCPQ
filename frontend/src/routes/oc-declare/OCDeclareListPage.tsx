import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { OC_DECLARE_LOCALSTORAGE_SAVE_KEY_CONSTRAINTS_META, OC_DECLARE_LOCALSTORAGE_SAVE_KEY_DATA, parseLocalStorageValue } from "@/lib/local-storage";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { RxPlusCircled } from "react-icons/rx";
import { TbTrash } from "react-icons/tb";
import { Link, useNavigate } from "react-router-dom";
import AutoSizer from "react-virtualized-auto-sizer";
import { FixedSizeList, ListChildComponentProps } from "react-window";
import { v4 } from "uuid";
import { OCDeclareMetaData } from "./flow/oc-declare-flow-data";

export default function OCDeclareListPage() {
  const [constraints, setConstraints] = useState<OCDeclareMetaData[]>(parseLocalStorageValue(localStorage.getItem(OC_DECLARE_LOCALSTORAGE_SAVE_KEY_CONSTRAINTS_META) ?? "[]"));
  const [deletePromptForIndex, setDeletePromptForIndex] = useState<{ index: number } | 'ALL'>();

  function saveData(constraintsMeta = constraints) {
    localStorage.setItem(
      OC_DECLARE_LOCALSTORAGE_SAVE_KEY_CONSTRAINTS_META,
      JSON.stringify(constraintsMeta),
    );
  }

  useEffect(() => {
    saveData();
  }, [constraints])

  const navigate = useNavigate();

  return <div className="text-left h-full overflow-hidden flex flex-col">

    <h2 className="text-4xl font-black bg-clip-text text-transparent tracking-tighter bg-linear-to-t from-orange-400 to-pink-600">OC-DECLARE</h2>
    <h4 className="font-semibold text-lg tracking-tight">Object-Centric Declarative Constraints</h4>
    <div className="flex justify-between items-center my-1">
      
    <Button className="cursor-pointer"
      // size="lg"
      onClick={() => {
        const newID = v4();
        saveData([
          ...constraints,
          {
            name: `New Constraint (${constraints.length + 1})`,
            id: newID,
          },
        ])
        navigate(`/oc-declare/${newID}`);
      }}
    >
      <RxPlusCircled className="mr-1" />
      Add
    </Button>
  <Button variant='destructive' onClick={() => setDeletePromptForIndex('ALL')}>Delete All...</Button>
  </div>
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
          <AlertDialogTitle>Delete {deletePromptForIndex === 'ALL' ? 'all' : ''} OC-DECLARE Constraint{deletePromptForIndex === 'ALL' ? 's' : ''}</AlertDialogTitle>
          <AlertDialogDescription className="hidden">
            Are you sure you want to delete {deletePromptForIndex === 'ALL' ? 'all ' : ''}the selected OC-DECLARE constraint{deletePromptForIndex === 'ALL' ? 's' : ''}? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="text-base text-gray-700 max-h-full overflow-auto px-2">
          {deletePromptForIndex !== undefined && deletePromptForIndex !== 'ALL' && (
            <>
              <span className="">
                Constraint:{" "}
                <span className="font-semibold">
                  {(constraints[deletePromptForIndex.index]?.name)
                    .length > 0
                    ? constraints[deletePromptForIndex.index]?.name
                    : `Constraint ${deletePromptForIndex.index + 1}`}
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
              if (deletePromptForIndex === 'ALL') {
                constraints.forEach(c => localStorage.removeItem(OC_DECLARE_LOCALSTORAGE_SAVE_KEY_DATA + c.id));
                setConstraints([])
                return;
              }
              const deleteId = constraints[deletePromptForIndex.index];
              setConstraints((constraints) => {
                const newConstraints = [...constraints];
                newConstraints.splice(deletePromptForIndex.index, 1);
                return newConstraints;
              });
              localStorage.removeItem(OC_DECLARE_LOCALSTORAGE_SAVE_KEY_DATA + deleteId);
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <div className="h-full overflow-auto">
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
                    onDelete={() => setDeletePromptForIndex({index})}
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
  constraint: OCDeclareMetaData;
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
      <Link to={`/oc-declare/${constraint.id}`}
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
          {constraint.description
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
