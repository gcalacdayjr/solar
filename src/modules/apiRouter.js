import { getConfig } from "./config.js";
import { CacheStore } from "./cacheStore.js";
import { SiseliClient } from "./siseliClient.js";
import { analyzeTelemetry } from "./telemetryAnalyzer.js";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function getTodayInTimezone(timezone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
}

function checkOptionalAuth(request, config) {
  if (!config.dashboardSecret) return true;
  const url = new URL(request.url);
  const queryKey = url.searchParams.get("key") || "";
  const headerKey = request.headers.get("X-Dashboard-Key") || "";
  return queryKey === config.dashboardSecret || headerKey === config.dashboardSecret;
}

export async function handleApiRequest(request, env) {
  const url = new URL(request.url);

  if (url.pathname === "/api/health") {
    return jsonResponse({ ok: true, time: new Date().toISOString() });
  }

  let config;
  try {
    config = getConfig(env);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message }, 500);
  }

  if (!checkOptionalAuth(request, config)) {
    return jsonResponse({ ok: false, error: "Unauthorized. Provide valid dashboard key." }, 401);
  }

  const cache = new CacheStore();
  const client = new SiseliClient(config, cache);
  const dateStr = url.searchParams.get("date") || getTodayInTimezone(config.timezone);
  const forceRefresh = url.searchParams.get("refresh") === "1";
  const rateParam = Number(url.searchParams.get("rate"));
  const ratePhp = !Number.isNaN(rateParam) && rateParam > 0 ? rateParam : config.defaultRatePhp;

  if (url.pathname === "/api/dashboard") {
    try {
      const cacheKey = `dashboard:${config.username}:${dateStr}`;
      let bundle = !forceRefresh ? await cache.getJson(cacheKey) : null;
      let fromCache = Boolean(bundle);

      if (!bundle) {
        bundle = await client.fetchAllForDate(dateStr);
        await cache.putJson(cacheKey, bundle, 120);
        fromCache = false;
      }

      const analyzed = analyzeTelemetry(bundle, ratePhp);
      return jsonResponse({
        ok: true,
        fromCache,
        fetchedAt: new Date().toISOString(),
        ...analyzed,
      });
    } catch (err) {
      return jsonResponse(
        {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        },
        502
      );
    }
  }

  if (url.pathname === "/api/debug/raw") {
    try {
      const bundle = await client.fetchAllForDate(dateStr);
      return jsonResponse({ ok: true, bundle });
    } catch (err) {
      return jsonResponse(
        {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        },
        502
      );
    }
  }

  return jsonResponse({ ok: false, error: "Endpoint not found" }, 404);
}
