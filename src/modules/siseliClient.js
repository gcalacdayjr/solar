import { formatLoginPassword } from "./hashUtil.js";

export class SiseliClient {
  constructor(config, cacheStore) {
    this.config = config;
    this.cache = cacheStore;
    this.tokenCacheKey = `token:${config.username || "direct"}`;
    this.idsCacheKey = `ids:${config.username || "direct"}`;
  }

  buildHeaders(token = "") {
    const headers = {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "IOT-Time-Zone": this.config.timezone,
      "IOT-Language": this.config.language,
      "User-Agent": "Mozilla/5.0 (compatible; PowMrSolarMonitor/1.0)",
      ...this.config.extraHeaders,
    };

    if (this.config.openAppId) {
      headers["IOT-Open-AppID"] = this.config.openAppId;
    }

    if (token) {
      headers["Authorization"] = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
      headers["token"] = token;
      headers["IOT-Token"] = token;
    }

    return headers;
  }

  resolveUrl(pathOrUrl) {
    if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
      return pathOrUrl;
    }
    const cleanPath = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
    return `${this.config.baseUrl}${cleanPath}`;
  }

  extractToken(json, headers) {
    const data = json?.data;
    if (typeof data === "string" && data.length > 10) {
      return data;
    }
    return (
      data?.token ||
      data?.accessToken ||
      data?.access_token ||
      data?.jwt ||
      json?.token ||
      json?.accessToken ||
      headers.get("token") ||
      headers.get("iot-token") ||
      headers.get("authorization") ||
      ""
    );
  }

  async login(forceRefresh = false) {
    if (this.config.directToken) {
      return this.config.directToken;
    }

    if (!forceRefresh) {
      const cached = await this.cache.getJson(this.tokenCacheKey);
      if (cached && cached.token) return cached.token;
    }

    if (!this.config.openAppId) {
      throw new Error("Missing SISELI_OPEN_APP_ID in Cloudflare Worker Variables/Secrets.");
    }

    const hashedPassword = await formatLoginPassword(
      this.config.password,
      this.config.passwordHashMode
    );

    const payloads = [
      {
        user: this.config.username,
        password: hashedPassword,
      },
      {
        user: this.config.username,
        userName: this.config.username,
        username: this.config.username,
        account: this.config.username,
        password: hashedPassword,
      },
    ];

    const targetUrl = this.resolveUrl(this.config.loginPath);
    const attempts = [];

    for (const body of payloads) {
      const res = await fetch(targetUrl, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        attempts.push(`${this.config.loginPath} (HTTP ${res.status})`);
        continue;
      }

      let json;
      try {
        json = await res.json();
      } catch {
        attempts.push(`${this.config.loginPath} (Non-JSON response)`);
        continue;
      }

      const token = this.extractToken(json, res.headers);
      if (token) {
        await this.cache.putJson(this.tokenCacheKey, { token }, 4 * 60 * 60);
        return token;
      }

      attempts.push(`${this.config.loginPath} (${json.msg || json.message || JSON.stringify(json)})`);
    }

    throw new Error(`Siseli login failed: ${attempts.join(" | ")}`);
  }

  async post(path, body = {}, retry = true) {
    const token = await this.login(false);
    const res = await fetch(this.resolveUrl(path), {
      method: "POST",
      headers: this.buildHeaders(token),
      body: JSON.stringify(body),
    });

    if (res.status === 401 && retry && !this.config.directToken) {
      await this.login(true);
      return this.post(path, body, false);
    }

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Endpoint ${path} returned HTTP ${res.status} non-JSON response`);
    }

    if ((json.code === 401 || json.code === 1002) && retry && !this.config.directToken) {
      await this.login(true);
      return this.post(path, body, false);
    }

    return json;
  }

  async safePost(path, body = {}) {
    try {
      return await this.post(path, body, true);
    } catch (err) {
      return { _error: err instanceof Error ? err.message : String(err) };
    }
  }

  async resolveIds() {
    if (this.config.stationId && this.config.deviceId) {
      return {
        stationId: this.config.stationId,
        deviceId: this.config.deviceId,
      };
    }

    const cachedIds = await this.cache.getJson(this.idsCacheKey);
    if (cachedIds && cachedIds.stationId && cachedIds.deviceId) {
      return cachedIds;
    }

    let stationId = this.config.stationId;
    let deviceId = this.config.deviceId;

    if (!stationId) {
      const stationRes = await this.post(this.config.stationListPath, { pageNo: 1, pageSize: 20 });
      const list = stationRes?.data?.records || stationRes?.data?.list || stationRes?.data || [];
      if (!Array.isArray(list) || list.length === 0) {
        throw new Error(`No solar stations returned from ${this.config.stationListPath}: ${JSON.stringify(stationRes)}`);
      }
      stationId = String(list[0].stationId || list[0].id);
    }

    if (!deviceId) {
      const devRes = await this.post(this.config.deviceListPath, { stationId });
      const devices = devRes?.data?.records || devRes?.data?.list || devRes?.data || [];
      if (Array.isArray(devices) && devices.length > 0) {
        deviceId = String(devices[0].deviceId || devices[0].id || devices[0].sn);
      } else {
        deviceId = stationId;
      }
    }

    const resolved = { stationId, deviceId };
    await this.cache.putJson(this.idsCacheKey, resolved, 12 * 60 * 60);
    return resolved;
  }

  async fetchAllForDate(dateStr) {
    const { stationId, deviceId } = await this.resolveIds();
    const startTime = `${dateStr} 00:00:00`;
    const endTime = `${dateStr} 23:59:59`;

    const [latestRes, flowRes, seriesV1Res, seriesListRes] = await Promise.all([
      this.safePost(this.config.latestPath, { stationId, deviceId }),
      this.safePost(this.config.flowPath, { stationId, deviceId }),
      this.safePost(this.config.seriesPath, {
        stationId,
        deviceId,
        date: dateStr,
        startTime,
        endTime,
      }),
      this.safePost(this.config.seriesListPath, {
        stationId,
        deviceId,
        date: dateStr,
        startTime,
        endTime,
        pageNo: 1,
        pageSize: 500,
      }),
    ]);

    return {
      stationId,
      deviceId,
      date: dateStr,
      latestRaw: latestRes,
      flowRaw: flowRes,
      seriesRaw: seriesV1Res?.data ? seriesV1Res : seriesListRes,
      seriesFallbackRaw: seriesListRes,
    };
  }
}
