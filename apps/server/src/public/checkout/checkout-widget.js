// apps/server/src/public/checkout/checkout-widget.js
(function () {
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

  // 👉 updated to support inline, styled, non-wrapping required asterisk
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
    const i = el("input", { type:"number", ...attrs, style:"height:36px; width:100%; box-sizing:border-box; padding:6px 10px" });
    i.addEventListener("wheel", () => i.blur());
    return i;
  }

  function textInput(attrs) { return el("input", { type:"text", ...attrs, style:"height:36px; width:100%; box-sizing:border-box; padding:6px 10px" }); }

  // ─────────────────────────────────────────────────────────
  // KYC popup lifecycle
  // ─────────────────────────────────────────────────────────
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

  function validateDepositInputs(amountCents, methodVal, fields) {
    if (!Number.isInteger(amountCents) || amountCents < MIN_AMOUNT * 100 || amountCents > MAX_AMOUNT * 100) {
      return `Enter an amount between ${MIN_AMOUNT} and ${MAX_AMOUNT} AUD.`;
    }
    if (methodVal === "OSKO") {
      if (!/^\d{10,12}$/.test(fields.accountNo || "")) return "Account No must be 10–12 digits.";
      if (!/^\d{6}$/.test(fields.bsb || "")) return "BSB must be 6 digits.";
      if (!fields.holderName || fields.holderName.length < 2) return "Enter account holder name.";
    } else {
      if (!fields.holderName || fields.holderName.length < 2) return "Enter account holder name.";
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.payIdValue || "");
      const isAuMobile = /^\+?61\d{9}$/.test(fields.payIdValue || "");
      if (!(isEmail || isAuMobile)) return "PayID must be an email or +61XXXXXXXXX.";
    }
    return null;
  }
  function validateWithdrawalInputs(amountCents, methodVal, fields) { return validateDepositInputs(amountCents, methodVal, fields); }

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

  // ─────────────────────────────────────────────────────────
  // Dynamic extras from /public/forms
  // ─────────────────────────────────────────────────────────
  function buildDynamicFrom(fields, draftExtras) {
    const list = Array.isArray(fields) ? fields : [];
    const wrap = el("div");
    if (!list.length) return { wrap, getValues: () => ({}), validate: () => null };

    const inputs = {};
    list.forEach(f => {
      if (!f || !f.name) return;
      let input;
      if (f.display === "select") {
        input = el("select", { style:"height:36px; width:100%; box-sizing:border-box; padding:6px 10px" },
          (Array.isArray(f.options) ? f.options : []).map(opt => el("option", { value:String(opt) }, String(opt)))
        );
      } else if (f.display === "file") {
        input = el("input", { type:"file", style:"height:36px; width:100%; box-sizing:border-box; padding:6px 10px" });
      } else {
        input = f.field === "number"
          ? numberInput({ placeholder: f.placeholder || "" })
          : textInput({ placeholder: f.placeholder || "" });
      }
      if (draftExtras && draftExtras[f.name] != null && input && input.type !== "file") {
        input.value = String(draftExtras[f.name]);
      }
      inputs[f.name] = input;
      // 👉 pass required to render inline asterisk properly
      wrap.appendChild(inputRow(f.name, input, !!f.required));
    });

    function getValues() {
      const out = {};
      Object.entries(inputs).forEach(([k, node]) => {
        if (node.type === "file") return; // file extras ignored for now
        out[k] = node.value;
      });
      return out;
    }

    function validate() {
      const vals = getValues();
      for (const f of list) {
        if (f.required) {
          const v = vals[f.name];
          if (v == null || String(v).trim() === "") return `${f.name} is required.`;
        }
        if (f.display === "select" && Array.isArray(f.options) && f.options.length) {
          const v = vals[f.name];
          if (v != null && !f.options.includes(String(v))) return `${f.name} has an invalid value.`;
        }
        if (f.display === "input" && f.field === "number" && f.digits > 0) {
          const v = vals[f.name];
          if (v && (!/^\d+$/.test(String(v)) || String(v).length !== Number(f.digits))) {
            return `${f.name} must be ${f.digits} digits.`;
          }
        }
      }
      return null;
    }

    return { wrap, getValues, validate };
  }

  function buildDynamic(kind, draftExtras) {
    const list = Array.isArray(_forms?.[kind]) ? _forms[kind] : [];
    return buildDynamicFrom(list, draftExtras);
  }

  // Helper: pick the same bank the server would choose for a given method,
  // then fetch that bank's form config.
  async function getBankAndFormsForMethod(token, methodValue) {
    const banksResp = await call(`/public/deposit/banks?method=${encodeURIComponent(methodValue)}`, token, { method: "GET" });
    const first = (banksResp && Array.isArray(banksResp.banks) && banksResp.banks.length) ? banksResp.banks[0] : null;

    if (first && first.id) {
      const cfg = await call(`/public/forms?bankAccountId=${encodeURIComponent(first.id)}`, token, { method: "GET" });
      return { bankId: first.id, depositFields: cfg.deposit || [] };
    }

    const cfg = await call(`/public/forms`, token, { method: "GET" });
    return { bankId: null, depositFields: cfg.deposit || [] };
  }

  // Infer payer/destination from dynamic form values
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
    if (methodVal === "OSKO") {
      const holderName = findValue(ex, ["account holder name", "holder name", "account name", "name"]);
      const accountNo = findValue(ex, ["account number", "account no", "account #", "acct number"]);
      const bsb = findValue(ex, ["bsb"]);
      return { holderName: String(holderName || ""), accountNo: String(accountNo || ""), bsb: String(bsb || "") };
    }
    const email = findValue(ex, ["email", "payid (email)"]);
    let mobile = findValue(ex, ["mobile", "phone", "payid (mobile)"]);
    const payIdValue = findValue(ex, ["payid value", "payid"]);
    const holderName = findValue(ex, ["account holder name", "holder name", "name"]);
    let type = "email";
    let value = String(email || "");
    const looksMobile = (s) => /^\+?61\d{9}$/.test(String(s || "").trim());
    if (!value && looksMobile(mobile)) { type = "mobile"; value = String(mobile); }
    if (!value && payIdValue) {
      const pv = String(payIdValue);
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pv)) { type = "email"; value = pv; }
      else if (looksMobile(pv)) { type = "mobile"; value = pv; }
    }
    return { holderName: String(holderName || ""), payIdType: type, payIdValue: value };
  }

  // ─────────────────────────────────────────────────────────
  // Deposit (Step 1 → Step 2)
  // ─────────────────────────────────────────────────────────
  async function openDeposit(token, claims) {
    const { box, header, close } = modalShell(_cfg.theme);
    header.firstChild.textContent = "Deposit";

    let nextBtn;

    const amount = numberInput({ placeholder:"Amount (AUD, min 50 max 5000)" });
    const method = el("select", { style:"height:36px; width:100%; box-sizing:border-box; padding:6px 10px" }, [
      el("option", { value:"OSKO" }, "OSKO"),
      el("option", { value:"PAYID" }, "PayID"),
    ]);

    // only dynamic fields
    const dynMount = el("div");
    dynMount.appendChild(el("div", { style:"opacity:.65; font-size:12px; padding:6px 0" }, "Loading form…"));

    const draft = loadDraft("deposit", claims) || {};
    if (draft.amountCents) amount.value = (draft.amountCents / 100).toFixed(2);
    if (draft.method) method.value = draft.method;

    let dyn = { wrap: el("div"), getValues: () => ({}), validate: () => null };
    let selectedBankId = null;

    async function refreshDynForMethod() {
      try {
        const { bankId, depositFields } = await getBankAndFormsForMethod(token, method.value);
        selectedBankId = bankId;
        dyn = buildDynamicFrom(depositFields, draft.extras);
      } catch (e) {
        selectedBankId = null;
        dyn = buildDynamic("deposit", draft.extras);
      }
      dynMount.innerHTML = "";
      dynMount.appendChild(dyn.wrap);
      updateValidity();
    }

    const status = el("div", { style:"margin-top:8px; font-size:12px; opacity:.8" });
    nextBtn = el("button", { style:"margin-top:10px; height:36px; padding:0 14px; cursor:pointer" }, "Next");

    function updateValidity() {
      const amountCents = normalizeAmountInput(amount.value);
      const extras = dyn.getValues();
      const inferred = inferPayerFromExtras(method.value, extras);
      let err = null;
      if (amountCents === null) {
        err = `Enter an amount between ${MIN_AMOUNT} and ${MAX_AMOUNT} AUD.`;
      } else {
        err = validateDepositInputs(amountCents, method.value, inferred);
      }
      err = err || dyn.validate();
      setEnabled(nextBtn, !err);
      status.textContent = err || "";
    }

    method.addEventListener("change", () => { refreshDynForMethod(); });
    [amount].forEach(i => i && i.addEventListener("input", updateValidity));
    dynMount.addEventListener("input", updateValidity);
    dynMount.addEventListener("change", updateValidity);

    box.appendChild(inputRow("Amount (AUD)", amount));
    box.appendChild(inputRow("Method", method));
    box.appendChild(dynMount);
    box.appendChild(nextBtn);
    box.appendChild(status);

    refreshDynForMethod();

    nextBtn.addEventListener("click", async () => {
      const amountCents = normalizeAmountInput(amount.value);
      const extras = dyn.getValues();
      const payer = inferPayerFromExtras(method.value, extras);

      if (amountCents === null) {
        status.textContent = `Enter an amount between ${MIN_AMOUNT} and ${MAX_AMOUNT} AUD.`;
        return;
      }

      const verr = validateDepositInputs(amountCents, method.value, { ...payer }) || dyn.validate();
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
    const ref = intent.referenceCode;

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

    const uploadBtn = el("button", { style:"height:36px; padding:0 12px; cursor:pointer" }, "Upload receipt");
    uploadBtn.addEventListener("click", async () => {
      try {
        if (!receipt.files || !receipt.files[0]) {
          status.textContent = "Attach a receipt file first.";
          return;
        }
        const fd = new FormData();
        fd.append("receipt", receipt.files[0]);
        status.textContent = "Uploading…";
        await call(`/public/deposit/${intent.id}/receipt`, token, { method:"POST", body: fd });
        status.textContent = "Submitted. Thank you!";
        safeCallback("onDepositSubmitted", {
          id: intent.id, referenceCode: intent.referenceCode,
          amountCents: intent.amountCents, currency: intent.currency || "AUD"
        });
      } catch (e) {
        status.textContent = (e && e.error) ? String(e.error) : "Error";
        safeCallback("onError", e);
      }
    });

    const doneBtn = el("button", { style:"height:36px; padding:0 12px; cursor:pointer" }, "Done");
    doneBtn.addEventListener("click", () => close());

    actions.appendChild(backBtn);
    actions.appendChild(uploadBtn);
    actions.appendChild(doneBtn);

    box.appendChild(intro);
    box.appendChild(grid);
    box.appendChild(inputRow("Receipt", receipt));
    box.appendChild(actions);
    box.appendChild(status);
  }

  // ─────────────────────────────────────────────────────────
  // Withdrawal
  // ─────────────────────────────────────────────────────────
  async function openWithdrawal(token, claims) {
    const { box, header } = modalShell(_cfg.theme);
    header.firstChild.textContent = "Withdrawal";

    let submit;

    const amount = numberInput({ placeholder:"Amount (AUD, min 50 max 5000)" });
    const method = el("select", { style:"height:36px; width:100%; box-sizing:border-box; padding:6px 10px" }, [
      el("option", { value:"OSKO" }, "OSKO"),
      el("option", { value:"PAYID" }, "PayID"),
    ]);

    const draft = loadDraft("withdrawal", claims) || {};
    if (draft.amountCents) amount.value = (draft.amountCents / 100).toFixed(2);
    if (draft.method) method.value = draft.method;

    const dyn = buildDynamic("withdrawal", draft.extras);
    const status = el("div", { style:"margin-top:8px; font-size:12px; opacity:.8" });

    submit = el("button", { style:"margin-top:10px; height:36px; padding:0 14px; cursor:pointer" }, "Submit withdrawal");

    function updateValidity() {
      const amountCents = normalizeAmountInput(amount.value);
      const extras = dyn.getValues();
      const inferred = inferPayerFromExtras(method.value, extras);
      let err = null;
      if (amountCents === null) {
        err = `Enter an amount between ${MIN_AMOUNT} and ${MAX_AMOUNT} AUD.`;
      } else {
        err = validateWithdrawalInputs(amountCents, method.value, inferred);
      }
      err = err || dyn.validate();
      setEnabled(submit, !err);
      status.textContent = err || "";
    }
    [amount, method].forEach(i => {
      i && i.addEventListener(i.tagName === "SELECT" ? "change" : "input", updateValidity);
    });
    dyn.wrap.addEventListener("input", updateValidity);
    dyn.wrap.addEventListener("change", updateValidity);
    updateValidity();

    submit.addEventListener("click", async () => {
      const amountCents = normalizeAmountInput(amount.value);
      const extras = dyn.getValues();
      const destination = inferPayerFromExtras(method.value, extras);

      if (amountCents === null) {
        status.textContent = `Enter an amount between ${MIN_AMOUNT} and ${MAX_AMOUNT} AUD.`;
        return;
      }

      const verr = validateWithdrawalInputs(amountCents, method.value, { ...destination }) || dyn.validate();
      if (verr) { status.textContent = verr; return; }

      saveDraft("withdrawal", claims, { amountCents, method: method.value, extras });

      try {
        status.textContent = "Submitting…";
        const resp = await call("/public/withdrawals", token, {
          method: "POST",
          headers: { "content-type":"application/json" },
          body: JSON.stringify({ amountCents, method: method.value, destination, extraFields: extras }),
        });
        status.innerHTML = `Request submitted. Reference: <b>${resp.referenceCode}</b>`;
        clearDraft("withdrawal", claims);
        safeCallback("onWithdrawalSubmitted", {
          id: resp.id, referenceCode: resp.referenceCode, amountCents, currency: "AUD"
        });
      } catch (e) {
        status.textContent = (e && e.error) ? String(e.error) : "Error";
        safeCallback("onError", e);
      }
    });

    box.appendChild(inputRow("Amount (AUD)", amount));
    box.appendChild(inputRow("Method", method));
    box.appendChild(dyn.wrap);
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

      // Load merchant-level dynamic form definitions (used for withdrawals; deposit uses bank-specific at runtime)
      try {
        const resp = await fetch("/public/forms", { headers: { authorization:`Bearer ${cfg.token}` } });
        const data = await resp.json();
        if (data && data.ok) _forms = { ok: true, deposit: data.deposit || [], withdrawal: data.withdrawal || [] };
      } catch {}

      // Warm draft endpoint and capture claims (optional, for LS keying)
      try {
        const r = await fetch("/public/deposit/draft", { headers: { authorization:`Bearer ${cfg.token}` } });
        const j = await r.json();
        if (j && j.ok && j.claims) _claims = j.claims;
      } catch {}

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