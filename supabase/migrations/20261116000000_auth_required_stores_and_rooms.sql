-- ログイン必須（スタッフ限定）で、店舗ごとの客室メモ・写真を共有するための構成
-- Supabase 管理画面の SQL Editor に貼り付けて実行する

-- パイロット用（誰でも読み書き可）の設定を撤去（旧 rooms は初期値のみで入力データなし）
drop policy if exists pilot_photo_upload on storage.objects;
drop policy if exists pilot_photo_read on storage.objects;
drop table if exists public.rooms;

-- スタッフ許可リスト（API からは見えない。管理画面 / SQL で追加する）
create table public.staff (
  email text primary key,
  created_at timestamptz not null default now()
);
alter table public.staff enable row level security;

create schema if not exists private;
grant usage on schema private to authenticated;
create or replace function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
$$;
revoke all on function private.is_staff() from public;
grant execute on function private.is_staff() to authenticated;

-- 店舗（追加・名称変更は管理画面の Table Editor で行う）
create table public.stores (
  id text primary key,
  name text not null,
  area text not null default '',
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.stores enable row level security;
create policy stores_select on public.stores for select to authenticated
  using ((select private.is_staff()));

-- 店舗ごとの客室データ
create table public.rooms (
  store_id text not null references public.stores(id) on delete cascade,
  room_id text not null check (room_id ~ '^[2-5]0[1-9]$'),
  focus text not null default '',
  repair text not null default '',
  photo_path text,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (store_id, room_id)
);
alter table public.rooms enable row level security;
create policy rooms_select on public.rooms for select to authenticated
  using ((select private.is_staff()));
create policy rooms_insert on public.rooms for insert to authenticated
  with check ((select private.is_staff()));
create policy rooms_update on public.rooms for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));

create or replace function private.touch_room() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
create trigger rooms_touch before update on public.rooms
  for each row execute function private.touch_room();

-- 写真バケットを非公開にし、スタッフのみアクセス可にする
update storage.buckets set public = false where id = 'room-photos';
create policy room_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'room-photos' and (select private.is_staff()));
create policy room_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'room-photos' and (select private.is_staff()));
create policy room_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'room-photos' and (select private.is_staff()));
create policy room_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'room-photos' and (select private.is_staff()));

-- 動作確認用の店舗（名称は Table Editor で変更できる）
insert into public.stores (id, name, area) values ('store-1', '店舗1（名称未設定）', '');
