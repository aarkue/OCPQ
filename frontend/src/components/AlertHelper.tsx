import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useState } from "react";
import Spinner from "./Spinner";

type AlertHelperProps<T> =
  | {
      mode?: "normal";
      trigger: React.ReactNode;
      title: React.ReactNode;
      initialData: T;
      content: React.FC<{
        data: T;
        setData: (data: T) => unknown;
        close: () => unknown;
      }>;
      submitAction?: React.ReactNode | undefined;
      onCancel?: () => unknown;
      onSubmit: (
        data: T,
        ev: React.MouseEvent<HTMLButtonElement, MouseEvent>,
      ) => unknown;
    }
  | {
      mode: "promise";
      trigger: React.ReactNode;
      title: React.ReactNode;
      initialData: T;
      content: React.FC<{
        data: T;
        setData: (data: T) => unknown;
        close: () => unknown;
      }>;
      submitAction?: React.ReactNode | undefined;
      onCancel?: () => unknown;
      onSubmit: (
        data: T,
        ev: React.MouseEvent<HTMLButtonElement, MouseEvent>,
      ) => Promise<unknown>;
    };

export default function AlertHelper<T>(props: AlertHelperProps<T>) {
  const [data, setData] = useState<T>(props.initialData);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o && props.onCancel != null) {
          props.onCancel();
        }
        setData(props.initialData);
      }}
    >
      <AlertDialogTrigger asChild>{props.trigger}</AlertDialogTrigger>
      <AlertDialogContent className="flex flex-col max-h-full justify-between">
        <AlertDialogHeader>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
        </AlertDialogHeader>
        <div className="text-sm text-gray-700 max-h-full overflow-auto px-2">
          <props.content
            data={data}
            setData={setData}
            close={() => setOpen(false)}
          />
        </div>
        <AlertDialogFooter className="!justify-between">
          <AlertDialogCancel className="!mr-full !ml-0">
            Cancel
          </AlertDialogCancel>
          {props.submitAction !== undefined && (
            <AlertDialogAction
              disabled={loading}
              onClick={(ev) => {
                if (props.mode === "promise") {
                  ev.preventDefault();
                  setLoading(true);
                  void props
                    .onSubmit(data, ev)
                    .then(() => {
                      setLoading(false);
                      setOpen(false);
                    })
                    .finally(() => {
                      setLoading(false);
                    });
                } else {
                  props.onSubmit(data, ev);
                }
              }}
            >
              {loading && <Spinner />}
              {props.submitAction}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
