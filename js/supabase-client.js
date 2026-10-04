/* Supabase client bootstrap. Uses the publishable/anon key from config.js. */
(() => {
  const config = window.COMMUTEIT_CONFIG || {};
  if (!window.supabase?.createClient || !config.supabaseUrl || !config.supabaseAnonKey) return;
  try {
    window.COMMUTEIT_SB = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
  } catch (error) {
    console.error("CommuteIT could not initialize Supabase.", error);
  }
})();
