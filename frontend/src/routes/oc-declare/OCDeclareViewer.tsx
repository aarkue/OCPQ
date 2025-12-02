import { Button } from "@/components/ui/button";
import { OC_DECLARE_LOCALSTORAGE_SAVE_KEY_CONSTRAINTS_META, OC_DECLARE_LOCALSTORAGE_SAVE_KEY_DATA, parseLocalStorageValue } from "@/lib/local-storage";
import { Link, useParams } from "react-router-dom";
import { IoArrowBack } from "react-icons/io5";
import OCDeclareFlowEditor from "./flow/OCDeclareFlowEditor";
import { OCDeclareFlowData, OCDeclareMetaData } from "./flow/oc-declare-flow-data";
import { LuPencil } from "react-icons/lu";
import { useRef, useState } from "react";
import AlertHelper from "@/components/AlertHelper";
import { Input } from "@/components/ui/input";
import OCDeclareDiscoveryButton from "./flow/OCDeclareDiscoveryButton";
import { ReactFlowInstance } from "@xyflow/react";
import { ActivityNodeType, CustomEdgeType } from "./flow/oc-declare-flow-types";
import { addArcsToFlow } from "./flow/oc-declare-flow-type-conversions";

export default function OCDeclareViewer() {

  const { id } = useParams();

  const meta = parseLocalStorageValue<OCDeclareMetaData[]>(localStorage.getItem(OC_DECLARE_LOCALSTORAGE_SAVE_KEY_CONSTRAINTS_META) ?? "[]");
  const data = parseLocalStorageValue<OCDeclareFlowData>(localStorage.getItem(OC_DECLARE_LOCALSTORAGE_SAVE_KEY_DATA + id) ?? "[]")
  const metaIndex = meta.findIndex(x => x.id === id);
  const [metaInfo, setMetaInfo] = useState(metaIndex !== undefined ? meta[metaIndex] : undefined);
  const flowRef = useRef<ReactFlowInstance<ActivityNodeType, CustomEdgeType>>();

  if (id == null || metaInfo === undefined) {
    return <div className=" text-left">
      <h2 className="font-black text-2xl text-red-500">Unknown OC-DECLARE Model</h2>
      <p className="mt-2 mb-4">The requested OC-DECLARE model does not exist. Maybe it was deleted?
        <br />
        Go back to see an overview over all existing models.
      </p>
      <Link to="/oc-declare">
        <Button size="lg">Back</Button>
      </Link>
    </div>
  }
  function updateMetaInfo(newMetaInfo: typeof metaInfo) {
    setMetaInfo(newMetaInfo);
    if (newMetaInfo && metaIndex !== null) {
      meta[metaIndex] = newMetaInfo;
      localStorage.setItem(OC_DECLARE_LOCALSTORAGE_SAVE_KEY_CONSTRAINTS_META, JSON.stringify(meta));
    }

  }
  return <div className="text-left w-full h-full flex flex-col">
    <div className="flex items-center gap-x-4">

      <Link to="/oc-declare">
        <Button title="Back to overview" size="icon" variant="outline"><IoArrowBack /> </Button>
      </Link>
      <div>
        <h2 className="font-bold text-xl">OC-DECLARE Model</h2>
        <div className="flex items-center gap-x-1">
          <h1 className="font-black text-2xl text-orange-500"> {metaInfo.name}</h1>
          <AlertHelper trigger={<Button size="icon" variant="ghost"> <LuPencil /> </Button>}
            initialData={{ ...metaInfo }}
            title="Change Name"
            content={({ data, setData, close }) => <>
              <Input value={data.name} autoFocus onKeyDown={(ev) => {
                if (ev.key === "Enter") {
                  updateMetaInfo(data);
                  close();
                }
              }}
                onChange={(ev) => setData({ ...data, name: ev.currentTarget.value })}
              />
            </>}
            submitAction={<>Save</>}
            onSubmit={updateMetaInfo} />
        </div>
      </div>
      <div className="ml-auto">
        <OCDeclareDiscoveryButton onConstraintsDiscovered={(constraints) => {
          console.log(`Got ${constraints.length} constraints`)
          if (flowRef.current) {

            addArcsToFlow(constraints, flowRef.current)
          }

        }} />
      </div>
    </div>
    <div className="w-full h-full border">

      <OCDeclareFlowEditor initialFlowJson={data.flowJson} name={metaInfo.name} onChange={(value) => {
        localStorage.setItem(OC_DECLARE_LOCALSTORAGE_SAVE_KEY_DATA + id, JSON.stringify({ flowJson: value } satisfies OCDeclareFlowData));
      }} onInit={(ref) => flowRef.current = ref} />
    </div>

  </div>
}
