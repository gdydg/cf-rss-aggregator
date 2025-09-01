import { AggregatedResult } from "./types";

export function getNumberFromEnv(env: Record<string, string>, key: string, fallback: number): number {
	const raw = env[key];
	const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
	return Number.isFinite(parsed) ? parsed : fallback;
}

export function withCORS(response: Response, env: any): Response {
	const allowOrigin = env.CORS_ALLOW_ORIGIN || "*";
	const headers = new Headers(response.headers);
	headers.set("Access-Control-Allow-Origin", allowOrigin);
	headers.set("Vary", "Origin");
	return new Response(response.body, { status: response.status, headers });
}

export function okJSON(data: unknown, init: ResponseInit = {}, env?: any): Response {
	const headers = new Headers(init.headers);
	headers.set("content-type", "application/json; charset=utf-8");
	const res = new Response(JSON.stringify(data), { ...init, headers });
	return env ? withCORS(res, env) : res;
}

export function errorJSON(message: string, status = 400, env?: any): Response {
	return okJSON({ error: message }, { status }, env);
}

export function notFound(env?: any): Response {
	return errorJSON("Not Found", 404, env);
}

export function unauthorized(env?: any): Response {
	return errorJSON("Unauthorized", 401, env);
}

export function methodNotAllowed(env?: any): Response {
	return errorJSON("Method Not Allowed", 405, env);
}

export function handleOptions(request: Request, env: any): Response {
	const headers = new Headers();
	headers.set("Access-Control-Allow-Origin", env.CORS_ALLOW_ORIGIN || "*");
	headers.set("Access-Control-Allow-Methods", "GET,PUT,POST,OPTIONS");
	headers.set("Access-Control-Allow-Headers", "authorization,content-type");
	headers.set("Access-Control-Max-Age", "86400");
	return new Response(null, { status: 204, headers });
}

export async function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
	const controller = new AbortController();
	const timeoutMs = init.timeoutMs ?? 8000;
	const timeoutId = setTimeout(() => controller.abort("timeout"), timeoutMs);
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timeoutId);
	}
}

export async function computeWeakEtag(input: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(input);
	const hashBuffer = await crypto.subtle.digest({ name: "SHA-1" }, data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
	return `W/"${hex}"`;
}

export async function computeResultEtag(result: AggregatedResult): Promise<string> {
	const basis = JSON.stringify({
		group: result.group,
		generatedAt: result.generatedAt,
		ids: result.items.map(i => ({ id: i.id, updatedAt: i.updatedAt, publishedAt: i.publishedAt }))
	});
	return computeWeakEtag(basis);
}
