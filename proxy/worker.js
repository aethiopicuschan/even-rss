const MAX_RESPONSE_BYTES = 1_500_000;
const MAX_REDIRECTS = 4;
const FEED_ACCEPT = "application/atom+xml, application/rss+xml, application/xml, text/xml, */*";
const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type",
    "Cache-Control": "no-store",
};

export default {
    async fetch(request, env) {
        if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
        if (request.method !== "GET") return jsonError("Method not allowed", 405);

        const requestUrl = new URL(request.url);
        const sourceUrl = requestUrl.searchParams.get("url");
        if (!sourceUrl || sourceUrl.length > 2048) return jsonError("A valid feed URL is required", 400);

        let feedUrl;
        try {
            feedUrl = new URL(sourceUrl);
        } catch {
            return jsonError("A valid feed URL is required", 400);
        }
        if ((feedUrl.protocol !== "https:" && feedUrl.protocol !== "http:") || feedUrl.username || feedUrl.password) {
            return jsonError("Only public HTTP(S) feed URLs are supported", 400);
        }

        const allowedHosts = (env.ALLOWED_FEED_HOSTS ?? "")
            .split(",")
            .map((host) => host.trim().toLowerCase().replace(/^\*\./, ""))
            .filter(Boolean);
        if (!allowedHosts.length) return jsonError("No feed hosts are configured", 503);
        if (!isAllowedHost(feedUrl.hostname, allowedHosts)) return jsonError("Feed host is not allowed", 403);

        let response;
        try {
            for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
                response = await fetch(feedUrl.href, {
                    headers: { Accept: FEED_ACCEPT },
                    redirect: "manual",
                    signal: AbortSignal.timeout(12000),
                });
                if (![301, 302, 303, 307, 308].includes(response.status)) break;
                if (redirectCount === MAX_REDIRECTS) return jsonError("Too many redirects", 502);

                const location = response.headers.get("location");
                if (!location) return jsonError("Feed redirect did not include a location", 502);
                feedUrl = new URL(location, feedUrl);
                if (!isAllowedHost(feedUrl.hostname, allowedHosts)) return jsonError("Redirect host is not allowed", 403);
            }
        } catch {
            return jsonError("Feed request failed", 502);
        }

        if (!response?.ok) return jsonError(`Feed returned HTTP ${response?.status ?? 502}`, response?.status ?? 502);
        const body = await readLimitedBody(response);
        if (!body) return jsonError("Feed is larger than the 1.5 MB limit", 413);

        return new Response(body, {
            headers: {
                ...CORS_HEADERS,
                "Content-Type": response.headers.get("content-type") || "application/xml; charset=utf-8",
            },
        });
    },
};

function isAllowedHost(hostname, allowedHosts) {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
    if (/^[\d.]+$/.test(host) || host.includes(":")) return false;
    return allowedHosts.includes("*") || allowedHosts.some((allowedHost) => host === allowedHost || host.endsWith(`.${allowedHost}`));
}

async function readLimitedBody(response) {
    const reader = response.body?.getReader();
    if (!reader) return new Uint8Array();

    const chunks = [];
    let totalBytes = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            return null;
        }
        chunks.push(value);
    }

    const body = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return body;
}

function jsonError(message, status) {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
    });
}
