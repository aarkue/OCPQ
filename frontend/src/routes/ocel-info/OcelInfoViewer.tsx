import { useContext } from "react";
import OcelTypeViewer from "./OcelTypeViewer";
import { OcelInfoContext } from "@/App";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { LuArrowRight, LuLink } from "react-icons/lu";
import { BsArrowRight } from "react-icons/bs";
import { RxArrowRight } from "react-icons/rx";

export default function OcelInfoViewer() {
  const ocelInfo = useContext(OcelInfoContext);
  if (ocelInfo === undefined) {
    return <div>No Info!</div>;
  }
  return (
    <div className="my-4 text-lg text-left">
      <h2 className="text-4xl font-semibold">OCEL Info</h2>
      <p className="text-muted-foreground flex flex-col  leading-tight mt-2">
        <span>{ocelInfo.num_events} Events</span>
        <span>{ocelInfo.num_objects} Objects</span>
      </p>
      <div className="grid grid-cols-[1fr,1fr] gap-x-2">
      <div className="bg-green-100 py-4 px-2 my-4 rounded-lg shadow border border-emerald-200">
        <h3 className="text-2xl font-semibold">
          Event Types{" "}
          <span className="text-gray-600 text-xl ml-2">
            {ocelInfo.event_types.length}
          </span>
        </h3>
        <div className="flex flex-wrap">
          {ocelInfo.event_types.map((et) => (
            <OcelTypeViewer key={et.name} typeInfo={et} type="event" />
          ))}
        </div>
      </div>
      <div className="bg-blue-100 py-4 px-2 my-4 rounded-lg shadow border border-sky-200">
        <h3 className="text-2xl font-semibold">
          Object Types{" "}
          <span className="text-gray-600 text-xl ml-2">
            {ocelInfo.object_types.length}
          </span>
        </h3>
        <div className="flex flex-wrap">
          {ocelInfo.object_types.map((et) => (
            <OcelTypeViewer key={et.name} typeInfo={et} type="object" />
          ))}
        </div>
      </div>
    </div>
    <Link to="/constraints">
    <Button size="lg" className="w-fit h-16 text-xl"> <RxArrowRight className="mr-2"/> Query & Constraint Editor</Button></Link>
        
      </div>
  );
}
