import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    watch: {
      ignored: ["**/*.bck"],
    },
    // Allow importing source files from the sibling propel checkout, for when @r4pm/components is
    // temporarily link:ed to it instead of installed from npm.
    fs: { allow: [path.resolve(__dirname, "."), path.resolve(__dirname, "../../propel")] },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    // React + xyflow hold React context singletons; a second copy breaks hooks/provider lookup.
    dedupe: ["react", "react-dom", "@xyflow/react"],
  },
});
