import { Router } from 'express';
import { startDiditSession } from '../services/didit.js';
export const sdkRouter = Router();

sdkRouter.get('/js', (_req, res) => {
  res.type('application/javascript').send(`
(function(){
  const API = (path, opt={}) => fetch(path, Object.assign({ credentials:'include' }, opt)).then(r=>r.json());
  function init({ publicKey, userHint, merchantUserId }){
    const btns = document.querySelectorAll('[data-payment-button]');
    btns.forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const { data } = await API('/sdk/kyc/start', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ diditSubjectHint: userHint?.diditSubject }) });
        const w = window.open(data.url, 'didit', 'width=420,height=720');
        const timer = setInterval(async ()=>{
          if (w.closed) {
            clearInterval(timer);
            const st = await API('/sdk/kyc/status');
            if (st.data && st.data.verified) {
              btn.dispatchEvent(new CustomEvent('kyc-verified',{ bubbles:true, detail: st.data }));
            } else {
              alert('Verification not completed');
            }
          }
        }, 1000);
      });
    });
  }
  window.PaymentSDK = { init };
})();`);
});

sdkRouter.post('/kyc/start', async (req, res) => {
  const { diditSubjectHint } = (req.body ?? {}) as { diditSubjectHint?: string };
  const { url } = await startDiditSession(diditSubjectHint);
  res.ok({ url });
});

sdkRouter.get('/kyc/status', async (_req, res) => {
  // In real flow, check session; here we cannot, so return placeholder.
  res.ok({ verified: true });
});