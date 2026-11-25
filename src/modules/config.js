function parseExtraHeaders(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function getConfig(env) {
  const hasCredentials = Boolean(env.SISELI_USERNAME && env.SISELI_PASSWORD);
  const hasDirectToken = Boolean(env.SISELI_TOKEN);

  if (!hasCredentials && !hasDirectToken) {
    throw new Error("Missing SISELI_USERNAME and SISELI_PASSWORD (or SISELI_TOKEN) in Cloudflare Worker Secrets.");
  }

  return {
    baseUrl: (env.SISELI_BASE_URL || "https://solar.siseli.com").replace(/\/$/, ""),
    timezone: env.SISELI_TIMEZONE || "Asia/Manila",
    language: env.SISELI_LANGUAGE || "en_US",
    openAppId: (env.SISELI_OPEN_APP_ID || "").trim(),
    extraHeaders: parseExtraHeaders(env.SISELI_EXTRA_HEADERS),
    username: env.SISELI_USERNAME || "",
    password: env.SISELI_PASSWORD || "",
    passwordHashMode: env.SISELI_PASSWORD_HASH_MODE || "auto",
    directToken: env.SISELI_TOKEN || "",
    loginPath: env.SISELI_LOGIN_PATH || "/apis/login/account",
    stationListPath: env.SISELI_STATION_LIST_PATH || "/apis/station/list",
    deviceListPath: env.SISELI_DEVICE_LIST_PATH || "/apis/station/device/list",
    latestPath: env.SISELI_LATEST_PATH || "/apis/remote/device/timeSeries/latest/v1",
    flowPath: env.SISELI_FLOW_PATH || "/apis/remote/device/energy/flow/v1",
    seriesPath: env.SISELI_SERIES_PATH || "/apis/remote/device/timeSeries/v1",
    seriesListPath: env.SISELI_SERIES_LIST_PATH || "/apis/remote/device/timeSeries/list/v1",
    stationId: env.SISELI_STATION_ID || "",
    deviceId: env.SISELI_DEVICE_ID || "",
    dashboardSecret: env.DASHBOARD_SECRET || "",
    defaultRatePhp: Number(env.ELECTRICITY_RATE_PHP || "15.00"),
  };
}
