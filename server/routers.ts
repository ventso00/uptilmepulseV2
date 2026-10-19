import { systemRouter } from "./_core/systemRouter";
import { router } from "./_core/trpc";

/**
 * The application surface is REST (see the server route modules).
 * tRPC is kept only for the platform health probe, which the runtime calls.
 */
export const appRouter = router({
  system: systemRouter,
});

export type AppRouter = typeof appRouter;
