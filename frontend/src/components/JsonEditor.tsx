import { Editor } from "@monaco-editor/react";
import { initEditorLoader } from "@/lib/editor-loader";

initEditorLoader();
export default function JSONEditor({
	value,
	onChange,
	readonly,
}: {
	value: string;
	onChange: (newValue: string | undefined) => unknown;
	readonly?: boolean;
}) {
	return (
		<Editor
			key={(readonly ?? false) ? "readonly" : "writeable"}
			value={value}
			language="json"
			onChange={onChange}
			className="h-full max-h-[50vh] w-full border rounded"
			onMount={(editor) => {
				editor.updateOptions({
					fontSize: 16,
					theme: "vs-light",
					glyphMargin: false,
					folding: true,
					lineNumbers: "on",
					lineDecorationsWidth: 2,
					lineNumbersMinChars: 2,
					minimap: { enabled: false },
					overviewRulerLanes: 0,
					readOnly: true,
					scrollbar: {
						vertical: "visible",
						horizontal: "hidden",
						handleMouseWheel: true,
					},
					wordWrap: "on",
				});
			}}
		/>
	);
}
