export const COLORS = ["#d544c0", "#dea921", "#7140cb", "#dd4536", "#67c341"];

const VARIABLE_COLORS = {
	// https://colordesigner.io/color-scheme-builder?mode=lch#0067A6-FA9805-CE2727-00851D-A90A76-E0F20D-e9488f-0481cc-16cc9d-080999
	object: [
		"#0067A6",
		"#FA9805",
		"#CE2727",
		"#00851D",
		"#A90A76",
		"#E0F20D",
		"#e9488f",
		"#0481cc",
		"#16cc9d",
		"#080999",
	],
	event: ["#01425e", "#53077f", "#db11c3", "#b76b00", "#506b01", "#aa082b", "#006289", "#758406"],
} as const;

/** Display name and color of a query variable. Names count from 1, so object variable 0 is `o1`. */
export function variableDisplay(variable: number, type: "object" | "event") {
	return {
		name: type.substring(0, 1) + (variable + 1),
		color: VARIABLE_COLORS[type][variable % VARIABLE_COLORS[type].length],
	};
}
