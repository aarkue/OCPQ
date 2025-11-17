import { useContext, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BackendProviderContext } from "@/BackendProviderContext";
import type {
  OCELEvent,
  OCELObject,
  OCELRelationship,
  OCELType,
} from "@/types/ocel";
import JSONEditor from "@/components/JsonEditor";
import { OcelInfoContext } from "@/App";
import { IconForDataType } from "@/routes/ocel-info/OcelTypeViewer";
import { VisualEditorContext } from "@/routes/visual-editor/helper/VisualEditorContext";
import { Button } from "./ui/button";
import OcelGraphViewer from "@/routes/OcelGraphViewer";

export default function OcelElementInfo({
  type,
  req,
}: {
  type: "event" | "object";
  req: { id: string; index?: undefined } | { index: number; id?: undefined };
}) {
  const backend = useContext(BackendProviderContext);
  const [info, setInfo] = useState<
    | {
      index: number;
      object: OCELObject;
      event?: undefined;
    }
    | { index: number; event: OCELEvent; object?: undefined }
    | null
    | undefined
  >(undefined);
  useEffect(() => {
    if (type === "object" && req != null) {
      void backend["ocel/get-object"](req)
        .then((res) => {
          setInfo(res);
        })
        .catch(() => setInfo(null));
    } else if (type === "event" && req != null) {
      void backend["ocel/get-event"](req)
        .then((res) => {
          setInfo(res);
        })
        .catch(() => setInfo(null));
    }
  }, [req, type]);

  const ocelInfo = useContext(OcelInfoContext);
  const overflowDiv = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (overflowDiv.current !== null) {
      overflowDiv.current.scrollTop = 0;
    }
  }, [info]);

  return (
    <div className="text-lg text-left h-full">
      <div className="grid grid-cols-[1fr_2fr] justify-center gap-x-4 w-full h-full">
        <div className="w-full h-full border-r-2 overflow-auto" ref={overflowDiv}>
          {info?.object != null && (
            <OcelObjectViewer
              object={info.object}
              type={ocelInfo?.object_types.find(
                (t) => t.name === info.object.type,
              )}
            />
          )}
          {info?.event != null && (
            <OcelEventViewer
              event={info.event}
              type={ocelInfo?.event_types.find(
                (t) => t.name === info.event.type,
              )}
            />
          )}

          {info === null && (
            <div className="text-4xl font-bold text-red-700">Not Found</div>
          )}
        </div>
        <div className="w-full h-full overflow-hidden">

          {info !== null &&
            <OcelGraphViewer
              initialGrapOptions={{
                type,
                id: (type === "event" ? info?.event : info?.object)?.id ?? req.id,
              }}
            />
          }
        </div>
      </div>
    </div>
  );
}

function RelationshipViewer({ rels }: { rels?: OCELRelationship[] }) {
  const { showElementInfo } = useContext(VisualEditorContext);
  return (
    <div className="mt-4">
      Relationships
      <ul className="list-disc ml-6">
        {rels?.map((rel, i) => (
          <li key={i} className="my-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                showElementInfo({ type: "object", req: { id: rel.objectId } });
              }}
            >
              {rel.objectId} @ {rel.qualifier}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OcelObjectViewer({
  object,
  type,
}: {
  object: OCELObject;
  type?: OCELType;
}) {
  return (
    <div
      className={`block h-full p-1 bg-white text-left`}
    >
      <h4 className="font-semibold text-2xl">{object.id}</h4>
      <span className="text-gray-600 text-xl block mb-2">
        Type: {object.type}
      </span>
      <ul className="text-left text-xl space-y-1">
        {type?.attributes.map((attr) => (
          <li key={attr.name}>
            <div className="flex gap-x-1 items-center w-full">
              <div className="flex self-start">
                <span className="flex justify-center -mt-1 w-8">
                  <IconForDataType dtype={attr.type} />
                </span>
                <div className="font-mono self-start">{attr.name}:</div>
              </div>
              <div className="font-mono text-blue-700 w-full flex flex-wrap overflow-hidden">
                {object.attributes
                  .filter((a) => a.name === attr.name)
                  .map((a) => (
                    <div
                      key={a.time}
                      className="mr-4 text-base border p-0.5 rounded-sm w-fit max-w-full truncate"
                      title={`${a.value} at ${a.time}`}
                    >
                      {String(a.value)}
                    </div>
                  ))}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <RelationshipViewer rels={object.relationships} />
    </div>
  );
}

function OcelEventViewer({
  event,
  type,
}: {
  event: OCELEvent;
  type?: OCELType;
}) {
  return (
    <div
      className={`block p-1 bg-white text-left`}
    >
      <h4 className="font-semibold text-2xl">{event.id}</h4>
      <span className="text-gray-800 text-xl block">
        Type: {event.type}
      </span>
      <span className="text-gray-800 text-xl block">
        Time: <span className="font-medium font-mono">{event.time}</span>
      </span>
      <ul className="text-left text-xl space-y-1 ">
        {type?.attributes.map((attr) => (
          <li key={attr.name}>
            <div className="flex gap-x-1 items-center">
              <span className="flex justify-center -mt-1 w-8">
                {/* {attr.name} */}
                <IconForDataType dtype={attr.type} />
              </span>
              <span className="font-mono">{attr.name}:</span>{" "}
              <span className="font-mono text-blue-700 truncate">
                {String(event.attributes.find((a) => a.name === attr.name)?.value ?? "-")}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <RelationshipViewer rels={event.relationships} />
    </div>
  );
}
