import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  entryPoints: ["backend/_core/index.ts"],
  tsconfig: "tsconfig.json",
  logLevel: "info",
};

// The Docker image installs node_modules, so its entry can keep dependencies
// external. A Vercel lambda is traced from the handler file only, and the
// backend is not inside api/, so that target must be self-contained.
await build({ ...common, outfile: "dist/index.js", packages: "external" });
await build({
  ...common,
  outfile: "dist/serverless.mjs",
  // backend/_core/vite.ts reaches "vite" through a dynamic import that only
  // runs in development. Bundling it would drag Vite's native optional
  // dependencies (lightningcss, @tailwindcss/oxide) into the lambda.
  external: ["vite"],
  // A single ESM file cannot `require` the CommonJS dependencies esbuild
  // inlined, so the bundle gets a node-module-backed require of its own.
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module";const require = __createRequire(import.meta.url);',
  },
});
