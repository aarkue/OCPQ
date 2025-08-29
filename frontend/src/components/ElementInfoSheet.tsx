import { useContext } from "react";
import { Sheet, SheetContent } from "./ui/sheet";
import { VisualEditorContext } from "@/routes/visual-editor/helper/VisualEditorContext";
import OcelElementInfo from "./OcelElementInfo";
import AlertHelper from "./AlertHelper";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Toggle } from "./ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Label } from "./ui/label";
import { LuFileSearch } from "react-icons/lu";

export default function ElementInfoSheet({
  elInfo,
}: {
  elInfo?: {
    type: "event" | "object";
    req: { id: string } | { index: number };
  };
}) {
  const { showElementInfo } = useContext(VisualEditorContext);
  return (
    <Sheet
      open={elInfo !== undefined}
      onOpenChange={() => showElementInfo(undefined)}
      modal={false}
    >
      <SheetContent
        side="bottom"
        className="h-[40vh] flex flex-col"
        overlay={false}
        onInteractOutside={(ev) => {
          ev.preventDefault();
        }}
      >
        <div className="absolute left-0 -top-11 p-2 z-20">
          {elInfo !== undefined && (
            <AlertHelper
              trigger={
                <Button size="icon">
                  <LuFileSearch />
                </Button>
              }
              initialData={{ ...elInfo }}
              title="Show Another Event or Object"
              mode="normal"
              content={({ setData, data }) => (
                <div>
                  <div className="flex items-center gap-x-4">
                    <Label className="w-[9ch]">Type</Label>
                    <ToggleGroup
                      type="single"
                      value={data.type}
                      onValueChange={(val: string) => {
                        setData({
                          ...data,
                          type: val === "event" ? "event" : "object",
                        });
                      }}
                    >
                      <ToggleGroupItem value="event" variant="outline">
                        Event
                      </ToggleGroupItem>
                      <ToggleGroupItem value="object" variant="outline">
                        Object
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                  <div className="flex items-center gap-x-4 mt-1">
                    <Label className="w-[9ch]">Retrieve By</Label>
                    <ToggleGroup
                      type="single"
                      value={
                        data.req === undefined || "id" in data.req
                          ? "id"
                          : "index"
                      }
                      onValueChange={(val: string) => {
                        setData({
                          ...data,
                          req: val === "id" ? { id: "" } : { index: 0 },
                        });
                      }}
                    >
                      <ToggleGroupItem value="id" variant="outline">
                        By ID
                      </ToggleGroupItem>
                      <ToggleGroupItem value="index" variant="outline">
                        By Index
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                  <div className="flex items-center gap-x-4 mt-1">
                    <Label className="w-[9ch]">
                      {"id" in data.req ? "ID" : "Index"}
                    </Label>
                    {"id" in data.req && (
                      <Input
                        value={data.req.id}
                        onChange={(ev) =>
                          setData({
                            ...data,
                            req: { id: ev.currentTarget.value },
                          })
                        }
                      />
                    )}
                    {"index" in data.req && (
                      <Input
                        type="number"
                        step={1}
                        value={data.req.index}
                        onChange={(ev) =>
                          setData({
                            ...data,
                            req: { index: ev.currentTarget.valueAsNumber },
                          })
                        }
                      />
                    )}
                  </div>
                </div>
              )}
              submitAction="Apply"
              onSubmit={(data) => {
                showElementInfo(data);
              }}
            />
          )}
        </div>
        {/* <SheetHeader> */}
        {/* <SheetTitle className="-mt-4">Element Info</SheetTitle> */}
        {/* <SheetDescription></SheetDescription> */}
        {/* </SheetHeader> */}
        {elInfo !== undefined && (
          <OcelElementInfo type={elInfo?.type} req={elInfo.req} />
        )}
      </SheetContent>
    </Sheet>
  );
}
