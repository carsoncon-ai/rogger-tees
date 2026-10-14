// Creates a Stripe Checkout page for a customer's deposit or remaining balance.
// The money goes to the shop's connected Stripe account; the platform keeps PLATFORM_FEE_PERCENT.
import { admin, cents, cors, env, fail, json, siteUrl, stripe } from "../_shared/util.ts";

const PAYABLE = ["Approved", "Production", "Ready", "Completed"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { token } = await req.json().catch(() => ({}));
    if (!token || !/^[0-9a-f-]{36}$/i.test(token)) return fail("Missing order link");

    const db = admin();
    const { data: order } = await db.from("orders").select("*, shops(*)").eq("access_token", token).single();
    if (!order) return fail("Order not found", 404);
    const shop = order.shops;
    if (!PAYABLE.includes(order.status)) return fail("This order hasn't been approved yet");
    if (!shop.stripe_account || !shop.stripe_ready) return fail(`${shop.name} isn't set up to take online payments yet`);

    const total = Number(order.total), paid = Number(order.amount_paid);
    const remaining = Math.round((total - paid) * 100) / 100;
    if (remaining <= 0 || order.paid) return fail("This order is already paid");

    const depositPct = Number(shop.settings?.deposit ?? 0);
    const isDeposit = paid === 0 && depositPct > 0 && depositPct < 100;
    const amount = isDeposit ? Math.round(total * depositPct) / 100 : remaining;
    const feePct = Number(env("PLATFORM_FEE_PERCENT", false) || 0);

    const back = `${siteUrl()}?shop=${encodeURIComponent(shop.slug)}&order=${token}`;
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      customer_email: order.customer_email,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: cents(amount),
          product_data: {
            name: `${shop.name} — Order #${order.number} ${isDeposit ? `deposit (${depositPct}%)` : paid ? "balance" : "payment"}`,
            description: `${order.title} · ${order.qty} × ${order.product_name}`,
          },
        },
      }],
      payment_intent_data: {
        application_fee_amount: feePct > 0 ? Math.round(cents(amount) * feePct / 100) : undefined,
        transfer_data: { destination: shop.stripe_account },
        metadata: { order_id: order.id, shop_id: shop.id },
      },
      metadata: { order_id: order.id, kind: isDeposit ? "deposit" : "balance" },
      success_url: `${back}&paid=1`,
      cancel_url: back,
    });
    return json({ url: session.url });
  } catch (e) {
    console.error(e);
    return fail((e as Error).message, 500);
  }
});
