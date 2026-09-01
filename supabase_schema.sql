-- ============================================================
-- AirFlow AI — Supabase Database Schema
-- Run this in: Supabase Dashboard > SQL Editor
-- ============================================================

-- 1. Create the health_profiles table
create table if not exists public.health_profiles (
    uid         uuid        primary key,  -- Supabase auth user id
    profile_data jsonb      not null,     -- Full health profile JSON blob
    updated_at  timestamptz default now() not null
);

-- 2. Enable Row Level Security (RLS)
alter table public.health_profiles enable row level security;

-- 3. Policy: users can only read their OWN profile
create policy "Users can read own profile"
    on public.health_profiles
    for select
    using (auth.uid() = uid);

-- 4. Policy: users can only insert their OWN profile
create policy "Users can insert own profile"
    on public.health_profiles
    for insert
    with check (auth.uid() = uid);

-- 5. Policy: users can only update their OWN profile
create policy "Users can update own profile"
    on public.health_profiles
    for update
    using (auth.uid() = uid);

-- 6. Policy: users can delete their OWN profile
create policy "Users can delete own profile"
    on public.health_profiles
    for delete
    using (auth.uid() = uid);

-- ============================================================
-- SETUP STEPS (after running this SQL):
-- 1. Go to Supabase Dashboard > Authentication > Providers
-- 2. Enable Google OAuth (add Client ID + Secret from Google Cloud Console)
-- 3. Set Redirect URL in Google Console: https://<your-project>.supabase.co/auth/v1/callback
-- 4. In app.js, replace:
--      SUPABASE_URL  = 'https://your-project-id.supabase.co'
--      SUPABASE_ANON = 'your-anon-public-key'
--    with values from: Supabase Dashboard > Project Settings > API
-- ============================================================
