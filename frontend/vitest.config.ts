import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

/**
 * Extends the app's Vite config instead of restating it, so tests resolve deps (React, aliases)
 * the same way the app does.
 */
export default mergeConfig(
	viteConfig,
	defineConfig({
		test: {
			include: ["src/**/*.test.{ts,tsx}", "src/**/*.test.mjs"],
			// `node`, not `jsdom`: everything under test today is pure logic; a component test would
			// opt into an environment per-file via `// @vitest-environment jsdom`.
			environment: "node",
		},
	}),
);
