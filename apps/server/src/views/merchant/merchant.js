document.addEventListener("DOMContentLoaded", () => {
  if (!window.CHECKOUT_TOKEN) {
    console.warn("Missing CHECKOUT_TOKEN on page");
    return;
  }

  PayX.init({
    token: window.CHECKOUT_TOKEN,
    theme: "dark", // or "light"
    onKycApproved(info) { console.log("KYC approved ✅", info); },
    onKycRejected(info) { console.warn("KYC rejected ❌", info); },
    onDepositSubmitted(info) { console.log("Deposit submitted", info.referenceCode); },
    onWithdrawalSubmitted(info) { console.log("Withdrawal submitted", info.referenceCode); },
    onError(err) { console.error("PayX error", err); }
  });

  // Example: hook up existing buttons if present
  const depBtn = document.querySelector("#depositBtn");
  const wdrBtn = document.querySelector("#withdrawBtn");
  if (depBtn) depBtn.addEventListener("click", () => PayX.openDeposit());
  if (wdrBtn) wdrBtn.addEventListener("click", () => PayX.openWithdrawal());
});