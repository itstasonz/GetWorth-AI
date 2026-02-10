import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://xbwxbdxuklrbnkpgonjc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhid3hiZHh1a2xyYm5rcGdvbmpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAxMzAwMzEsImV4cCI6MjA4NTcwNjAzMX0.eDVeOTgF7DX_BKgOoz7DnN5Gy5tikPG7r4DOA-FfnIY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});
