import { GroupsConfig, NormalizedGroupsConfig, GroupName, AggregatedResult, Env, FeedSource } from "./types";
import { aggregateGroupItems } from "./aggregate";
import { okJSON, errorJSON, notFound, methodNotAllowed, withCORS, handleOptions, getNumberFromEnv, computeResultEtag } from "./utils";

const CONFIG_KEY = "config";

export async function readGroupsConfig(kv: KVNamespace, envVars: Record<string, string>): Promise<NormalizedGroupsConfig> {
	const viaKv = await kv.get(CONFIG_KEY, { type: "json" }) as GroupsConfig | NormalizedGroupsConfig | null;
	if (viaKv && typeof viaKv === "object") return normalizeConfig(viaKv as any);
	if (envVars.GROUPS_JSON) {
		try {
			const parsed = JSON.parse(envVars.GROUPS_JSON) as GroupsConfig;
			return normalizeConfig(parsed);
		} catch {
			// ignore
		}
	}
	return {};
}

export async function writeGroupsConfig(kv: KVNamespace, config: GroupsConfig | NormalizedGroupsConfig): Promise<void> {
	await kv.put(CONFIG_KEY, JSON.stringify(normalizeConfig(config as any)));
}

export function listGroups(config: NormalizedGroupsConfig): GroupName[] {
	return Object.keys(config);
}

function normalizeConfig(config: GroupsConfig | NormalizedGroupsConfig): NormalizedGroupsConfig {
	const out: NormalizedGroupsConfig = {};
	for (const [group, sources] of Object.entries(config)) {
		if (!sources || !Array.isArray(sources)) continue;
		const cleaned: FeedSource[] = [];
		for (const entry of sources as Array<string | FeedSource>) {
			if (typeof entry === "string") {
				const url = entry.trim();
				if (url) cleaned.push({ url });
				continue;
			}
			if (entry && typeof entry === "object") {
				const url = typeof entry.url === "string" ? entry.url.trim() : "";
				const author = typeof (entry as any).author === "string" ? (entry as any).author.trim() : undefined;
				if (url) cleaned.push(author ? { url, author } : { url });
			}
		}
		if (cleaned.length > 0) out[group] = cleaned;
	}
	return out;
}

function groupCacheKey(group: GroupName): string {
	return `group:${group}`;
}

export async function getGroupCache(kv: KVNamespace, group: GroupName): Promise<AggregatedResult | null> {
	const cached = await kv.get(groupCacheKey(group), { type: "json" });
	return (cached as AggregatedResult | null) ?? null;
}

export async function setGroupCache(kv: KVNamespace, group: GroupName, result: AggregatedResult, ttlSeconds: number): Promise<void> {
	await kv.put(groupCacheKey(group), JSON.stringify(result), { expirationTtl: ttlSeconds });
}

async function handleApiGroups(request: Request, env: Env): Promise<Response> {
	if (request.method !== "GET") return methodNotAllowed(env);
	const config = await readGroupsConfig(env.FEEDS_KV, env as any);
	const groups = listGroups(config);
	return okJSON({ groups }, {}, env);
}

