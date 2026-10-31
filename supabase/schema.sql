-- 명조 지도: 사용자별 진행도 테이블 (지도 1장당 1행)
-- MAGI와 같은 Supabase 프로젝트를 쓰므로 테이블 이름에 wuwa_ 접두어를 붙였다. MAGI 테이블(magi_sessions)은 건드리지 않는다.
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run

create table if not exists public.wuwa_progress (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  map_id     text        not null,
  ids        text[]      not null default '{}',
  t          bigint      not null default 0,      -- 클라이언트가 마지막으로 수정한 시각(ms)
  updated_at timestamptz not null default now(),
  primary key (user_id, map_id)
);

alter table public.wuwa_progress enable row level security;
grant select, insert, update, delete on public.wuwa_progress to authenticated;

drop policy if exists "wuwa_progress_select_own" on public.wuwa_progress;
drop policy if exists "wuwa_progress_insert_own" on public.wuwa_progress;
drop policy if exists "wuwa_progress_update_own" on public.wuwa_progress;
drop policy if exists "wuwa_progress_delete_own" on public.wuwa_progress;

create policy "wuwa_progress_select_own" on public.wuwa_progress
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "wuwa_progress_insert_own" on public.wuwa_progress
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "wuwa_progress_update_own" on public.wuwa_progress
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "wuwa_progress_delete_own" on public.wuwa_progress
  for delete to authenticated using ((select auth.uid()) = user_id);

create or replace function public.wuwa_wuwa_progress_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists wuwa_progress_touch on public.wuwa_progress;
create trigger wuwa_progress_touch before update on public.wuwa_progress
  for each row execute function public.wuwa_wuwa_progress_touch();
