export class SiseliClient {
  constructor(config, cacheStore) {
    this.config = config;
    this.cache = cacheStore;
    this.tokenCacheKey = `token:${config.username}`;
    this.idsCacheKey = `ids:${config.username}`;
  }

  buildHeaders(token = "") {
    const headers = {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "IOT-Time-Zone": this.config.timezone,
      "User-Agent": "Mozilla/5.0 (compatible; PowMrSolarMonitor/1.0)",
    };
    if (token) {
      headers["Authorization"] = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
      headers["token"] = token;
    }
    return headers;
  }

  async login(forceRefresh = false) {
    if (!forceRefresh) {
      const cached = await this.cache.getJson(this.tokenCacheKey);
      if (cached && cached.token) return cached.token;
    }

    const endpoints = ["/apis/user/login", "/apis/login"];
    let lastError = "Unable to authenticate with solar.siseli.com";

    for (const path of endpoints) {
      const res = await fetch(`${this.config.baseUrl}${path}`, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify({
          userName: this.config.username,
          username: this.config.username,
          account: this.config.username,
          password: this.config.password,
        }),
      });

      if (!res.ok) {
        lastError = `Login HTTP ${res.status} on ${path}`;
        continue;
      }

      const json = await res.json();
      const data = json.data || json;
      const token =
        data.token ||
        data.accessToken ||
        data.access_token ||
        res.headers.get("token") ||
        res.headers.get("authorization");

      if (token) {
        await this.cache.putJson(this.tokenCacheKey, { token }, 4 * 60 * 60);
        return token;
      }

      lastError = json.msg || json.message || "Token missing in Siseli response";
    }

    throw new Error(lastError);
  }

  async post(path, body = {}, retry = true) {
    const token = await this.login(false);
    const res = await fetch(`${this.config.baseUrl}${path}`, {
      method: "POST",
      headers: this.buildHeaders(token),
      body: JSON.stringify(body),
    });

    if (res.status === 401 && retry) {
      await this.login(true);
      return this.post(path, body, false);
    }

    const json = await res.json();
    if ((json.code === 401 || json.code === 1002) && retry) {
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
      const stationRes = await this.post("/apis/station/list", { pageNo: 1, pageSize: 20 });
      const list = stationRes?.data?.records || stationRes?.data?.list || stationRes?.data || [];
      if (!Array.isArray(list) || list.length === 0) {
        throw new Error("No solar stations found on this Sun House / Siseli account.");
      }
      stationId = String(list[0].stationId || list[0].id);
    }

    if (!deviceId) {
      const devRes = await this.post("/apis/station/device/list", { stationId });
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
      this.safePost("/apis/remote/device/timeSeries/latest/v1", { stationId, deviceId }),
      this.safePost("/apis/remote/device/energy/flow/v1", { stationId, deviceId }),
      this.safePost("/apis/remote/device/timeSeries/v1", {
        stationId,
        deviceId,
        date: dateStr,
        startTime,
        endTime,
      }),
      this.safePost("/apis/remote/device/timeSeries/list/v1", {
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