async function handleApiGroup(request: Request, env: Env, group: GroupName): Promise<Response> {
	if (request.method !== "GET") return methodNotAllowed(env);
	const url = new URL(request.url);
	const limitParam = Number.parseInt(url.searchParams.get("limit") || "", 10);
	const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 100;
	const format = (url.searchParams.get("format") || "json").toLowerCase();
	const fresh = url.searchParams.get("fresh") === "1";
	if (format !== "json") return errorJSON("Unsupported format", 400, env);

	const config = await readGroupsConfig(env.FEEDS_KV, env as any);
	if (!config[group] || config[group].length === 0) return notFound(env);

	const cacheTtl = getNumberFromEnv(env as any, "CACHE_TTL_SECONDS", 900);
	const ifNoneMatch = request.headers.get("if-none-match") || undefined;

	if (!fresh) {
		const cached = await getGroupCache(env.FEEDS_KV, group);
		if (cached) {
			const resultForLimit: AggregatedResult = cached.limit === limit
				? cached
				: { ...cached, items: cached.items.slice(0, limit), limit };
			const etag = await computeResultEtag(resultForLimit);
			const headers = new Headers();
			headers.set("ETag", etag);
			headers.set("Cache-Control", `public, max-age=${Math.min(60, cacheTtl)}`);
			if (ifNoneMatch && ifNoneMatch === etag) {
				return withCORS(new Response(null, { status: 304, headers }), env);
			}
			return okJSON(resultForLimit, { headers }, env);
		}
	}

	// No cache or forced refresh
	const aggregated = await aggregateGroupItems(config, group, env, limit);
	const etag = await computeResultEtag(aggregated);
	await setGroupCache(env.FEEDS_KV, group, aggregated, cacheTtl);
	const headers = new Headers();
	headers.set("ETag", etag);
	headers.set("Cache-Control", `public, max-age=${Math.min(60, cacheTtl)}`);
	return okJSON(aggregated, { headers }, env);
}

async function handleAdminPutConfig(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const token = url.searchParams.get("token") || "";
	if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return errorJSON("Unauthorized", 401, env);
	if (request.method !== "PUT") return methodNotAllowed(env);
	let body: any;
	try {
		body = await request.json();
	} catch {
		return errorJSON("Invalid JSON", 400, env);
	}
	await writeGroupsConfig(env.FEEDS_KV, body as GroupsConfig);
	const config = await readGroupsConfig(env.FEEDS_KV, env as any);
	return okJSON({ ok: true, groups: listGroups(config) }, {}, env);
}

async function handleAdminReloadConfig(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const token = url.searchParams.get("token") || "";
	if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return errorJSON("Unauthorized", 401, env);
	if (request.method !== "POST") return methodNotAllowed(env);
	const configUrl = env.CONFIG_URL;
	if (!configUrl) return errorJSON("CONFIG_URL not set", 400, env);
	try {
		const res = await fetch(configUrl, { headers: { "accept": "application/json" } });
		if (!res.ok) return errorJSON(`Fetch failed: ${res.status}`, 502, env);
		const json = await res.json<GroupsConfig>();
		await writeGroupsConfig(env.FEEDS_KV, json);
		const cfg = await readGroupsConfig(env.FEEDS_KV, env as any);
		return okJSON({ ok: true, groups: listGroups(cfg) }, {}, env);
	} catch (err: any) {
		return errorJSON(`Reload failed: ${String(err?.message || err)}`, 500, env);
	}
}

export default {
	async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
		if (request.method === "OPTIONS") return handleOptions(request, env);
		const url = new URL(request.url);
		const path = url.pathname;

		if (path === "/") {
			return withCORS(new Response("Hello world"), env);
		}
		if (path === "/health") {
			return okJSON({ ok: true }, {}, env);
		}
		if (path === "/api/_groups") {
			return handleApiGroups(request, env);
		}
		if (path.startsWith("/api/")) {
			const group = decodeURIComponent(path.slice("/api/".length)).replace(/^\/+/, "");
			if (!group) return notFound(env);
			return handleApiGroup(request, env, group);
		}
		if (path === "/admin/config") {
			return handleAdminPutConfig(request, env);
		}
		if (path === "/admin/reload-config") {
			return handleAdminReloadConfig(request, env);
		}
		return notFound(env);
	},

	async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
		const config = await readGroupsConfig(env.FEEDS_KV, env as any);
		const groups = listGroups(config);
		const cacheTtl = getNumberFromEnv(env as any, "CACHE_TTL_SECONDS", 900);
		for (const group of groups) {
			try {
				const result = await aggregateGroupItems(config, group, env, 100);
				await setGroupCache(env.FEEDS_KV, group, result, cacheTtl);
			} catch {
				// ignore errors during prewarm
			}
		}
	},
};
