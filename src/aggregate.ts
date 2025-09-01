import { FeedItem, AggregatedResult, NormalizedGroupsConfig, GroupName, Env } from "./types";
import { fetchWithTimeout } from "./utils";
import { parseFeedXml } from "./parser";

interface AggregateOptions {
	limit: number;
	userAgent: string;
	fetchTimeoutMs: number;
	concurrency: number;
}

async function* parallelPool<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): AsyncGenerator<R, void, unknown> {
	const executing: Promise<R>[] = [];
	for (const item of items) {
		const p = worker(item);
		executing.push(p);
		if (executing.length >= limit) {
			yield await Promise.race(executing);
			const idx = executing.findIndex(e => e === p);
			if (idx !== -1) executing.splice(idx, 1);
		}
	}
	while (executing.length > 0) {
		yield await Promise.race(executing);
		executing.splice(0, 1);
	}
}

async function fetchOneFeed(url: string, options: AggregateOptions): Promise<FeedItem[]> {
	try {
		const res = await fetchWithTimeout(url, {
			headers: {
				"user-agent": options.userAgent,
				"accept": "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
			},
			timeoutMs: options.fetchTimeoutMs,
		});
		if (!res.ok) return [];
		const text = await res.text();
		return parseFeedXml(text, url);
	} catch {
		return [];
	}
}

export async function aggregateGroupItems(config: NormalizedGroupsConfig, group: GroupName, env: Env, limit: number): Promise<AggregatedResult> {
	const sources = config[group] ?? [];
	const options: AggregateOptions = {
		limit,
		userAgent: env.USER_AGENT || "cf-rss-aggregator/0.1",
		fetchTimeoutMs: Number.parseInt(env.FETCH_TIMEOUT_MS || "8000", 10),
		concurrency: Number.parseInt(env.CONCURRENCY || "6", 10),
	};
	const allItems: FeedItem[] = [];
	const worker = (source: { url: string; author?: string }) => fetchOneFeed(source.url, options).then(items => {
		if (source.author) {
			for (const it of items) {
				if (!it.author || it.author === "") it.author = source.author as string;
			}
		}
		allItems.push(...items);
		return items.length;
	});
	// Simple concurrency limiter
	const pool: Promise<number>[] = [];
	for (const src of sources) {
		pool.push(worker(src));
		if (pool.length >= options.concurrency) {
			await Promise.race(pool);
			// prune settled
			for (let i = pool.length - 1; i >= 0; i--) {
				if (isSettled(pool[i])) pool.splice(i, 1);
			}
		}
	}
	await Promise.allSettled(pool);

	allItems.sort((a, b) => {
		const da = Date.parse(a.updatedAt || a.publishedAt || "0");
		const db = Date.parse(b.updatedAt || b.publishedAt || "0");
		return db - da;
	});

	const sliced = allItems.slice(0, limit);
	return {
		group,
		items: sliced,
		generatedAt: new Date().toISOString(),
		limit,
	};
}

function isSettled<T>(p: Promise<T>): boolean {
	return (p as any).status === "fulfilled" || (p as any).status === "rejected";
}
