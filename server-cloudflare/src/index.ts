import { routeAgentRequest } from "agents";

import { requireAuthorizedRequest } from "./auth";
import type { Env } from "./types";

export { ElatoOpenAiVoiceAgent } from "../models/openai";

function rewriteOpenAIRequest(request: Request): Request {
  const originalUrl = new URL(request.url);
  const pathParts = originalUrl.pathname.split("/").filter(Boolean);
  const sessionName = pathParts[2] || originalUrl.searchParams.get("session") || "default";

  originalUrl.pathname = `/agents/elato-open-ai-voice-agent/${encodeURIComponent(sessionName)}`;
  return new Request(originalUrl.toString(), request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      return Response.json({ ok: true, backend: "cloudflare-voice" });
    }

    let routedRequest = request;
    if (url.pathname === "/ws/openai" || url.pathname.startsWith("/ws/openai/")) {
      routedRequest = rewriteOpenAIRequest(request);
    }

    return (
      (await routeAgentRequest(routedRequest, env, {
        cors: true,
        onBeforeConnect: async (incomingRequest) =>
          requireAuthorizedRequest(incomingRequest, env),
        onBeforeRequest: async (incomingRequest) =>
          requireAuthorizedRequest(incomingRequest, env),
      })) ?? new Response("Not found", { status: 404 })
    );
  },
};
