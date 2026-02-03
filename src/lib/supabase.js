import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://xbwxbdxuklrbnkpgonjc.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhid3hiZHh1a2xyYm5rcGdvbmpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAxMzAwMzEsImV4cCI6MjA4NTcwNjAzMX0.eDVeOTgF7DX_BKgOoz7DnN5Gy5tikPG7r4DOA-FfnIY';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const signInWithGoogle = async () => {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  });
  return { data, error };
};

export const signInWithEmail = async (email, password) => {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { data, error };
};

export const signUpWithEmail = async (email, password, fullName) => {
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { full_name: fullName } }
  });
  return { data, error };
};

export const signOut = async () => {
  const { error } = await supabase.auth.signOut();
  return { error };
};

export const getProfile = async (userId) => {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
  return { data, error };
};

export const getListings = async (filters = {}) => {
  let query = supabase.from('listings').select('*, seller:profiles(id, full_name, avatar_url, rating, total_sales, badge, is_verified)').eq('status', 'active').order('created_at', { ascending: false });
  if (filters.category) query = query.eq('category', filters.category);
  if (filters.minPrice) query = query.gte('price', filters.minPrice);
  if (filters.maxPrice) query = query.lte('price', filters.maxPrice);
  if (filters.search) query = query.or(`title.ilike.%${filters.search}%,title_hebrew.ilike.%${filters.search}%`);
  const { data, error } = await query;
  return { data, error };
};

export const getUserListings = async (userId) => {
  const { data, error } = await supabase.from('listings').select('*').eq('seller_id', userId).neq('status', 'deleted').order('created_at', { ascending: false });
  return { data, error };
};

export const createListing = async (listing) => {
  const { data, error } = await supabase.from('listings').insert(listing).select().single();
  return { data, error };
};

export const deleteListing = async (id) => {
  const { data, error } = await supabase.from('listings').update({ status: 'deleted' }).eq('id', id);
  return { data, error };
};

export const incrementViews = async (listingId) => {
  await supabase.rpc('increment_listing_views', { listing_uuid: listingId });
};

export const getSavedItems = async (userId) => {
  const { data, error } = await supabase.from('saved_items').select('*, listing:listings(*, seller:profiles(id, full_name, avatar_url, rating, badge, is_verified))').eq('user_id', userId).order('created_at', { ascending: false });
  return { data, error };
};

export const saveItem = async (userId, listingId) => {
  const { data, error } = await supabase.from('saved_items').insert({ user_id: userId, listing_id: listingId }).select().single();
  return { data, error };
};

export const unsaveItem = async (userId, listingId) => {
  const { error } = await supabase.from('saved_items').delete().eq('user_id', userId).eq('listing_id', listingId);
  return { error };
};

export default supabase;
