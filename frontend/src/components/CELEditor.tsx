/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-template-curly-in-string */
import { VisualEditorContext } from "@/routes/visual-editor/helper/VisualEditorContext";
import type { Variable } from "@/types/generated/Variable";
import { useMonaco, Editor } from "@monaco-editor/react";
import { useContext, useEffect, useMemo } from "react";

export default function CELEditor({
  cel,
  onChange,
  availableEventVars,
  availableObjectVars,
  nodeID,
}: {
  cel?: string;
  onChange?: (newCel: string | undefined) => unknown;
  availableEventVars: number[];
  availableObjectVars: number[];
  nodeID: string;
}) {
  const monaco = useMonaco();
  const varSymbols = useMemo(() => {
    return [
      ...availableObjectVars.map((ov) => "o" + (ov + 1)),
      ...availableEventVars.map((ev) => "e" + (ev + 1)),
    ];
  }, [availableEventVars, availableObjectVars]);

  const { getTypesForVariable, getVarName } = useContext(VisualEditorContext);
  const specialFunctions = [
    {
      name: "attr",
      for_type: ["object", "event"],
      insertTemplate: "attr(${1:attr_name})",
      signatureLabel: "value attr(attr_name: string)",
      parameters: [
        {
          label: "attr_name: string",
          documentation: "The name of the attribute.",
        },
      ],
      description:
        "**attr**\n\nRetrieve an object/event attribute value.\n\nExample:\n`o1.attr('price') >= 100`<br/><br/>For objects the first encountered attribute value is picked, regardless of the associated timestamp. Use `attrAt` to retrieve the attribute value of an object at a specific timestamp. ",
    },
    {
      name: "attrs",
      for_type: ["object", "event"],
      insertTemplate: "attrs()",
      description:
        "**attrs**\n\nRetrieves all attributes of an event or object. Returns a list containing all attributes represented as lists of size 3: name, value, timestamp. The timestamp is only present for object attributes, otherwise it is set to `null`.\n\nExamples:\n`e1.attrs() == [['resource',1000.0,null]]`<br/>`o1.attrs().filter(x,x[0] == 'price').all(x,x[1] >= 100)`",
    },
    {
      name: "attrAt",
      for_type: ["object"],
      insertTemplate: "attrAt(${1:attr_name},${2:at_time})",

      signatureLabel: "value attrAt(attr_name: string,at_time: timestamp)",
      parameters: [
        {
          label: "attr_name: string",
          documentation: "The name of the attribute.",
        },
        {
          label: "at_time: timestamp",
          documentation:
            "The timestamp on which to retrieve the current attribute value.",
        },
      ],
      description:
        "**attrAt**\n\nRetrieve an *object* attribute value.\n\nExamples:\n`o1.attr('price',e1.time()) >= 100`,\n\n`o1.attr('price',timestamp('2024-01-01T12:30:00+00:00')) >= 50.0`<br/><br/>The latest recorded attribute value before or at the specified timestamp is selected.<br/>See `attr` for also retrieving attributes of events.",
    },
    {
      name: "time",
      for_type: ["event"],
      insertTemplate: "time()",
      description:
        "**time**\n\nRetrieve the **timestamp of an event**.\n\nExample:\n`e2.time() - e1.time() <= duration('24h')`",
    },
    {
      name: "type",
      for_type: ["object", "event"],
      insertTemplate: "type()",
      description:
        "**type**\n\nRetrieve the **type of an object/event**\n\nExample:\n`o1.type() == 'orders'`",
    },
  ];

  const standardFunctions = [
    {
      name: "contains",
      for_type: ["value"],
      insertTemplate: "contains(${1:arg})",
      signatureLabel: "bool contains(arg: value)",
      parameters: [
        {
          label: "arg: value",
          documentation: "The value to look for.",
        },
      ],
      description:
        "**contains**\n\nReturns if a string, list or map contains the provided value as a substring/element/key.\n\nExamples:<br/>`'test123'.contains('test') == true`<br/>`['test123','test456','test789'].contains('test456') == true`",
    },
    {
      name: "string",
      for_type: ["standalone"],
      insertTemplate: "string(${1:arg})",
      signatureLabel: "string string(arg: value)",
      parameters: [
        {
          label: "arg: value",
          documentation: "The value to convert to string.",
        },
      ],
      description:
        "**string** (type conversion)\n\nConverts a value into a string.\n\nExamples:<br/>`string(4.0) == '4'`<br/>`string(4.50) == '4.5'`<br/>`string(e1.time()) == '2023-04-04T14:09:41+00:00'`",
    },
    {
      name: "double",
      for_type: ["standalone"],
      insertTemplate: "double(${1:arg})",
      signatureLabel: "double double(arg: value)",
      parameters: [
        {
          label: "arg: value",
          documentation: "The value to convert to double.",
        },
      ],
      description:
        "**double** (type conversion)\n\nConverts a value into a double (i.e., floating point number).\n\nExamples:<br/>`double('4') == 4.0`<br/>`double('4.50') == 4.5`<br/>`double(4) == 4.0`",
    },
    {
      name: "int",
      for_type: ["standalone"],
      insertTemplate: "int(${1:arg})",
      signatureLabel: "int int(arg: value)",
      parameters: [
        {
          label: "arg: value",
          documentation: "The value to convert to int.",
        },
      ],
      description:
        "**int** (type conversion)\n\nConverts a value into a int (i.e., integer number). The argument is floored (i.e., rounded down towards zero), if necessary.\n\nExamples:<br/>`int('4') == 4.0`<br/>`int(4.50) == 4`<br/>`int(1.8) == 1`",
    },
    {
      name: "duration",
      for_type: ["standalone"],
      insertTemplate: "duration(${1:arg})",
      signatureLabel: "duration duration(arg: string)",
      parameters: [
        {
          label: "arg: string",
          documentation: "The value to convert to a duration.",
        },
      ],
      description:
        "**duration** (type conversion)\n\nParses a duration from a given string. As units, combinations of `h` (hour), `m` (minute), `s` (seconds) are supported.\n\nExamples:<br/>`duration('80s') <= duration('1m30s')`<br/>`duration('12h45m30s') <= duration('13h')`",
    },
    {
      name: "timestamp",
      for_type: ["standalone"],
      insertTemplate: "timestamp(${1:arg})",
      signatureLabel: "timestamp timestamp(arg: string)",
      parameters: [
        {
          label: "arg: string",
          documentation: "The value to convert to a timestamp.",
        },
      ],
      description:
        "**timestamp** (type conversion)\n\nParses a timestamp from a given string. The string must be in RFC3339 format.\n\nExamples:<br/>`timestamp('2024-01-01T12:30:00+00:00') <= timestamp('2024-01-02T12:30:00+00:00')`<br/>`e1.time() >= timestamp('2024-01-01T15:30:00+00:00')`",
    },
    {
      name: "startsWith",
      for_type: ["value"],
      insertTemplate: "startsWith(${1:arg})",
      signatureLabel: "bool startsWith(arg: string)",
      parameters: [
        {
          label: "arg: string",
          documentation: "The string to test if is a prefix.",
        },
      ],
      description:
        "**startsWith**\n\nChecks if a string starts with a given prefix.\n\nExamples:<br/>`'abc'.startsWith('a') == true`<br/>`'abc'.startsWith('ac') == false`",
    },
    {
      name: "endsWith",
      for_type: ["value"],
      insertTemplate: "endsWith(${1:arg})",
      signatureLabel: "bool endsWith(arg: string)",
      parameters: [
        {
          label: "arg: string",
          documentation: "The string to test if is a postfix.",
        },
      ],
      description:
        "**endsWith**\n\nChecks if a string ends with a given postfix.\n\nExamples:<br/>`'abc'.endsWith('c') == true`<br/>`'abc'.endsWith('cb') == false`",
    },
    {
      name: "matches",
      for_type: ["value"],
      insertTemplate: "matches(${1:arg})",
      signatureLabel: "bool  (regex: string)",
      parameters: [
        {
          label: "regex: string",
          documentation: "The regex to test for matches.",
        },
      ],
      description:
        "**matches**\n\nTest if a string matches a regular expression.\n\nExamples:<br/>`'abcd'.matches('abc?') == true`<br/>`'^abc$'.matches('abcd') == false`",
    },
    {
      name: "has",
      for_type: ["standalone"],
      insertTemplate: "has(${1:property})",
      signatureLabel: "bool  (property: value)",
      parameters: [
        {
          label: "property: value",
          documentation: "The property to check for.",
        },
      ],
      description:
        "**has**\n\nChecks if the argument function can be resolved.\n\nExamples:<br/>`has(o1.attr) == true`<br/>`has(o1.nonExistingFunc) == false`",
    },
    {
      name: "map",
      for_type: ["value"],
      insertTemplate: "map(${1:x}, ${2:2*x})",
      signatureLabel: "list  (variable: identifier, expr: expression)",
      parameters: [
        {
          label: "variable: identifier",
          documentation:
            "The variable identifier running through the list. For instance, `x` or `i`.",
        },
        {
          label: "expr: expression",
          documentation:
            "The expression on which to map this entry. For instance, `2 * x`.",
        },
      ],
      description:
        "**map**\n\nMaps entries of a list according to the provided expression, producing a new list.\n\nExamples:<br/>`[1,2,3].map(x, 2*x) == [2,4,6]`",
    },
    {
      name: "filter",
      for_type: ["value"],
      insertTemplate: "filter(${1:x}, ${2:x>=3})",
      signatureLabel: "list  (variable: identifier, expr: expression)",
      parameters: [
        {
          label: "variable: identifier",
          documentation:
            "The variable identifier running through the list. For instance, `x` or `i`.",
        },
        {
          label: "expr: expression",
          documentation:
            "The filter expression which determines if a list item is retained. For instance, `x >= 3`.",
        },
      ],
      description:
        "**filter**\n\nFilters entries of a list according to the provided filter expression, producing a new list.\n\nExamples:<br/>`[1,2,3,4].filter(x, x>=3) == [3,4]`",
    },
    {
      name: "all",
      for_type: ["value"],
      insertTemplate: "all(${1:x}, ${2:x>=3})",
      signatureLabel: "bool  (variable: identifier, expr: expression)",
      parameters: [
        {
          label: "variable: identifier",
          documentation:
            "The variable identifier running through the list. For instance, `x` or `i`.",
        },
        {
          label: "expr: expression",
          documentation:
            "The filter expression which determines if a list item is satisfied. For instance, `x >= 3`.",
        },
      ],
      description:
        "**all**\n\nReturns if **all** entries of the list satisfy the filter expression.\n\nExamples:<br/>`[3,4,5].all(x, x>=3) == true`",
    },
    {
      name: "exists",
      for_type: ["value"],
      insertTemplate: "exists(${1:x}, ${2:x>=5})",
      signatureLabel: "bool  (variable: identifier, expr: expression)",
      parameters: [
        {
          label: "variable: identifier",
          documentation:
            "The variable identifier running through the list. For instance, `x` or `i`.",
        },
        {
          label: "expr: expression",
          documentation:
            "The filter expression which determines if a list item is satisfied. For instance, `x >= 3`.",
        },
      ],
      description:
        "**exists**\n\nReturns if **at least one** entry of the list satisfies the filter expression.\n\nExamples:<br/>`[3,4,5].exists(x, x>=5) == true`",
    },
    // exists_one skipped
    {
      name: "max",
      for_type: ["standalone"],
      insertTemplate: "max(${1:arg}, [... ${2:arg2}])",
      signatureLabel: "bool (arg1: value|list, ...args: value)",
      parameters: [
        {
          label: "arg1: value|list",
          documentation: "Either a single value or list of values.",
        },
        {
          label: "...args: value",
          documentation:
            "If arg1 is a single value, args are the other passed values.",
        },
      ],
      description:
        "**max**\n\nReturns the maximum value of either all provided arguments or, if the first argument is a list, the maximum value in this list.\n\nExamples:<br/>`max([3,4,5]) == 5`<br/>`max(3,4,5) == 5`",
    },
  ];
  useEffect(() => {
    if (monaco == null) {
      return;
    }
    const dispos: { dispose: () => unknown }[] = [];
    const specialSymbols = varSymbols.map(
      (s) => [s, "constant"] as [string, string],
    );
    monaco.languages.register({ id: "cel" });

    // Register a tokens provider for the language
    monaco.languages.setMonarchTokensProvider("cel", {
      defaultToken: "invalid",
      customFunctions: specialFunctions.map((s) => s.name),
      standardFunctions: standardFunctions.map((s) => s.name),
      keywords: ["true", "false", "null"],

      operators: [
        "&&",
        "||",
        "<=",
        "<",
        ">=",
        ">",
        "==",
        "!=",
        "in",
        "+",
        "-",
        "*",
        "/",
        "%",
        "!",
      ],

      symbols: /[=><!~?:&|+\-*/^%]+/,

      escapes:
        /\\(?:[bfnrt"\\'\\]|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|x[0-9A-Fa-f]{2}|0[0-8]{3})/,

      tokenizer: {
        root: [
          // Reserved identifiers (illegal in CEL)
          [
            /(\b(as|break|const|continue|else|for|function|if|import|let|loop|package|namespace|return|var|void|while)\b)/,
            "invalid",
          ],

          // Custom :)
          ...specialSymbols,
          [
            /[a-z_$][\w$]*/,
            {
              cases: {
                "@customFunctions": "keyword.function.custom",
                "@standardFunctions": "keyword.function",
                "@keywords": "constant",
                "@default": "identifier",
              },
            },
          ],

          // // Function calls
          // [/[a-zA-Z_]\w*(?=\()/, "function"],
          // ...specialFunctionNames,

          // Object construction
          [
            /[a-zA-Z_]\w*\s*(\{)/,
            [
              "variable.object",
              {
                token: "punctuation.definition.object.begin",
                bracket: "@open",
              },
            ],
          ],

          // Operators
          [
            /@symbols/,
            { cases: { "@operators": "keyword.operator", "@default": "" } },
          ],

          // Numbers
          [/\d*\.\d+([eE][-+]?\d+)?/, "number.float"],
          [/\d+[eE][-+]?\d+/, "number.float"],
          [/\d+|0x[0-9a-fA-F]+[uU]?/, "number"],

          // Strings (single-line)
          [
            /r?("|')/,
            { token: "string.quote", bracket: "@open", next: "@string" },
          ],
          // Strings (multi-line)
          [
            /r?("""|''')/,
            { token: "string.quote", bracket: "@open", next: "@multiString" },
          ],

          // Lists
          [
            /\[/,
            {
              token: "punctuation.definition.list.begin",
              bracket: "@open",
              next: "@list",
            },
          ],

          // Maps
          [
            /\{/,
            {
              token: "punctuation.definition.map.begin",
              bracket: "@open",
              next: "@map",
            },
          ],

          // Parentheses
          [
            /\(/,
            {
              token: "punctuation.parenthesis.begin",
              bracket: "@open",
              next: "@paren",
            },
          ],

          // Comments
          [/\/\/.*$/, "comment"],
        ],

        string: [
          [/[^\\'"]+/, "string"],
          [/@escapes/, "string.escape"],
          [/\\./, "string.escape.invalid"],
          [/['"]/, { token: "string.quote", bracket: "@close", next: "@pop" }],
        ],

        multiString: [
          [/[^\\'"]+/, "string"],
          [/@escapes/, "string.escape"],
          [/\\./, "string.escape.invalid"],
          [
            /("""|''')/,
            { token: "string.quote", bracket: "@close", next: "@pop" },
          ],
        ],

        list: [
          { include: "root" },
          [/,/, "punctuation.separator.list"],
          [
            /\]/,
            {
              token: "punctuation.definition.list.end",
              bracket: "@close",
              next: "@pop",
            },
          ],
        ],

        map: [
          { include: "root" },
          [/,/, "punctuation.separator.map"],
          [/:/, "punctuation.separator.map"],
          [
            /\}/,
            {
              token: "punctuation.definition.map.end",
              bracket: "@close",
              next: "@pop",
            },
          ],
        ],

        paren: [
          { include: "root" },
          [
            /\)/,
            {
              token: "punctuation.parenthesis.end",
              bracket: "@close",
              next: "@pop",
            },
          ],
        ],
      },
    });
    dispos.push(
      monaco.languages.registerCompletionItemProvider("cel", {
        provideCompletionItems: (_model, _position) => {
          console.log(varSymbols);
          return {
            suggestions: [
              ...varSymbols.map((s) => ({
                label: s,
                insertText: s,
                filterText: s,
                detail: s.startsWith("o")
                  ? "Object Variable"
                  : "Event Variable",
                range: null as any,
                kind: monaco.languages.CompletionItemKind.Variable, // CompletionItemKind Variable
              })),
              ...standardFunctions
                .filter((s) => s.for_type.includes("standalone"))
                .map((s) => ({
                  // TODO: editor.action.triggerParameterHints
                  label: s.name,
                  insertText: s.insertTemplate ?? s.name,
                  filterText: s.name,
                  detail: s.description,
                  range: null as any,
                  kind: monaco.languages.CompletionItemKind.Function, // CompletionItemKind Function
                  insertTextRules:
                    monaco.languages.CompletionItemInsertTextRule
                      .InsertAsSnippet,
                })),
            ],
          };
        },
      }),
    );
    dispos.push(
      monaco.languages.registerSignatureHelpProvider("cel", {
        signatureHelpTriggerCharacters: ["(", ","],
        signatureHelpRetriggerCharacters: [")"],
        provideSignatureHelp: (model, pos, _token) => {
          const prev = model.getValueInRange({
            startLineNumber: pos.lineNumber,
            endLineNumber: pos.lineNumber,
            startColumn: 0,
            endColumn: pos.column,
          });
          let open = 0;
          let close = 0;
          let i = prev.length - 1;
          let paraPos = 0;
          let buf = "";

          while (i >= 0) {
            const c = prev.charAt(i);
            if (c === "(") {
              open++;
              buf = "";
              // paraPosPrev = paraPos;
              // paraPos = 0;
            } else if (c === ")") {
              close++;
              buf = "";
            } else if (c === " " || c === "," || c === ".") {
              if (c === "," && close <= open) {
                paraPos++;
              }
              if (open > close && buf.length > 0) {
                console.log("Bling Bling", buf, paraPos);
                break;
              }
              buf = "";
            } else {
              buf = c + buf;
            }
            i--;
          }
          const sf =
            specialFunctions.find((sf) => sf.name === buf) ??
            standardFunctions.find((sf) => sf.name === buf);
          console.log("signature help", prev, sf);
          if (sf == null) {
            return {
              value: { signatures: [], activeParameter: 0, activeSignature: 0 },
              dispose: () => {},
            };
          }

          return {
            value: {
              signatures: [
                {
                  label: sf.signatureLabel ?? sf.name,
                  parameters: sf.parameters ?? [],
                },
              ],
              activeParameter: Math.min(
                paraPos,
                (sf.parameters?.length ?? 0) - 1,
              ),
              activeSignature: 0,
            },
            dispose: () => {},
          };
        },
      }),
    );
    dispos.push(
      monaco.languages.registerCompletionItemProvider("cel", {
        triggerCharacters: ["."],
        provideCompletionItems: (model, position) => {
          const word =
            model.getWordAtPosition(position.delta(0, -1))?.word ?? "";
          const lastChar =
            model.getValueInRange({
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: position.column - 1,
              endColumn: position.column,
            }) ?? "";
          const prevToLastChar =
            model.getValueInRange({
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: position.column - 2,
              endColumn: position.column - 1,
            }) ?? "";
          if (varSymbols.includes(word) && lastChar === ".") {
            const wordType = word.startsWith("o") ? "object" : "event";
            return {
              suggestions: specialFunctions
                .filter((s) => s.for_type.includes(wordType))
                .map((s) => ({
                  label: s.name,
                  insertText: s.insertTemplate ?? s.name,
                  filterText: s.name,
                  detail: s.description,
                  range: null as any,
                  kind: monaco.languages.CompletionItemKind.Function, // CompletionItemKind Function
                  insertTextRules:
                    monaco.languages.CompletionItemInsertTextRule
                      .InsertAsSnippet,
                })),
            };
          } else if (prevToLastChar !== "" && lastChar === ".") {
            return {
              suggestions: standardFunctions
                .filter((s) => s.for_type.includes("value"))
                .map((s) => ({
                  label: s.name,
                  insertText: s.insertTemplate ?? s.name,
                  filterText: s.name,
                  detail: s.description,
                  range: null as any,
                  kind: monaco.languages.CompletionItemKind.Function, // CompletionItemKind Function
                  insertTextRules:
                    monaco.languages.CompletionItemInsertTextRule
                      .InsertAsSnippet,
                })),
            };
          }
        },
      }),
    );

    dispos.push(
      monaco.languages.registerHoverProvider("cel", {
        provideHover: (model, position, _token) => {
          const word = model.getWordAtPosition(position)?.word ?? "";
          if (varSymbols.includes(word)) {
            const variableIndex = parseInt(word.substring(1)) - 1;
            const variable: Variable = word.startsWith("o")
              ? { Object: variableIndex }
              : { Event: variableIndex };
            const { color } = getVarName(
              variableIndex,
              "Object" in variable ? "object" : "event",
            );
            const hintText = `<span style="color:${color};">**${word}**</span>: ${
              "Object" in variable ? "**Object" : "**Event"
            } Variable**\n\nAllowed Types: ${getTypesForVariable(
              nodeID,
              variableIndex,
              "Object" in variable ? "object" : "event",
            )
              .map((ot) => ot.name)
              .join(", ")}`;
            return {
              contents: [{ value: hintText, supportHtml: true }],
            };
          } else if (specialFunctions.find((s) => s.name === word) != null) {
            const sf = specialFunctions.find((s) => s.name === word)!;
            return { contents: [{ value: sf.description, supportHtml: true }] };
          } else if (standardFunctions.find((s) => s.name === word) != null) {
            const sf = standardFunctions.find((s) => s.name === word)!;
            return { contents: [{ value: sf.description, supportHtml: true }] };
          }
        },
      }),
    );
    return () => {
      dispos.forEach((d) => d.dispose());
    };
  }, [monaco]);

  return (
    <Editor
      value={cel}
      language="cel"
      onChange={onChange}
      className="min-h-[10rem] border rounded"
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
