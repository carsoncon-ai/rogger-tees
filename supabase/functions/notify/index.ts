// Order emails through Resend. Optional: if RESEND_API_KEY isn't set, this quietly does nothing.
//  - "submitted": called by the customer right after submitting -> emails the shop + a receipt to the customer
//  - "updated":   called by the shop owner after approve/decline/status change -> emails the customer
import { admin, cors, env, fail, json, siteUrl, userFrom } from "../_shared/util.ts";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const LABEL: Record<string, string> = { Pending: "Needs review", Approved: "Approved", Declined: "Declined", Production: "In production", Ready: "Ready", Completed: "Completed" };

async function send(to: string, subject: string, html: string, replyTo?: string) {
  const key = env("RESEND_API_KEY", false);
  if (!key || !to) return false;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env("FROM_EMAIL"), to, subject, html, reply_to: replyTo || undefined }),
  });
  if (!r.ok) console.error("Resend error", r.status, await r.text());
  return r.ok;
}

const wrap = (shop: { name: string }, body: string) =>
  `<div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:auto;color:#111">
     <h2 style="margin:0 0 12px">${esc(shop.name)}</h2>${body}
     <p style="color:#888;font-size:12px;margin-top:28px">Sent by ${esc(shop.name)} via Rogger Studio</p></div>`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { event, token, order_id } = await req.json().catch(() => ({}));
    const db = admin();

    if (event === "submitted") {
      const { data: o } = await db.from("orders").select("*, shops(*)").eq("access_token", token).single();
      if (!o) return fail("Order not found", 404);
      // Only right after submitting, so this can't be used to spam.
      if (Date.now() - new Date(o.created_at).getTime() > 10 * 60_000) return json({ skipped: "too old" });
      const shop = o.shops, link = `${siteUrl()}?shop=${shop.slug}&order=${o.access_token}`;
      const { data: owner } = await db.auth.admin.getUserById(shop.owner);
      const shopEmail = shop.settings?.email || owner?.user?.email;
      await send(shopEmail, `New order #${o.number} from ${o.customer.org}`, wrap(shop,
        `<p><b>${esc(o.customer.org)}</b> submitted <b>${esc(o.title)}</b>: ${o.qty} × ${esc(o.product_name)} (${esc(o.color_name)}) — $${Number(o.total).toFixed(2)}.</p>
         <p><a href="${siteUrl()}#hq" style="background:#111;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Review in Business HQ</a></p>`), o.customer_email);
      await send(o.customer_email, `We got your order #${o.number}`, wrap(shop,
        `<p>Thanks ${esc(o.customer.name || o.customer.org)}! ${esc(shop.name)} will review your design and get back to you.</p>
         <p>Estimated total: <b>$${Number(o.total).toFixed(2)}</b></p>
         <p><a href="${link}">Track your order</a></p>`), shopEmail);
      return json({ ok: true });
    }

    if (event === "updated") {
      const user = await userFrom(req);
      if (!user) return fail("Sign in first", 401);
      const { data: o } = await db.from("orders").select("*, shops(*)").eq("id", order_id).single();
      if (!o || o.shops.owner !== user.id) return fail("Order not found", 404);
      const shop = o.shops, link = `${siteUrl()}?shop=${shop.slug}&order=${o.access_token}`;
      const lines: Record<string, string> = {
        Approved: `Your design is approved!${shop.stripe_ready && !o.paid ? " You can pay securely online from your order page." : ""}`,
        Declined: `We couldn't approve this design as submitted.<br><b>Reason:</b> ${esc(o.decline_reason)}<br>You can edit it and resubmit from your order page.`,
        Production: "Your order is now in production.",
        Ready: "Your order is ready!",
        Completed: "Your order is complete. Thanks for ordering with us!",
      };
      if (!lines[o.status]) return json({ skipped: "no email for this status" });
      await send(o.customer_email, `Order #${o.number}: ${LABEL[o.status]}`, wrap(shop,
        `<p>${lines[o.status]}</p>${o.message ? `<p><i>“${esc(o.message)}”</i></p>` : ""}
         <p><a href="${link}" style="background:#111;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">View order #${o.number}</a></p>`),
        shop.settings?.email);
      return json({ ok: true });
    }
    return fail("Unknown event");
  } catch (e) {
    console.error(e);
    return fail((e as Error).message, 500);
  }
});
