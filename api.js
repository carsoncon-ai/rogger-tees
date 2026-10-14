/* Data layer. The app talks only to `api`, which is either:
   - CloudApi: Supabase database/auth/storage + Stripe via Supabase Edge Functions
   - LocalApi: demo mode, everything in this browser's localStorage
   Shapes returned to the app are the same in both modes (see the fromX / toX mappers). */
(() => {
const cfg = window.ROGGER_CONFIG || {};
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const SITE = location.origin + location.pathname;
const abs = p => /^(https?:|data:)/.test(p || '') ? p : new URL(p, SITE).href;

const DEFAULT_SETTINGS = {
  turnaround: '10–14 business days after approval', email: '', phone: '',
  tiers: [{ min: 24, off: 0 }, { min: 48, off: 5 }, { min: 72, off: 8 }, { min: 144, off: 12 }],
  deposit: 50, rush: 15, tax: 0,
};
const tee = c => ({ front: `assets/shirt-${c}-front.png`, back: `assets/shirt-${c}-back.png` });
const hood = c => ({ front: `assets/hoodie-${c}-front.png`, back: `assets/hoodie-${c}-back.png` });
const tint = [['royal', 'Royal', '#2a4fa8'], ['carolina', 'Carolina', '#7fb2e0'], ['maroon', 'Maroon', '#6b1f2a'], ['cardinal', 'Cardinal', '#a8202d'],
  ['sand', 'Sand', '#d9c7a3'], ['pink', 'Pink', '#f1b8c8'], ['purple', 'Purple', '#4e2f7a']].map(([id, name, hex]) => ({ id, name, hex }));
const DEFAULT_PRODUCTS = () => [
  { name: 'Essential Cotton Tee', category: 'T-Shirts', active: true, position: 0, price: 14, extraLoc: 4, extraEl: 0.75, cost: 4.5, minQty: 12,
    sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'], upcharge: { '2XL': 2, '3XL': 3 },
    images: tee('white'), print: { front: [31, 22, 38, 50], back: [31, 20, 38, 55] },
    colors: [{ id: 'white', name: 'White', hex: '#ffffff' }, { id: 'black', name: 'Black', hex: '#1a1a1a', ...tee('black') },
      { id: 'navy', name: 'Navy', hex: '#1f2a44', ...tee('navy') }, { id: 'forest', name: 'Forest Green', hex: '#24452f', ...tee('forest') },
      { id: 'gray', name: 'Heather Gray', hex: '#9a9a9a', ...tee('gray') }, ...tint] },
  { name: 'Heavyweight Hoodie', category: 'Fleece', active: true, position: 1, price: 34, extraLoc: 5, extraEl: 1, cost: 14, minQty: 12,
    sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'], upcharge: { '2XL': 3, '3XL': 4 },
    images: hood('white'), print: { front: [34, 37, 32, 24], back: [31, 33, 38, 48] },
    colors: [{ id: 'hgray', name: 'Heather Gray', hex: '#a9acaf', ...hood('gray') }, { id: 'white', name: 'White', hex: '#ffffff' },
      { id: 'black', name: 'Black', hex: '#2b2b2b' }, { id: 'navy', name: 'Navy', hex: '#1f2a44' }, { id: 'forest', name: 'Forest Green', hex: '#24452f' }, ...tint] },
];
// Image paths in default products become absolute so they work from any page.
const absolutize = p => ({ ...p, images: { front: abs(p.images.front), back: p.images.back ? abs(p.images.back) : '' },
  colors: p.colors.map(c => ({ ...c, ...(c.front ? { front: abs(c.front) } : {}), ...(c.back ? { back: abs(c.back) } : {}) })) });

function dataUrlToBlob(u) {
  const [h, b] = u.split(','), mime = h.match(/:(.*?);/)[1], bin = atob(b), a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return new Blob([a], { type: mime });
}

/* ======================= CLOUD ======================= */
function CloudApi() {
  const recovery = /type=recovery/.test(location.hash); // read before Supabase cleans the URL
  const sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, detectSessionInUrl: true } });
  const fnUrl = n => `${cfg.supabaseUrl}/functions/v1/${n}`;
  const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  let shopId = null;

  const fromShop = r => ({ id: r.id, slug: r.slug, name: r.name, logo: r.logo_url || '', accent: r.accent,
    ...DEFAULT_SETTINGS, ...r.settings, stripeReady: r.stripe_ready, stripeConnected: !!r.stripe_account });
  const toShop = s => ({ name: s.name, slug: s.slug, logo_url: s.logo || null, accent: s.accent,
    settings: { turnaround: s.turnaround, email: s.email, phone: s.phone, tiers: s.tiers, deposit: s.deposit, rush: s.rush, tax: s.tax } });
  const fromProduct = r => ({ ...r.data, id: r.id, active: r.active, position: r.position });
  const toProduct = p => { const { id, active, position, ...data } = p; return { shop_id: shopId, active, position: position || 0, data }; };
  const fromOrder = r => ({ id: r.id, number: r.number, token: r.access_token || r.token, customer: r.customer, title: r.title, due: r.due || '',
    notes: r.notes || '', sizes: r.sizes, qty: r.qty, unit: +r.unit || 0, total: +r.total, cost: +r.cost || 0, productId: r.product_id,
    productName: r.product_name, colorName: r.color_name, design: r.design, status: r.status, paid: r.paid, amountPaid: +r.amount_paid || 0,
    declineReason: r.decline_reason, message: r.message, note: r.note, history: r.history || [], at: new Date(r.created_at).getTime(),
    revisionOf: r.revision_of, shopId: r.shop_id });

  async function call(name, body, withAuth = true) {
    const headers = { 'Content-Type': 'application/json', apikey: cfg.supabaseAnonKey };
    const { data: { session } } = await sb.auth.getSession();
    headers.Authorization = `Bearer ${withAuth && session ? session.access_token : cfg.supabaseAnonKey}`;
    const r = await fetch(fnUrl(name), { method: 'POST', headers, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
    return j;
  }

  return {
    mode: 'cloud', siteUrl: SITE, recovery,
    async user() { return (await sb.auth.getUser()).data.user; },
    onAuth(cb) { sb.auth.onAuthStateChange((ev, s) => cb(ev, s?.user || null)); },
    async signIn(email, password) { must(await sb.auth.signInWithPassword({ email, password })); },
    async signUp(email, password) { const d = must(await sb.auth.signUp({ email, password, options: { emailRedirectTo: SITE + '?hq=1' } })); return !!d.session; },
    async signOut() { await sb.auth.signOut(); },
    async resetPassword(email) { must(await sb.auth.resetPasswordForEmail(email, { redirectTo: SITE + '?hq=1' })); },
    async updatePassword(password) { must(await sb.auth.updateUser({ password })); },
    async sendCode(email) { must(await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })); },
    async verifyCode(email, token) { must(await sb.auth.verifyOtp({ email, token, type: 'email' })); },

    async storefront(slug) {
      const shop = must(await sb.from('shops').select('*').eq('slug', slug).maybeSingle());
      if (!shop) return null;
      const products = must(await sb.from('products').select('*').eq('shop_id', shop.id).eq('active', true).order('position'));
      return { shop: fromShop(shop), products: products.map(fromProduct) };
    },
    async ownerData() {
      const u = await this.user(); if (!u) return null;
      const shop = must(await sb.from('shops').select('*').eq('owner', u.id).maybeSingle());
      if (!shop) return { user: u, shop: null };
      shopId = shop.id;
      const [products, orders] = await Promise.all([
        sb.from('products').select('*').eq('shop_id', shop.id).order('position').then(must),
        sb.from('orders').select('*').eq('shop_id', shop.id).order('created_at', { ascending: false }).then(must)]);
      return { user: u, shop: fromShop(shop), products: products.map(fromProduct), orders: orders.map(fromOrder) };
    },
    async createShop({ name, slug }) {
      const u = await this.user();
      const shop = must(await sb.from('shops').insert({ owner: u.id, name, slug, settings: DEFAULT_SETTINGS }).select().single());
      shopId = shop.id;
      must(await sb.from('products').insert(DEFAULT_PRODUCTS().map(absolutize).map(toProduct)));
    },
    async saveShop(s) { must(await sb.from('shops').update(toShop(s)).eq('id', s.id)); },
    async saveProduct(p) {
      const row = toProduct(p);
      if (p.id && !String(p.id).startsWith('new_')) { must(await sb.from('products').update(row).eq('id', p.id)); return p; }
      return fromProduct(must(await sb.from('products').insert(row).select().single()));
    },
    async deleteProduct(id) { must(await sb.from('products').delete().eq('id', id)); },
    async updateOrder(o, keys) {
      const map = { status: 'status', paid: 'paid', declineReason: 'decline_reason', message: 'message', note: 'note', history: 'history' };
      const patch = {}; keys.forEach(k => patch[map[k]] = o[k]);
      must(await sb.from('orders').update(patch).eq('id', o.id));
    },
    async deleteOrder(id) { must(await sb.from('orders').delete().eq('id', id)); },
    onOrders(cb) {
      if (!shopId) return;
      sb.channel('orders-' + shopId).on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `shop_id=eq.${shopId}` },
        p => cb(p.eventType, p.new && p.new.id ? fromOrder(p.new) : null, p.old?.id)).subscribe();
    },

    async uploadImage(dataUrl, kind) {
      if (!dataUrl?.startsWith('data:')) return dataUrl;
      const blob = dataUrlToBlob(dataUrl), ext = blob.type.split('/')[1].replace('svg+xml', 'svg');
      const path = kind === 'shop' ? `shops/${shopId}/${uid()}.${ext}` : `uploads/${uid()}.${ext}`;
      must(await sb.storage.from('media').upload(path, blob, { contentType: blob.type, cacheControl: '31536000' }));
      return sb.storage.from('media').getPublicUrl(path).data.publicUrl;
    },
    async submitOrder(shop, o) {
      const r = must(await sb.rpc('submit_order', { p_shop: shop.id, p_product: o.productId, p_design: o.design, p_sizes: o.sizes,
        p_customer: o.customer, p_title: o.title, p_due: o.due || null, p_notes: o.notes, p_revision_of: o.revisionOf || null }));
      return { id: r.id, number: r.number, token: r.token, total: +r.total };
    },
    async orderByToken(token) { const r = must(await sb.rpc('order_by_token', { p_token: token })); return r && fromOrder(r); },
    async myOrders(shop) { return (must(await sb.rpc('my_orders', { p_shop: shop.id })) || []).map(fromOrder); },
    async checkout(token) { return (await call('checkout', { token }, false)).url; },
    async connect(action) { return call('connect', { action }); },
    notify(event, data) { call('notify', { event, ...data }, event === 'updated').catch(e => console.warn('notify:', e.message)); },
  };
}

