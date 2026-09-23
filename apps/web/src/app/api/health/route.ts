import { isRedisConfigured } from "@/lib/server/store/redis-store";

export async function GET() {
  return Response.json({
    status: "ok",
    service: "web",
    // Which LeadStore/CallSessionStore/SalesInquiryStore backend is
    // active — see apps/web/src/lib/server/store/index.ts. "memory" is
    // NOT safe on Vercel (state doesn't survive across serverless
    // invocations); "redis" requires UPSTASH_REDIS_REST_URL/
    // UPSTASH_REDIS_REST_TOKEN to be set.
    store: isRedisConfigured() ? "redis" : "memory",
  });
}
