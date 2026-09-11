import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    reactRouter(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
  /**
   * The SSR pass externalizes node_modules by default, which loads a second
   * copy of React next to the pre-bundled one — every hook then fails with
   * "Invalid hook call … more than one copy of React". Keep the React-based UI
   * libraries inside the SSR graph so there is only ever one React.
   */
  ssr: {
    noExternal: ["lucide-react", "framer-motion", "@convex-dev/auth", "convex"],
  },
});
