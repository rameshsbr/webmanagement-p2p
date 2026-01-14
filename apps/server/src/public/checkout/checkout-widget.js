// apps/server/src/public/checkout/checkout-widget.js
// Plain JS (no TS syntax). Keeps your current behavior; only tiny guards/semicolons.

(function () {
  "use strict";

  const DEFAULT_THEME = "light";

  // global, persisted after init()
  let _cfg = {
    token: null,
    theme: DEFAULT_THEME,
    onKycApproved: null,
    onKycRejected: null,
    onDepositSubmitted: null,
    onWithdrawalSubmitted: null,
    onError: null,
  };

  // claims from /public/deposit/draft (merchantId, diditSubject, currency)
  let _claims = null;

  const _bankFormCache = {};
  let _availableMethods = [];
  // NEW: remember per-method limits from /public/deposit/banks
  const _methodLimits = Object.create(null); // { METHOD: {minCents,maxCents} }

  function ensureStyles() {
    if (document.querySelector('link[data-payx-style="1"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/public/checkout/styles.css";
    link.setAttribute("data-payx-style", "1");
    document.head.appendChild(link);
  }

  const LS_KEY = (merchantId, subject, currency, kind) =>
    `payx:${merchantId}:${subject}:${currency}:${kind}`;

  function html(strings, ...vals) {
    return strings.reduce((s, c, i) => s + c + (vals[i] ?? ""), "");
  }

  function el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === "class") e.className = v;
      else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    });
    (Array.isArray(children) ? children : [children]).forEach((c) =>
      typeof c === "string" ? e.appendChild(document.createTextNode(c)) : c && e.appendChild(c)
    );
    return e;
  }

  // Legacy fallbacks (used when server didn't send limits)
  const MIN_AMOUNT = 50;
  const MAX_AMOUNT = 5000;

  function currencyUnit() {
    const cur = String((_claims && _claims.currency) || "AUD").trim();
    return cur ? cur.toUpperCase() : "AUD";
  }

  const NO_FORM_MESSAGE = "No configured form for this method and currency.";
  const NO_METHODS_MESSAGE = "No configured methods.";

  function normalizeAmountInput(value) {
    if (value === null || value === undefined) return null;
    const num = Number(String(value).replace(/,/g, ""));
    if (!Number.isFinite(num) || num <= 0) return null;
    const cents = Math.round(num * 100);
    return Number.isFinite(cents) ? cents : null;
  }

  // Small UX helpers
  function setEnabled(btn, ok) {
    if (!btn) return;
    btn.disabled = !ok;
    btn.style.opacity = ok ? "" : ".6";
    btn.style.pointerEvents = ok ? "" : "none";
  }

  function toast(msg) {
    const t = document.createElement("div");
    t.className = "payx-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => t.classList.remove("show"), 1400);
    setTimeout(() => t.remove(), 1800);
  }

  function copy(text) {
    try { navigator.clipboard.writeText(String(text || "")); toast("Copied"); } catch {}
  }
  function kv(label, value, copyable = true) {
    const v = el("div", { class: "payx-kv" }, [
      el("div", { class: "payx-kv-label" }, label),
      el("div", { class: "payx-kv-value" }, String(value ?? "-")),
      copyable ? el("button", { class:"payx-copy", onclick: () => copy(value) }, "Copy") : null
    ].filter(Boolean));
    return v;
  }

  function modalShell(theme = DEFAULT_THEME) {
    const wrap = el("div", {
      class: `payx-overlay payx-theme-${theme}`,
      style: `
        position:fixed; inset:0; background:rgba(0,0,0,.5);
        display:flex; align-items:center; justify-content:center; z-index:99999;
      `,
    });
    const box = el("div", {
      class: "payx-box",
      style: `
        width:min(640px, 92vw); background:#fff; border-radius:12px; padding:16px;
        box-shadow:0 10px 30px rgba(0,0,0,.2); font-family: ui-sans-serif, system-ui; color:#222;
      `,
    });

    // Close helpers (Esc + backdrop)
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
    function close() { try { document.removeEventListener("keydown", onKey); } catch {} wrap.remove(); }
    document.addEventListener("keydown", onKey);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });

    const header = el("div", { style:"display:flex; justify-content:space-between; align-items:center; margin-bottom:8px" }, [
      el("div", { style:"font-weight:600" }, "Payment"),
      el("button", {
        class: "payx-close",
        onclick: () => close(),
        style:"border:none;background:#eee;border-radius:8px;padding:6px 10px;cursor:pointer"
      }, "Close"),
    ]);
    box.appendChild(header);
    wrap.appendChild(box);
    document.body.appendChild(wrap);
    return { wrap, box, header, close };
  }

  async function call(path, token, init) {
    const resp = await fetch(path, {
      ...init,
      headers: {
        ...(init && init.headers ? init.headers : {}),
        authorization: `Bearer ${token}`,
      },
    });
    const ct = resp.headers.get("content-type") || "";
    if (!resp.ok) {
      let err = { ok: false, status: resp.status, error: "HTTP_ERROR" };
      try { err = await resp.json(); } catch {}
      console.error(`[PayX] request failed (${resp.status}) for ${path}`, err);
      throw err;
    }
    return ct.includes("application/json") ? resp.json() : resp.text();
  }

  function inputRow(label, inputEl, required = false) {
    const lbl = el("div", {
      style:"opacity:.7; padding-top:6px; white-space:nowrap"
    }, [
      String(label),
      required ? el("span", { style:"color:#dc2626; margin-left:2px" }, "*") : null
    ].filter(Boolean));
    const row = el("label", { style:"display:grid; grid-template-columns: 140px 1fr; gap:8px; margin:8px 0" }, [
      lbl,
      inputEl
    ]);
    return row;
  }

  function numberInput(attrs) {
    const i = el("input", {
      type:"text",
      inputmode:"numeric",
      pattern:"[0-9\\s-]*",
      autocomplete:"off",
      spellcheck:"false",
      ...attrs,
      style:"height:36px; width:100%; box-sizing:border-box; padding:6px 10px"
    });
    i.addEventListener("wheel", () => i.blur());
    return i;
  }

  function textInput(attrs) { return el("input", { type:"text", ...attrs, style:"height:36px; width:100%; box-sizing:border-box; padding:6px 10px" }); }

  // KYC popup lifecycle
  let _kycPopup = null;
  let _listenerInstalled = false;

  function safeCallback(name, payload) {
    try {
      const fn = _cfg[name];
      if (typeof fn === "function") fn(payload);
    } catch (err) { console.error("[PayX] callback error:", err); }
  }

  function installKycListener() {
    if (_listenerInstalled) return;
    _listenerInstalled = true;
    window.addEventListener("message", (ev) => {
      if (ev.origin !== location.origin) return;
      const msg = ev.data || {};
      if (msg && msg.type === "kyc.complete") {
        const status = String(msg.status || "").toLowerCase();
        try { if (_kycPopup && !_kycPopup.closed) _kycPopup.close(); } catch {}
        if (status === "approved") {
          safeCallback("onKycApproved", { sessionId: msg.sessionId, diditSubject: msg.diditSubject });
        } else if (status === "rejected" || status === "declined" || status === "failed") {
          safeCallback("onKycRejected", { sessionId: msg.sessionId, diditSubject: msg.diditSubject });
        }
      }
    });
  }

  // UPDATED: allow dynamic limits
  function validateAmountRange(amountCents, limits) {
    const has = limits && Number.isFinite(limits.minCents) && Number.isFinite(limits.maxCents);
    const minC = has ? Math.max(0, limits.minCents) : MIN_AMOUNT * 100;
    const maxC = has ? Math.max(minC, limits.maxCents) : MAX_AMOUNT * 100;
    if (!Number.isInteger(amountCents) || amountCents < minC || amountCents > maxC) {
      const minStr = (minC / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const maxStr = (maxC / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return `Enter an amount between ${minStr} and ${maxStr} ${currencyUnit()}.`;
    }
    return null;
  }
  function validateDepositInputs(amountCents, limits) { return validateAmountRange(amountCents, limits); }
  function validateWithdrawalInputs(amountCents, limits) { return validateAmountRange(amountCents, limits); }

  async function ensureKyc(token) {
    const st = await call("/public/kyc/status", token, { method:"GET" });
    if (st.status === "approved") return true;
    const start = await call("/public/kyc/start", token, { method:"POST" });
    if (start?.url) {
      installKycListener();
      _kycPopup = window.open(start.url, "payx_kyc", "popup=yes,noopener,noreferrer,width=480,height=720");
    }
    for (let i=0; i<10; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const s2 = await call("/public/kyc/status", token, { method:"GET" });
      if (s2.status === "approved") { safeCallback("onKycApproved", {}); return true; }
      if (s2.status === "rejected")  { safeCallback("onKycRejected", {}); throw { ok:false, error:"KYC_REJECTED" }; }
    }
    throw { ok:false, error:"KYC_PENDING" };
  }

  function saveDraft(kind, claims, data) {
    try { localStorage.setItem(LS_KEY(claims.merchantId, claims.diditSubject, claims.currency, kind), JSON.stringify(data)); } catch {}
  }
  function loadDraft(kind, claims) {
    try {
      const raw = localStorage.getItem(LS_KEY(claims.merchantId, claims.diditSubject, claims.currency, kind));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  function clearDraft(kind, claims) { try { localStorage.removeItem(LS_KEY(claims.merchantId, claims.diditSubject, claims.currency, kind)); } catch {} }

  // Dynamic extras from /public/forms
  function buildDynamicFrom(fields, draftExtras) {
    const list = Array.isArray(fields) ? fields : [];
    const wrap = el("div");
    if (!list.length) return { wrap, getValues: () => ({}), validate: () => null };

    const metas = [];

    list.forEach((f) => {
      if (!f || !f.name) return;
      let input;
      if (f.display === "select") {
        input = el(
          "select",
          { style: "height:36px; width:100%; box-sizing:border-box; padding:6px 10px" },
          (Array.isArray(f.options) ? f.options : []).map((opt) =>
            el("option", { value: String(opt) }, String(opt))
          )
        );
      } else if (f.display === "file") {
        input = el("input", {
          type: "file",
          style: "height:36px; width:100%; box-sizing:border-box; padding:6px 10px",
        });
      } else {
        input = f.field === "number"
          ? numberInput({ placeholder: f.placeholder || "" })
          : textInput({ placeholder: f.placeholder || "" });
      }

      if (draftExtras && draftExtras[f.name] != null && input && input.type !== "file") {
        input.value = String(draftExtras[f.name]);
      }

      if (f.display === "input" && f.field === "number" && input && input.type !== "file") {
        input.addEventListener("input", () => {
          const filtered = input.value.replace(/[^0-9\s-]+/g, "");
          if (filtered !== input.value) input.value = filtered;
        });
        input.addEventListener("blur", () => {
          const trimmed = String(input.value || "").trim();
          input.value = trimmed ? trimmed.replace(/[\s-]+/g, "") : "";
        });
      }

      const errorEl = el("div", {
        style: "color:#dc2626; font-size:12px; margin:4px 0 0; display:none",
      });
      const row = inputRow(f.name, input, !!f.required);
      const rowWrap = el("div", { style: "margin-bottom:8px" }, [row, errorEl]);
      wrap.appendChild(rowWrap);

      if (input && input.type !== "file") {
        metas.push({ field: f, input, errorEl });
      }
    });

    function getValues() {
      const out = {};
      metas.forEach(({ field, input }) => {
        if (!field || !field.name) return;
        if (field.display === "input" && field.field === "number") {
          const trimmed = String(input.value || "").trim();
          out[field.name] = trimmed ? trimmed.replace(/[\s-]+/g, "") : "";
        } else if (field.display === "select") {
          out[field.name] = String(input.value || "");
        } else {
          out[field.name] = String(input.value || "").trim();
        }
      });
      return out;
    }

    function setError(meta, message) {
      if (!meta || !meta.errorEl) return;
      if (message) {
        meta.errorEl.textContent = message;
        meta.errorEl.style.display = "block";
        meta.input.setAttribute("aria-invalid", "true");
      } else {
        meta.errorEl.textContent = "";
        meta.errorEl.style.display = "none";
        meta.input.removeAttribute("aria-invalid");
      }
    }

    function validate() {
      const vals = getValues();
      let firstMessage = null;
      metas.forEach((meta) => {
        const { field, input } = meta;
        if (!field || !field.name) return;
        const raw = String(input.value || "");
        const trimmed = raw.trim();
        let message = "";

        if (field.required && trimmed === "") {
          message = `${field.name} is required.`;
        } else if (
          field.display === "select" &&
          Array.isArray(field.options) &&
          field.options.length
        ) {
          const val = String(input.value || "");
          if (trimmed && !field.options.includes(val)) {
            message = `${field.name} has an invalid value.`;
          }
        } else if (field.display === "input" && field.field === "number" && trimmed !== "") {
          if (!/^[\d\s-]+$/.test(trimmed)) {
            message = "Enter digits only.";
          } else {
            const normalized = vals[field.name] || "";
            if (!/^\d+$/.test(normalized)) {
              message = "Enter digits only.";
            } else {
              const min = Number.isFinite(field.minDigits)
                ? Math.max(0, Math.floor(field.minDigits))
                : 0;
              const max =
                typeof field.maxDigits === "number" && Number.isFinite(field.maxDigits)
                  ? Math.max(min, Math.floor(field.maxDigits))
                  : null;
              const len = normalized.length;
              if (max !== null && min > 0 && (len < min || len > max)) {
                message = `Enter between ${min} and ${max} digits.`;
              } else if (min > 0 && len < min) {
                message = `Enter at least ${min} digits.`;
              } else if (max !== null && len > max) {
                message = `Enter at most ${max} digits.`;
              }
            }
          }
        }

        setError(meta, message);
        if (!firstMessage && message) firstMessage = message;
      });

      return firstMessage;
    }

    return { wrap, getValues, validate };
  }

  async function getBankAndFormsForMethod(token, methodValue) {
    const method = String(methodValue || "").trim();
    const currency = currencyUnit();
    const cacheKey = `${method}::${currency}`;
    if (_bankFormCache[cacheKey]) return _bankFormCache[cacheKey];

    if (!method) return { bankId: null, depositFields: [], withdrawalFields: [], limits: null };

    const params = new URLSearchParams();
    if (method) params.set("method", method);
    if (currency) params.set("currency", currency);
    const query = params.toString();

    console.info(`[PayX] getBankAndFormsForMethod:start`, { method, currency });
    let banksResp;
    try {
      banksResp = await call(query ? `/public/deposit/banks?${query}` : "/public/deposit/banks", token, { method: "GET" });
    } catch (err) {
      console.error(`[PayX] getBankAndFormsForMethod:banks error`, err);
      throw err;
    }
    const banks = (banksResp && Array.isArray(banksResp.banks)) ? banksResp.banks : [];
    const methodU = method.toUpperCase();
    const candidates = banks.filter((b) => {
      if (!b) return false;
      const val = String(b.method || "").trim().toUpperCase();
      const active = b.active === undefined || b.active === null || !!b.active;
      return active && val === methodU;
    });
    const firstActive = candidates[0];

    if (!firstActive || !firstActive.id) {
      const result = { bankId: null, depositFields: [], withdrawalFields: [], limits: null };
      _bankFormCache[cacheKey] = result;
      console.warn(`[PayX] getBankAndFormsForMethod:no-bank`, { method, currency });
      return result;
    }

    // capture limits (server now sends them)
    const limits = firstActive.limits && Number.isFinite(firstActive.limits.minCents) && Number.isFinite(firstActive.limits.maxCents)
      ? { minCents: Number(firstActive.limits.minCents), maxCents: Number(firstActive.limits.maxCents) }
      : null;

    let cfg;
    try {
      cfg = await call(`/public/forms?bankAccountId=${encodeURIComponent(firstActive.id)}`, token, { method: "GET" });
    } catch (err) {
      console.error(`[PayX] getBankAndFormsForMethod:forms error`, err);
      throw err;
    }
    const result = {
      bankId: firstActive.id,
      depositFields: Array.isArray(cfg?.deposit) ? cfg.deposit : [],
      withdrawalFields: Array.isArray(cfg?.withdrawal) ? cfg.withdrawal : [],
      limits,
    };
    _bankFormCache[cacheKey] = result;
    console.info(`[PayX] getBankAndFormsForMethod:success`, { method, currency, bankId: firstActive.id, limits });
    return result;
  }

  async function fetchAvailableMethods(token) {
    const currency = currencyUnit();
    const params = new URLSearchParams();
    if (currency) params.set("currency", currency);
    const query = params.toString();
    console.info(`[PayX] fetchAvailableMethods:start`, { currency });
    let resp;
    try {
      resp = await call(query ? `/public/deposit/banks?${query}` : "/public/deposit/banks", token, { method: "GET" });
    } catch (err) {
      console.error(`[PayX] fetchAvailableMethods:error`, err);
      _availableMethods = [];
      throw err;
    }
    const banks = (resp && Array.isArray(resp.banks)) ? resp.banks : [];
    const methods = [];
    banks.forEach((bank) => {
      const value = String(bank?.method || "").trim().toUpperCase();
      if (!value) return;
      if (methods.find((m) => m.value === value)) return;
      const label = String(bank?.methodLabel || value).trim();
      methods.push({ value, label: label || value });
      // remember limits for this method (first seen)
      if (bank && bank.limits && !_methodLimits[value]) {
        _methodLimits[value] = {
          minCents: Number(bank.limits.minCents),
          maxCents: Number(bank.limits.maxCents),
        };
      }
    });
    _availableMethods = methods;
    console.info(`[PayX] fetchAvailableMethods:done`, { count: methods.length, methods, limits:_methodLimits });
    return methods;
  }

  function buildMethodSelect(selectedMethod) {
    const opts = Array.isArray(_availableMethods) ? _availableMethods : [];
    const select = el("select", {
      style: "height:36px; width:100%; box-sizing:border-box; padding:6px 10px",
      ...(opts.length ? {} : { disabled: "disabled" })
    });

    if (!opts.length) {
      select.appendChild(el("option", { value: "" }, "No methods configured"));
      select.value = "";
      return select;
    }

    const normalizedSelected = String(selectedMethod || "").trim().toUpperCase();
    opts.forEach((item) => {
      select.appendChild(el("option", { value: item.value }, item.label || item.value));
    });
    if (normalizedSelected && opts.find((m) => m.value === normalizedSelected)) {
      select.value = normalizedSelected;
    } else if (opts.length) {
      select.value = opts[0].value;
    }
    return select;
  }

  function normKey(k) { return String(k || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
  function findValue(extras, names) {
    const keys = Object.keys(extras || {});
    for (const want of names) {
      const w = normKey(want);
      for (const k of keys) {
        if (normKey(k) === w) return extras[k];
      }
    }
    return undefined;
  }
  function normalizeNameTokens(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }
  function computeNameSimilarity(a, b) {
    if (!a || !b) return 0;
    const tokensA = new Set(normalizeNameTokens(a));
    const tokensB = new Set(normalizeNameTokens(b));
    if (!tokensA.size || !tokensB.size) return 0;
    let intersection = 0;
    tokensA.forEach((t) => {
      if (tokensB.has(t)) intersection += 1;
    });
    return (2 * intersection) / (tokensA.size + tokensB.size);
  }
  function evaluateNameMatch(payerName, firstName, lastName, fullName) {
    const raw = String(payerName || "").trim();
    if (!raw) return { score: 0, allow: true, needsReview: false };

    const combined = [firstName, lastName].filter(Boolean).join(" ") || null;
    const scores = [
      computeNameSimilarity(raw, fullName || null),
      computeNameSimilarity(raw, combined),
      computeNameSimilarity(raw, firstName || null),
      computeNameSimilarity(raw, lastName || null),
    ].filter((s) => s > 0);

    const best = scores.length ? Math.max(...scores) : 0;
    const ALLOW_THRESHOLD = 0.60;
    const EXACT_THRESHOLD = 0.999;

    const allow = best >= ALLOW_THRESHOLD;
    const needsReview = best >= ALLOW_THRESHOLD && best < EXACT_THRESHOLD;
    return { score: best, allow, needsReview };
  }
  function normalizeAuMobile(input) {
    const digits = String(input || "").replace(/[^\d]/g, "");
    if (/^04\d{8}$/.test(digits)) return "+61" + digits.slice(1);
    if (/^614\d{8}$/.test(digits)) return "+61" + digits.slice(2);
    if (/^61\d{9}$/.test(digits)) return "+" + digits;
    return input || "";
  }
  function inferPayerFromExtras(methodVal, extras) {
    const ex = extras || {};
    const bankNameRaw = findValue(ex, ["bank name", "bank", "withdrawal bank", "payout bank", "bank selection"]);
    const bankName = bankNameRaw != null ? String(bankNameRaw).trim() : "";

    if (methodVal === "OSKO") {
      const holderName = findValue(ex, ["account holder name", "holder name", "account name", "name", "account holder"]);
      const accountNo = findValue(ex, ["account number", "account no", "account #", "acct number"]);
      const bsb = findValue(ex, ["bsb"]);
      return {
        holderName: String(holderName || ""),
        accountNo: String(accountNo || ""),
        bsb: String(bsb || ""),
        bankName: bankName || undefined,
      };
    }
    const emailRaw = findValue(ex, ["email", "payid (email)"]);
    const mobileRaw = findValue(ex, ["mobile", "phone", "payid (mobile)"]);
    const payIdValueRaw = findValue(ex, ["payid value", "payid", "pay id"]);
    const holderName = findValue(ex, ["account holder name", "holder name", "name", "account holder"]);
    const email = String(emailRaw || "").trim();
    const m1 = normalizeAuMobile(mobileRaw);
    const m2 = normalizeAuMobile(payIdValueRaw);
    const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
    const isMobile = (v) => /^\+61\d{9}$/.test(v);

    let type = "email";
    let value = "";

    if (isEmail(email)) {
      type = "email";
      value = email;
    } else if (isMobile(m1)) {
      type = "mobile";
      value = m1;
    } else if (isEmail(String(payIdValueRaw || ""))) {
      type = "email";
      value = String(payIdValueRaw).trim();
    } else if (isMobile(m2)) {
      type = "mobile";
      value = m2;
    }

    return {
      holderName: String(holderName || ""),
      payIdType: type,
      payIdValue: value,
      bankName: bankName || undefined,
    };
  }

  async function openDeposit(token, claims) {
    try {
      console.info("[PayX] openDeposit:fetchAvailableMethods:start");
      await fetchAvailableMethods(token);
      console.info("[PayX] openDeposit:fetchAvailableMethods:done");
    } catch (err) {
      console.error("[PayX] openDeposit:fetchAvailableMethods:error", err);
      _availableMethods = [];
    }

    const { box, header, close } = modalShell(_cfg.theme);
    header.firstChild.textContent = "Deposit";

    let nextBtn;

    const amount = numberInput({ placeholder:`Amount (${currencyUnit()}, min ${MIN_AMOUNT} max ${MAX_AMOUNT})` });
    const draft = loadDraft("deposit", claims) || {};
    if (draft.amountCents) amount.value = (draft.amountCents / 100).toFixed(2);

    const method = buildMethodSelect(draft.method);

    const dynMount = el("div");
    dynMount.appendChild(el("div", { style:"opacity:.65; font-size:12px; padding:6px 0" }, "Loading form…"));
    const configWarning = el("div", { style:"color:#dc2626; font-size:12px; margin-top:4px; display:none" });
    if (!(_availableMethods && _availableMethods.length)) {
      configWarning.textContent = NO_METHODS_MESSAGE;
      configWarning.style.display = "block";
    }

    let dyn = { wrap: el("div"), getValues: () => ({}), validate: () => null };
    let selectedBankId = null;
    let formReady = false;

    // NEW: track limits for current selection
    let currentLimits = null;
    function applyAmountLimits(limits) {
      const has = limits && Number.isFinite(limits.minCents) && Number.isFinite(limits.maxCents);
      if (has) {
        amount.min = (limits.minCents / 100).toString();
        amount.max = (limits.maxCents / 100).toString();
        amount.placeholder = `Amount (${currencyUnit()}, min ${(limits.minCents/100).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} max ${(limits.maxCents/100).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})})`;
      } else {
        amount.removeAttribute("min");
        amount.removeAttribute("max");
        amount.placeholder = `Amount (${currencyUnit()}, min ${MIN_AMOUNT} max ${MAX_AMOUNT})`;
      }
    }

    async function refreshDynForMethod() {
      const prev = typeof dyn.getValues === "function" ? dyn.getValues() : (draft.extras || {});
      dynMount.innerHTML = "";
      dynMount.appendChild(el("div", { style:"opacity:.65; font-size:12px; padding:6px 0" }, "Loading form…"));
      configWarning.style.display = "none";
      configWarning.textContent = "";
      formReady = false;
      selectedBankId = null;
      currentLimits = null;
      applyAmountLimits(null);

      const methodVal = String(method.value || "").trim().toUpperCase();
      if (!methodVal) {
        selectedBankId = null;
        dyn = buildDynamicFrom([], prev);
        dynMount.innerHTML = "";
        dynMount.appendChild(dyn.wrap);
        configWarning.textContent = (_availableMethods && _availableMethods.length)
          ? NO_FORM_MESSAGE
          : NO_METHODS_MESSAGE;
        configWarning.style.display = "block";
        updateValidity();
        return;
      }

      try {
        console.info("[PayX] openDeposit:getBankForms:start", methodVal);
        const { bankId, depositFields, limits } = await getBankAndFormsForMethod(token, methodVal);
        selectedBankId = bankId;
        currentLimits = limits || _methodLimits[methodVal] || null;
        applyAmountLimits(currentLimits);

        dyn = buildDynamicFrom(Array.isArray(depositFields) ? depositFields : [], prev);
        dynMount.innerHTML = "";
        dynMount.appendChild(dyn.wrap);
        if (!bankId || !(Array.isArray(depositFields) && depositFields.length)) {
          configWarning.textContent = NO_FORM_MESSAGE;
          configWarning.style.display = "block";
          formReady = false;
        } else {
          configWarning.textContent = "";
          configWarning.style.display = "none";
          formReady = true;
        }
        console.info("[PayX] openDeposit:getBankForms:done", { method: methodVal, bankId, currentLimits });
      } catch (e) {
        dyn = buildDynamicFrom([], prev);
        dynMount.innerHTML = "";
        dynMount.appendChild(dyn.wrap);
        configWarning.textContent = NO_FORM_MESSAGE;
        configWarning.style.display = "block";
        formReady = false;
      }
      updateValidity();
    }

    const status = el("div", { style:"margin-top:8px; font-size:12px; opacity:.8" });
    nextBtn = el("button", { style:"margin-top:10px; height:36px; padding:0 14px; cursor:pointer" }, "Next");

    function updateValidity() {
      const amountCents = normalizeAmountInput(amount.value);
      let err = validateDepositInputs(amountCents, currentLimits);
      err = err || dyn.validate();
      const ready = formReady && Boolean(String(method.value || ""));
      setEnabled(nextBtn, ready && !err);
      status.textContent = err || "";
    }

    method.addEventListener("change", () => { refreshDynForMethod(); });
    [amount].forEach(i => i && i.addEventListener("input", updateValidity));
    dynMount.addEventListener("input", updateValidity);
    dynMount.addEventListener("change", updateValidity);

    box.appendChild(inputRow(`Amount (${currencyUnit()})`, amount));
    box.appendChild(inputRow("Method", method));
    box.appendChild(dynMount);
    box.appendChild(configWarning);
    box.appendChild(nextBtn);
    box.appendChild(status);

    refreshDynForMethod();

    nextBtn.addEventListener("click", async () => {
      const amountCents = normalizeAmountInput(amount.value);
      const extras = dyn.getValues();
      const payer = inferPayerFromExtras(method.value, extras);

      const firstErr = validateDepositInputs(amountCents, currentLimits);
      if (firstErr) { status.textContent = firstErr; return; }

      if (!formReady || !method.value || !selectedBankId) {
        configWarning.textContent = selectedBankId ? NO_FORM_MESSAGE : NO_METHODS_MESSAGE;
        configWarning.style.display = "block";
        setEnabled(nextBtn, false);
        return;
      }

      const verr = dyn.validate();
      if (verr) { status.textContent = verr; return; }

      payer.holderName = String(payer.holderName || "").trim();
      const hasKycName = Boolean(
        (_claims && _claims.kycFullName) ||
        (_claims && _claims.kycFirstName) ||
        (_claims && _claims.kycLastName)
      );
      if (hasKycName) {
        const nameMatch = evaluateNameMatch(
          payer.holderName,
          (_claims && _claims.kycFirstName) || null,
          (_claims && _claims.kycLastName) || null,
          (_claims && _claims.kycFullName) || null,
        );
        if (!nameMatch.allow) {
          status.textContent = "Account holder name must match the verified KYC name.";
          return;
        }
      }

      saveDraft("deposit", claims, { amountCents, method: method.value, extras });

      try {
        status.textContent = "Checking verification…";
        await ensureKyc(token);

        status.textContent = "Creating intent…";
        const body = { amountCents, method: method.value, payer, extraFields: extras, bankAccountId: selectedBankId };

        const resp = await call("/public/deposit/intent", token, {
          method: "POST",
          headers: { "content-type":"application/json" },
          body: JSON.stringify(body),
        });

        renderDepositInstructions({ box, header, token, claims, intent: resp, close });
        clearDraft("deposit", claims);
      } catch (e) {
        const message = (e && (e.message || e.error)) ? String(e.message || e.error) : "Error";
        status.textContent = message;
        safeCallback("onError", { ...(e || {}), message });
      }
    });
  }

  function renderDepositInstructions({ box, header, token, claims, intent, close }) {
    while (box.childNodes.length > 1) box.removeChild(box.lastChild);
    header.firstChild.textContent = "Transfer details";

    const details = intent.bankDetails || {};
    const ref = intent.uniqueReference || intent.referenceCode;

    const intro = el("div", { style:"margin:4px 0 8px 0; opacity:.85" },
      "Use the details below to make your transfer. Always include the reference."
    );

    const grid = el("div");
    grid.appendChild(kv("Reference", ref));

    const fields = Array.isArray(details.displayFields) ? details.displayFields : [];
    fields.forEach((it) => {
      if (!it || it.value == null || it.value === "") return;
      const isNote = String(it.type || "").toLowerCase() === "note" || String(it.key||"") === "instructions";
      const row = kv(it.label || it.key || "-", it.value, !isNote);
      if (isNote) {
        const v = row.querySelector(".payx-kv-value");
        if (v) v.style.whiteSpace = "pre-wrap";
      }
      grid.appendChild(row);
    });

    const receipt = el("input", { type:"file", accept:"image/*,application/pdf" });
    const status = el("div", { style:"margin-top:8px; font-size:12px; opacity:.8" });

    const actions = el("div", { style:"display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;" });
    const backBtn = el("button", { style:"height:36px; padding:0 12px; cursor:pointer" }, "Back");
    backBtn.addEventListener("click", () => {
      while (box.childNodes.length > 1) box.removeChild(box.lastChild);
      openDeposit(token, claims);
    });

    const submitBtn = el("button", { style:"height:36px; padding:0 12px; cursor:pointer" }, "Submit");
    submitBtn.addEventListener("click", async () => {
      try {
        if (!receipt.files || !receipt.files[0]) {
          status.textContent = "Attach a receipt file first.";
          return;
        }
        if (!intent.intentToken) {
          status.textContent = "Intent expired. Please restart.";
          return;
        }
        const fd = new FormData();
        fd.append("receipt", receipt.files[0]);
        fd.append("intentToken", intent.intentToken);
        status.textContent = "Submitting…";
        submitBtn.disabled = true;
        const resp = await call(`/public/deposit/submit`, token, { method:"POST", body: fd });
        const refLabel = resp.uniqueReference || intent.uniqueReference || resp.referenceCode || intent.referenceCode;
        status.innerHTML = refLabel ? `Submitted. Reference: <b>${refLabel}</b>` : "Submitted. Thank you!";
        safeCallback("onDepositSubmitted", {
          id: resp.id,
          referenceCode: resp.referenceCode || intent.referenceCode,
          uniqueReference: resp.uniqueReference || intent.uniqueReference,
          amountCents: resp.amountCents || intent.amountCents,
          currency: resp.currency || intent.currency || currencyUnit(),
        });
        setTimeout(() => { submitBtn.disabled = false; }, 1500);
      } catch (e) {
        status.textContent = (e && e.error) ? String(e.error) : "Error";
        safeCallback("onError", e);
        submitBtn.disabled = false;
      }
    });

    const doneBtn = el("button", { style:"height:36px; padding:0 12px; cursor:pointer" }, "Done");
    doneBtn.addEventListener("click", () => close());

    actions.appendChild(backBtn);
    actions.appendChild(submitBtn);
    actions.appendChild(doneBtn);

    box.appendChild(intro);
    box.appendChild(grid);
    box.appendChild(inputRow("Receipt", receipt));
    box.appendChild(actions);
    box.appendChild(status);
  }

  async function openWithdrawal(token, claims) {
    try {
      console.info("[PayX] openWithdrawal:fetchAvailableMethods:start");
      await fetchAvailableMethods(token);
      console.info("[PayX] openWithdrawal:fetchAvailableMethods:done");
    } catch (err) {
      console.error("[PayX] openWithdrawal:fetchAvailableMethods:error", err);
      _availableMethods = [];
    }

    const { box, header } = modalShell(_cfg.theme);
    header.firstChild.textContent = "Withdrawal";

    let submit;

    const amount = numberInput({ placeholder:`Amount (${currencyUnit()}, min ${MIN_AMOUNT} max ${MAX_AMOUNT})` });
    const draft = loadDraft("withdrawal", claims) || {};
    if (draft.amountCents) amount.value = (draft.amountCents / 100).toFixed(2);

    const method = buildMethodSelect(draft.method);

    const dynMount = el("div");
    const loadingNotice = el("div", { style:"opacity:.65; font-size:12px; padding:6px 0" }, "Loading form…");
    dynMount.appendChild(loadingNotice);
    const configWarning = el("div", { style:"color:#dc2626; font-size:12px; margin-top:4px; display:none" });
    if (!(_availableMethods && _availableMethods.length)) {
      configWarning.textContent = NO_METHODS_MESSAGE;
      configWarning.style.display = "block";
    }
    let dyn = buildDynamicFrom([], draft.extras);
    const status = el("div", { style:"margin-top:8px; font-size:12px; opacity:.8" });

    submit = el("button", { style:"margin-top:10px; height:36px; padding:0 14px; cursor:pointer" }, "Submit withdrawal");
    setEnabled(submit, false);

    let formReady = false;
    let refreshSeq = 0;
    let selectedBankId = null;

    // NEW: track limits for current withdrawal method
    let currentLimits = null;
    function applyAmountLimits(limits) {
      const has = limits && Number.isFinite(limits.minCents) && Number.isFinite(limits.maxCents);
      if (has) {
        amount.min = (limits.minCents / 100).toString();
        amount.max = (limits.maxCents / 100).toString();
        amount.placeholder = `Amount (${currencyUnit()}, min ${(limits.minCents/100).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} max ${(limits.maxCents/100).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})})`;
      } else {
        amount.removeAttribute("min");
        amount.removeAttribute("max");
        amount.placeholder = `Amount (${currencyUnit()}, min ${MIN_AMOUNT} max ${MAX_AMOUNT})`;
      }
    }

    function updateValidity() {
      const amountCents = normalizeAmountInput(amount.value);
      let err = validateWithdrawalInputs(amountCents, currentLimits);
      err = err || dyn.validate();
      const ready = formReady && Boolean(String(method.value || "")) && Boolean(selectedBankId);
      setEnabled(submit, ready && !err);
      status.textContent = err || "";
    }

    async function refreshDynamicFields() {
      const seq = ++refreshSeq;
      const prev = typeof dyn.getValues === "function" ? dyn.getValues() : (draft.extras || {});
      dynMount.innerHTML = "";
      dynMount.appendChild(el("div", { style:"opacity:.65; font-size:12px; padding:6px 0" }, "Loading form…"));
      configWarning.style.display = "none";
      configWarning.textContent = "";
      formReady = false;
      selectedBankId = null;
      currentLimits = null;
      applyAmountLimits(null);

      const methodVal = String(method.value || "").trim().toUpperCase();
      if (!methodVal) {
        dyn = buildDynamicFrom([], prev);
        dynMount.innerHTML = "";
        dynMount.appendChild(dyn.wrap);
        configWarning.textContent = (_availableMethods && _availableMethods.length)
          ? NO_FORM_MESSAGE
          : NO_METHODS_MESSAGE;
        configWarning.style.display = "block";
        updateValidity();
        return;
      }

      try {
        console.info("[PayX] openWithdrawal:getBankForms:start", methodVal);
        const { bankId, withdrawalFields, limits } = await getBankAndFormsForMethod(token, methodVal);
        if (seq !== refreshSeq) return;
        selectedBankId = bankId || null;
        currentLimits = limits || _methodLimits[methodVal] || null;
        applyAmountLimits(currentLimits);

        dyn = buildDynamicFrom(Array.isArray(withdrawalFields) ? withdrawalFields : [], prev);
        dynMount.innerHTML = "";
        dynMount.appendChild(dyn.wrap);
        if (!bankId || !(Array.isArray(withdrawalFields) && withdrawalFields.length)) {
          configWarning.textContent = NO_FORM_MESSAGE;
          configWarning.style.display = "block";
          formReady = false;
        } else {
          configWarning.textContent = "";
          configWarning.style.display = "none";
          formReady = true;
        }
        console.info("[PayX] openWithdrawal:getBankForms:done", { method: methodVal, bankId, currentLimits });
      } catch (err) {
        if (seq !== refreshSeq) return;
        selectedBankId = null;
        dyn = buildDynamicFrom([], prev);
        dynMount.innerHTML = "";
        dynMount.appendChild(dyn.wrap);
        configWarning.textContent = NO_FORM_MESSAGE;
        configWarning.style.display = "block";
        formReady = false;
      }
      updateValidity();
    }

    [amount].forEach(i => { i && i.addEventListener("input", updateValidity); });
    method.addEventListener("change", () => { refreshDynamicFields(); });
    dynMount.addEventListener("input", updateValidity);
    dynMount.addEventListener("change", updateValidity);
    refreshDynamicFields().then(() => updateValidity());

    submit.addEventListener("click", async () => {
      const amountCents = normalizeAmountInput(amount.value);
      const extras = dyn.getValues();
      const destination = inferPayerFromExtras(method.value, extras);

      const firstErr = validateWithdrawalInputs(amountCents, currentLimits);
      if (firstErr) { status.textContent = firstErr; return; }

      if (!formReady || !method.value || !selectedBankId) {
        configWarning.textContent = NO_FORM_MESSAGE;
        configWarning.style.display = "block";
        setEnabled(submit, false);
        return;
      }

      const verr = dyn.validate();
      if (verr) { status.textContent = verr; return; }

      destination.holderName = String(destination.holderName || "").trim();
      const hasKycName = Boolean(
        (_claims && _claims.kycFullName) ||
        (_claims && _claims.kycFirstName) ||
        (_claims && _claims.kycLastName)
      );
      if (hasKycName) {
        const nameMatch = evaluateNameMatch(
          destination.holderName,
          (_claims && _claims.kycFirstName) || null,
          (_claims && _claims.kycLastName) || null,
          (_claims && _claims.kycFullName) || null,
        );
        if (!nameMatch.allow) {
          status.textContent = "Account holder name must match the verified KYC name.";
          return;
        }
      }

      saveDraft("withdrawal", claims, { amountCents, method: method.value, extras });

      try {
        status.textContent = "Checking verification…";
        try {
          await ensureKyc(token);
        } catch (e) {
          const message = (e && (e.message || e.error)) ? String(e.message || e.error) : "KYC error";
          status.textContent = message;
          return;
        }
        status.textContent = "Submitting…";
        const resp = await call("/public/withdrawals", token, {
          method: "POST",
          headers: { "content-type":"application/json" },
          body: JSON.stringify({
            amountCents,
            method: method.value,
            destination,
            extraFields: extras,
            bankAccountId: selectedBankId,
          }),
        });
        status.innerHTML = `Request submitted. Reference: <b>${resp.uniqueReference || resp.referenceCode}</b>`;
        clearDraft("withdrawal", claims);
        safeCallback("onWithdrawalSubmitted", {
          id: resp.id, referenceCode: resp.referenceCode, uniqueReference: resp.uniqueReference, amountCents, currency: resp.currency || currencyUnit()
        });
      } catch (e) {
        const message = (e && (e.message || e.error)) ? String(e.message || e.error) : "Error";
        status.textContent = message;
        safeCallback("onError", { ...(e || {}), message });
      }
    });

    box.appendChild(inputRow(`Amount (${currencyUnit()})`, amount));
    box.appendChild(inputRow("Method", method));
    box.appendChild(dynMount);
    box.appendChild(configWarning);
    box.appendChild(submit);
    box.appendChild(status);
  }

  // Public API
  window.PayX = {
    async init(cfg) {
      if (!cfg || !cfg.token) throw new Error("token required");
      ensureStyles();
      _cfg.token = cfg.token;
      _cfg.theme = (cfg.theme === "dark" || cfg.theme === "light") ? cfg.theme : DEFAULT_THEME;
      _cfg.onKycApproved = cfg.onKycApproved || null;
      _cfg.onKycRejected = cfg.onKycRejected || null;
      _cfg.onDepositSubmitted = cfg.onDepositSubmitted || null;
      _cfg.onWithdrawalSubmitted = cfg.onWithdrawalSubmitted || null;
      _cfg.onError = cfg.onError || null;

      this._token = cfg.token;

      try {
        const r = await fetch("/public/deposit/draft", { headers: { authorization:`Bearer ${cfg.token}` } });
        const j = await r.json();
        if (j && j.ok && j.claims) _claims = j.claims;
      } catch {}

      try { await fetchAvailableMethods(cfg.token); } catch { _availableMethods = []; }

      return true;
    },
    openDeposit() { this._open("deposit"); },
    openWithdrawal() { this._open("withdrawal"); },
    _open(kind) {
      if (!this._token) throw new Error("Call PayX.init({token}) first");
      const claims = _claims || {};
      if (kind === "deposit") return openDeposit(this._token, claims);
      return openWithdrawal(this._token, claims);
    }
  };
})();