# FullCircle Stripe Embedded Checkout Provider Contract

Bead: `fullcircle-64o.13 — Design embedded Stripe Checkout provider contract`

## Scope

This contract covers **Stripe Checkout Sessions in `subscription` mode with `ui_mode=embedded_page`**. It is separate from the hosted Checkout provider so FullCircle does not half-support two browser journeys through one ambiguous API.

FullCircle treats the Stripe-hosted page, embedded Checkout page, and Elements/custom flows as distinct provider contracts:

- hosted Checkout returns a redirect `url` and uses `success_url`/`cancel_url`.
- embedded Checkout returns a `client_secret`, uses `return_url`, and is mounted in the app via Stripe.js.
- Elements/custom Checkout requires a separate contract because the app owns more of the client-side payment form.

Stripe's current Checkout Sessions API names the embedded prebuilt UI mode `embedded_page`. Older planning notes in this repository used `embedded`; provider APIs should use the current Stripe API value and can document migrations from older notes, but should not accept both names silently.

## Provider API

```ts
stripe.checkout.embedded.sessions.createSubscription({
  match: {
    customer: 'cus_app_user_123',
    returnUrl: 'http://localhost:3000/checkout/return?session_id={CHECKOUT_SESSION_ID}',
    redirectOnCompletion: 'if_required',
    allowPromotionCodes: true,
    clientReferenceId: 'user_123',
    lineItems: [
      {priceId: 'price_pro_monthly', quantity: 1},
    ],
    metadata: {
      user_id: 'user_123',
    },
    subscriptionMetadata: {
      user_id: 'user_123',
    },
    trial: {
      periodDays: 14,
      missingPaymentMethod: 'cancel',
    },
  },
  reply: {
    id: 'cs_test_embedded_123',
    customer: 'cus_app_user_123',
    client_secret: 'cs_test_embedded_123_secret_fullcircle',
  },
});
```

### Request contract

The provider matches `POST /v1/checkout/sessions` form-encoded requests with:

- `mode=subscription`
- `ui_mode=embedded_page`
- `return_url`, usually including `{CHECKOUT_SESSION_ID}`
- no `success_url` or `cancel_url`
- optional `redirect_on_completion` when the app customizes post-payment redirect behavior
- optional `customer`, `allow_promotion_codes`, `client_reference_id`, `metadata[*]`, `subscription_data[metadata][*]`, and `subscription_data[trial_*]`
- one or more `line_items[n][price]` and `line_items[n][quantity]`

A hosted-style request must fail fast with diagnostics, rather than returning a fixture that would hide a production integration mismatch.

### Response contract

The deterministic response is a Checkout Session fixture with:

```ts
{
  id: 'cs_test_fullcircle_embedded_123',
  object: 'checkout.session',
  mode: 'subscription',
  ui_mode: 'embedded_page',
  status: 'open',
  payment_status: 'unpaid',
  client_secret: 'cs_test_fullcircle_embedded_123_secret_fullcircle',
  return_url: 'http://localhost:3000/checkout/return?session_id={CHECKOUT_SESSION_ID}',
  url: null,
  success_url: null,
  cancel_url: null,
  customer: 'cus_fullcircle_123',
  subscription: null,
  livemode: false,
}
```

The app under test should return the `client_secret` from its server API and mount embedded Checkout in the browser. FullCircle browser-capture tests can then correlate the user click that created the session with this Stripe API call and any follow-up webhooks.

## Acceptance tests

The provider contract is covered by `packages/harness/tests/providers/stripe.test.ts`:

1. `models embedded subscription Checkout Sessions as a separate provider contract` proves a Soundspace-like `ui_mode=embedded_page` subscription request returns `client_secret`, `return_url`, and no hosted `url`.
2. `rejects hosted-style Checkout payloads for the embedded Checkout contract` proves `success_url`/`cancel_url` payloads fail when the embedded provider is installed.

A future browser-level e2e should add a tiny app that:

1. clicks an in-app checkout button,
2. calls the app server endpoint that creates the embedded Checkout Session,
3. receives `client_secret`,
4. mounts a test double for Stripe.js embedded Checkout,
5. simulates completion by sending `checkout.session.completed` and subscription/invoice webhooks,
6. verifies the app database diff shows the expected subscription entitlement rows.

## Non-goals

- Do not emulate Stripe's embedded iframe UI inside the API provider.
- Do not mix embedded Checkout options into `stripe.checkout.sessions.create()`, which remains the hosted Checkout contract.
- Do not model Elements/custom Checkout in this contract.
- Do not silently accept legacy `ui_mode=embedded`; require the app code to send Stripe's current API value.

## References

- Stripe embedded Checkout quickstart: https://docs.stripe.com/checkout/embedded/quickstart
- Stripe Checkout Session create API: https://docs.stripe.com/api/checkout/sessions/create
- Stripe Checkout Session object API: https://docs.stripe.com/api/checkout/sessions/object
