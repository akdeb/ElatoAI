import type { Env } from "./types";

export { ElatoOpenAiVoiceAgent } from "../models/openai";

function sessionNameFromRequest(request: Request): string {
  const url = new URL(request.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  return pathParts[2] || url.searchParams.get("session") || "default";
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      return Response.json({ ok: true, backend: "cloudflare-voice" });
    }

    if (url.pathname === "/ws/esp32" || url.pathname.startsWith("/ws/esp32/")) {
      /* Add AUTH here */

      const stub = env.ElatoOpenAiVoiceAgent.get(
        env.ElatoOpenAiVoiceAgent.idFromName(sessionNameFromRequest(request)),
      );
      return stub.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
};
