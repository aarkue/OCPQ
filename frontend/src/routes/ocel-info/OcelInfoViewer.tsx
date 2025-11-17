import { OcelInfoContext } from "@/App";
import { Button } from "@/components/ui/button";
import { useContext } from "react";
import { RxArrowRight } from "react-icons/rx";
import { Link } from "react-router-dom";
import OcelTypeViewer from "./OcelTypeViewer";

export default function OcelInfoViewer() {
  const ocelInfo = useContext(OcelInfoContext);
  if (ocelInfo === undefined) {
    return <div>No Info!</div>;
  }
  return (
    <div className="my-4 text-lg text-left">
      <h2 className="text-4xl font-black">OCEL Info</h2>
      <p className="text-muted-foreground flex flex-col  leading-tight mt-2">
        <span>{ocelInfo.num_events} Events</span>
        <span>{ocelInfo.num_objects} Objects</span>
      </p>
      <div className="font-medium mt-4 mb-2 bg-fuchsia-50 p-2 rounded">
        <h3 className="font-black text-2xl">What do you want to do?</h3>
        <div className="ml-2">
        <p>Create custom queries to freely explore the dataset.
          <span className="text-sm italic font-normal mb-1 block">How many orders are delivered late? What are the customers with the most payment reminders?</span>
        </p>
        <Link to="/constraints">
          <Button className=" h-12 text-xl  bg-purple-700 text-white font-bold cursor-pointer"> <RxArrowRight className="mr-2" />OCPQ Query Editor</Button></Link>
        </div>
        <div className="ml-2">
        <p className="mt-2">Discover and analyze behavioral patterns.
          <span className="text-sm italic font-normal mb-1 block">What happens after an order is placed? Is the same employee entering the order also confirming it?</span>
        </p>
        <Link to="/oc-declare"><Button className="h-12 text-xl bg-emerald-600 text-white font-bold cursor-pointer"> <RxArrowRight className="mr-2" /> OC-DECLARE</Button></Link>
        </div>
      </div>
      <div className="grid grid-cols-[1fr_1fr] gap-x-2">
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

    </div>
  );
}
