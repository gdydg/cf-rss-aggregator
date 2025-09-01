import { XMLParser } from "fast-xml-parser";
import { FeedItem } from "./types";

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	allowBooleanAttributes: true,
	parseTagValue: true,
	parseAttributeValue: true,
	trimValues: true,
});

function toArray<T>(value: T | T[] | undefined): T[] {
	if (value === undefined) return [];
	return Array.isArray(value) ? value : [value];
}

function pickDate(...values: Array<string | undefined>): string | undefined {
	for (const v of values) {
		if (!v) continue;
		const d = new Date(v);
		if (!Number.isNaN(d.getTime())) return d.toISOString();
	}
	return undefined;
}

export function parseFeedXml(xml: string, sourceUrl: string): FeedItem[] {
	const data = parser.parse(xml);
	// Atom
	if (data?.feed?.entry) {
		const entries = toArray<any>(data.feed.entry);
		return entries.map((entry: any): FeedItem => {
			const link = Array.isArray(entry.link)
				? (entry.link.find((l: any) => l["@_rel"] === "alternate")?.["@_href"] ?? entry.link[0]?.["@_href"]) 
				: (entry.link?.["@_href"] ?? entry.link);
			return {
				id: String(entry.id ?? link ?? `${sourceUrl}#${entry.updated ?? entry.published ?? entry.title ?? Math.random()}`),
				title: String(entry.title?.["#text"] ?? entry.title ?? ""),
				link: String(link ?? sourceUrl),
				author: String(entry.author?.name ?? entry.author ?? ""),
				publishedAt: pickDate(entry.published, entry.updated),
				updatedAt: pickDate(entry.updated, entry.published),
				summary: String(entry.summary?.["#text"] ?? entry.summary ?? entry.content?.["#text"] ?? entry.content ?? ""),
				sourceUrl,
			};
		});
	}
	// RSS 2.0
	if (data?.rss?.channel?.item) {
		const items = toArray<any>(data.rss.channel.item);
		return items.map((it: any): FeedItem => {
			return {
				id: String(it.guid?.["#text"] ?? it.guid ?? it.link ?? `${sourceUrl}#${it.pubDate ?? it.title ?? Math.random()}`),
				title: String(it.title ?? ""),
				link: String(it.link ?? sourceUrl),
				author: String(it.author ?? it["dc:creator"] ?? ""),
				publishedAt: pickDate(it.pubDate),
				updatedAt: pickDate(it.updated ?? it.pubDate),
				summary: String(it.description ?? it.summary ?? ""),
				sourceUrl,
			};
		});
	}
	// RSS 1.0 (RDF) or unknown structure: try common patterns
	if (data?.rdf?.item || data?.RDF?.item) {
		const items = toArray<any>(data.rdf?.item ?? data.RDF?.item);
		return items.map((it: any): FeedItem => ({
			id: String(it.guid ?? it.link ?? `${sourceUrl}#${it.title ?? Math.random()}`),
			title: String(it.title ?? ""),
			link: String(it.link ?? sourceUrl),
			author: String(it.creator ?? it["dc:creator"] ?? ""),
			publishedAt: pickDate(it.date ?? it.pubDate),
			updatedAt: pickDate(it.date ?? it.pubDate),
			summary: String(it.description ?? ""),
			sourceUrl,
		}));
	}
	return [];
}
