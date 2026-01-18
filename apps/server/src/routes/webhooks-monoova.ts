import { Router } from "express";
import { handleMonoovaWebhook } from "../services/monoova/webhooks.js";

export const monoovaWebhookRouter = Router();

monoovaWebhookRouter.post("/", async (req: any, res) => {
  try {
    const headers = req.headers || {};
    const payload = req.body || {};
    const result = await handleMonoovaWebhook(payload, headers);
    res.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("[monoova webhook] failed", err);
    res.status(500).json({ ok: false, error: "WEBHOOK_FAILED" });
  }
});
