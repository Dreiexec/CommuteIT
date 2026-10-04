/* CommuteIT configuration */
window.COMMUTEIT_CONFIG = {
  googleMapsKey: "AIzaSyAhAf-byynXkviz9DtZMeUybItJycaXjGo",

  // Paste the Supabase Project URL and publishable/anon key here.
  // Never put a Supabase service_role/secret key in this file.
  supabaseUrl: "https://buqcwejrkbazdipbbzkg.supabase.co",
  supabaseAnonKey: "sb_publishable_qJofsbEJD5EIKlG8IZZLBw_FchKfbWI",

  demo: {
    // The demo uses Supabase Anonymous Sign-In. Each demo login gets a fresh
    // authenticated user, and all demo rows are deleted on logout.
    useAnonymousAuth: true,
    firstName: "Anonymous",
    lastName: "",
    emailLabel: "Demo account"
  }
};
