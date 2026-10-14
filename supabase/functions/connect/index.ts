// Stripe Connect for shop owners: onboarding, status refresh and the Stripe Express dashboard.
import { admin, cors, fail, json, siteUrl, stripe, userFrom } from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const user = await userFrom(req);
    if (!user) return fail("Sign in first", 401);
    const { action } = await req.json().catch(() => ({}));

    const db = admin();
    const { data: shop } = await db.from("shops").select("*").eq("owner", user.id).single();
    if (!shop) return fail("Create your shop first", 404);
    const s = stripe();

    if (action === "onboard") {
      let account = shop.stripe_account as string | null;
      if (!account) {
        const acct = await s.accounts.create({
          type: "express",
          email: user.email,
          business_profile: { name: shop.name },
          capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
          metadata: { shop_id: shop.id },
        });
        account = acct.id;
        await db.from("shops").update({ stripe_account: account }).eq("id", shop.id);
      }
      const back = `${siteUrl()}#hq-payments`;
      const link = await s.accountLinks.create({ account, refresh_url: back, return_url: back, type: "account_onboarding" });
      return json({ url: link.url });
    }

    if (action === "status") {
      if (!shop.stripe_account) return json({ connected: false, ready: false });
      const acct = await s.accounts.retrieve(shop.stripe_account);
      const ready = !!acct.charges_enabled;
      if (ready !== shop.stripe_ready) await db.from("shops").update({ stripe_ready: ready }).eq("id", shop.id);
      return json({ connected: true, ready, details_submitted: acct.details_submitted, payouts_enabled: acct.payouts_enabled });
    }

    if (action === "dashboard") {
      if (!shop.stripe_account) return fail("Connect Stripe first");
      const link = await s.accounts.createLoginLink(shop.stripe_account);
      return json({ url: link.url });
    }

    return fail("Unknown action");
  } catch (e) {
    console.error(e);
    return fail((e as Error).message, 500);
  }
});
