import { jwtVerify } from "jose";

import type { Env } from "./types";

export interface AuthPayload {
  email?: string;
  sub?: string;
}

export function getAuthToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length);
  }

  const url = new URL(request.url);
  return url.searchParams.get("token");
}

export async function verifyAuthToken(
  token: string,
  env: Env,
): Promise<AuthPayload> {
  const secret = new TextEncoder().encode(env.JWT_SECRET_KEY);
  const { payload } = await jwtVerify(token, secret);
  return {
    email: typeof payload.email === "string" ? payload.email : undefined,
    sub: typeof payload.sub === "string" ? payload.sub : undefined,
  };
}

export async function requireAuthorizedRequest(
  request: Request,
  env: Env,
): Promise<Response | void> {
  const token = getAuthToken(request);
  if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    await verifyAuthToken(token, env);
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
}
