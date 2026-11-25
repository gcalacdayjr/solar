const dateInput = document.getElementById("dateInput");
const rateInput = document.getElementById("rateInput");
const refreshBtn = document.getElementById("refreshBtn");
const statusLine = document.getElementById("statusLine");
const errorBanner = document.getElementById("errorBanner");
const hoverReadout = document.getElementById("chartHoverInfo");

let currentSeries = [];

function getManilaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const savedRate = localStorage.getItem("powmr_php_rate");
if (savedRate) {
  rateInput.value = savedRate;
}
dateInput.value = getManilaToday();

function getDashboardKey() {
  const params = new URLSearchParams(window.location.search);
  return params.get("key") || localStorage.getItem("powmr_dashboard_key") || "";
}

async function fetchDashboard(forceRefresh = false) {
  const dateVal = dateInput.value || getManilaToday();
  const rateVal = rateInput.value || "12.50";
  const key = getDashboardKey();

  refreshBtn.disabled = true;
  refreshBtn.textContent = forceRefresh ? "Refreshing..." : "Loading...";
  errorBanner.classList.add("hidden");

  try {
    const query = new URLSearchParams({
      date: dateVal,
      rate: rateVal,
      refresh: forceRefresh ? "1" : "0",
    });
    if (key) query.set("key", key);

    const res = await fetch(`/api/dashboard?${query.toString()}`);
    if (res.status === 401) {
      const entered = prompt("Enter DASHBOARD_SECRET key:");
      if (entered) {
        localStorage.setItem("powmr_dashboard_key", entered);
        return fetchDashboard(forceRefresh);
      }
    }

    const data = await res.json();
    if (!data.ok) {
      throw new Error(data.error || "Failed to load Siseli telemetry.");
    }

    currentSeries = data.series || [];
    renderDashboard(data);
  } catch (err) {
    errorBanner.textContent = err instanceof Error ? err.message : String(err);
    errorBanner.classList.remove("hidden");
    statusLine.textContent = "Error fetching telemetry.";
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = "Refresh Now";
  }
}

function renderDashboard(data) {
  const live = data.live || {};
  const sum = data.dailySummary || {};

  statusLine.textContent = `Station ${data.stationId} | Date: ${data.date} | ${data.fromCache ? "Cached" : "Live"} (${sum.dataSource || ""})`;

  document.getElementById("kpiUtilHomeKwh").textContent = `${Number(sum.utilityHomeLoadKwh || 0).toFixed(2)} kWh`;
  document.getElementById("kpiUtilSub").textContent =
    `Total Grid Import: ${Number(sum.totalGridImportKwh || 0).toFixed(2)} kWh | Est. Bill: PHP ${Number(sum.utilityCostPhp || 0).toFixed(2)}`;

  document.getElementById("kpiPvW").textContent = `${Math.round(live.pvPowerW || 0)} W`;
  document.getElementById("kpiPvSub").textContent =
    `${live.pvVoltageV || 0} V | Generated: ${Number(sum.pvTodayKwh || 0).toFixed(2)} kWh`;

  document.getElementById("kpiBatSoc").textContent = `${live.batterySocPct || 0} %`;
  document.getElementById("kpiBatSub").textContent =
    `${live.batteryVoltageV || 0} V | ${Math.round(live.batteryPowerW || 0)} W`;

  document.getElementById("kpiLoadW").textContent = `${Math.round(live.loadPowerW || 0)} W`;
  document.getElementById("kpiLoadSub").textContent =
    `Consumed: ${Number(sum.loadTodayKwh || 0).toFixed(2)} kWh | Solar Share: ${sum.solarCoveragePct || 0}%`;

  document.getElementById("kpiGridW").textContent = `${Math.round(live.gridPowerW || 0)} W`;
  document.getElementById("kpiGridSub").textContent =
    `Grid: ${live.gridVoltageV || 0} V | Solar Saved: PHP ${Number(sum.solarSavingsPhp || 0).toFixed(2)}`;

  document.getElementById("kpiTemp").textContent = `${live.inverterTempC || 0} C`;
  document.getElementById("kpiMode").textContent =
    `Mode: ${live.workMode || "Normal"} | ${live.timestamp || "No timestamp"}`;

  drawChart(currentSeries);
  renderTable(currentSeries);
}

