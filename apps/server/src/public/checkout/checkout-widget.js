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

  // Merchant-level forms (loaded at init). We will still use these for withdrawals.
  let _forms = { ok: true, deposit: [], withdrawal: [] };
  const _withdrawalFormCache = {};
  let _availableMethods = [];
  let _availableMethodsCurrency = null;
  let _availableMethodsPromise = null;

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

  const MIN_AMOUNT = 50;
  const MAX_AMOUNT = 5000;
  const NO_FORM_MESSAGE = "No configured form for this method/currency.";

  function currencyUnit() {
    return (_claims && _claims.currency) || "AUD";
  }

  function currencyUnit() {
    const cur = String((_claims && _claims.currency) || "AUD").trim();
    return cur ? cur.toUpperCase() : "AUD";
  }

  const NO_FORM_MESSAGE = "No configured form for this method and currency.";

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

  function validateDepositInputs(amountCents) {
    if (!Number.isInteger(amountCents) || amountCents < MIN_AMOUNT * 100 || amountCents > MAX_AMOUNT * 100) {
      return `Enter an amount between ${MIN_AMOUNT} and ${MAX_AMOUNT} ${currencyUnit()}.`;
    }
    return null;
  }
  function validateWithdrawalInputs(amountCents) { return validateDepositInputs(amountCents); }

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

  async function fetchAvailableMethods(token) {
    const currency = (_claims && _claims.currency) ? _claims.currency : "";
    if (_availableMethods.length && _availableMethodsCurrency === currency) return _availableMethods;
    if (_availableMethodsPromise) return _availableMethodsPromise;

    _availableMethodsPromise = (async () => {
      try {
        const resp = await call(`/public/deposit/banks?currency=${encodeURIComponent(currency)}`, token, { method: "GET" });
        const banks = Array.isArray(resp?.banks) ? resp.banks : [];
        const seen = new Set();
        const list = [];
        banks.forEach((bank) => {
          const methodVal = bank && bank.method ? String(bank.method) : "";
          if (!methodVal || seen.has(methodVal)) return;
          seen.add(methodVal);
          list.push(methodVal);
        });
        _availableMethods = list;
        _availableMethodsCurrency = currency;
        return list;
      } catch (err) {
        _availableMethods = [];
        _availableMethodsCurrency = null;
        throw err;
      } finally {
        _availableMethodsPromise = null;
      }
    })();

    return _availableMethodsPromise;
  }

  function buildMethodSelect(selectedValue) {
    const select = el("select", {
      style: "height:36px; width:100%; box-sizing:border-box; padding:6px 10px"
    });
    _availableMethods.forEach((methodValue) => {
      select.appendChild(el("option", { value: methodValue }, methodValue));
    });
    if (_availableMethods.length === 0) select.disabled = true;
    if (selectedValue && _availableMethods.includes(selectedValue)) {
      select.value = selectedValue;
    } else if (_availableMethods.length) {
      select.value = _availableMethods[0];
    }
    return select;
  }

  async function getBankAndFormsForMethod(token, methodValue) {
    if (!methodValue) {
      return { bankId: null, depositFields: [], withdrawalFields: [], error: NO_FORM_MESSAGE };
    }
    const currency = (_claims && _claims.currency) ? _claims.currency : "";
    const query = `/public/deposit/banks?method=${encodeURIComponent(methodValue)}&currency=${encodeURIComponent(currency)}`;
    const banksResp = await call(query, token, { method: "GET" });
    const banks = Array.isArray(banksResp?.banks) ? banksResp.banks : [];
    const first = banks.find((b) => b && b.id && (b.active === undefined || b.active === true));

    if (!first) {
      return { bankId: null, depositFields: [], withdrawalFields: [], error: NO_FORM_MESSAGE };
    }

    const cfg = await call(`/public/forms?bankAccountId=${encodeURIComponent(first.id)}`, token, { method: "GET" });
    const depositFields = Array.isArray(cfg?.deposit) ? cfg.deposit : [];
    const withdrawalFields = Array.isArray(cfg?.withdrawal) ? cfg.withdrawal : [];
    const hasFields = depositFields.length || withdrawalFields.length;
    return {
      bankId: first.id,
      depositFields,
      withdrawalFields,
      error: hasFields ? null : NO_FORM_MESSAGE,
    };
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
    const email = findValue(ex, ["email", "payid (email)"]);
    let mobile = findValue(ex, ["mobile", "phone", "payid (mobile)"]);
    const payIdValue = findValue(ex, ["payid value", "payid", "pay id"]);
    const holderName = findValue(ex, ["account holder name", "holder name", "name", "account holder"]);
    let type = "email";
    let value = String(email || "");
    const looksMobile = (s) => /^\+?61\d{9}$/.test(String(s || "").trim());
    if (!value && looksMobile(mobile)) { type = "mobile"; value = String(mobile); }
    if (!value && payIdValue) {
      const pv = String(payIdValue);
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pv)) { type = "email"; value = pv; }
      else if (looksMobile(pv)) { type = "mobile"; value = pv; }
    }
    return {
      holderName: String(holderName || ""),
      payIdType: type,
      payIdValue: value,
      bankName: bankName || undefined,
    };
  }

  async function openDeposit(token, claims) {
    try { await fetchAvailableMethods(token); } catch { _availableMethods = []; }

    const { box, header, close } = modalShell(_cfg.theme);
    header.firstChild.textContent = "Deposit";

    _claims = { ...(_claims || {}), ...(claims || {}) };

    let methodsError = null;
    try {
      await fetchAvailableMethods(token);
    } catch (err) {
      methodsError = err && err.error ? String(err.error) : "Unable to load payment methods.";
    }

    let nextBtn;

    const amountPlaceholder = `Amount (${currencyUnit()}, min ${MIN_AMOUNT} max ${MAX_AMOUNT})`;
    const amount = numberInput({ placeholder: amountPlaceholder });
    const draft = loadDraft("deposit", claims) || {};
    if (draft.amountCents) amount.value = (draft.amountCents / 100).toFixed(2);

    const method = buildMethodSelect(draft.method);

    const dynMount = el("div");
    const loadingNotice = el("div", { style:"opacity:.65; font-size:12px; padding:6px 0" }, "Loading form…");
    dynMount.appendChild(loadingNotice);

    let dyn = { wrap: el("div"), getValues: () => ({}), validate: () => null };
    let selectedBankId = null;
    let hasConfigError = false;
    const configNotice = el("div", { style:"color:#dc2626; font-size:12px; margin:4px 0; display:none" });

    function setConfigError(message) {
      const msg = message || "";
      configNotice.textContent = msg;
      configNotice.style.display = msg ? "block" : "none";
      hasConfigError = Boolean(msg);
    }

    if (methodsError || !_availableMethods.length) {
      setConfigError(methodsError || NO_FORM_MESSAGE);
      dynMount.innerHTML = "";
    }

    async function refreshDynForMethod() {
      const selectedMethod = method.value;
      if (!selectedMethod) {
        selectedBankId = null;
        dyn = buildDynamicFrom([], draft.extras);
        dynMount.innerHTML = "";
        dynMount.appendChild(dyn.wrap);
        setConfigError(NO_FORM_MESSAGE);
        updateValidity();
        return;
      }
      dynMount.innerHTML = "";
      dynMount.appendChild(loadingNotice);
      try {
        const { bankId, depositFields, error } = await getBankAndFormsForMethod(token, selectedMethod);
        const errMsg = error || (depositFields && depositFields.length ? null : NO_FORM_MESSAGE);
        selectedBankId = errMsg ? null : bankId;
        dyn = buildDynamicFrom(depositFields, draft.extras);
        setConfigError(errMsg);
      } catch (err) {
        selectedBankId = null;
        dyn = buildDynamicFrom([], draft.extras);
        setConfigError((err && err.error) ? String(err.error) : "Unable to load form.");
      }
      updateValidity();
    }

    const status = el("div", { style:"margin-top:8px; font-size:12px; opacity:.8" });
    nextBtn = el("button", { style:"margin-top:10px; height:36px; padding:0 14px; cursor:pointer" }, "Next");

    function updateValidity() {
      if (hasConfigError) {
        setEnabled(nextBtn, false);
        status.textContent = "";
        return;
      }
      const amountCents = normalizeAmountInput(amount.value);
      let err = null;
      if (amountCents === null) {
        err = `Enter an amount between ${MIN_AMOUNT} and ${MAX_AMOUNT} ${currencyUnit()}.`;
      } else {
        err = validateDepositInputs(amountCents);
      }
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
    box.appendChild(configNotice);
    box.appendChild(nextBtn);
    box.appendChild(status);

    if (_availableMethods.length) refreshDynForMethod();
    else updateValidity();

    nextBtn.addEventListener("click", async () => {
      if (hasConfigError) {
        status.textContent = configNotice.textContent || NO_FORM_MESSAGE;
        return;
      }
      const amountCents = normalizeAmountInput(amount.value);
      const extras = dyn.getValues();
      const payer = inferPayerFromExtras(method.value, extras);

      if (amountCents === null) {
        status.textContent = `Enter an amount between ${MIN_AMOUNT} and ${MAX_AMOUNT} ${currencyUnit()}.`;
        return;
      }

      const verr = validateDepositInputs(amountCents) || dyn.validate();
      if (verr) { status.textContent = verr; return; }

      saveDraft("deposit", claims, { amountCents, method: method.value, extras });

      try {
        status.textContent = "Checking verification…";
        await ensureKyc(token);

        status.textContent = "Creating intent…";
        const body = { amountCents, method: method.value, payer, extraFields: extras };
        if (selectedBankId) body.bankAccountId = selectedBankId;

        const resp = await call("/public/deposit/intent", token, {
          method: "POST",
          headers: { "content-type":"application/json" },
          body: JSON.stringify(body),
        });

        renderDepositInstructions({ box, header, token, claims, intent: resp, close });
        clearDraft("deposit", claims);
      } catch (e) {
        status.textContent = (e && e.error) ? String(e.error) : "Error";
        safeCallback("onError", e);
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
    try { await fetchAvailableMethods(token); } catch { _availableMethods = []; }

    const { box, header } = modalShell(_cfg.theme);
    header.firstChild.textContent = "Withdrawal";

    _claims = { ...(_claims || {}), ...(claims || {}) };

    let methodsError = null;
    try {
      await fetchAvailableMethods(token);
    } catch (err) {
      methodsError = err && err.error ? String(err.error) : "Unable to load payment methods.";
    }

    let submit;

    const amountPlaceholder = `Amount (${currencyUnit()}, min ${MIN_AMOUNT} max ${MAX_AMOUNT})`;
    const amount = numberInput({ placeholder: amountPlaceholder });
    const draft = loadDraft("withdrawal", claims) || {};
    if (draft.amountCents) amount.value = (draft.amountCents / 100).toFixed(2);

    const method = buildMethodSelect(draft.method);

    const dynMount = el("div");
    const loadingNotice = el("div", { style:"opacity:.65; font-size:12px; padding:6px 0" }, "Loading form…");
    dynMount.appendChild(loadingNotice);
    const configWarning = el("div", { style:"color:#dc2626; font-size:12px; margin-top:4px; display:none" });
    let dyn = buildDynamicFrom([], draft.extras);
    const status = el("div", { style:"margin-top:8px; font-size:12px; opacity:.8" });
    const configNotice = el("div", { style:"color:#dc2626; font-size:12px; margin:4px 0; display:none" });
    let hasConfigError = false;

    function setConfigError(message) {
      const msg = message || "";
      configNotice.textContent = msg;
      configNotice.style.display = msg ? "block" : "none";
      hasConfigError = Boolean(msg);
    }

    if (methodsError || !_availableMethods.length) {
      setConfigError(methodsError || NO_FORM_MESSAGE);
      dynMount.innerHTML = "";
    }

    submit = el("button", { style:"margin-top:10px; height:36px; padding:0 14px; cursor:pointer" }, "Submit withdrawal");
    setEnabled(submit, false);

    let formReady = false;
    let refreshSeq = 0;

    function updateValidity() {
      if (hasConfigError) {
        setEnabled(submit, false);
        status.textContent = "";
        return;
      }
      const amountCents = normalizeAmountInput(amount.value);
      let err = null;
      if (amountCents === null) {
        err = `Enter an amount between ${MIN_AMOUNT} and ${MAX_AMOUNT} ${currencyUnit()}.`;
      } else {
        err = validateWithdrawalInputs(amountCents);
      }
      err = err || dyn.validate();
      const ready = formReady && Boolean(String(method.value || ""));
      setEnabled(submit, ready && !err);
      status.textContent = err || "";
    }

    async function refreshDynamicFields() {
      const seq = ++refreshSeq;
      const prev = typeof dyn.getValues === "function" ? dyn.getValues() : (draft.extras || {});
      const selectedMethod = method.value;

      if (!selectedMethod) {
        dyn = buildDynamicFrom([], prev);
        dynMount.innerHTML = "";
        dynMount.appendChild(dyn.wrap);
        setConfigError(NO_FORM_MESSAGE);
        updateValidity();
        return;
      }

      dynMount.innerHTML = "";
      dynMount.appendChild(loadingNotice);

      const cacheKey = `${selectedMethod}:::${currencyUnit()}`;
      if (Object.prototype.hasOwnProperty.call(_withdrawalFormCache, cacheKey)) {
        const cached = _withdrawalFormCache[cacheKey];
        if (seq !== refreshSeq) return;
        dyn = buildDynamicFrom(cached.fields || [], prev);
        setConfigError(cached.error || null);
        dynMount.innerHTML = "";
        dynMount.appendChild(dyn.wrap);
        updateValidity();
        return;
      }

      try {
        const { withdrawalFields, error } = await getBankAndFormsForMethod(token, selectedMethod);
        if (seq !== refreshSeq) return;
        const errMsg = error || (withdrawalFields && withdrawalFields.length ? null : NO_FORM_MESSAGE);
        _withdrawalFormCache[cacheKey] = { fields: withdrawalFields, error: errMsg };
        dyn = buildDynamicFrom(withdrawalFields, prev);
        setConfigError(errMsg);
      } catch (err) {
        if (seq !== refreshSeq) return;
        const msg = (err && err.error) ? String(err.error) : "Unable to load form.";
        _withdrawalFormCache[cacheKey] = { fields: [], error: msg };
        dyn = buildDynamicFrom([], prev);
        setConfigError(msg);
      }

      dynMount.innerHTML = "";
      dynMount.appendChild(dyn.wrap);
      updateValidity();
    }

    [amount].forEach(i => { i && i.addEventListener("input", updateValidity); });
    method.addEventListener("change", () => { refreshDynamicFields(); });
    dynMount.addEventListener("input", updateValidity);
    dynMount.addEventListener("change", updateValidity);
    if (_availableMethods.length) refreshDynamicFields().then(() => updateValidity());
    else updateValidity();

    submit.addEventListener("click", async () => {
      if (hasConfigError) {
        status.textContent = configNotice.textContent || NO_FORM_MESSAGE;
        return;
      }
      const amountCents = normalizeAmountInput(amount.value);
      const extras = dyn.getValues();
      const destination = inferPayerFromExtras(method.value, extras);

      if (amountCents === null) {
        status.textContent = `Enter an amount between ${MIN_AMOUNT} and ${MAX_AMOUNT} ${currencyUnit()}.`;
        return;
      }

      const verr = validateWithdrawalInputs(amountCents) || dyn.validate();
      if (verr) { status.textContent = verr; return; }

      saveDraft("withdrawal", claims, { amountCents, method: method.value, extras });

      try {
        status.textContent = "Submitting…";
        const resp = await call("/public/withdrawals", token, {
          method: "POST",
          headers: { "content-type":"application/json" },
          body: JSON.stringify({ amountCents, method: method.value, destination, extraFields: extras }),
        });
        status.innerHTML = `Request submitted. Reference: <b>${resp.uniqueReference || resp.referenceCode}</b>`;
        clearDraft("withdrawal", claims);
        safeCallback("onWithdrawalSubmitted", {
          id: resp.id,
          referenceCode: resp.referenceCode,
          uniqueReference: resp.uniqueReference,
          amountCents,
          currency: resp.currency || currencyUnit()
        });
      } catch (e) {
        status.textContent = (e && e.error) ? String(e.error) : "Error";
        safeCallback("onError", e);
      }
    });

    box.appendChild(inputRow(`Amount (${currencyUnit()})`, amount));
    box.appendChild(inputRow("Method", method));
    box.appendChild(dynMount);
    box.appendChild(configNotice);
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
        const resp = await fetch("/public/forms", { headers: { authorization:`Bearer ${cfg.token}` } });
        const data = await resp.json();
        if (data && data.ok) _forms = { ok: true, deposit: data.deposit || [], withdrawal: data.withdrawal || [] };
      } catch {}

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