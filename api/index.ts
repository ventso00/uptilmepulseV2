import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Express } from "express";

/**
 * Vercel serverless entry point.
 *
 * The backend cannot be imported with a static specifier: only `api/` is
 * traced into the lambda, so `../backend/_core/index` would be missing at
 * runtime. The build bundles it as `dist/serverless.mjs` (see
 * `scripts/build-serverless.mjs`) and `vercel.json` ships that single file
 * next to the handler via `includeFiles`.
 *
 * The client assets are served by the platform's CDN from `dist/public`, which
 * is why the app is created with `serveClient: false`: static files never
 * reach this function.
 */
process.env.UPTIMEPULSE_SERVERLESS = "1";

const bundlePath = path.join(
  process.env.LAMBDA_TASK_ROOT || process.cwd(),
  "dist",
  "serverless.mjs"
);

let appPromise: Promise<Express> | undefined;

async function getApp() {
  if (!appPromise) {
    appPromise = import(pathToFileURL(bundlePath).href).then(mod =>
      mod.createApp({ serveClient: false })
    );
  }
  return appPromise;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
) {
  const app = await getApp();
  return app(req, res);
}
