import { useState } from "react";
import toast from "react-hot-toast";
import { LuClipboardCheck, LuClipboardCopy } from "react-icons/lu";
import { Button } from "./ui/button";

export function ClipboardButton({ name, value, hideValueInToast }: { name: string, value: string, hideValueInToast?: boolean }) {
  const [showConfirmation, setShowConfirmation] = useState(false);
  return <Button className="h-7" variant="ghost" size="icon" title="Copy to clipboard" onClick={() => {
    navigator.clipboard.writeText(value);
    if (!hideValueInToast) {
      toast.success(`Copied ${name}\n'${value.substring(0, 32)}${value.length > 32 ? '...' : ''}'`, { id: "clipboard-copy" });
    } else {
      toast.success(`Copied ${name}`, { id: "clipboard-copy" });
    }
    setShowConfirmation(true);
    setTimeout(() => setShowConfirmation(false), 400);
  }}>
    {
      showConfirmation && <LuClipboardCheck className="text-green-600" />
    }
    {!showConfirmation
      &&
      <LuClipboardCopy />
    }
  </Button>
}
