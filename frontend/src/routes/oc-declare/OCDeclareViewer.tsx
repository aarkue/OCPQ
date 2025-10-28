import { Button } from "@/components/ui/button";
import { OC_DECLARE_LOCALSTORAGE_SAVE_KEY_CONSTRAINTS_META, OC_DECLARE_LOCALSTORAGE_SAVE_KEY_DATA, parseLocalStorageValue } from "@/lib/local-storage";
import { Link, useParams } from "react-router-dom";
import { ConstraintInfo } from "../visual-editor/helper/types";
import { IoArrowBack, IoPencil, IoPencilSharp } from "react-icons/io5";
import OCDeclareFlowEditor from "./flow/OCDeclareFlowEditor";
import { OCDeclareFlowData } from "./flow/oc-declare-flow-data";
import { PiEngineLight, PiGenderMaleLight } from "react-icons/pi";
import { BsPencil } from "react-icons/bs";
import { LuPencil } from "react-icons/lu";
import { useRef, useState } from "react";
import AlertHelper from "@/components/AlertHelper";
import { Input } from "@/components/ui/input";
import OCDeclareDiscoveryButton from "./flow/OCDeclareDiscoveryButton";
import { ReactFlowInstance } from "@xyflow/react";
import { ActivityNodeType, CustomEdgeType } from "./flow/oc-declare-flow-types";
import { addArcsToFlow } from "./flow/oc-declare-flow-type-conversions";

function parseIndexFromID(id: string | undefined) {
  if (typeof id === "string") {
    const index = parseInt(id);
    if (isNaN(index)) {
      return null;
    } else {
      return index;
    }
  }
  return null
}
export default function OCDeclareViewer() {

  const { id } = useParams();
  const index = parseIndexFromID(id);

  const meta = parseLocalStorageValue<ConstraintInfo[]>(localStorage.getItem(OC_DECLARE_LOCALSTORAGE_SAVE_KEY_CONSTRAINTS_META) ?? "[]");
  // const [meta,setMeta] = useState();
  const data = parseLocalStorageValue<OCDeclareFlowData[]>(localStorage.getItem(OC_DECLARE_LOCALSTORAGE_SAVE_KEY_DATA) ?? "[]")
  const [metaInfo, setMetaInfo] = useState(index !== null && index >= 0 && index < meta.length ? meta[index] : undefined);
  const flowRef = useRef<ReactFlowInstance<ActivityNodeType, CustomEdgeType>>();

  if (index == null || metaInfo === undefined) {
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
    if (newMetaInfo && index !== null) {
      meta[index] = newMetaInfo;
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
          if(flowRef.current){
            
          addArcsToFlow(constraints,flowRef.current)
          }

        }} />
      </div>
    </div>
    <OCDeclareFlowEditor initialFlowJson={data[index]?.flowJson} onChange={(value) => {
      data[index] = { flowJson: value };
      localStorage.setItem(OC_DECLARE_LOCALSTORAGE_SAVE_KEY_DATA, JSON.stringify(data));
    }} onInit={(ref) => flowRef.current = ref} />

  </div>
}
