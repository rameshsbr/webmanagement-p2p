// apps/server/src/routes/webhooks.ts
import { Router } from "express";
import { z } from "zod";
import crypto from "crypto";
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

/**
 * POST handler (server → server webhook), supports:
 *  - Legacy body: { sessionId, diditSubject, status: "approved"|"rejected" }
 *  - Didit v2 flat:    { session_id, vendor_data, status: "Approved"|"Declined"|... }
 *  - Didit v2 nested:  { data: { session: {...}, decision: {...} }, event: ... }
 *  - Signature verification (x-signature/didit-signature + WEBHOOK_SECRET_KEY)
 *  - Full profile extraction from id_verification
 */
for (const path of PATHS) {
  diditWebhookRouter.post(path, async (req, res) => {
    try {
      // --------------------------------------------------------------------
      // 1. VERIFY SIGNATURE
      // --------------------------------------------------------------------
      const secret = process.env.WEBHOOK_SECRET_KEY;
      if (!secret) {
        console.error("[didit] Missing WEBHOOK_SECRET_KEY");
        return res.status(500).json({ ok: false, error: "server_config_error" });
      }

      const rawBody = req.rawBody;
      // accept both header names just in case
      const signature =
        (req.headers["x-signature"] as string | undefined) ||
        (req.headers["didit-signature"] as string | undefined);

      if (!rawBody || !signature) {
        console.error("[didit] missing_signature", { hasRawBody: !!rawBody, hasSig: !!signature });
        return res.status(400).json({ ok: false, error: "missing_signature" });
      }

      const expected = crypto
        .createHmac("sha256", secret)
        .update(rawBody)
        .digest("hex");

      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        console.error("[didit] Invalid webhook signature");
        return res.status(400).json({ ok: false, error: "invalid_signature" });
      }

      // Parse JSON safely after signature verified
      const body = JSON.parse(rawBody.toString());
      console.log("[didit webhook] body:", JSON.stringify(body, null, 2));

      // --------------------------------------------------------------------
      // 2. DEFINE SCHEMAS (legacy + flexible v2)
      // --------------------------------------------------------------------
      const legacy = z.object({
        sessionId: z.string(),
        diditSubject: z.string(),
        status: z.enum(["approved", "rejected"]),
      });

      const v2 = z.object({
        // flat v2
        session_id: z.string().optional(),
        status: z.string().optional(),
        vendor_data: z.string().optional().default(""),
        decision: z.any().optional(),

        // nested v2
        data: z
          .object({
            session: z
              .object({
                id: z.string().optional(),
                session_id: z.string().optional(),
                status: z.string().optional(),
                vendor_data: z.string().optional().default(""),
              })
              .optional(),
            decision: z.any().optional(),
          })
          .optional(),

        event: z.string().optional(),
      });

      let sessionId = "";
      let diditSubject = "";
      let merchantId: string | null = null;
      let statusNorm: "approved" | "rejected" | "pending" = "pending";
      let fullName: string | null = null;
      let firstName: string | null = null;
      let lastName: string | null = null;
      let documentType: string | null = null;
      let documentNumber: string | null = null;
      let issuingState: string | null = null;
      let issuingCountry: string | null = null;
      let dateOfBirth: string | null = null;
      let documentExpiry: string | null = null;
      let gender: string | null = null;
      let address: string | null = null;
      let emailFromDidit: string | null = null;
      let phoneFromDidit: string | null = null;

      // --------------------------------------------------------------------
      // 3. PARSE BODY
      // --------------------------------------------------------------------
      const l = legacy.safeParse(body);
      if (l.success) {
        // legacy shape
        sessionId = l.data.sessionId;
        diditSubject = l.data.diditSubject;
        statusNorm = l.data.status;
      } else {
        // v2 – flat or nested
        const vb = v2.parse(body);

        // Choose the session object
        const session: any = vb.data?.session ?? vb; // fall back to flat keys on root

        sessionId =
          session.session_id ||
          session.id ||
          vb.session_id ||
          "";

        const vendorRaw = session.vendor_data ?? vb.vendor_data ?? "";
        const vendor = parseVendorData(vendorRaw);
        diditSubject = vendor.diditSubject || "";
        merchantId = vendor.merchantId || null;

        const statusRaw = session.status ?? vb.status ?? "";
        const s = String(statusRaw).toLowerCase();
        statusNorm = s.includes("approve")
          ? "approved"
          : s.includes("reject") || s.includes("declin")
          ? "rejected"
          : "pending";

        // Decision object can be at root or under data
        const decision: any = vb.decision ?? vb.data?.decision ?? {};
        const idv =
          decision.id_verification ??
          decision.idVerification ??
          decision.identity_check ??
          {};

        // Names
        firstName = idv.first_name || idv.firstName || null;
        lastName = idv.last_name || idv.lastName || null;
        fullName =
          idv.full_name ||
          idv.fullName ||
          [firstName, lastName].filter(Boolean).join(" ") ||
          null;

        // Document fields
        documentType = idv.document_type || null;
        documentNumber = idv.document_number || null;

        issuingState = idv.issuing_state_name || idv.issuing_state || null;
        // issuingCountry should come from country fields, not state
        issuingCountry =
          idv.issuing_country ||
          idv.issuing_country_code ||
          idv.country ||
          null;

        dateOfBirth = idv.date_of_birth || null;
        documentExpiry = idv.expiration_date || null;
        gender = idv.gender || null;

        // 🔧 Address selection:
        // Prefer any fields that sound like "address on ID / document",
        // and only fall back to generic / location addresses.
        const documentAddress =
          idv.document_address ||
          idv.address_on_document ||
          idv.address_on_id ||
          idv.id_address ||
          idv.residential_address ||
          idv.address ||
          null;

        const locationAddress =
          idv.formatted_address ||
          idv.location_address ||
          idv.gps_address ||
          null;

        address = documentAddress || locationAddress;

        // Contact details
        emailFromDidit = decision?.contact_details?.email || idv.email || null;
        phoneFromDidit = decision?.contact_details?.phone || idv.phone || null;
      }

      console.log("[didit webhook] parsed:", {
        sessionId,
        diditSubject,
        merchantId,
        statusNorm,
        fullName,
        firstName,
        lastName,
        documentType,
        documentNumber,
        issuingState,
        issuingCountry,
        dateOfBirth,
        documentExpiry,
        gender,
        address,
        emailFromDidit,
        phoneFromDidit,
      });

      // Pending = ignore (do not touch DB)
      if (statusNorm === "pending") {
        return res.json({ ok: true, pending: true });
      }

      // --------------------------------------------------------------------
      // 4. RECOVER SUBJECT IF MISSING (fallback via KycVerification)
      // --------------------------------------------------------------------
      if (!diditSubject) {
        const p = await prisma();
        const row = await p.kycVerification.findFirst({
          where: { externalSessionId: sessionId },
          include: { user: { select: { diditSubject: true } } },
        });
        if (row?.user?.diditSubject) diditSubject = row.user.diditSubject;
      }

      if (!diditSubject) {
        console.error("[didit webhook] missing_diditSubject for session", sessionId);
        return res.status(400).json({ ok: false, error: "missing_diditSubject" });
      }

      // --------------------------------------------------------------------
      // 5. HANDLE USER + KYC STATUS (this writes into Prisma User)
      // --------------------------------------------------------------------
      const user = await handleDiditWebhook(
        sessionId,
        diditSubject,
        statusNorm,
        merchantId,
        undefined, // externalId not used in vendor_data currently
        emailFromDidit,
        {
          fullName,
          firstName,
          lastName,
          documentType,
          documentNumber,
          documentIssuingState: issuingState,
          documentIssuingCountry: issuingCountry,
          dateOfBirth,
          documentExpiry,
          gender,
          address,
          email: emailFromDidit,
          phone: phoneFromDidit,
          status: statusNorm,
        }
      );

      // --------------------------------------------------------------------
      // 6. Response
      // --------------------------------------------------------------------
      if (!fullName) {
        console.warn("[didit webhook] no fullName in payload for session", sessionId);
      }

      return res.json({
        ok: true,
        userId: user.id,
        verifiedAt: user.verifiedAt,
        fullName,
      });
    } catch (err: any) {
      console.error("Didit webhook POST error:", err?.message || err, err?.stack);
      return res.status(400).json({ ok: false, error: "bad_payload" });
    }
  });

  /**
   * GET handler (browser redirect misuse) – unchanged
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
      const merchantId = vendor.merchantId || null;

      const statusRaw = String(q.status || "").toLowerCase();
      const statusNorm: "approved" | "rejected" | "pending" =
        statusRaw.includes("approve")
          ? "approved"
          : statusRaw.includes("reject") || statusRaw.includes("declin")
          ? "rejected"
          : "pending";

      if (!sessionId) return res.status(400).send("Missing session id.");
      if (statusNorm === "pending") {
        const ret = process.env.CHECKOUT_RETURN_URL || "";
        const qs = new URLSearchParams({
          status: statusNorm,
          session: sessionId,
          vendor: diditSubject || "",
          ...(ret ? { return: ret } : {}),
        });
        return res.redirect(302, `/public/kyc/done?${qs.toString()}`);
      }

      if (!diditSubject) {
        const p = await prisma();
        const row = await p.kycVerification.findFirst({
          where: { externalSessionId: sessionId },
          include: { user: { select: { diditSubject: true } } },
        });
        if (row?.user?.diditSubject) diditSubject = row.user.diditSubject;
      }
      if (!diditSubject) return res.status(400).send("Missing vendor_data/diditSubject.");

      await handleDiditWebhook(sessionId, diditSubject, statusNorm, merchantId);

      const ret = process.env.CHECKOUT_RETURN_URL || "";
      const qs = new URLSearchParams({
        status: statusNorm,
        session: sessionId,
        vendor: diditSubject || "",
        ...(ret ? { return: ret } : {}),
      });
      return res.redirect(302, `/public/kyc/done?${qs.toString()}`);
    } catch (err: any) {
      console.error("Didit webhook GET error:", err?.message || err);
      return res.status(400).send("Bad request");
    }
  });
}

// Export
export { diditWebhookRouter };
export const webhookRouter = diditWebhookRouter;
export default diditWebhookRouter;