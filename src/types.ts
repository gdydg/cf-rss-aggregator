export interface Env {
	FEEDS_KV: KVNamespace;
	ADMIN_TOKEN: string;
	CORS_ALLOW_ORIGIN: string;
	CACHE_TTL_SECONDS: string;
	FETCH_TIMEOUT_MS: string;
	CONCURRENCY: string;
	USER_AGENT: string;
	GROUPS_JSON: string;
	CONFIG_URL: string;
}

export type GroupName = string;

// Input config as provided by users (backward compatible):
// - Either a list of URL strings
// - Or a list of objects with url and optional author override
export interface FeedSource {
	url: string;
	author?: string;
}

export interface GroupsConfig {
	[groupName: GroupName]: Array<string | FeedSource>;
}

// Normalized config used internally
export interface NormalizedGroupsConfig {
	[groupName: GroupName]: FeedSource[];
}

export interface FeedItem {
	id: string;
	title: string;
	link: string;
	author?: string;
	publishedAt?: string;
	updatedAt?: string;
	summary?: string;
	sourceUrl: string;
}

export interface AggregatedResult {
	group: GroupName;
	items: FeedItem[];
	generatedAt: string;
	limit: number;
}
