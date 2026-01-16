// apps/server/src/public/idr-v4-checkout.js
// IDR v4 embeddable overlay (VA deposits + FAZZ disbursements). Isolated from P2P.
// Usage:
//   IBGCheckoutV4.init({ apiBase: '/api/v1', merchantBase: '/merchant', token: 'prefix.secret', diditSubject: 'user-123' });
//   IBGCheckoutV4.openDeposit({ method: 'VIRTUAL_BANK_ACCOUNT_DYNAMIC' });
//   IBGCheckoutV4.openWithdrawal();

(function () {
  "use strict";

  let _cfg = {
    apiBase: "/api/v1",
    merchantBase: "/merchant",
    token: "",
    diditSubject: "",
    onClose: null,
    onSuccess: null,
  };
  let _stylesInjected = false;

  function normalizeBase(value, fallback) {
    const raw = String(value || fallback || "").trim();
    return raw.endsWith("/") ? raw.slice(0, -1) : raw;
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (key === "class") node.className = value;
      else if (key === "style") node.style.cssText = value;
      else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    });
    (Array.isArray(children) ? children : [children]).forEach((child) => {
      if (child === null || child === undefined) return;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }

  function ensureStyles() {
    if (_stylesInjected) return;
    const style = document.createElement("style");
    style.textContent = `
      .idr-v4-overlay input,
      .idr-v4-overlay select {
        width: 100%;
        box-sizing: border-box;
        height: 36px;
        padding: 6px 10px;
        border: 1px solid #ddd;
        border-radius: 8px;
        font-family: inherit;
      }
      .idr-v4-overlay .btn,
      .idr-v4-overlay button {
        border: 1px solid #ddd;
        background: #f7f7f7;
        border-radius: 8px;
        padding: 6px 12px;
        cursor: pointer;
        font-family: inherit;
      }
      .idr-v4-overlay .btn.primary {
        background: #111827;
        border-color: #111827;
        color: #fff;
      }
    `;
    document.head.appendChild(style);
    _stylesInjected = true;
  }

  function notifyClose() {
    if (typeof _cfg.onClose === "function") _cfg.onClose();
  }

  function notifySuccess(payload) {
    if (typeof _cfg.onSuccess === "function") _cfg.onSuccess(payload || {});
  }

  function authHeaders() {
    return _cfg.token ? { authorization: `Bearer ${_cfg.token}` } : {};
  }

  async function apiPost(path, body) {
    const resp = await fetch(`${_cfg.apiBase}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body || {}),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data?.ok === false) {
      throw new Error(data?.error || data?.message || "Request failed");
    }
    return data;
  }

  async function fetchMeta(methodCode) {
    const resp = await fetch(`${_cfg.merchantBase}/idrv4/meta?method=${encodeURIComponent(methodCode)}`, {
      credentials: "include",
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.ok) {
      throw new Error(data?.error || "Unable to load meta");
    }
    return data;
  }

  function normalizeName(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function nameScore(a, b) {
    const left = normalizeName(a);
    const right = normalizeName(b);
    if (!left || !right) return 0;
    const leftWords = new Set(left.split(" "));
    const rightWords = new Set(right.split(" "));
    let common = 0;
    leftWords.forEach((w) => { if (rightWords.has(w)) common += 1; });
    return common / Math.max(leftWords.size, rightWords.size, 1);
  }

  function parseAmount(value) {
    const raw = String(value || "").replace(/,/g, "").trim();
    if (!raw) return null;
    const num = Number(raw);
    if (!Number.isFinite(num) || num <= 0) return null;
    return Math.round(num);
  }

  function bankLabel(code) {
    const map = {
      BCA: "BCA",
      BRI: "BRI",
      BNI: "BNI",
      MANDIRI: "Mandiri",
      CIMB_NIAGA: "CIMB Niaga",
      DANAMON: "Danamon",
      PERMATA: "Permata",
      HANA: "Hana",
      SAHABAT_SAMPOERNA: "Bank Sahabat Sampoerna",
      BSI: "Bank Syariah Indonesia",
    };
    const key = String(code || "").toUpperCase();
    return map[key] || key;
  }

  function openModal(title, builder) {
    ensureStyles();
    const overlay = el("div", {
      class: "idr-v4-overlay",
      style: "position:fixed; inset:0; background:rgba(0,0,0,.45); display:flex; align-items:center; justify-content:center; z-index:99999;",
    });
    const box = el("div", {
      class: "idr-v4-box",
      style: "width:min(720px, 92vw); background:#fff; border-radius:12px; padding:16px; box-shadow:0 10px 30px rgba(0,0,0,.2); font-family: ui-sans-serif, system-ui;",
    });
    const headerTitle = el("div", { style: "font-weight:600" }, title);
    const header = el("div", { style: "display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;" }, [
      headerTitle,
      el("button", { class: "btn", style: "border:none;background:#eee;border-radius:8px;padding:6px 10px;cursor:pointer" }, "Close"),
    ]);
    header.querySelector("button").addEventListener("click", () => {
      overlay.remove();
      notifyClose();
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        overlay.remove();
        notifyClose();
      }
    });
    const body = el("div");
    box.appendChild(header);
    box.appendChild(body);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    builder(body, () => {
      overlay.remove();
      notifyClose();
    }, headerTitle);
  }

  async function openDeposit(opts = {}) {
    const methodCode = (opts.method || "VIRTUAL_BANK_ACCOUNT_DYNAMIC").toUpperCase();
    openModal("IDR v4 Deposit", async (body, close, headerTitle) => {
      const form = el("form", { style: "display:grid; gap:10px;" });
      const amount = el("input", { class: "input", inputmode: "numeric", placeholder: "Amount (IDR, min 10,000 max 100,000,000)" });
      const fullName = el("input", { class: "input", placeholder: "Full name" });
      const bank = el("select", { class: "input" });
      const warning = el("div", { class: "muted", style: "font-size:12px; color:#b91c1c; display:none;" });
      const actions = el("div", { style: "display:flex; gap:8px; justify-content:flex-end;" }, [
        el("button", { class: "btn", type: "button" }, "Cancel"),
        el("button", { class: "btn primary", type: "submit" }, "Create VA"),
      ]);
      actions.firstChild.addEventListener("click", close);

      const row = (label, inputEl) => el("label", { class: "form-line", style: "display:grid; grid-template-columns: 160px 1fr; gap:8px; align-items:center;" }, [
        el("span", { class: "muted" }, label),
        inputEl,
      ]);

      form.append(
        row("Amount (IDR)", amount),
        row("Full name", fullName),
        row("Bank (VA)", bank),
        warning,
        actions,
      );
      body.appendChild(form);

      if (!_cfg.diditSubject) {
        warning.style.display = "";
        warning.textContent = "Missing diditSubject. Provide it in IBGCheckoutV4.init().";
        actions.lastChild.disabled = true;
        return;
      }
      if (!_cfg.token) {
        warning.style.display = "";
        warning.textContent = "Missing API token. Provide it in IBGCheckoutV4.init().";
        actions.lastChild.disabled = true;
        return;
      }

      let limits = { minDeposit: null, maxDeposit: null };
      try {
        const meta = await fetchMeta(methodCode);
        const banks = Array.isArray(meta?.banks) ? meta.banks : [];
        limits = meta?.limits || limits;
        bank.innerHTML = "";
        banks.forEach((code) => bank.appendChild(el("option", { value: code }, bankLabel(code))));
      } catch (err) {
        warning.style.display = "";
        warning.textContent = (err && err.message) || "Unable to load bank list.";
      }

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        warning.style.display = "none";

        const amountCents = parseAmount(amount.value);
        if (!amountCents) { warning.textContent = "Enter a valid amount."; warning.style.display = ""; return; }
        if (typeof limits.minDeposit === "number" && amountCents < limits.minDeposit) {
          warning.textContent = `Amount must be ≥ ${limits.minDeposit.toLocaleString("en-US")} IDR.`; warning.style.display = ""; return;
        }
        if (typeof limits.maxDeposit === "number" && amountCents > limits.maxDeposit) {
          warning.textContent = `Amount must be ≤ ${limits.maxDeposit.toLocaleString("en-US")} IDR.`; warning.style.display = ""; return;
        }

        const name = String(fullName.value || "").trim();
        if (!name) { warning.textContent = "Enter the full name."; warning.style.display = ""; return; }

        actions.lastChild.disabled = true;
        try {
          const data = await apiPost("/deposit/intents?debug=1", {
            user: { diditSubject: _cfg.diditSubject || "" },
            amountCents,
            currency: "IDR",
            bankCode: String(bank.value || ""),
            methodCode,
            paymentMethodDisplayName: name,
          });
          const intent = data?.data || data;
          const va = intent?.va || {};
          const instructions = intent?.instructions || {};
          const meta = instructions?.meta || va?.meta || {};
          const uniqueRefNo = meta?.uniqueRefNo || null;
          const fallbackSteps = [
            "Open your banking app.",
            "Transfer the amount to the VA below.",
            "Use immediate transfer if available.",
          ];
          const steps = Array.isArray(instructions?.steps) && instructions.steps.length
            ? instructions.steps
            : fallbackSteps;
          const isDynamic = methodCode.toUpperCase().includes("DYNAMIC");
          const expiresAt = intent?.expiresAt || intent?.expiredAt || null;
          body.innerHTML = "";
          if (headerTitle) headerTitle.textContent = "Transfer details";
          body.appendChild(el("div", { class: "muted", style: "margin-bottom:8px;" }, "Use the details below to make your transfer. Always include the reference."));
          const rows = [
            ...(uniqueRefNo && isDynamic ? [el("div", { class: "muted" }, "Unique Reference No"), el("div", { class: "mono" }, uniqueRefNo)] : []),
            el("div", { class: "muted" }, "Bank"), el("div", {}, bankLabel(va.bankCode || "")),
            el("div", { class: "muted" }, "Account No"), el("div", { class: "mono" }, va.accountNo || "-"),
            el("div", { class: "muted" }, "Account Name"), el("div", {}, va.accountName || "-"),
            el("div", { class: "muted" }, "Amount"), el("div", { class: "mono" }, `IDR ${amountCents.toLocaleString("en-US")}`),
          ];
          if (isDynamic && expiresAt) {
            rows.push(el("div", { class: "muted" }, "Expiry"), el("div", {}, String(expiresAt)));
          }
          body.appendChild(el("div", { style: "display:grid; grid-template-columns: 160px 1fr; gap:6px;" }, rows));

          body.appendChild(el("div", { class: "muted", style: "margin:12px 0 4px;" }, "Steps"));
          const ol = el("ol", { style: "margin:0 0 8px 16px; padding:0;" });
          steps.forEach((step) => ol.appendChild(el("li", {}, step)));
          body.appendChild(ol);
          const statusEl = el("div", { class: "muted", style: "margin-top:10px;" }, "Awaiting payment confirmation.");
          const pollBtn = el("button", { class: "btn primary", type: "button", style: "margin-top:10px;" }, "I've paid");
          body.appendChild(statusEl);
          body.appendChild(el("div", { style: "display:flex; justify-content:flex-end; margin-top:12px;" }, [pollBtn]));
          pollBtn.addEventListener("click", async () => {
            pollBtn.disabled = true;
            let attempts = 0;
            const interval = setInterval(async () => {
              attempts += 1;
              try {
                const confirm = await apiPost("/deposit/confirm", { id: intent?.id });
                const status = confirm?.status || confirm?.data?.status || "PENDING";
                statusEl.textContent = `Status: ${status}`;
                if (status === "APPROVED" || attempts >= 20) {
                  clearInterval(interval);
                  pollBtn.disabled = false;
                  if (status === "APPROVED") notifySuccess({ type: "deposit", referenceCode: intent?.referenceCode });
                }
              } catch (err) {
                clearInterval(interval);
                pollBtn.disabled = false;
                statusEl.textContent = (err && err.message) || "Unable to confirm payment.";
              }
            }, 2500);
          });
        } catch (err) {
          warning.textContent = (err && err.message) || "Unable to create deposit.";
          warning.style.display = "";
        } finally {
          actions.lastChild.disabled = false;
        }
      });
    });
  }

  async function openWithdrawal() {
    openModal("IDR v4 Withdrawal", async (body, close) => {
      const form = el("form", { style: "display:grid; gap:10px;" });
      const amount = el("input", { class: "input", inputmode: "numeric", placeholder: "Amount (IDR, min 10,000 max 100,000,000)" });
      const bank = el("select", { class: "input" });
      const holderName = el("input", { class: "input", placeholder: "Account holder name" });
      const accountNo = el("input", { class: "input", placeholder: "Account number" });
      const validateBtn = el("button", { class: "btn", type: "button" }, "Validate");
      const validateMsg = el("span", { class: "muted" });
      const holderLabel = el("div", { class: "muted", style: "font-size:12px; display:none;" });
      const submitBtn = el("button", { class: "btn primary", type: "submit", disabled: "disabled" }, "Submit withdraw");
      const warning = el("div", { class: "muted", style: "font-size:12px; color:#b91c1c; display:none;" });

      const row = (label, inputEl) => el("label", { class: "form-line", style: "display:grid; grid-template-columns: 180px 1fr; gap:8px; align-items:center;" }, [
        el("span", { class: "muted" }, label),
        inputEl,
      ]);

      const actions = el("div", { style: "display:flex; gap:8px; justify-content:flex-end;" }, [
        el("button", { class: "btn", type: "button" }, "Cancel"),
        submitBtn,
      ]);
      actions.firstChild.addEventListener("click", close);

      form.append(
        row("Amount (IDR)", amount),
        row("Bank", bank),
        row("Account holder name", holderName),
        row("Account number", accountNo),
        el("div", { style: "display:flex; gap:8px; align-items:center;" }, [validateBtn, validateMsg]),
        holderLabel,
        warning,
        actions,
      );
      body.appendChild(form);

      if (!_cfg.diditSubject) {
        warning.style.display = "";
        warning.textContent = "Missing diditSubject. Provide it in IBGCheckoutV4.init().";
        submitBtn.disabled = true;
        validateBtn.disabled = true;
        return;
      }
      if (!_cfg.token) {
        warning.style.display = "";
        warning.textContent = "Missing API token. Provide it in IBGCheckoutV4.init().";
        submitBtn.disabled = true;
        validateBtn.disabled = true;
        return;
      }

      let limits = { minWithdrawal: null, maxWithdrawal: null };
      try {
        const meta = await fetchMeta("VIRTUAL_BANK_ACCOUNT_DYNAMIC");
        limits = meta?.limits || limits;
      } catch {
        // ignore
      }

      try {
        const resp = await fetch(`${_cfg.apiBase}/withdraw/config`, {
          method: "GET",
          headers: authHeaders(),
        });
        const data = await resp.json().catch(() => ({}));
        const banks = Array.isArray(data?.banks) ? data.banks : [];
        bank.innerHTML = "";
        banks.forEach((row) => {
          bank.appendChild(el("option", { value: row.code }, row.name || row.code));
        });
      } catch (err) {
        warning.style.display = "";
        warning.textContent = (err && err.message) || "Unable to load bank list.";
      }

      validateBtn.addEventListener("click", async () => {
        warning.style.display = "none";
        holderLabel.style.display = "none";
        const amt = parseAmount(amount.value);
        if (!amt) { warning.textContent = "Enter a valid amount."; warning.style.display = ""; return; }
        if (typeof limits.minWithdrawal === "number" && amt < limits.minWithdrawal) {
          warning.textContent = `Amount must be ≥ ${limits.minWithdrawal.toLocaleString("en-US")} IDR.`; warning.style.display = ""; return;
        }
        if (typeof limits.maxWithdrawal === "number" && amt > limits.maxWithdrawal) {
          warning.textContent = `Amount must be ≤ ${limits.maxWithdrawal.toLocaleString("en-US")} IDR.`; warning.style.display = ""; return;
        }

        const name = String(holderName.value || "").trim();
        const acc = String(accountNo.value || "").trim();
        const code = String(bank.value || "").trim();
        if (!name || !acc || !code) {
          warning.textContent = "Fill all fields first."; warning.style.display = ""; return;
        }

        validateMsg.textContent = "Validating…";
        validateBtn.disabled = true;
        try {
          const resp = await fetch(`${_cfg.merchantBase}/idrv4/validate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ bankCode: code, accountNo: acc, name }),
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok || !data?.ok) throw new Error(data?.error || "Validation failed");
          const score = nameScore(name, data?.holder || "");
          holderLabel.textContent = data?.holder ? `Account holder: ${data.holder}` : "";
          holderLabel.style.display = data?.holder ? "" : "none";
          if (score >= 0.6) {
            validateMsg.textContent = "Validated ✓";
            submitBtn.disabled = false;
          } else {
            validateMsg.textContent = "Name mismatch.";
            submitBtn.disabled = true;
          }
        } catch (err) {
          validateMsg.textContent = (err && err.message) || "Validation error";
          submitBtn.disabled = true;
        } finally {
          validateBtn.disabled = false;
        }
      });

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        warning.style.display = "none";
        const amountCents = parseAmount(amount.value);
        if (!amountCents) { warning.textContent = "Enter a valid amount."; warning.style.display = ""; return; }

        submitBtn.disabled = true;
        try {
          const data = await apiPost("/withdrawals", {
            user: { diditSubject: _cfg.diditSubject || "" },
            amountCents,
            currency: "IDR",
            methodCode: "FAZZ_SEND",
            destination: {
              bankCode: String(bank.value || "").trim(),
              holderName: String(holderName.value || "").trim(),
              accountNo: String(accountNo.value || "").trim(),
            },
          });
          const result = data?.data || data;
          body.innerHTML = "";
          body.appendChild(el("div", { class: "muted", style: "margin-bottom:6px;" }, "Withdrawal submitted"));
          body.appendChild(el("div", { class: "mono" }, `Reference: ${result?.referenceCode || "-"}`));
          const statusEl = el("div", { class: "muted", style: "margin-top:10px;" }, "Status: PENDING");
          const refresh = el("button", { class: "btn primary", type: "button", style: "margin-top:8px;" }, "Refresh status");
          body.appendChild(statusEl);
          body.appendChild(el("div", { style: "display:flex; justify-content:flex-end; margin-top:8px;" }, [refresh]));

          refresh.addEventListener("click", async () => {
            refresh.disabled = true;
            try {
              const confirm = await apiPost("/withdraw/confirm", { referenceCode: result?.referenceCode });
              const status = confirm?.status || confirm?.data?.status || "PENDING";
              statusEl.textContent = `Status: ${status}`;
              if (status === "APPROVED") notifySuccess({ type: "withdrawal", referenceCode: result?.referenceCode });
            } catch (err) {
              statusEl.textContent = (err && err.message) || "Unable to refresh status.";
            } finally {
              refresh.disabled = false;
            }
          });
        } catch (err) {
          warning.textContent = (err && err.message) || "Unable to submit withdrawal.";
          warning.style.display = "";
        } finally {
          submitBtn.disabled = false;
        }
      });
    });
  }

  window.IBGCheckoutV4 = {
    init(cfg) {
      _cfg = {
        ..._cfg,
        ...cfg,
      };
      _cfg.apiBase = normalizeBase(_cfg.apiBase, "/api/v1");
      _cfg.merchantBase = normalizeBase(_cfg.merchantBase, "/merchant");
      return _cfg;
    },
    openDeposit(opts) {
      return openDeposit(opts || {});
    },
    openWithdrawal() {
      return openWithdrawal();
    },
  };
})();
