function readNumericField(obj, keys) {
  if (!obj || typeof obj !== "object") return null;
  for (const key of keys) {
    const raw = obj[key];
    if (raw !== undefined && raw !== null && raw !== "") {
      if (typeof raw === "object" && raw.value !== undefined) {
        const num = Number(raw.value);
        if (!Number.isNaN(num)) {
          const unit = String(raw.unit || "").toLowerCase();
          return unit === "kw" ? num * 1000 : num;
        }
      } else {
        const num = Number(raw);
        if (!Number.isNaN(num)) return num;
      }
    }
  }
  return null;
}

function readStringField(obj, keys, fallback = "") {
  if (!obj || typeof obj !== "object") return fallback;
  for (const key of keys) {
    const raw = obj[key];
    if (raw !== undefined && raw !== null && raw !== "") {
      if (typeof raw === "object" && raw.value !== undefined) {
        return String(raw.value);
      }
      return String(raw);
    }
  }
  return fallback;
}

function normalizeWatts(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return 0;
  if (Math.abs(value) > 0 && Math.abs(value) < 30) {
    return Math.round(value * 1000);
  }
  return Math.round(value);
}

function extractPoint(primary, secondary = {}) {
  const merged = { ...secondary, ...primary };

  const pv1 = readNumericField(merged, ["pvPower", "pv1Power", "generationPower", "solarPower", "pvPanelPower"]);
  const pv2 = readNumericField(merged, ["pv2Power"]) || 0;
  const pvPowerW = normalizeWatts((pv1 || 0) + pv2);

  const loadRaw = readNumericField(merged, [
    "loadPower",
    "acOutputActivePower",
    "acOutputPower",
    "outputPower",
    "usePower",
  ]);
  const loadPowerW = normalizeWatts(loadRaw);

  const gridRaw = readNumericField(merged, [
    "mainsPower",
    "gridPower",
    "gridImportPower",
    "acInputPower",
  ]);
  const gridPowerW = normalizeWatts(gridRaw);

  const batPowerRaw = readNumericField(merged, ["batteryPower", "batPower"]);
  const batVoltageV = readNumericField(merged, ["batteryVoltage", "batVoltage"]) || 0;
  const batCurrentA = readNumericField(merged, ["batteryCurrent", "batCurrent"]) || 0;
  const acChargeCurrentA = readNumericField(merged, ["inverterChargingCurrent", "acChargingCurrent", "mainsChargeCurrent"]) || 0;

  let batteryPowerW = batPowerRaw !== null ? normalizeWatts(batPowerRaw) : Math.round(batVoltageV * batCurrentA);
  const acChargePowerW = acChargeCurrentA > 0 && batVoltageV > 0 ? Math.round(acChargeCurrentA * batVoltageV) : 0;

  const timestamp = readStringField(
    merged,
    ["updateTime", "collectTime", "dataTime", "time", "timestamp"],
    ""
  );

  return {
    timestamp,
    pvPowerW: Math.max(0, pvPowerW),
    pvVoltageV: Number((readNumericField(merged, ["pvVoltage", "pv1Voltage"]) || 0).toFixed(1)),
    batterySocPct: Number((readNumericField(merged, ["batterySoc", "soc", "batSoc"]) || 0).toFixed(0)),
    batteryVoltageV: Number(batVoltageV.toFixed(1)),
    batteryCurrentA: Number(batCurrentA.toFixed(1)),
    batteryPowerW,
    acChargePowerW,
    loadPowerW: Math.max(0, loadPowerW),
    gridPowerW: Math.max(0, gridPowerW),
    gridVoltageV: Number((readNumericField(merged, ["mainsVoltage", "gridVoltage", "acInputVoltage"]) || 0).toFixed(1)),
    inverterTempC: Number((readNumericField(merged, ["inverterTemperature", "pvTemperature", "temperature"]) || 0).toFixed(1)),
    workMode: readStringField(merged, ["workMode", "inverterMode", "deviceStatus", "statusName"], "Normal"),
    nativeGridImportTodayKwh: readNumericField(merged, [
      "gridImportEnergyToday",
      "todayGridEnergy",
      "mainsEnergyToday",
      "dailyGridImport",
    ]),
    nativePvTodayKwh: readNumericField(merged, [
      "pvGeneratedToday",
      "todayPvEnergy",
      "dailyPvEnergy",
      "eToday",
    ]),
    nativeLoadTodayKwh: readNumericField(merged, [
      "loadEnergyToday",
      "todayLoadEnergy",
      "dailyLoadEnergy",
    ]),
  };
}

