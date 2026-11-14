-- Facility 3D Manager：Supabase 初期設定（試験運用・ログインなし版）
-- Supabase 管理画面 > SQL Editor に全文を貼り付けて「Run」してください。何度実行しても安全です。

-- 1) 客室ごとの清掃状況テーブル（1部屋＝1行）
create table if not exists public.rooms (
  id          text primary key,                 -- 部屋番号（例：201）
  status      text not null default '未清掃'
              check (status in ('未清掃','清掃中','清掃完了','点検済','要確認')),
  focus       text not null default '',         -- 重点清掃箇所
  repair      text not null default '',         -- 修理必要箇所
  photo_url   text,                             -- 客室写真（Storage の公開URL）
  updated_at  timestamptz not null default now()
);

-- 2) アクセス権（RLS）：試験運用のため、公開キー（anon）で閲覧・登録・更新を許可。削除は不可。
--    ※本番運用ではログイン済みスタッフ（authenticated）のみに絞る予定
alter table public.rooms enable row level security;
drop policy if exists "pilot_select" on public.rooms;
drop policy if exists "pilot_insert" on public.rooms;
drop policy if exists "pilot_update" on public.rooms;
create policy "pilot_select" on public.rooms for select to anon, authenticated using (true);
create policy "pilot_insert" on public.rooms for insert to anon, authenticated with check (true);
create policy "pilot_update" on public.rooms for update to anon, authenticated using (true) with check (true);

-- 3) リアルタイム配信：他の端末で更新されたら即時反映
do $$ begin
  alter publication supabase_realtime add table public.rooms;
exception when duplicate_object then null; end $$;

-- 4) 客室写真の保存先（Storage バケット、公開読み取り）
insert into storage.buckets (id, name, public)
values ('room-photos', 'room-photos', true)
on conflict (id) do nothing;

drop policy if exists "pilot_photo_read"   on storage.objects;
drop policy if exists "pilot_photo_upload" on storage.objects;
create policy "pilot_photo_read"   on storage.objects for select to anon, authenticated using (bucket_id = 'room-photos');
create policy "pilot_photo_upload" on storage.objects for insert to anon, authenticated with check (bucket_id = 'room-photos');
