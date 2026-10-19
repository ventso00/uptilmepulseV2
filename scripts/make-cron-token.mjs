// Local-only helper: mints the JWT that the scheduler endpoint expects, so the
// check pipeline can be exercised without the Manus runtime. Not part of the
// application; the real scheduler is registered by server/scheduler/register.ts.
import { SignJWT } from "jose";

const secret = process.env.MANUS_JWT_SECRET;
const appId = process.env.MANUS_PROJECT_ID;
if (!secret || !appId) {
  console.error("MANUS_JWT_SECRET and MANUS_PROJECT_ID are required");
  process.exit(1);
}

const token = await new SignJWT({ appId, openId: "cron_local_dev" })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("1h")
  .sign(new TextEncoder().encode(secret));

console.log(token);
