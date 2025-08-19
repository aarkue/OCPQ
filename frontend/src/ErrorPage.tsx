import { Link, useRouteError } from "react-router-dom";
import { LightningBoltIcon } from "@radix-ui/react-icons";
import { buttonVariants } from "./components/ui/button";
export default function ErrorPage() {
  const error: { statusText?: string; message?: string } | undefined =
    useRouteError() as any;

  return (
    <div
      id="error-page"
      className="mx-auto w-fit flex flex-col h-screen items-center justify-center"
    >
      <div>
        <LightningBoltIcon className="mx-auto my-2 text-orange-400 w-12 h-12" />
        <h1 className="text-5xl">Error</h1>
        <p className="text-3xl">Sorry about that!</p>
        <p className="text-center text-xl">
          <i>{error?.statusText ?? error?.message}</i>
        </p>
        <div className="mx-auto text-center mt-4">
          <Link className={buttonVariants({ variant: "outline" })} to="/">
            Back to Root
          </Link>
        </div>
      </div>
    </div>
  );
}
