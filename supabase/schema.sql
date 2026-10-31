-- 명조 지도: 사용자별 진행도 테이블 (지도 1장당 1행)
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run

create table if not exists public.progress (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  map_id     text        not null,
  ids        text[]      not null default '{}',
  t          bigint      not null default 0,      -- 클라이언트가 마지막으로 수정한 시각(ms)
  updated_at timestamptz not null default now(),
  primary key (user_id, map_id)
);

alter table public.progress enable row level security;
grant select, insert, update, delete on public.progress to authenticated;

drop policy if exists "progress_select_own" on public.progress;
drop policy if exists "progress_insert_own" on public.progress;
drop policy if exists "progress_update_own" on public.progress;
drop policy if exists "progress_delete_own" on public.progress;

create policy "progress_select_own" on public.progress
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "progress_insert_own" on public.progress
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "progress_update_own" on public.progress
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "progress_delete_own" on public.progress
  for delete to authenticated using ((select auth.uid()) = user_id);

create or replace function public.progress_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists progress_touch on public.progress;
create trigger progress_touch before update on public.progress
  for each row execute function public.progress_touch();
