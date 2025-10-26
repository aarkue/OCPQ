import { Button } from "@/components/ui/button";
import { OC_DECLARE_LOCALSTORAGE_SAVE_KEY_CONSTRAINTS_META, OC_DECLARE_LOCALSTORAGE_SAVE_KEY_DATA, parseLocalStorageValue } from "@/lib/local-storage";
import { Link, useParams } from "react-router-dom";
import { ConstraintInfo } from "../visual-editor/helper/types";
import { IoArrowBack } from "react-icons/io5";
import OCDeclareFlowEditor from "./flow/OCDeclareFlowEditor";
import { OCDeclareFlowData } from "./flow/oc-declare-flow-data";

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
    const meta = parseLocalStorageValue<ConstraintInfo[]>(localStorage.getItem(OC_DECLARE_LOCALSTORAGE_SAVE_KEY_CONSTRAINTS_META) ?? "[]")
    const data = parseLocalStorageValue<OCDeclareFlowData[]>(localStorage.getItem(OC_DECLARE_LOCALSTORAGE_SAVE_KEY_DATA) ?? "[]")
    if (index === null || meta.length <= index) {
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
    const metaInfo = meta[index];
    return <div className="text-left w-full h-full">
        <div className="flex items-center gap-x-4">

            <Link to="/oc-declare">
                <Button title="Back to overview" size="icon" variant="outline"><IoArrowBack /> </Button>
            </Link>
            <div>

                <h2 className="font-bold text-xl">OC-DECLARE Model</h2>
                <h1 className="font-black text-2xl text-orange-500"> {metaInfo.name}</h1>
            </div>
        </div>
            <OCDeclareFlowEditor initialFlowJson={data[index]?.flowJson} onChange={(value) => {
                data[index] = {flowJson: value};
                localStorage.setItem(OC_DECLARE_LOCALSTORAGE_SAVE_KEY_DATA, JSON.stringify(data));
                console.log(value);
            }}/>

    </div>
}