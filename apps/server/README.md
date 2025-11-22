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