/* ======================= LOCAL (demo) ======================= */
function LocalApi() {
  const NS = 'rts1_';
  const get = (k, d) => { try { const v = localStorage.getItem(NS + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const set = (k, v) => { try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch (e) { throw new Error('Browser storage is full — remove some images'); } };
  const loadShop = () => {
    const s = get('settings', {});
    return { id: 'local', slug: 'demo', name: 'Rogger Tees', logo: 'assets/logo.png', accent: '#ffffff', pin: '', nextOrder: 1001,
      ...DEFAULT_SETTINGS, ...s, stripeReady: false, stripeConnected: false };
  };
  let products = get('products', null);
  if (!products || products.some(p => p.price === undefined)) {
    products = DEFAULT_PRODUCTS().map((p, i) => ({ ...p, id: ['tee', 'hoodie'][i] }));
    set('products', products);
  }
  const orders = () => get('orders', []);
  // migrate older demo orders that used "#1001" ids
  set('orders', orders().map(o => o.number ? o : { ...o, number: +String(o.id).replace('#', '') || 0, id: uid(), token: uid() + uid(), amountPaid: o.paid ? o.total : 0 }));

  return {
    mode: 'local', siteUrl: SITE,
    async user() { return null; }, onAuth() {},
    async storefront() { return { shop: loadShop(), products: products.filter(p => p.active) }; },
    async ownerData() { return { user: { email: 'demo' }, shop: loadShop(), products, orders: orders() }; },
    async saveShop(s) { const { stripeReady, stripeConnected, id, slug, ...rest } = s; set('settings', rest); },
    async saveProduct(p) {
      if (!p.id || String(p.id).startsWith('new_')) p = { ...p, id: uid() };
      const i = products.findIndex(x => x.id === p.id); if (i >= 0) products[i] = p; else products.push(p);
      set('products', products); return p;
    },
    async deleteProduct(id) { products = products.filter(p => p.id !== id); set('products', products); },
    async updateOrder(o) { set('orders', orders().map(x => x.id === o.id ? o : x)); },
    async deleteOrder(id) { set('orders', orders().filter(x => x.id !== id)); },
    async addOrders(list) { set('orders', [...list, ...orders()]); },
    onOrders() {},
    async uploadImage(u) { return u; },
    async submitOrder(shop, o) {
      const s = loadShop(), number = s.nextOrder;
      set('settings', { ...get('settings', {}), nextOrder: number + 1 });
      const row = { ...o, id: uid(), number, token: uid() + uid(), status: 'Pending', paid: false, amountPaid: 0, at: Date.now(),
        history: [{ at: Date.now(), text: o.revisionOf ? 'Resubmitted after changes' : 'Order submitted' }] };
      set('orders', [row, ...orders()]);
      return { id: row.id, number, token: row.token, total: row.total };
    },
    async orderByToken(token) { return orders().find(o => o.token === token) || null; },
    async myOrders(shop, email) { return orders().filter(o => o.customer.email.toLowerCase() === (email || '').toLowerCase()); },
    async checkout() { throw new Error('Online payments are available once the shop is connected to Stripe'); },
    async connect() { throw new Error('Connect Supabase first to use Stripe'); },
    notify() {},
    reset() { Object.keys(localStorage).filter(k => k.startsWith(NS)).forEach(k => localStorage.removeItem(k)); },
    exportAll() { return { settings: get('settings', {}), products, orders: orders() }; },
    importAll(d) { set('settings', d.settings || {}); set('products', d.products); set('orders', d.orders); },
  };
}

window.api = cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase ? CloudApi() : LocalApi();
window.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
})();
