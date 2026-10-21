import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public")
      : path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  app.use(express.static(distPath));

  // Client-side routing needs a deep link like /monitors/12 to serve the SPA
  // shell, but a request for a missing asset must 404: answering HTML for a
  // script request makes the browser fail with a MIME type error instead of a
  // clear 404, and it hides genuinely missing files.
  //
  // Mounted without a path on purpose. `app.use("*", ...)` treats the argument
  // as a route pattern rather than a prefix, so `req.path` arrives as "/" and the
  // extension check below never sees the requested filename.
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/") || path.extname(req.path)) {
      return next();
    }
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
