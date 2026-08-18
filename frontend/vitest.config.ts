import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

/**
 * Extends the app's Vite config rather than restating part of it.
 *
 * A second standalone config drifts: this one repeated the `@` alias but dropped the `react` and
 * `tailwindcss` plugins and the `dedupe` list, so a test importing a component would resolve React
 * differently than the app does -- the exact class of difference that makes a test pass while the
 * app is broken, or the reverse.
 */
export default mergeConfig(
	viteConfig,
	defineConfig({
		test: {
			include: ["src/**/*.test.{ts,tsx}", "src/**/*.test.mjs"],
			// `node`, not `jsdom`: everything under test today is pure logic (binding transport, the
			// table writers, the storage helpers). A component test will need to opt into an
			// environment, per file, via a `// @vitest-environment jsdom` docblock.
			environment: "node",
		},
	}),
);
