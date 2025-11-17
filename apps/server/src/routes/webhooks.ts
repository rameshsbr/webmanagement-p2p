// apps/server/src/routes/webhooks.ts
import { Router } from "express";
import { z } from "zod";
import { handleDiditWebhook } from "../services/didit.js";

// lazy prisma import (only if we need to look up vendor_data)
let prismaSingleton: any | null = null;
async function prisma() {
  if (!prismaSingleton) {
    const mod = await import("../lib/prisma.js");
    prismaSingleton = (mod as any).prisma;
  }
  return prismaSingleton;
}

const diditWebhookRouter = Router();

function parseVendorData(raw: unknown): { merchantId: string; diditSubject: string } {
  const str = typeof raw === "string" ? raw : "";
  const parts = str.split("|");
  if (parts.length >= 2) {
    return { merchantId: parts[0] || "", diditSubject: parts[1] || "" };
  }
  return { merchantId: "", diditSubject: str || "" };
}

// Accept both mount styles:
//   - app.use(diditWebhookRouter)  -> POST /webhooks/didit
//   - app.use("/webhooks", diditWebhookRouter) -> POST /didit
const PATHS = ["/webhooks/didit", "/didit"];

function parseVendorData(raw: string) {
  const parts = String(raw || "").split("|");
  if (parts.length >= 2) {
    const [merchantId, ...rest] = parts;
    return { merchantId: merchantId || "", diditSubject: rest.join("|") || "" };
  }
  return { merchantId: "", diditSubject: String(raw || "") };
}

/**
 * POST handler (server → server webhook), supports:
 *  - Legacy body: { sessionId, diditSubject, status: "approved"|"rejected" }
 *  - Didit v2:    { session_id, vendor_data, status: "Approved"|"Declined"|... }
 */
for (const path of PATHS) {
  diditWebhookRouter.post(path, async (req, res) => {
    try {
      const legacy = z.object({
        sessionId: z.string(),
        diditSubject: z.string(),
        status: z.enum(["approved", "rejected"]),
      });

      const v2 = z.object({
        session_id: z.string(),
        status: z.string(),            // e.g. "Approved", "Declined", "In Progress"
        vendor_data: z.string().optional().default(""),
      });

      let sessionId = "";
      let diditSubject = "";
      let merchantId = "";
      let statusNorm: "approved" | "rejected" | "pending" = "pending";

      const body = req.body ?? {};
      const l = legacy.safeParse(body);
      if (l.success) {
        sessionId = l.data.sessionId;
        diditSubject = l.data.diditSubject;
        statusNorm = l.data.status;
      } else {
        const vb = v2.parse(body);
        sessionId = vb.session_id;
        const vendor = parseVendorData(vb.vendor_data);
        diditSubject = vendor.diditSubject || "";
        merchantId = vendor.merchantId || "";
        const s = vb.status.toLowerCase();
        statusNorm = s.includes("approve")
          ? "approved"
          : s.includes("reject") || s.includes("declin")
          ? "rejected"
          : "pending";
      }

      if (statusNorm === "pending") {
        return res.json({ ok: true, pending: true });
      }

      if (!diditSubject) {
        // Try to recover diditSubject from our KYC table if vendor_data was not sent
        const p = await prisma();
        const row = await p.kycVerification.findFirst({
          where: { externalSessionId: sessionId },
          include: { user: { select: { diditSubject: true } } },
        });
        if (row?.user?.diditSubject) diditSubject = row.user.diditSubject;
      }

      if (!diditSubject) {
        return res.status(400).json({ ok: false, error: "missing_diditSubject" });
      }

      const user = await handleDiditWebhook(sessionId, diditSubject, statusNorm as "approved" | "rejected", {
        merchantId: merchantId || undefined,
      });
      return res.json({ ok: true, userId: user.id, verifiedAt: user.verifiedAt });
    } catch (err: any) {
      console.error("Didit webhook POST error:", err?.message || err);
      return res.status(400).json({ ok: false, error: "bad_payload" });
    }
  });

  /**
   * GET handler (browser redirect misuse). Some configs send the browser to:
   *   /webhooks/didit?verificationSessionId=...&status=Approved&vendor_data=...
   * We’ll accept this and update, then redirect the user to /public/kyc/done.
   */
  diditWebhookRouter.get(path, async (req, res) => {
    try {
      const q = req.query || {};
      const sessionId =
        (q.verificationSessionId as string) ||
        (q.session_id as string) ||
        (q.sessionId as string) ||
        "";

      const vendor = parseVendorData(
        (q.vendor_data as string) || (q.diditSubject as string) || (q.subject as string) || ""
      );
      let diditSubject = vendor.diditSubject;
      const merchantId = vendor.merchantId;

      const statusRaw = String(q.status || "").toLowerCase();
      const statusNorm: "approved" | "rejected" | "pending" =
        statusRaw.includes("approve")
          ? "approved"
          : statusRaw.includes("reject") || statusRaw.includes("declin")
          ? "rejected"
          : "pending";

      if (!sessionId) return res.status(400).send("Missing session id.");
      if (statusNorm === "pending") {
        // Don’t mutate DB on indeterminate statuses via GET.
        // Build bounce URL with optional merchant return
        const ret = process.env.CHECKOUT_RETURN_URL || "";
        const qs = new URLSearchParams({
          status: statusNorm,
          session: sessionId,
          vendor: diditSubject || "",
          ...(ret ? { return: ret } as Record<string, string> : {}),
        });
        return res.redirect(302, `/public/kyc/done?${qs.toString()}`);
      }

      if (!diditSubject) {
        // Recover subject via DB if we can
        const p = await prisma();
        const row = await p.kycVerification.findFirst({
          where: { externalSessionId: sessionId },
          include: { user: { select: { diditSubject: true } } },
        });
        if (row?.user?.diditSubject) diditSubject = row.user.diditSubject;
      }
      if (!diditSubject) return res.status(400).send("Missing vendor_data/diditSubject.");

      await handleDiditWebhook(sessionId, diditSubject, statusNorm as "approved" | "rejected", {
        merchantId: merchantId || undefined,
      });

      // Build bounce URL with optional merchant return
      const ret = process.env.CHECKOUT_RETURN_URL || ""; // e.g. https://merchant.example/checkout
      const qs = new URLSearchParams({
        status: statusNorm,          // "approved" | "rejected"
        session: sessionId,
        vendor: diditSubject || "",
        ...(ret ? { return: ret } as Record<string, string> : {}),
      });
      return res.redirect(302, `/public/kyc/done?${qs.toString()}`);
    } catch (err: any) {
      console.error("Didit webhook GET error:", err?.message || err);
      return res.status(400).send("Bad request");
    }
  });
}

// Export under both names so existing imports keep working
export { diditWebhookRouter };
export const webhookRouter = diditWebhookRouter;
export default diditWebhookRouter;