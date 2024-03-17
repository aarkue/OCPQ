import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createContext, useContext, useEffect, useState } from "react";
import toast from "react-hot-toast";
// import { Outlet, useLocation } from "react-router-dom";
import "./App.css";
import MenuLink from "./components/MenuLink";
import Spinner from "./components/Spinner";
import { Button } from "./components/ui/button";
import { type OCELInfo } from "./types/ocel";
import { BackendProviderContext } from "./BackendProviderContext";
import { Outlet, useLocation } from "react-router-dom";

export const OcelInfoContext = createContext<OCELInfo | undefined>(undefined);

function App() {
  const [loading, setLoading] = useState(false);
  const [ocelInfo, setOcelInfo] = useState<OCELInfo>();

  const location = useLocation();
  const isAtRoot = location.pathname === "/";
  const [availableOcels, setAvailableOcels] = useState<string[]>([]);
  const [selectedOcel, setSelectedOcel] = useState<string>();
  const backend = useContext(BackendProviderContext);
  useEffect(() => {
    void toast
      .promise(backend["ocel/info"](), {
        loading: "Loading OCEL Info",
        success: "Got OCEL info",
        error: "Failed to load OCEL info",
      })
      .then((info) => {
        setOcelInfo(info);
      });

    void toast
      .promise(backend["ocel/available"](), {
        loading: "Loading available OCEL",
        success: "Got available OCEL",
        error: "Failed to load available OCEL",
      })
      .then((res) => {
        setAvailableOcels(res);
      });
  }, []);

  async function loadOcel() {
    if (selectedOcel == null) {
      console.warn("No valid OCEL selected");
      return;
    }
    await toast.promise(
      backend["ocel/load"](selectedOcel).then((ocelInfo) => {
        setOcelInfo(ocelInfo);
      }),
      {
        loading: "Importing OCEL...",
        success: "Imported OCEL",
        error: "Failed to import OCEL",
      },
    );
  }

  return (
    <OcelInfoContext.Provider value={ocelInfo}>
      <div className="max-w-full overflow-hidden h-screen text-center grid grid-cols-[15rem_auto]">
        <div className="bg-gray-50 border-r border-r-slate-200 px-2">
        <img src="/favicon.png" className="w-[7rem] h-[7rem] mx-auto my-4"/>
          <div className="flex flex-col gap-2">
            {ocelInfo !== undefined && (
              <span className="flex flex-col items-center mx-auto text-xl">
                <span className=" font-semibold text-green-700">OCEL loaded</span>
                <span>{ocelInfo.num_events} Events</span>
                <span>{ocelInfo.num_objects} Objects</span>
              </span>
            )}
            {ocelInfo !== undefined && (
              <>
                <MenuLink to="/ocel-info">OCEL Info</MenuLink>
                <MenuLink to="/constraints">Constraints</MenuLink>
              </>
            )}
            <br />
            {!isAtRoot && (
              <>
                <MenuLink to={"/"}>Back</MenuLink>
              </>
            )}
          </div>
        </div>
        <div className="px-4 overflow-auto py-8">
          {/* <Spinner loadingText="Importing OCEL..." spinning={loading} /> */}
          {isAtRoot && (
            <div className="">
              <Select
                value={selectedOcel}
                onValueChange={(v) => {
                  setSelectedOcel(v);
                }}
              >
                <SelectTrigger className={"w-[180px] mx-auto my-2"}>
                  <SelectValue placeholder="Select an OCEL" />
                </SelectTrigger>
                <SelectContent>
                  {availableOcels.map((ocelName) => (
                    <SelectItem key={ocelName} value={ocelName}>
                      {ocelName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                disabled={loading || selectedOcel === undefined}
                size="default"
                onClick={async () => {
                  setLoading(true);
                  await toast
                    .promise(loadOcel(), {
                      loading: "Loading OCEL...",
                      success: "Loaded OCEL",
                      error: "Failed to load OCEL",
                    })
                    .finally(() => {
                      setLoading(false);
                    });
                }}
              >
                {loading && <Spinner />}
                <span>Open JSON OCEL</span>
              </Button>
            </div>
          )}
          <div className="w-full h-full">
            <Outlet />
          </div>
        </div>
      </div>
    </OcelInfoContext.Provider>
  );
}

export default App;
