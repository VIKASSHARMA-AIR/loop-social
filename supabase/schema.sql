-- Loop MVP database. Run this once in the Supabase SQL editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (char_length(username) between 3 and 24),
  display_name text not null default 'Loop member' check (char_length(display_name) <= 50),
  avatar_url text,
  bio text not null default '' check (char_length(bio) <= 300),
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  candidate text;
begin
  candidate := lower(regexp_replace(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)), '[^a-z0-9_]', '', 'g'));
  if char_length(candidate) < 3 then candidate := 'member_' || left(new.id::text, 8); end if;
  insert into public.profiles(id, username, display_name)
  values (new.id, candidate, coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), candidate))
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.is_loop_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false)
$$;

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  media_path text not null unique,
  media_type text not null check (media_type in ('image', 'video')),
  caption text not null default '' check (char_length(caption) <= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followed_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  check (follower_id <> followed_id)
);

create table if not exists public.likes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('post', 'comment', 'profile')),
  target_id uuid not null,
  reason text not null default 'Community guidelines',
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now(),
  unique (reporter_id, target_type, target_id)
);

create index if not exists posts_status_created_idx on public.posts(status, created_at desc);
create index if not exists posts_user_idx on public.posts(user_id, created_at desc);
create index if not exists comments_post_idx on public.comments(post_id, created_at);
create index if not exists reports_status_created_idx on public.reports(status, created_at desc);

alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.follows enable row level security;
alter table public.likes enable row level security;
alter table public.comments enable row level security;
alter table public.reports enable row level security;

drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles for select to authenticated using (true);
drop policy if exists "owner updates own profile" on public.profiles;
create policy "owner updates own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid() and is_admin = (select p.is_admin from public.profiles p where p.id = auth.uid()));

drop policy if exists "approved posts and own queue readable" on public.posts;
create policy "approved posts and own queue readable" on public.posts for select to authenticated using (status = 'approved' or user_id = auth.uid() or public.is_loop_admin());
drop policy if exists "users create own pending posts" on public.posts;
create policy "users create own pending posts" on public.posts for insert to authenticated with check (user_id = auth.uid() and status = 'pending');
drop policy if exists "owners delete own posts" on public.posts;
create policy "owners delete own posts" on public.posts for delete to authenticated using (user_id = auth.uid() or public.is_loop_admin());
drop policy if exists "admins moderate posts" on public.posts;
create policy "admins moderate posts" on public.posts for update to authenticated using (public.is_loop_admin()) with check (public.is_loop_admin());

drop policy if exists "follows readable" on public.follows;
create policy "follows readable" on public.follows for select to authenticated using (true);
drop policy if exists "follow as self" on public.follows;
create policy "follow as self" on public.follows for insert to authenticated with check (follower_id = auth.uid());
drop policy if exists "unfollow as self" on public.follows;
create policy "unfollow as self" on public.follows for delete to authenticated using (follower_id = auth.uid());

drop policy if exists "likes readable" on public.likes;
create policy "likes readable" on public.likes for select to authenticated using (true);
drop policy if exists "like as self" on public.likes;
create policy "like as self" on public.likes for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "unlike as self" on public.likes;
create policy "unlike as self" on public.likes for delete to authenticated using (user_id = auth.uid());

drop policy if exists "comments readable on visible posts" on public.comments;
create policy "comments readable on visible posts" on public.comments for select to authenticated using (exists (select 1 from public.posts p where p.id = post_id and (p.status = 'approved' or p.user_id = auth.uid() or public.is_loop_admin())));
drop policy if exists "comment on approved posts" on public.comments;
create policy "comment on approved posts" on public.comments for insert to authenticated with check (user_id = auth.uid() and exists (select 1 from public.posts p where p.id = post_id and p.status = 'approved'));
drop policy if exists "owner or admin removes comments" on public.comments;
create policy "owner or admin removes comments" on public.comments for delete to authenticated using (user_id = auth.uid() or public.is_loop_admin());

drop policy if exists "reporters create reports" on public.reports;
create policy "reporters create reports" on public.reports for insert to authenticated with check (reporter_id = auth.uid());
drop policy if exists "admins review reports" on public.reports;
create policy "admins review reports" on public.reports for select to authenticated using (public.is_loop_admin());
drop policy if exists "admins close reports" on public.reports;
create policy "admins close reports" on public.reports for update to authenticated using (public.is_loop_admin()) with check (public.is_loop_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('loop-media', 'loop-media', false, 104857600, array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm'])
on conflict (id) do update set public = false, file_size_limit = 104857600, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "visible post media readable" on storage.objects;
create policy "visible post media readable" on storage.objects for select to authenticated using (
  bucket_id = 'loop-media' and (
    (storage.foldername(name))[1] = auth.uid()::text or
    exists (select 1 from public.posts p where p.media_path = name and (p.status = 'approved' or p.user_id = auth.uid() or public.is_loop_admin()))
  )
);
drop policy if exists "users upload into own folder" on storage.objects;
create policy "users upload into own folder" on storage.objects for insert to authenticated with check (bucket_id = 'loop-media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "users remove own media" on storage.objects;
create policy "users remove own media" on storage.objects for delete to authenticated using (bucket_id = 'loop-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- After your account exists, set a moderator from SQL Editor:
-- update public.profiles set is_admin = true where username = 'your_username';

