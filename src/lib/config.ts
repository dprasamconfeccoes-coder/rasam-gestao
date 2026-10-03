const publicSupabaseKey = 'sb_publishable_xNOM7puV6vNlFDMax4bOPg_GgzxVFDI'

export const config = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || 'https://nunnryxospkvjalbngoa.supabase.co',
  supabaseKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || publicSupabaseKey,
  appName: 'Rasam Gestão',
}