function drawChart(series, highlightIndex = -1) {
  const canvas = document.getElementById("powerChart");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = 300;

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  if (series.length < 2) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = "14px system-ui";
    ctx.fillText("Not enough 5-minute intervals returned for this date yet.", 20, 40);
    return;
  }

  const pad = { top: 20, right: 20, bottom: 28, left: 54 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  let maxVal = 500;
  for (const row of series) {
    maxVal = Math.max(
      maxVal,
      Number(row.pvPowerW || 0),
      Number(row.loadPowerW || 0),
      Number(row.gridPowerW || 0),
      Math.abs(Number(row.batteryPowerW || 0))
    );
  }
  maxVal = Math.ceil(maxVal / 500) * 500;

  ctx.strokeStyle = "#26344d";
  ctx.fillStyle = "#94a3b8";
  ctx.font = "11px system-ui";
  ctx.lineWidth = 1;

  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (plotH * i) / 4;
    const val = Math.round(maxVal * (1 - i / 4));
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.fillText(`${val}W`, 6, y + 4);
  }

  const plotLine = (key, color, absVal = false) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    series.forEach((row, idx) => {
      const x = pad.left + (idx / (series.length - 1)) * plotW;
      const raw = Number(row[key] || 0);
      const val = absVal ? Math.abs(raw) : Math.max(0, raw);
      const y = pad.top + plotH - (val / maxVal) * plotH;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  };

  plotLine("pvPowerW", "#f59e0b");
  plotLine("loadPowerW", "#38bdf8");
  plotLine("gridPowerW", "#f43f5e");
  plotLine("batteryPowerW", "#10b981", true);

  ctx.fillStyle = "#94a3b8";
  ctx.fillText(series[0].timestamp.slice(11, 16), pad.left, height - 8);
  const midIdx = Math.floor(series.length / 2);
  ctx.fillText(series[midIdx].timestamp.slice(11, 16), pad.left + plotW / 2 - 16, height - 8);
  ctx.fillText(series[series.length - 1].timestamp.slice(11, 16), width - pad.right - 36, height - 8);

  if (highlightIndex >= 0 && highlightIndex < series.length) {
    const x = pad.left + (highlightIndex / (series.length - 1)) * plotW;
    ctx.strokeStyle = "#cbd5e1";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function renderTable(series) {
  const tbody = document.getElementById("logsBody");
  const reversed = [...series].reverse();
  tbody.innerHTML = reversed
    .map(
      (r) => `
      <tr>
        <td>${r.timestamp.slice(11, 16) || r.timestamp}</td>
        <td>${Math.round(r.pvPowerW)}</td>
        <td>${Math.round(r.loadPowerW)}</td>
        <td>${Math.round(r.gridPowerW)}</td>
        <td>${r.batterySocPct}%</td>
        <td>${r.batteryVoltageV}</td>
        <td>${r.inverterTempC}</td>
      </tr>`
    )
    .join("");
}

const chartCanvas = document.getElementById("powerChart");
chartCanvas.addEventListener("mousemove", (e) => {
  if (currentSeries.length < 2) return;
  const rect = chartCanvas.getBoundingClientRect();
  const padLeft = 54;
  const padRight = 20;
  const plotW = rect.width - padLeft - padRight;
  const relX = Math.max(0, Math.min(plotW, e.clientX - rect.left - padLeft));
  const idx = Math.round((relX / plotW) * (currentSeries.length - 1));
  const pt = currentSeries[idx];
  if (pt) {
    hoverReadout.textContent =
      `${pt.timestamp} | PV: ${pt.pvPowerW}W | Load: ${pt.loadPowerW}W | Grid: ${pt.gridPowerW}W | Battery: ${pt.batterySocPct}% (${pt.batteryPowerW}W)`;
    drawChart(currentSeries, idx);
  }
});

chartCanvas.addEventListener("mouseleave", () => {
  if (currentSeries.length >= 2) {
    drawChart(currentSeries, -1);
  }
});

refreshBtn.addEventListener("click", () => fetchDashboard(true));
dateInput.addEventListener("change", () => fetchDashboard(false));
rateInput.addEventListener("change", () => {
  localStorage.setItem("powmr_php_rate", rateInput.value);
  fetchDashboard(false);
});
window.addEventListener("resize", () => drawChart(currentSeries));

fetchDashboard(false);
setInterval(() => fetchDashboard(false), 180000);
