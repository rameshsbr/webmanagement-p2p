# Server notes

## Starting a checkout session

Call `POST /merchant/checkout/session` with your API key.

**Request**

```json
{
  "user": {
    "externalId": "USER_PRIMARY_KEY",
    "email": "optional@example.com"
  },
  "currency": "AUD",
  "availableBalanceCents": 250000
}
```

**Response**

```json
{ "ok": true, "token": "<short-lived-token>", "expiresAt": "..." }
```

Use the token with the PayX widget. A stable internal subject is derived from `(merchantId, externalId)`, so always send the same `externalId` for the same user.

## Deletion policy

Production data is designed to be durable. Cascading deletes are disabled for user, admin, merchant, and payment relations so that removing a parent row will not silently wipe financial history or audit logs. Foreign keys now use `RESTRICT` or `SET NULL` behaviour; if you need to purge related records, do it explicitly with a dedicated cleanup routine instead of relying on implicit cascades.

When deleting rows directly in Prisma Studio or via scripts, expect one of two outcomes:

- If dependent rows exist on a restrictive relation, the delete will fail with a foreign-key error so you can handle the children explicitly.
- If the relationship is nullable, the parent row deletes cleanly and child foreign keys are nulled without deleting the child records.

This keeps payment history, KYC records, and audit logs intact even when a parent entity is removed.

## IDR v4 Method Banks

IDR v4 virtual account methods (Static/Dynamic) maintain their own method-scoped bank list in the `MethodBank` table. Super Admins can edit these banks from the Methods page via the **Banks** modal. The merchant portal `GET /merchant/idrv4/meta?method=...` endpoint uses this configuration to populate the checkout widget/test modal, falling back to the seeded defaults when no rows exist. The list is intentionally separate from the P2P Banks module. 
