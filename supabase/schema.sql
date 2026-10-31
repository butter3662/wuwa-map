-- 명조 지도 진행도 표 (MAGI·SEED 10K와 같은 Supabase 프로젝트)
-- SQL Editor → New query 에 붙여 넣고 Run 한 번. 여러 번 실행해도 된다.
-- 계정마다 지도별로 한 줄, 본인 기록만 읽고 쓸 수 있다.
create table if not exists public.wuwa_progress (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  map_id  text not null,
  ids     text[] not null default '{}',
  t       bigint not null default 0,
  primary key (user_id, map_id)
);
alter table public.wuwa_progress enable row level security;
drop policy if exists "wuwa_progress_own" on public.wuwa_progress;
create policy "wuwa_progress_own" on public.wuwa_progress for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
