import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://vtpphwvvchwrqdnnwtdm.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0cHBod3Z2Y2h3cnFkbm53dGRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxMDYzMTQsImV4cCI6MjA5MTY4MjMxNH0.HLj2_rsUXj_zJjQXNVC6CXaGTmaalDLf7DsvIBVya5o'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
