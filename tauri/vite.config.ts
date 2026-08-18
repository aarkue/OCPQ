import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  server: {
    port: 4565,
    fs: {
      // Allow the sibling propel checkout too, for when @r4pm/components is temporarily link:ed
      // to it instead of installed from npm.
      allow: [".", "../frontend", path.resolve(__dirname, "../../propel")]
    }
  },
  // build: {
  //   sourcemap: true,
  // },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "$": path.resolve(__dirname, "../frontend/src"),
      "@": path.resolve(__dirname, "../frontend/src"),
    },
    // React + xyflow hold React context singletons; a second copy breaks hooks/provider lookup.
    dedupe: ["react", "react-dom", "@xyflow/react"],
  },
});
