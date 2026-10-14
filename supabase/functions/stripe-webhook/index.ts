// Stripe tells us when a Checkout payment succeeds; we record it on the order exactly once.
import Stripe from "npm:stripe@17.7.0";
import { admin, env, stripe } from "../_shared/util.ts";

const crypto = Stripe.createSubtleCryptoProvider();

Deno.serve(async (req) => {
  const sig = req.headers.get("Stripe-Signature");
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(body, sig!, env("STRIPE_WEBHOOK_SECRET"), undefined, crypto);
  } catch (e) {
    console.error("Bad signature", e);
    return new Response("Invalid signature", { status: 400 });
  }

  const db = admin();
  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.payment_status === "paid" && s.metadata?.order_id) {
        const { error } = await db.rpc("record_payment", {
          p_session: s.id,
          p_order: s.metadata.order_id,
          p_amount: (s.amount_total ?? 0) / 100,
          p_kind: s.metadata.kind ?? "payment",
        });
        if (error) throw error;
      }
    }
    if (event.type === "account.updated") {
      const a = event.data.object as Stripe.Account;
      await db.from("shops").update({ stripe_ready: !!a.charges_enabled }).eq("stripe_account", a.id);
    }
  } catch (e) {
    console.error(e);
    return new Response("Handler error", { status: 500 }); // Stripe will retry
  }
  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});
