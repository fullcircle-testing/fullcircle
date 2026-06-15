# FullCircle Stripe Checkout Subscriptions Spec

Status: discussion/specification draft
Bead: `fullcircle-ktt — Research Stripe Checkout flow spec`
Research date: 2026-06-11

## Goal

Implement first-class FullCircle support for Stripe Checkout subscription flows so e2e tests can:

1. Control Stripe API responses from the test.
2. Exercise app code that uses the real Stripe SDK/client boundary.
3. Simulate Stripe-hosted Checkout completion without requiring real browser interaction with Stripe.
4. Deliver Stripe-like webhook events with valid signatures.
5. Record, sanitize, and replay the provider API calls, webhook events, browser actions, and SQLite DB effects.

This spec is scoped to **hosted Checkout Sessions in `subscription` mode**. One-time payments, Stripe Elements, embedded Checkout, customer portal, metered billing, and Connect are future expansions. FullCircle should not partially emulate those variants until each has its own provider contract and acceptance tests.

## Primary Stripe lifecycle to model

For hosted Checkout, Stripe describes this lifecycle:

1. App creates a Checkout Session.
2. Checkout Session returns a URL for a Stripe-hosted payment page.
3. Customer completes payment on the hosted page.
4. Stripe sends webhook events, especially `checkout.session.completed`, so the app can fulfill/provision access.

FullCircle should model this lifecycle without requiring a real Stripe checkout page during replay.

## App integration contract

A FullCircle-compatible app should keep production Stripe code intact while allowing test/dev override of the Stripe API origin.

```ts
import Stripe from 'stripe';

export function createStripeClient() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    // Pin the same Stripe API version your app uses in production.
    // exact option depends on stripe-node version; provider adapter should document it
    // and/or provide a factory wrapper for apps that opt in.
    apiBase: process.env.FULLCIRCLE_STRIPE_API_BASE_URL,
  });
}
```

Minimum app env for FullCircle tests:

```bash
STRIPE_SECRET_KEY=sk_test_fullcircle
STRIPE_WEBHOOK_SECRET=whsec_fullcircle_test_secret
FULLCIRCLE_STRIPE_API_BASE_URL=http://localhost:<fc-port>/provider/stripe
```

The webhook endpoint must verify signatures against `STRIPE_WEBHOOK_SECRET` and must consume the **raw request body**.

## Required outgoing Stripe API calls

### 1. Create Checkout Session

HTTP request:

```http
POST /v1/checkout/sessions
Authorization: Bearer sk_test_...
Content-Type: application/x-www-form-urlencoded
```

Minimum body for subscription Checkout:

```txt
mode=subscription
success_url=https://app.example/billing/success?session_id={CHECKOUT_SESSION_ID}
cancel_url=https://app.example/billing/cancel
line_items[0][price]=price_...
line_items[0][quantity]=1
```

Recommended reconciliation fields:

```txt
client_reference_id=<internal user/account/cart id>
metadata[userId]=<internal user id>
subscription_data[metadata][userId]=<internal user id>
```

Important Stripe semantics to model:

- `mode=subscription` is required when the Checkout Session includes recurring items.
- `line_items` is required for `payment` and `subscription` mode.
- In `subscription` mode, Checkout creates/reuses a Customer and saves the payment method by default.
- A Checkout Session response contains `id`, `object=checkout.session`, `mode`, `status`, `payment_status`, `customer`, `subscription`, `success_url`, `cancel_url`, and `url`.
- `url` is the browser redirect target for hosted Checkout.

FullCircle deterministic response:

```json
{
  "id": "cs_test_fullcircle_123",
  "object": "checkout.session",
  "mode": "subscription",
  "status": "open",
  "payment_status": "unpaid",
  "customer": "cus_fullcircle_123",
  "subscription": null,
  "client_reference_id": "user_test_123",
  "metadata": {
    "userId": "user_test_123"
  },
  "success_url": "http://localhost:3000/billing/success?session_id={CHECKOUT_SESSION_ID}",
  "cancel_url": "http://localhost:3000/billing/cancel",
  "url": "http://localhost:<fc-port>/stripe/checkout/cs_test_fullcircle_123"
}
```

