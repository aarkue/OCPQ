import { useState } from "react";
import { Button } from "./ui/button";
import toast from "react-hot-toast";
import { LuClipboardCheck, LuClipboardCopy } from "react-icons/lu";

export function ClipboardButton({ name, value }: { name: string, value: string }) {
  const [showConfirmation, setShowConfirmation] = useState(false);
  return <Button className="h-7" variant="ghost" size="icon" title="Copy to clipboard" onClick={() => {
    navigator.clipboard.writeText(value);
    toast.success(`Copied ${name}\n'${value.substring(0, 32)}${value.length > 32 ? '...' : ''}'`, { id: "clipboard-copy" });
    setShowConfirmation(true);
    setTimeout(() => setShowConfirmation(false), 400);
  }}>
    {
      showConfirmation && <LuClipboardCheck className="text-green-600"/>
    }
    {!showConfirmation
      &&
      <LuClipboardCopy />
    }
  </Button>
}
