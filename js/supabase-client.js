/* CommuteIT Supabase client bootstrap. Only the publishable/anon key belongs here. */
(() => {
  const cfg = window.COMMUTEIT_CONFIG || {};
  const url = String(cfg.supabaseUrl || '').trim();
  const key = String(cfg.supabaseAnonKey || '').trim();
  if (!url || !key || !window.supabase?.createClient) {
    window.COMMUTEIT_SB = null;
    return;
  }
  window.COMMUTEIT_SB = window.supabase.createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
})();
