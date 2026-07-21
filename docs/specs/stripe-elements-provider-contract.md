# FullCircle Stripe Elements / Payment Element Provider Contract

Bead: `fullcircle-64o.12 — Design Stripe Elements provider contract`

## Scope

This contract covers **Stripe Elements and Payment Element integrations** where the app owns the checkout page, creates or confirms Intents through app/server code, passes a `client_secret` to Stripe.js, and fulfills through webhooks. It is intentionally separate from hosted Checkout and embedded Checkout:

- hosted Checkout returns a Stripe-hosted `url` and uses `success_url` / `cancel_url`;
- embedded Checkout creates a Checkout Session with `ui_mode=embedded_page`, returns `client_secret`, and still relies on the Checkout Session object;
- Elements/Payment Element uses PaymentIntent and SetupIntent APIs directly and the app owns the form, submit button, and client-side confirmation behavior.

FullCircle should not add Payment Element fields to `stripe.checkout.sessions.create()`. Elements needs its own provider contract and browser shim because the critical behavior happens at the seam between app UI, Stripe.js, PaymentIntent/SetupIntent APIs, and webhooks.

## Stripe lifecycle to model

For Payment Element one-time or invoice-like payment flows:

1. app server creates a PaymentIntent with amount/currency/customer/metadata;
2. server returns the PaymentIntent `client_secret` to the browser;
3. browser mounts Stripe.js Elements with that `client_secret`;
4. user submits the app-owned form;
5. browser calls `stripe.confirmPayment()` or app server confirms the PaymentIntent;
6. payment status transitions to `succeeded`, `processing`, `requires_action`, or `requires_payment_method`;
7. app fulfills from webhooks, especially `payment_intent.succeeded`, not only from client redirect/polling.

For saved-payment-method or subscription-setup flows:

1. app server creates a SetupIntent for a customer;
2. server returns the SetupIntent `client_secret`;
3. browser mounts Payment Element or payment-method collection UI;
4. browser calls `stripe.confirmSetup()`;
5. app handles `setup_intent.succeeded`, `setup_intent.setup_failed`, and optional `payment_method.attached` webhooks.

## Provider API proposal

```ts
const stripe = stripeProvider(harness);

stripe.elements.paymentIntents.create({
  match: {
    amount: 2500,
    currency: 'usd',
    customer: 'cus_acme',
    automaticPaymentMethodsEnabled: true,
    metadata: { order_id: 'order_123' },
  },
  reply: {
    id: 'pi_fullcircle_123',
    client_secret: 'pi_fullcircle_123_secret_fullcircle',
    status: 'requires_payment_method',
  },
});

stripe.elements.paymentIntents.confirm({
  paymentIntentId: 'pi_fullcircle_123',
  match: { paymentMethod: 'pm_card_visa', returnUrl: 'http://localhost:3000/payment/return' },
  reply: { status: 'succeeded' },
});

stripe.elements.setupIntents.create({
  match: { customer: 'cus_acme', usage: 'off_session' },
  reply: {
    id: 'seti_fullcircle_123',
    client_secret: 'seti_fullcircle_123_secret_fullcircle',
    status: 'requires_payment_method',
  },
});

stripe.elements.setupIntents.confirm({
  setupIntentId: 'seti_fullcircle_123',
  match: { paymentMethod: 'pm_card_visa' },
  reply: { status: 'succeeded', payment_method: 'pm_card_visa' },
});
```

### Endpoint mapping

| Provider helper | Stripe endpoint | Match fields |
| --- | --- | --- |
| `elements.paymentIntents.create()` | `POST /v1/payment_intents` | `amount`, `currency`, `customer`, `payment_method_types[]`, `automatic_payment_methods[enabled]`, `metadata[*]`, `setup_future_usage`, `capture_method` |
| `elements.paymentIntents.retrieve()` | `GET /v1/payment_intents/:id` | id in path, optional `client_secret` query assertion |
| `elements.paymentIntents.confirm()` | `POST /v1/payment_intents/:id/confirm` | `payment_method`, `return_url`, `use_stripe_sdk`, `mandate_data`, `receipt_email` |
| `elements.setupIntents.create()` | `POST /v1/setup_intents` | `customer`, `usage`, `payment_method_types[]`, `metadata[*]`, `automatic_payment_methods[enabled]` |
| `elements.setupIntents.retrieve()` | `GET /v1/setup_intents/:id` | id in path, optional `client_secret` query assertion |
| `elements.setupIntents.confirm()` | `POST /v1/setup_intents/:id/confirm` | `payment_method`, `return_url`, `use_stripe_sdk`, `mandate_data` |
| `elements.paymentMethods.attach()` | `POST /v1/payment_methods/:id/attach` | `customer` |

## Browser shim contract

The API provider alone is not enough for Elements because the app owns the browser form and calls Stripe.js directly. FullCircle should provide a small browser shim, likely through the Vite browser interaction plugin, that can replace `@stripe/stripe-js`/`loadStripe()` in tests.

