# Payments Platform

## Starting a checkout session

Call `POST /merchant/checkout/session` with your API key. Provide a stable `externalId` for the end user; the platform derives the internal subject from your merchant ID and this value so it stays consistent over time.

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

Use the returned token with the PayX widget. Always send the same `externalId` for the same user so verification and balances remain stable.
