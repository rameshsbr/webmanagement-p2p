(() => {
  const scopeEl = document.querySelector("[data-metrics-scope]");
  const form = document.querySelector("[data-metrics-form]");
  if (!scopeEl || !form) return;

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

  const renderBars = (container, series, keys) => {
    container.innerHTML = "";
    if (!series || !series.length) {
      container.innerHTML = "<div class='metrics-empty'>No data</div>";
      return;
    }
    const max = Math.max(
      1,
      ...series.map((row) => keys.reduce((sum, key) => Math.max(sum, row[key] || 0), 0)),
    );

    const wrap = document.createElement("div");
    wrap.className = "metrics-bars";
    series.forEach((row) => {
      const group = document.createElement("div");
      group.className = "metrics-bar-group";
      const label = document.createElement("div");
      label.className = "metrics-bar-label";
      label.textContent = row.date;
      group.appendChild(label);
      const bars = document.createElement("div");
      bars.className = "metrics-bar-stack";
      keys.forEach((key) => {
        const bar = document.createElement("div");
        bar.className = "metrics-bar";
        const value = row[key] || 0;
        bar.style.height = `${(value / max) * 100}%`;
        bar.title = `${key}: ${value}`;
        bar.dataset.key = key;
        bars.appendChild(bar);
      });
      group.appendChild(bars);
      wrap.appendChild(group);
    });
    container.appendChild(wrap);
  };

  const renderBreakdown = (data) => {
    const methodEl = document.querySelector("[data-breakdown=methods]");
    if (methodEl) {
      const items = data?.breakdown?.byMethod || [];
      methodEl.innerHTML = items.length
        ? items
            .map((item) => `
              <div class="metrics-breakdown-row">
                <div class="metrics-breakdown-label">${item.method}</div>
                <div class="metrics-breakdown-value">${formatNumber(item.approvedCount)} / ${formatNumber(item.approvedSumCents)}</div>
              </div>
            `)
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
        <tr><td>Avg provider response</td><td>${data?.breakdown?.avgProviderResponseMs ? formatMinutes(data.breakdown.avgProviderResponseMs) : "N/A"}</td></tr>
      </tbody></table>`;
    }
  };

  const renderCharts = (data) => {
    renderBars(document.querySelector("[data-chart=kyc]"), data?.series?.kyc || [], ["starts", "completes"]);
    renderBars(document.querySelector("[data-chart=deposits]"), data?.series?.deposits || [], ["pending", "approved", "rejected"]);
    renderBars(document.querySelector("[data-chart=withdrawals]"), data?.series?.withdrawals || [], ["submitted", "approved", "rejected"]);
  };

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

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    load();
  });

  setDefaults();
  load();
})();
