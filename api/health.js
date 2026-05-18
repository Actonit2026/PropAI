export const config = { runtime: "edge" };

export default async function handler(req) {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  return new Response(
    JSON.stringify({
      ok: true,
      service: "prop-ai",
      ts: new Date().toISOString(),
      commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
      env: process.env.VERCEL_ENV || "unknown"
    }),
    { status: 200, headers }
  );
}
