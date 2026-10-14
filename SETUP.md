# Rogger Studio — going live with Supabase + Stripe

The site runs in **demo mode** (everything saved in the visitor's browser) until `config.js` has your Supabase keys.
After setup:

- Businesses sign up at `https://carsoncon-ai.github.io/rogger-tees/#hq-signup` and get their own shop.
- Each shop's customers use `https://carsoncon-ai.github.io/rogger-tees/?shop=their-shop-link`.
- Customers pay deposits/balances by card; money goes to the shop's Stripe account, and you keep `PLATFORM_FEE_PERCENT`.

Run every command below from this folder (`rogger-tees-studio`).

---

## 1. Create the Supabase project (5 min)

1. Sign up at <https://supabase.com> and click **New project** (the free plan is fine to start).
2. When it's ready, open **Project Settings → API** and copy:
   - **Project URL** (`https://xxxx.supabase.co`)
   - **anon public** key
3. Paste both into `config.js`. (Both are safe to publish — the database rules decide what the anon key can do.)
4. Note the **project ref** — the `xxxx` part of the URL.

## 2. Push the database and server functions

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
npx supabase functions deploy connect checkout stripe-webhook notify
```

## 3. Auth settings (Supabase dashboard → Authentication)

- **URL Configuration**
  - Site URL: `https://carsoncon-ai.github.io/rogger-tees/`
  - Redirect URLs: add `https://carsoncon-ai.github.io/rogger-tees/**`
- **Email Templates → Magic Link**: customers sign in to "My orders" with a code. Replace the body with:
  ```html
  <h2>Your sign-in code</h2>
  <p>Enter this code to see your orders: <b style="font-size:22px">{{ .Token }}</b></p>
  ```
- **Emails**: Supabase's built-in sender only allows a few emails per hour. Before real launch, set up custom SMTP
  (**Authentication → SMTP Settings** — Resend works well) so sign-up and code emails always arrive.

## 4. Stripe (Connect)

1. Sign in at <https://dashboard.stripe.com> and stay in **Test mode** for now.
2. Go to **Connect → Get started** and choose the **Platform / marketplace** option. Fill in the platform profile.
3. Copy your **secret key** (Developers → API keys, starts with `sk_test_`).
4. Set the server secrets (replace the values):
   ```bash
   npx supabase secrets set STRIPE_SECRET_KEY=sk_test_xxx SITE_URL=https://carsoncon-ai.github.io/rogger-tees/ PLATFORM_FEE_PERCENT=3
   ```
5. Add the webhook: **Developers → Webhooks → Add endpoint**
   - URL: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/stripe-webhook`
   - Listen to: **Your account**
   - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`
   - Copy the **signing secret** (`whsec_…`) and set it:
   ```bash
   npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxx
   ```

## 5. Order emails (optional, recommended)

New-order alerts to the shop and approve/decline emails to customers go through [Resend](https://resend.com):

1. Create a Resend account, verify your sending domain, and create an API key.
2. ```bash
   npx supabase secrets set RESEND_API_KEY=re_xxx FROM_EMAIL="Rogger Studio <orders@yourdomain.com>"
   ```

Without these, everything still works — just no emails beyond Supabase's sign-in emails.

## 6. Test the whole flow

1. Open `https://carsoncon-ai.github.io/rogger-tees/#hq-signup`, create an account and a shop.
2. **Settings → Online payments → Connect Stripe**. In test mode you can use Stripe's test data to finish onboarding.
3. Open your customer link (Dashboard → **Copy customer link**) in a private window, design a shirt, submit.
4. Back in HQ the order appears live. Approve it.
5. Open the customer's order link → **Pay deposit** → use card `4242 4242 4242 4242`, any future date, any CVC.
6. The order shows the payment within a few seconds.

## Going live

1. Switch Stripe to **Live mode**, finish your platform's Connect profile, and repeat step 4 with the live
   `sk_live_` key and a live webhook endpoint (new `whsec_`).
2. Set up custom SMTP (step 3) and Resend (step 5).
3. Optional: a custom domain for the site (GitHub repo → Settings → Pages), then update `SITE_URL` and the Supabase Site URL.

## How it fits together

| Piece | Where | Does |
|---|---|---|
| `index.html`, `app.js` | GitHub Pages | Studio + Business HQ |
| `api.js`, `config.js` | GitHub Pages | Talks to Supabase (or browser storage in demo mode) |
| `supabase/migrations` | Supabase Postgres | Shops, products, orders, payments; row-level security; server-side pricing |
| `functions/connect` | Supabase Edge | Stripe Connect onboarding + status for shop owners |
| `functions/checkout` | Supabase Edge | Stripe Checkout for deposits/balances (platform fee applied) |
| `functions/stripe-webhook` | Supabase Edge | Records payments exactly once |
| `functions/notify` | Supabase Edge | Order emails via Resend |

Security notes: order prices are recalculated in the database (customers can't change what they pay), shop owners can't
edit payment amounts, and each business only ever sees its own orders.
