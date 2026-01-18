(() => {
  const scopeEl = document.querySelector("[data-metrics-scope]");
  const form = document.querySelector("[data-metrics-form]");
  if (!scopeEl || !form) return;

  // ---------- formatting ----------
  const formatPercent = (value) => `${(value * 100).toFixed(1)}%`;
  const formatNumber = (value) => new Intl.NumberFormat().format(value || 0);
  const formatMinutes = (ms) => {
    if (!ms) return "0m";
    const minutes = Math.round(ms / 60000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return `${hours}h ${remainder}m`;
  };

  // ---------- defaults ----------
  const setDefaults = () => {
    const tzInput = form.querySelector("input[name=tz]");
    const timezone = document.body?.dataset?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tzInput && !tzInput.value) tzInput.value = timezone || "UTC";

    const fromInput = form.querySelector("input[name=from]");
    const toInput = form.querySelector("input[name=to]");
    if (fromInput && toInput && !fromInput.value && !toInput.value) {
      const now = new Date();
      const to = now.toISOString().slice(0, 10);
      const fromDate = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
      const from = fromDate.toISOString().slice(0, 10);
      fromInput.value = from;
      toInput.value = to;
    }
  };

  // ---------- KPIs ----------
  const renderKpis = (data) => {
    document.querySelectorAll("[data-kpi]").forEach((el) => {
      const key = el.dataset.kpi;
      if (!key) return;
      const parts = key.split(".");
      let value = data?.kpi;
      for (const p of parts) value = value ? value[p] : undefined;

      if (key.endsWith("completionRate") || key.endsWith("vaCreateSuccessRate")) {
        el.textContent = formatPercent(value || 0);
        return;
      }
      if (key.endsWith("avgTimeToApprovalMs")) {
        el.textContent = formatMinutes(value || 0);
        return;
      }
      el.textContent = formatNumber(value || 0);
    });
  };

  // ---------- charts (SVG stacked bars) ----------
  const PALETTE = ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f", "#edc948"];

  function svgEl(tag, attrs = {}) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  }

  function renderBarChart(container, series, keys) {
    container.innerHTML = "";
    if (!series || !series.length) {
      container.innerHTML = "<div class='metrics-empty'>No data</div>";
      return;
    }

    const width = Math.max(600, container.clientWidth || 600);
    const height = 260;
    const margin = { top: 16, right: 12, bottom: 40, left: 44 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;

    // y max based on stacked totals
    const totals = series.map((row) => keys.reduce((acc, k) => acc + (Number(row[k] || 0)), 0));
    const yMax = Math.max(1, ...totals);

    // x spacing
    const n = series.length;
    const slot = plotW / n;
    const barW = Math.max(8, Math.min(28, slot * 0.6));

    // scales
    const yScale = (v) => plotH * (1 - v / yMax);

    const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, width: "100%", height: height });
    const g = svgEl("g", { transform: `translate(${margin.left},${margin.top})` });
    svg.appendChild(g);

    // gridlines (5 steps)
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
      const val = (yMax / steps) * i;
      const y = yScale(val);
      const line = svgEl("line", {
        x1: 0,
        y1: y,
        x2: plotW,
        y2: y,
        stroke: "#e5e7eb",
        "stroke-width": 1,
      });
      g.appendChild(line);

      const label = svgEl("text", {
        x: -8,
        y: y + 4,
        "text-anchor": "end",
        "font-size": "10",
        fill: "#6b7280",
      });
      label.textContent = formatNumber(Math.round(val));
      g.appendChild(label);
    }

    // bars (stacked)
    series.forEach((row, i) => {
      const x = i * slot + (slot - barW) / 2;
      let yStack = plotH; // start at bottom

      keys.forEach((k, ki) => {
        const v = Number(row[k] || 0);
        if (!v) return;
        const h = plotH - yScale(totals[i] - (keys.slice(ki + 1).reduce((a, kk) => a + (Number(row[kk] || 0)), 0)));
        const segmentH = (plotH - yScale(v)) * (v / v); // equals v-height
        const rect = svgEl("rect", {
          x,
          y: yStack - (plotH - yScale(v)),
          width: barW,
          height: plotH - yScale(v),
          fill: PALETTE[ki % PALETTE.length],
          rx: 2,
        });
        const title = svgEl("title");
        title.textContent = `${k}: ${formatNumber(v)} (${row.date})`;
        rect.appendChild(title);
        g.appendChild(rect);
        yStack -= (plotH - yScale(v));
      });

      // x tick label (sparse to avoid clutter)
      const every = Math.max(1, Math.ceil(n / 12));
      if (i % every === 0 || i === n - 1) {
        const tx = x + barW / 2;
        const ty = plotH + 14;
        const lbl = svgEl("text", {
          x: tx,
          y: ty,
          "text-anchor": "middle",
          "font-size": "10",
          fill: "#6b7280",
        });
        lbl.textContent = row.date.slice(5); // show MM-DD
        g.appendChild(lbl);
      }
    });

    // axis baseline
    g.appendChild(svgEl("line", {
      x1: 0, y1: plotH, x2: plotW, y2: plotH, stroke: "#9ca3af", "stroke-width": 1
    }));

    // legend
    const legend = svgEl("g", { transform: `translate(0,${-6})` });
    keys.forEach((k, i) => {
      const gx = i * 120;
      const swatch = svgEl("rect", { x: gx, y: -12, width: 12, height: 12, fill: PALETTE[i % PALETTE.length], rx: 2 });
      const text = svgEl("text", { x: gx + 16, y: -2, "font-size": "11", fill: "#374151" });
      text.textContent = k;
      legend.appendChild(swatch);
      legend.appendChild(text);
    });
    g.appendChild(legend);

    container.appendChild(svg);
  }

  // ---------- breakdown tables ----------
  const renderBreakdown = (data) => {
    const methodEl = document.querySelector("[data-breakdown=methods]");
    if (methodEl) {
      const items = data?.breakdown?.byMethod || [];
      methodEl.innerHTML = items.length
        ? items
            .map(
              (item) => `
              <div class="metrics-breakdown-row">
                <div class="metrics-breakdown-label">${item.method}</div>
                <div class="metrics-breakdown-value">${formatNumber(item.approvedCount)} / ${formatNumber(item.approvedSumCents)}</div>
              </div>`
            )
            .join("")
        : "<div class='metrics-empty'>No data</div>";
    }

    const rejectEl = document.querySelector("[data-breakdown=rejects]");
    if (rejectEl) {
      const items = data?.breakdown?.rejectReasons || [];
      rejectEl.innerHTML = items.length
        ? `<table class="table"><thead><tr><th>Reason</th><th>Count</th></tr></thead><tbody>${
            items.map((r) => `<tr><td>${r.reason}</td><td>${formatNumber(r.count)}</td></tr>`).join("")
          }</tbody></table>`
        : "<div class='metrics-empty'>No data</div>";
    }

    const issuesEl = document.querySelector("[data-breakdown=issues]");
    if (issuesEl) {
      const avgLifetime = data?.breakdown?.avgVaLifetimeMs || 0;
      issuesEl.innerHTML = `<table class="table"><tbody>
        <tr><td>Avg VA lifetime</td><td>${formatMinutes(avgLifetime)}</td></tr>
        <tr><td>Avg provider response</td><td>${
          data?.breakdown?.avgProviderResponseMs ? formatMinutes(data.breakdown.avgProviderResponseMs) : "N/A"
        }</td></tr>
      </tbody></table>`;
    }
  };

  const renderCharts = (data) => {
    renderBarChart(
      document.querySelector("[data-chart=kyc]"),
      data?.series?.kyc || [],
      ["starts", "completes"]
    );
    renderBarChart(
      document.querySelector("[data-chart=deposits]"),
      data?.series?.deposits || [],
      ["pending", "approved", "rejected"]
    );
    renderBarChart(
      document.querySelector("[data-chart=withdrawals]"),
      data?.series?.withdrawals || [],
      ["submitted", "approved", "rejected"]
    );
  };

  // ---------- data fetch ----------
  const fetchMetrics = async (params) => {
    const qs = new URLSearchParams(params);
    const res = await fetch(`/metrics/v1/overview?${qs.toString()}`);
    const data = await res.json();
    if (!data.ok) return null;
    return data;
  };

  const buildParams = () => {
    const data = new FormData(form);
    const params = {};
    for (const [key, value] of data.entries()) {
      if (!value) continue;
      if (params[key]) {
        params[key] = Array.isArray(params[key]) ? params[key] : [params[key]];
        params[key].push(value);
      } else {
        params[key] = value;
      }
    }
    if (scopeEl.dataset.merchantId) {
      params.merchantId = scopeEl.dataset.merchantId;
    }
    return params;
  };

  const load = async () => {
    const params = buildParams();
    const data = await fetchMetrics(params);
    if (!data) return;
    renderKpis(data);
    renderCharts(data);
    renderBreakdown(data);
  };

  // ---------- events ----------
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    load();
  });

  window.addEventListener("resize", () => {
    // redraw charts on resize (use latest data currently rendered in DOM by reloading)
    const params = buildParams();
    fetchMetrics(params).then((data) => {
      if (!data) return;
      renderCharts(data);
    });
  });

  setDefaults();
  load();
})();