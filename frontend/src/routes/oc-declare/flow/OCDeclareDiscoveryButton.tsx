import AlertHelper from "@/components/AlertHelper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OCDeclareArc } from "../types/OCDeclareArc";
import { RiRobot2Line } from "react-icons/ri";
import { Label } from "@/components/ui/label";
import { useContext, useRef } from "react";
import { BackendProviderContext } from "@/BackendProviderContext";
import toast from "react-hot-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import MultiSelect from "@/components/ui/multi-select";
import { OcelInfoContext } from "@/App";
import { Switch } from "@/components/ui/switch";

export type OCDeclareDiscoveryOptions = {
  noise_threshold: number,
  o2o_mode: "None" | "Direct" | "Reversed" | "Bidirectional",
  acts_to_use?: string[] | undefined,
  counts_for_generation: [number | null, number | null],
  counts_for_filter: [number | null, number | null],

}
export default function OCDeclareDiscoveryButton({ onConstraintsDiscovered }: { onConstraintsDiscovered: (arcs: OCDeclareArc[]) => unknown }) {
  const backend = useContext(BackendProviderContext);
  const ocelInfo = useContext(OcelInfoContext);
  const wasCancelledRef = useRef(false);
  return <AlertHelper onCancel={() => {
    wasCancelledRef.current = true;
    toast.dismiss("oc-declare-discovery");
  }} trigger={<Button size="default" className="font-semibold"> <RiRobot2Line className="mr-1" />  Auto Discover...</Button>}
    initialData={{ noise_threshold: 0.2, o2o_mode: "None", counts_for_generation: [1, null], counts_for_filter: [1, 20] } satisfies OCDeclareDiscoveryOptions as OCDeclareDiscoveryOptions}
    title="Auto-Discover OC-DECLARE Constraints"
    content={({ data, setData }) => <div className="flex flex-col gap-y-4">
      <Label className="flex flex-col gap-y-1">
        Noise Threshold
        <Input type="number" min={0} max={1} step={0.05} value={data.noise_threshold} onChange={((ev) => setData({ ...data, noise_threshold: ev.currentTarget.valueAsNumber }))} />
      </Label>
      <Label className="flex flex-col gap-y-1">
        O2O Mode
        <Select value={data.o2o_mode} defaultValue={data.o2o_mode} onValueChange={(v) => setData({ ...data, o2o_mode: v as OCDeclareDiscoveryOptions['o2o_mode'] })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {(["None", "Direct", "Reversed", "Bidirectional"] satisfies OCDeclareDiscoveryOptions['o2o_mode'][]).map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </Label>
      {ocelInfo?.event_types && <Label className="flex flex-col gap-y-1">
        Activities
        <div className="flex items-center gap-x-1">

          <Switch checked={data.acts_to_use === undefined} onCheckedChange={(checked) => {
            if (checked) {
              setData({ ...data, acts_to_use: undefined })
            } else {
              setData({ ...data, acts_to_use: ocelInfo.event_types.slice(0, 3).map(t => t.name) })
            }
          }} />
          <Label>Use {data.acts_to_use === undefined ? "all" : "selected"} activities</Label>
        </div>
        {data.acts_to_use !== undefined &&
          <MultiSelect
            options={ocelInfo.event_types
              .map((t) => ({
                label: t.name,
                value: t.name,
              }))}
            placeholder={""}
            defaultValue={data.acts_to_use}
            onValueChange={(value: string[]) => {
              setData({ ...data, acts_to_use: value });
            }}
          />
        }
      </Label>}
    </div>}
    submitAction={<>Run</>}
    mode="promise"
    onSubmit={async (data) => {
      wasCancelledRef.current = false;
      console.log("Discovery with options", data);
      const res = await toast.promise(backend['ocel/discover-oc-declare'](data), { loading: "Discovering...", error: "Discovery failed.", success: "Discovery finished!" }, { id: "oc-declare-discovery" });
      if (!wasCancelledRef.current) {
        onConstraintsDiscovered(res);
      } else {
        toast.dismiss("oc-declare-discovery");
      }
    }} />
}