### 2. Retrieve Checkout Session, optional but common

Apps often retrieve the session on a success page or fulfillment path:

```http
GET /v1/checkout/sessions/:id
```

Common expansions:

```txt
expand[]=line_items
expand[]=subscription
expand[]=customer
```

FullCircle should support both:

```ts
stripe.checkout.sessions.retrieve('cs_test_fullcircle_123')
```

and:

```ts
stripe.checkout.sessions.retrieve('cs_test_fullcircle_123', {
  expand: ['line_items', 'subscription', 'customer'],
});
```

### 3. Retrieve line items, optional

If the app needs product/price details, it may call:

```http
GET /v1/checkout/sessions/:id/line_items
```

FullCircle should provide a deterministic `list` response matching the line items from the create request or session fixture.

## Required webhook events

FullCircle must be able to deliver these events to the app's webhook endpoint with a Stripe-compatible `Stripe-Signature` header.

### Event signing

Stripe signs webhook payloads with `Stripe-Signature`. The signature is HMAC-SHA256 over:

```txt
<timestamp>.<raw JSON payload>
```

Header format:

```txt
Stripe-Signature: t=<unix_timestamp>,v1=<hex_hmac>
```

FullCircle must:

- preserve the exact raw JSON bytes it signs,
- send those same bytes to the app,
- support configurable timestamp,
- default to a fixed signing secret for deterministic tests,
- support invalid-signature scenarios.

### 1. `checkout.session.completed`

Purpose: customer completed Checkout; fulfill/provision the order.

Canonical event fixture:

```json
{
  "id": "evt_fullcircle_checkout_completed_123",
  "object": "event",
  "created": 1760000000,
  "livemode": false,
  "type": "checkout.session.completed",
  "data": {
    "object": {
      "id": "cs_test_fullcircle_123",
      "object": "checkout.session",
      "mode": "subscription",
      "status": "complete",
      "payment_status": "paid",
      "customer": "cus_fullcircle_123",
      "subscription": "sub_fullcircle_123",
      "client_reference_id": "user_test_123",
      "metadata": {
        "userId": "user_test_123"
      }
    }
  }
}
```

`api_version` is intentionally omitted by default in FullCircle-generated webhook fixtures. Tests that need to assert API-version-specific behavior should set the version explicitly in the provider options or event fixture.

FullCircle expected app behavior:

- webhook returns 2xx quickly,
- app records event ID for idempotency,
- app either provisions immediately from the session or retrieves missing objects,
- app creates/updates internal subscription row.

### 2. `customer.subscription.created`

Purpose: subscription object was created. Stripe recommends using `customer.subscription` events to track subscription state.

Canonical event fixture:

```json
{
  "id": "evt_fullcircle_subscription_created_123",
  "object": "event",
  "type": "customer.subscription.created",
  "data": {
    "object": {
      "id": "sub_fullcircle_123",
      "object": "subscription",
      "customer": "cus_fullcircle_123",
      "status": "active",
      "metadata": {
        "userId": "user_test_123"
      },
      "items": {
        "object": "list",
        "data": [
          {
            "id": "si_fullcircle_123",
            "object": "subscription_item",
            "price": {
              "id": "price_fullcircle_pro_monthly",
              "object": "price",
              "recurring": {
                "interval": "month"
              }
            }
          }
        ]
      }
    }
  }
}
```

### 3. `invoice.paid`

Purpose: invoice was paid. For subscriptions, Stripe docs describe provisioning access on `invoice.paid` when the subscription status is active.

Canonical event fixture:

```json
{
  "id": "evt_fullcircle_invoice_paid_123",
  "object": "event",
  "type": "invoice.paid",
  "data": {
    "object": {
      "id": "in_fullcircle_123",
      "object": "invoice",
      "customer": "cus_fullcircle_123",
      "subscription": "sub_fullcircle_123",
      "status": "paid",
      "paid": true,
      "amount_paid": 2000,
      "currency": "usd"
    }
  }
}
```

### 4. Failure/cancellation events to support in v1 test matrix

