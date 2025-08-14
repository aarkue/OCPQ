import { BackendProviderContext } from "@/BackendProviderContext";
import AlertHelper from "@/components/AlertHelper";
import { columnsForBinding } from "@/components/binding-table/columns";
import type PaginatedBindingTable from "@/components/binding-table/PaginatedBindingTable";
import Spinner from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import MultiSelect from "@/components/ui/multi-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import type { BindingBoxTreeNode } from "@/types/generated/BindingBoxTreeNode";
import { type TableExportOptions } from "@/types/generated/TableExportOptions";
import { Suspense, lazy, memo, useContext, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { TbTableExport } from "react-icons/tb";
import { LabelLabel } from "./helper/box/LabelFunctionChooser";
import type { EvaluationResPerNodes } from "./helper/types";
import { VisualEditorContext } from "./helper/VisualEditorContext";
const DataTablePaginationLazy = lazy(
  async () => await import("@/components/binding-table/PaginatedBindingTable"),
) as typeof PaginatedBindingTable;

const DEFAULT_CUTOFF = 10_000;
const ViolationDetailsSheet = memo(function ViolationDetailsSheet({
  violationResPerNodes,
  reset,
  initialMode,
  node,
  nodeID,
}: {
  violationResPerNodes: EvaluationResPerNodes;
  initialMode: "violations" | "situations" | "satisfied-situations" | undefined;
  node: BindingBoxTreeNode;
  nodeID: string;
  reset: () => unknown;
}) {
  const backend = useContext(BackendProviderContext);
  const hasConstraints =
    "Box" in node ? node.Box[0].constraints.length > 0 : true;

  const { showElementInfo, violationsPerNode } =
    useContext(VisualEditorContext);
  const labels = useMemo(() => {
    // If violation info is available (it should?!) determine labels based on the first binding
    if (
      violationsPerNode?.evalRes[nodeID]?.situations &&
      violationsPerNode?.evalRes[nodeID]?.situations.length > 0
    ) {
      return Object.keys(
        violationsPerNode?.evalRes[nodeID]?.situations[0][0].labelMap,
      );
    }
    return "Box" in node ? node.Box[0].labels?.map((l) => l.label) ?? [] : [];
  }, [nodeID, node, violationsPerNode]);
  const [appliedCutoff, setAppliedCutoff] = useState<number | undefined>(
    DEFAULT_CUTOFF,
  );
  const violationDetails = useMemo(() => {
    return violationsPerNode?.evalRes[nodeID];
  }, [nodeID, violationsPerNode]);
  const items = useMemo(() => {
    return (
      violationsPerNode?.evalRes[nodeID]?.situations.slice(0, appliedCutoff) ??
      []
    );
  }, [appliedCutoff, violationsPerNode, nodeID]);

  const numBindings = violationsPerNode?.evalRes[nodeID]?.situationCount ?? 0;
  const numViolations =
    violationsPerNode?.evalRes[nodeID].situationViolatedCount ?? 0;
  console.log(violationResPerNodes.evalRes[nodeID]);
  const columns = useMemo(() => {
    if (items.length >= 1) {
      return columnsForBinding(
        items[0][0],
        violationResPerNodes.objectIds,
        violationResPerNodes.eventIds,
        showElementInfo,
        node,
        hasConstraints,
      );
    } else {
      return [];
    }
  }, [violationResPerNodes, node]);

  return (
    <Sheet
      modal={false}
      open={violationDetails !== undefined}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          showElementInfo(undefined);
        }
      }}
    >
      {violationDetails !== undefined && (
        <SheetContent
          side="left"
          className="h-screen flex flex-col w-[50vw] min-w-fit"
          overlay={false}
          onInteractOutside={(ev) => {
            ev.preventDefault();
          }}
        >
          <SheetHeader>
            <SheetTitle className="flex items-center justify-between pr-4">
              Output Bindings
            </SheetTitle>
            <SheetDescription asChild>
              <div>
                <div className="flex justify-between">
                  <p className="text-primary text-base">
                    {numBindings} Bindings
                    <br />
                    {numViolations} Violations
                  </p>
                  <AlertHelper
                    title="Export Situation Table CSV/XLSX"
                    mode="promise"
                    initialData={
                      {
                        includeIds: true,
                        includeViolationStatus: hasConstraints,
                        omitHeader: false,
                        labels,
                        format: "CSV",
                      } satisfies TableExportOptions as TableExportOptions
                    }
                    trigger={
                      <Button
                        size="icon"
                        variant="outline"
                        title="Export as CSV/XLSX (Situation Table)"
                      >
                        <TbTableExport />
                      </Button>
                    }
                    content={({ data, setData }) => (
                      <div>
                        <p className="mb-4">
                          All event or object attributes will be included as an
                          extra column. The object/event ID can also be included
                          as a column (on by default).
                        </p>
                        <div className="grid grid-cols-[auto,1fr] gap-x-2 gap-y-2 items-center">
                          <Label>Format</Label>
                          <Combobox
                            options={[
                              { label: "CSV (Basic)", value: "CSV" },
                              { label: "XLSX (Formatted)", value: "XLSX" },
                            ]}
                            name="Export Format"
                            value={data.format}
                            onChange={(f) => {
                              if (f == "CSV" || f == "XLSX") {
                                setData({
                                  ...data,
                                  format: f as "CSV" | "XLSX",
                                });
                              }
                            }}
                          />
                          <Label>Include IDs</Label>
                          <Switch
                            checked={data.includeIds}
                            onCheckedChange={(b) => {
                              setData({ ...data, includeIds: b });
                            }}
                          />
                          <Label>Include Headers</Label>
                          <Switch
                            checked={!data.omitHeader}
                            onCheckedChange={(b) => {
                              setData({ ...data, omitHeader: !b });
                            }}
                          />
                          {labels.length >= 1 && (
                            <>
                              <Label>Labels to Include</Label>
                              <MultiSelect
                                options={labels.map((l) => ({
                                  value: l,
                                  label: <LabelLabel label={l} />,
                                }))}
                                onValueChange={(value: string[]) => {
                                  setData({ ...data, labels: value });
                                }}
                                name={"Labels"}
                                defaultValue={data.labels}
                                placeholder={""}
                              />
                            </>
                          )}
                          {hasConstraints && (
                            <>
                              <Label>Include Violation Status</Label>
                              <Switch
                                checked={data.includeViolationStatus}
                                onCheckedChange={(b) => {
                                  setData({
                                    ...data,
                                    includeViolationStatus: b,
                                  });
                                }}
                              />
                            </>
                          )}
                        </div>
                      </div>
                    )}
                    submitAction="Export"
                    onSubmit={async (data, ev) => {
                      try {
                        const nodeIndex =
                          violationsPerNode?.nodeIdtoIndex[nodeID];
                        if (nodeIndex !== undefined) {
                          const res = await toast.promise(
                            backend["ocel/export-bindings"](nodeIndex, data),
                            {
                              loading: "Exporting to CSV...",
                              error: (e) => (
                                <p>
                                  Failed to export to CSV!
                                  <br />
                                  {String(e)}
                                </p>
                              ),
                              success: "Finished CSV Export!",
                            },
                          );
                          if (res !== undefined) {
                            backend["download-blob"](
                              res,
                              `situation-table.${
                                data.format === "CSV" ? "csv" : "xlsx"
                              }`,
                            );
                          } else {
                            console.log("CSV res was undefined", res);
                          }
                        }
                      } catch (e) {
                        toast.error(String(e));
                        throw e;
                      }
                    }}
                  />
                </div>
                {numBindings > DEFAULT_CUTOFF && (
                  <div className="flex items-center gap-x-2">
                    {appliedCutoff !== undefined
                      ? `For performance reasons, only the first ${DEFAULT_CUTOFF} output bindings are shown.`
                      : "All output bindings are shown."}
                    {/* <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (appliedCutoff !== undefined) {
                          setAppliedCutoff(undefined);
                        } else {
                          setAppliedCutoff(DEFAULT_CUTOFF);
                        }
                      }}
                    >
                      {appliedCutoff !== undefined ? "Show All" : "Undo"}
                    </Button> */}
                  </div>
                )}
              </div>
            </SheetDescription>
          </SheetHeader>

          {items.length > 0 && (
            <Suspense
              fallback={
                <div className="flex items-center gap-x-2">
                  Loading binding table... <Spinner />
                </div>
              }
            >
              <DataTablePaginationLazy
                key={JSON.stringify(node)}
                columns={columns}
                data={items}
                initialMode={initialMode}
              />
            </Suspense>
          )}
        </SheetContent>
      )}
    </Sheet>
  );
});
export default ViolationDetailsSheet;
