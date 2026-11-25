const CACHE_ORIGIN = "https://powmr-internal-cache.local";

export class CacheStore {
  constructor() {
    this.cache = caches.default;
  }

  buildRequest(key) {
    return new Request(`${CACHE_ORIGIN}/${encodeURIComponent(key)}`, {
      method: "GET",
    });
  }

  async getJson(key) {
    const match = await this.cache.match(this.buildRequest(key));
    if (!match) return null;
    try {
      return await match.json();
    } catch {
      return null;
    }
  }

  async putJson(key, data, ttlSeconds) {
    const response = new Response(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${Math.max(10, ttlSeconds)}`,
      },
    });
    await this.cache.put(this.buildRequest(key), response);
  }

  async delete(key) {
    await this.cache.delete(this.buildRequest(key));
  }
}
