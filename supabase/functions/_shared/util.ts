import Stripe from "npm:stripe@17.7.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

export const fail = (message: string, status = 400) => json({ error: message }, status);

export function env(name: string, required = true): string {
  const v = Deno.env.get(name) ?? "";
  if (required && !v) throw new Error(`Missing secret ${name}. Set it with: supabase secrets set ${name}=...`);
  return v;
}

/** Service-role client: bypasses RLS, only ever used server-side. */
export const admin = (): SupabaseClient =>
  createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

export const stripe = () => new Stripe(env("STRIPE_SECRET_KEY"), { httpClient: Stripe.createFetchHttpClient() });

/** Public site address, used for Stripe return links. Always ends with "/". */
export const siteUrl = () => env("SITE_URL").replace(/\/?$/, "/");

/** Returns the signed-in user for this request, or null. */
export async function userFrom(req: Request) {
  const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data } = await admin().auth.getUser(jwt);
  return data.user ?? null;
}

export const cents = (n: number) => Math.round(n * 100);
