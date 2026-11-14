// Where saves sync to (docs/SYNC.md). Both values are public by design: they only work together with the row-level
// security in docs/supabase-setup.sql, which lets nothing through without the owner's password AND TOTP code.
// Leave them empty and the app never contacts anything.
export const SYNC_CONFIG = {
  supabaseUrl: 'https://ptaesnkaszsnwpbtrzdo.supabase.co',
  supabaseAnonKey: 'sb_publishable_5fXgdDa7CJLsiP3aKCfYug_I2GF0tOo',   // a "publishable" key: safe in a browser. Never a secret / service_role key.
};
