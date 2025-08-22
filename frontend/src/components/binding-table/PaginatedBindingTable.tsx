import { ChevronLeftIcon, ChevronRightIcon } from "@radix-ui/react-icons";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { IndeterminateCheckbox } from "../ui/intermediate-checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
}

export function DataTablePagination<TData, TValue>({
  columns,
  data,
  initialMode,
}: DataTableProps<TData, TValue> & {
  initialMode: "violations" | "situations" | "satisfied-situations" | undefined;
}) {
  const table = useReactTable({
    data,
    columns,
    filterFns: {},
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    initialState: {
      pagination: {
        pageIndex: 0,
        pageSize: 20,
      },
    },
  });
  useEffect(() => {
    if (table.getAllColumns().find((c) => c.id === "Violation") !== undefined) {
      if (initialMode === "satisfied-situations") {
        table.getColumn("Violation")?.setFilterValue("SATISFIED");
      } else if (initialMode === "violations") {
        table.getColumn("Violation")?.setFilterValue("VIOLATED");
      } else {
        table.getColumn("Violation")?.setFilterValue(undefined);
      }
    }
  }, [initialMode]);
  return (
    <div className="w-full">
      <div className="rounded-md border w-full max-h-[73vh] overflow-auto">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="divide-x">
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id} className="py-1 px-2 mx-4 ">
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                      <div className="flex items-center gap-x-1 w-fit">
                        {header.id === "Violation" && (
                          <>
                            <IndeterminateCheckbox
                              title={
                                table.getColumn(header.id)?.getFilterValue() ===
                                "SATISFIED"
                                  ? "Only show satisfied bindings"
                                  : table
                                      .getColumn(header.id)
                                      ?.getFilterValue() === "VIOLATED"
                                  ? "Only show violated bindings"
                                  : "Show both satisfied and violated bindings"
                              }
                              state={
                                table.getColumn(header.id)?.getFilterValue() ===
                                "SATISFIED"
                                  ? "unchecked"
                                  : table
                                      .getColumn(header.id)
                                      ?.getFilterValue() === "VIOLATED"
                                  ? "checked"
                                  : "indeterminate"
                              }
                              newState={(newChecked) => {
                                table
                                  .getColumn(header.id)
                                  ?.setFilterValue(
                                    newChecked === "indeterminate"
                                      ? undefined
                                      : newChecked === "unchecked"
                                      ? "SATISFIED"
                                      : "VIOLATED",
                                  );
                              }}
                            />
                            {table.getColumn(header.id)?.getFilterValue() ===
                            undefined
                              ? "any"
                              : table.getColumn(header.id)?.getFilterValue() ===
                                "VIOLATED"
                              ? "viol."
                              : "sat."}
                          </>
                        )}
                        {header.id !== "Violation" && (
                          <DebouncedInput
                            debounce={200}
                            placeholder="Search..."
                            value={
                              (table
                                .getColumn(header.id)
                                ?.getFilterValue() as string) ?? ""
                            }
                            onChange={(newVal) =>
                              table.getColumn(header.id)?.setFilterValue(newVal)
                            }
                            className="max-w-20 text-xs py-0 h-6 my-1 bg-white"
                          />
                        )}
                      </div>
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody className="text-xs">
            {table.getRowModel().rows?.length !== 0 ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  className="divide-x w-fit"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="">
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="grid grid-cols-[1fr_1fr_1fr] items-center justify-between px-2 text-xs mt-2 w-full">
        <div className="flex items-center space-x-2">
          <p className="font-medium">Rows per page</p>
          <Select
            value={`${table.getState().pagination.pageSize}`}
            onValueChange={(value) => {
              table.setPageSize(Number(value));
            }}
          >
            <SelectTrigger className="h-8 w-[70px]">
              <SelectValue placeholder={table.getState().pagination.pageSize} />
            </SelectTrigger>
            <SelectContent side="top">
              {[10, 20, 30, 40, 50].map((pageSize) => (
                <SelectItem key={pageSize} value={`${pageSize}`}>
                  {pageSize}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex w-full min-w-[150px] items-center justify-center font-medium">
          Page {table.getState().pagination.pageIndex + 1} of{" "}
          {table.getPageCount()}
        </div>
        <div className="flex items-center space-x-2 justify-end">
          {/* <Button
              variant="outline"
              className="hidden h-8 w-8 p-0 lg:flex"
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
            >
              <span className="sr-only">Go to first page</span>
              <DoubleArrowLeftIcon className="h-4 w-4" />
            </Button> */}
          <Button
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <span className="sr-only">Go to previous page</span>
            <ChevronLeftIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <span className="sr-only">Go to next page</span>
            <ChevronRightIcon className="h-4 w-4" />
          </Button>
          {/* <Button
              variant="outline"
              className="hidden h-8 w-8 p-0 lg:flex"
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
              disabled={!table.getCanNextPage()}
            >
              <span className="sr-only">Go to last page</span>
              <DoubleArrowRightIcon className="h-4 w-4" />
            </Button> */}
        </div>
      </div>
    </div>
  );
}

// A typical debounced input react component
function DebouncedInput({
  value: initialValue,
  onChange,
  debounce = 500,
  ...props
}: {
  value: string | number;
  onChange: (value: string | number) => void;
  debounce?: number;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange">) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      onChange(value);
    }, debounce);

    return () => clearTimeout(timeout);
  }, [value]);

  return (
    <Input
      {...props}
      value={value}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}

export default DataTablePagination;