Proposed shim API:

```ts
stripeElementsBrowserShim({
  clientSecret: 'pi_fullcircle_123_secret_fullcircle',
  confirmPayment: {
    result: {
      paymentIntent: { id: 'pi_fullcircle_123', status: 'succeeded' },
    },
  },
  mountedElements: ['payment'],
});
```

The shim should capture:

- `loadStripe()` publishable key and options;
- `stripe.elements({ clientSecret })` calls;
- mounted Element type and selector;
- `confirmPayment()` / `confirmSetup()` inputs;
- redirect behavior (`if_required`, `always`, `return_url`);
- user interaction correlation from the Vite browser capture plugin.

The shim should not emulate card validation exhaustively. It should provide deterministic success/failure/SCA-required results so app e2e tests can verify routing, database changes, and webhook fulfillment.

## Required fixtures and statuses

### PaymentIntent fixtures

Minimum deterministic PaymentIntent fixture:

```ts
{
  id: 'pi_fullcircle_123',
  object: 'payment_intent',
  amount: 2500,
  currency: 'usd',
  customer: 'cus_acme',
  client_secret: 'pi_fullcircle_123_secret_fullcircle',
  status: 'requires_payment_method',
  payment_method: null,
  metadata: { order_id: 'order_123' },
  livemode: false,
}
```

Statuses to support first:

- `requires_payment_method` for initial create and failed attempt;
- `requires_action` for SCA/3DS app handling;
- `processing` for async payment method handling;
- `succeeded` for happy-path fulfillment;
- `canceled` for explicit cancellation or expired flow.

### SetupIntent fixtures

Minimum deterministic SetupIntent fixture:

```ts
{
  id: 'seti_fullcircle_123',
  object: 'setup_intent',
  customer: 'cus_acme',
  client_secret: 'seti_fullcircle_123_secret_fullcircle',
  status: 'requires_payment_method',
  payment_method: null,
  usage: 'off_session',
  livemode: false,
}
```

Statuses to support first:

- `requires_payment_method`;
- `requires_action`;
- `processing`;
- `succeeded`;
- `canceled`.

## Webhook events

Elements flows should use the existing `stripe.webhooks.send()` controller, expanded as needed, for:

- `payment_intent.created`;
- `payment_intent.requires_action`;
- `payment_intent.processing`;
- `payment_intent.succeeded`;
- `payment_intent.payment_failed`;
- `payment_intent.canceled`;
- `setup_intent.succeeded`;
- `setup_intent.setup_failed`;
- `setup_intent.requires_action`;
- `payment_method.attached`.

The acceptance tests should assert that app fulfillment waits for webhook-side state, not only the browser `confirmPayment()` result.

## Failure fixtures

High-signal failures to model:

1. PaymentIntent create validation error, such as amount/currency mismatch;
2. `requires_action` confirmation result for SCA handling;
3. `requires_payment_method` with `last_payment_error` for card decline;
4. webhook says `payment_intent.payment_failed` after client sees a failure;
5. SetupIntent failure for saved payment method setup;
6. browser shim `confirmPayment()` rejects or returns `{error}` to test UI error rendering;
7. app retries retrieve/poll and sees `processing` before webhook success.

## Acceptance test plan

Provider contract tests in FullCircle should cover:

1. creating a PaymentIntent returns a deterministic `client_secret` and matches amount/currency/customer/metadata;
2. confirming a PaymentIntent can return `succeeded`, `requires_action`, or `requires_payment_method`;
3. creating and confirming a SetupIntent returns deterministic setup fixtures;
4. browser shim captures `elements({clientSecret})`, mounted Payment Element, and `confirmPayment()` payload;
5. signed webhooks deliver `payment_intent.succeeded` and `setup_intent.succeeded` fixtures;
6. a tiny app e2e asserts user click -> app server creates Intent -> shim confirms -> webhook updates SQLite rows.

## Non-goals

- Do not mix Elements into `stripe.checkout.sessions.create()`.
- Do not recreate Stripe's full iframe/card validation frontend.
- Do not support subscriptions through Elements until the app-level contract is explicit; a subscription flow may involve SetupIntents, PaymentMethods, Subscriptions, Invoices, and PaymentIntents and should get its own acceptance scenario.
- Do not rely on polling alone for fulfillment assertions; webhooks must be first-class.

## References

- Stripe Payment Element overview: https://docs.stripe.com/payments/payment-element
- Stripe Payment Intents API: https://docs.stripe.com/payments/payment-intents
- Stripe PaymentIntent object: https://docs.stripe.com/api/payment_intents/object
- Stripe payment status/webhook guidance: https://docs.stripe.com/payments/payment-intents/verifying-status
- Stripe Setup Intents API: https://docs.stripe.com/api/setup_intents
