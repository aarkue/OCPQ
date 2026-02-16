import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

export function initEditorLoader() {
	loader.config({ monaco });
	void loader.init().then(/* ... */);
}
