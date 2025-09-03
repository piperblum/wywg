// lib/supabaseClient.js
import { createClient } from '@supabase/supabase-js'

// Public client (browser) – uses NEXT_PUBLIC_ env vars
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  }
)

// Single Storage bucket used by the app (folders per group_id)
export const STORAGE_BUCKET = process.env.NEXT_PUBLIC_STORAGE_BUCKET || 'entries'