function extractSeriesList(seriesPayload) {
  const data = seriesPayload?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.records)) return data.records;
  if (Array.isArray(data?.list)) return data.list;
  if (Array.isArray(data?.timeSeries)) return data.timeSeries;
  return [];
}

function parseTimestampMs(ts) {
  if (!ts) return NaN;
  const iso = ts.includes("T") ? ts : ts.replace(" ", "T");
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? NaN : parsed;
}

export function analyzeTelemetry(bundle, ratePhp = 12.5) {
  const latestSrc = bundle?.latestRaw?.data || {};
  const flowSrc = bundle?.flowRaw?.data || {};
  const live = extractPoint(latestSrc, flowSrc);

  const rawList = extractSeriesList(bundle?.seriesRaw);
  const points = rawList
    .map((item) => extractPoint(item))
    .filter((p) => p.timestamp)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  let calcPvKwh = 0;
  let calcLoadKwh = 0;
  let calcTotalGridImportKwh = 0;
  let calcUtilityHomeLoadKwh = 0;

  for (let i = 0; i < points.length; i++) {
    const curr = points[i];
    let intervalHours = 5 / 60;

    if (i > 0) {
      const prevMs = parseTimestampMs(points[i - 1].timestamp);
      const currMs = parseTimestampMs(curr.timestamp);
      if (!Number.isNaN(prevMs) && !Number.isNaN(currMs) && currMs > prevMs) {
        const diffHours = (currMs - prevMs) / 3600000;
        if (diffHours > 0 && diffHours <= 0.5) {
          intervalHours = diffHours;
        }
      }
    }

    calcPvKwh += (curr.pvPowerW / 1000) * intervalHours;
    calcLoadKwh += (curr.loadPowerW / 1000) * intervalHours;
    calcTotalGridImportKwh += (curr.gridPowerW / 1000) * intervalHours;

    const utilityToLoadW = curr.acChargePowerW > 0
      ? Math.max(0, curr.gridPowerW - curr.acChargePowerW)
      : Math.min(curr.gridPowerW, curr.loadPowerW > 0 ? curr.loadPowerW : curr.gridPowerW);

    calcUtilityHomeLoadKwh += (utilityToLoadW / 1000) * intervalHours;
  }

  const totalGridImportKwh = live.nativeGridImportTodayKwh !== null && live.nativeGridImportTodayKwh > 0
    ? Number(live.nativeGridImportTodayKwh.toFixed(2))
    : Number(calcTotalGridImportKwh.toFixed(2));

  const utilityHomeLoadKwh = Number(
    Math.min(totalGridImportKwh, calcUtilityHomeLoadKwh).toFixed(2)
  );

  const pvTodayKwh = live.nativePvTodayKwh !== null && live.nativePvTodayKwh > 0
    ? Number(live.nativePvTodayKwh.toFixed(2))
    : Number(calcPvKwh.toFixed(2));

  const loadTodayKwh = live.nativeLoadTodayKwh !== null && live.nativeLoadTodayKwh > 0
    ? Number(live.nativeLoadTodayKwh.toFixed(2))
    : Number(calcLoadKwh.toFixed(2));

  const solarSuppliedLoadKwh = Number(Math.max(0, loadTodayKwh - utilityHomeLoadKwh).toFixed(2));
  const solarCoveragePct = loadTodayKwh > 0
    ? Math.min(100, Math.round((solarSuppliedLoadKwh / loadTodayKwh) * 100))
    : 0;

  return {
    stationId: bundle.stationId,
    deviceId: bundle.deviceId,
    date: bundle.date,
    live,
    dailySummary: {
      totalGridImportKwh,
      utilityHomeLoadKwh,
      gridBatteryChargeKwh: Number(Math.max(0, totalGridImportKwh - utilityHomeLoadKwh).toFixed(2)),
      pvTodayKwh,
      loadTodayKwh,
      solarSuppliedLoadKwh,
      solarCoveragePct,
      utilityCostPhp: Number((totalGridImportKwh * ratePhp).toFixed(2)),
      solarSavingsPhp: Number((solarSuppliedLoadKwh * ratePhp).toFixed(2)),
      ratePhp,
      dataSource: live.nativeGridImportTodayKwh !== null ? "Inverter Counter + 5-Min Curve" : "5-Min Interval Integration",
    },
    series: points,
  };
}