FullCircle v1 should include fixtures for:

- `checkout.session.expired` — user never completed Checkout.
- `checkout.session.async_payment_failed` — delayed payment failed.
- `checkout.session.async_payment_succeeded` — delayed payment later succeeded.
- `invoice.created` — draft invoice created; apps may retrieve/finalize or annotate it before finalization.
- `invoice.finalization_failed` — Stripe could not finalize an invoice; app should surface or queue remediation.
- `invoice.payment_action_required` — payment requires customer action; app should notify user and avoid provisioning until resolved.
- `invoice.payment_failed` — payment failed; app should notify user and not grant/revoke access according to product rules.
- `customer.subscription.updated` — subscription status/price changed.
- `customer.subscription.deleted` — subscription canceled/ended; app should deprovision access.

## Webhook delivery realities FullCircle must model

Stripe webhook behavior has test implications:

- Webhooks are the reliable source of payment/subscription completion; client redirects alone are not sufficient.
- Webhook event delivery is not guaranteed to be ordered.
- Duplicate deliveries can happen; apps should dedupe by event ID, or by event type plus `data.object.id` for duplicate Event objects.
- Live mode retries for up to three days; sandbox retries three times over a few hours.
- Handlers should respond quickly and move heavy work to a queue if needed.

FullCircle should support:

```ts
await stripe.webhooks.send('checkout.session.completed', fixture);
await stripe.webhooks.sendOutOfOrder([...events]);
await stripe.webhooks.sendDuplicate('evt_fullcircle_checkout_completed_123');
await stripe.webhooks.sendInvalidSignature('checkout.session.completed', fixture);
```

## FullCircle Stripe provider API proposal

```ts
export interface StripeProviderDsl {
  checkout: {
    sessions: {
      create(expectation: StripeCheckoutSessionCreateExpectation): StripeExpectationBuilder;
      retrieve(expectation: StripeCheckoutSessionRetrieveExpectation): StripeExpectationBuilder;
      lineItems(expectation: StripeCheckoutSessionLineItemsExpectation): StripeExpectationBuilder;
    };
  };

  webhooks: StripeWebhookController;
}

export interface StripeCheckoutSessionCreateExpectation {
  match?: {
    mode?: 'subscription';
    successUrl?: Matcher<string>;
    cancelUrl?: Matcher<string>;
    priceId?: Matcher<string>;
    quantity?: Matcher<number>;
    clientReferenceId?: Matcher<string>;
    metadata?: Record<string, Matcher<string>>;
    subscriptionMetadata?: Record<string, Matcher<string>>;
  };

  reply?: Partial<StripeCheckoutSessionFixture>;
}

export interface StripeWebhookController {
  send<TType extends StripeWebhookType>(
    type: TType,
    event: StripeWebhookFixture<TType>,
    options?: StripeWebhookSendOptions,
  ): Promise<WebhookDeliveryResult>;

  sendSequence(
    events: StripeWebhookSequenceItem[],
    options?: StripeWebhookSequenceOptions,
  ): Promise<WebhookDeliveryResult[]>;
}

export interface StripeWebhookSendOptions {
  to?: string;
  signingSecret?: string;
  timestamp?: number;
  signatureMode?: 'valid' | 'invalid' | 'missing';
  idempotencyKey?: string;
}
```

Example authored session:

```ts
await fullcircle.provider('stripe').session('checkout-subscription-success', stripe => {
  stripe.checkout.sessions.create({
    match: {
      mode: 'subscription',
      priceId: 'price_pro_monthly',
      clientReferenceId: 'user_test_123',
      metadata: { userId: 'user_test_123' },
    },
    reply: {
      id: 'cs_test_fullcircle_123',
      customer: 'cus_fullcircle_123',
      url: 'http://localhost:7331/stripe/checkout/cs_test_fullcircle_123',
    },
  });
});
```

Example test webhook send:

```ts
await fullcircle.provider('stripe').webhooks.send('checkout.session.completed', {
  id: 'evt_fullcircle_checkout_completed_123',
  data: {
    object: {
      id: 'cs_test_fullcircle_123',
      customer: 'cus_fullcircle_123',
      subscription: 'sub_fullcircle_123',
      client_reference_id: user.id,
      metadata: { userId: user.id },
    },
  },
});
```

