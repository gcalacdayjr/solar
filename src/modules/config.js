export function getConfig(env) {
  if (!env.SISELI_USERNAME || !env.SISELI_PASSWORD) {
    throw new Error("Missing SISELI_USERNAME or SISELI_PASSWORD in Cloudflare Worker Secrets.");
  }

  return {
    baseUrl: (env.SISELI_BASE_URL || "https://solar.siseli.com").replace(/\/$/, ""),
    timezone: env.SISELI_TIMEZONE || "Asia/Manila",
    username: env.SISELI_USERNAME,
    password: env.SISELI_PASSWORD,
    stationId: env.SISELI_STATION_ID || "",
    deviceId: env.SISELI_DEVICE_ID || "",
    dashboardSecret: env.DASHBOARD_SECRET || "",
    defaultRatePhp: Number(env.ELECTRICITY_RATE_PHP || "12.50"),
  };
}