## Recording format requirements

Canonical JSON session should store:

```json
{
  "schemaVersion": "fullcircle.session.v1",
  "provider": "stripe",
  "name": "checkout-subscription-success",
  "expectations": [
    {
      "name": "create checkout session",
      "request": {
        "method": "POST",
        "path": "/v1/checkout/sessions",
        "bodyEncoding": "form-urlencoded",
        "body": {
          "mode": "subscription",
          "line_items[0][price]": "price_pro_monthly",
          "line_items[0][quantity]": "1"
        }
      },
      "response": {
        "status": 200,
        "json": {
          "id": "cs_test_fullcircle_123",
          "object": "checkout.session",
          "url": "http://localhost:7331/stripe/checkout/cs_test_fullcircle_123"
        }
      }
    }
  ],
  "webhooks": [
    {
      "type": "checkout.session.completed",
      "eventId": "evt_fullcircle_checkout_completed_123",
      "signatureMode": "valid"
    }
  ]
}
```

## Redaction rules

Always redact:

- `Authorization` header,
- `Stripe-Signature` header in recorded fixtures unless intentionally testing signature parsing,
- `STRIPE_SECRET_KEY`,
- `STRIPE_WEBHOOK_SECRET`,
- customer email/name/address/phone unless explicitly kept,
- card/payment method details,
- idempotency keys if they include app secrets.

Preserve deterministic synthetic IDs:

- `cs_test_fullcircle_*`
- `cus_fullcircle_*`
- `sub_fullcircle_*`
- `evt_fullcircle_*`
- `price_fullcircle_*`

## SQLite acceptance assertions for subscription checkout

After successful replay, DB diff should show:

- one inserted or updated user billing/customer mapping,
- one inserted subscription row or updated subscription status,
- one processed webhook event ID for idempotency.

Example expected diff:

```json
{
  "inserted": {
    "subscriptions": [
      {
        "user_id": "user_test_123",
        "provider": "stripe",
        "provider_customer_id": "cus_fullcircle_123",
        "provider_subscription_id": "sub_fullcircle_123",
        "status": "active"
      }
    ],
    "processed_webhook_events": [
      {
        "provider": "stripe",
        "event_id": "evt_fullcircle_checkout_completed_123"
      }
    ]
  }
}
```

## Minimum implementation checklist

1. Parse Stripe SDK form-encoded requests to `/v1/checkout/sessions`.
2. Match subscription Checkout create requests by `mode`, price, quantity, success/cancel URLs, metadata, and client reference ID.
3. Return deterministic Checkout Session with hosted `url` pointing back into FullCircle.
4. Provide a synthetic hosted checkout page route that can simulate success/cancel.
5. Generate/send valid `Stripe-Signature` headers for webhook payloads.
6. Support `checkout.session.completed`, `customer.subscription.created`, and `invoice.paid` fixtures.
7. Record and replay webhook deliveries.
8. Add duplicate/out-of-order/invalid-signature test helpers.
9. Produce JSON session fixtures plus optional generated TypeScript helpers.
10. Add SQLite snapshot/diff assertions in the dogfood acceptance test.

## Sources

- Stripe Checkout lifecycle and hosted session flow: https://docs.stripe.com/payments/checkout/how-checkout-works.md?payment-ui=stripe-hosted
- Create Checkout Session API: https://docs.stripe.com/api/checkout/sessions/create
- Checkout Session object/API overview: https://docs.stripe.com/api/checkout/sessions
- Checkout fulfillment and `checkout.session.completed`: https://docs.stripe.com/checkout/fulfillment.md?payment-ui=stripe-hosted
- Webhook signature verification and raw body requirement: https://docs.stripe.com/webhooks.md#verify-events
- Webhook signature troubleshooting: https://docs.stripe.com/webhooks/signature.md
- Subscription webhook event guidance: https://docs.stripe.com/billing/subscriptions/webhooks.md
