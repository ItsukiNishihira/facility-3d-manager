-- 要件定義書（Facility 3D Manager）に基づく修繕管理の構成
--   ・役割：本社管理者（admin）／店舗スタッフ（staff）。アカウントと権限はアプリ内の管理画面で管理する
--   ・店舗スタッフは自店舗のみ閲覧（管理者が許可すれば複数店舗）。データベース側（RLS）でも制限する
--   ・修繕案件：報告（写真のアップロード日＝修繕依頼日）→ 予定（本社）→ 完了報告（完了写真の登録日＝対応完了日）
--   ・日付は自動記録し、手入力させない（トリガーで上書き）
-- 20261116000000 の後に実行する前提（staff 許可リスト方式を profiles + store_members に置き換える）

create schema if not exists private;
grant usage on schema private to authenticated;

-- ───────────── 利用者 ─────────────
-- Supabase Auth のユーザー作成時に自動で作られる。管理者が有効化・役割設定するまで何も見えない
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  display_name text not null default '',
  role text not null default 'staff' check (role in ('admin', 'staff')),
  active boolean not null default false,
  line_user_id text unique,               -- LINEログイン導入時に使う
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, coalesce(new.email, ''),
          coalesce(new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.is_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active)
$$;
create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.role = 'admin')
$$;

-- ───────────── 店舗 ─────────────
-- 20261116 で作成済み。建物の形（階数・部屋数・共用部）を店舗ごとのデータとして持つ
alter table public.stores
  add column if not exists building jsonb not null default '{}'::jsonb,
  add column if not exists line_group_id text;   -- 通知先の店舗LINEグループ

-- 店舗の閲覧許可（自店舗＋管理者が許可した店舗）
create table public.store_members (
  store_id text not null references public.stores(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (store_id, user_id)
);
alter table public.store_members enable row level security;
create index store_members_user_idx on public.store_members (user_id);

create or replace function private.can_access_store(sid text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin() or (private.is_active() and exists (
    select 1 from public.store_members m where m.store_id = sid and m.user_id = auth.uid()))
$$;
revoke all on function private.is_active(), private.is_admin(), private.can_access_store(text) from public;
grant execute on function private.is_active(), private.is_admin(), private.can_access_store(text) to authenticated;

-- 旧方式（staff 許可リスト）のポリシーを置き換える
drop policy if exists stores_select on public.stores;
create policy stores_select on public.stores for select to authenticated
  using ((select private.can_access_store(id)));
create policy stores_admin_insert on public.stores for insert to authenticated
  with check ((select private.is_admin()));
create policy stores_admin_update on public.stores for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy stores_admin_delete on public.stores for delete to authenticated
  using ((select private.is_admin()));

create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_admin())
         or ((select private.is_active()) and exists (
              select 1 from public.store_members a join public.store_members b using (store_id)
              where a.user_id = profiles.id and b.user_id = (select auth.uid()))));
create policy profiles_admin_update on public.profiles for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy store_members_select on public.store_members for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin())
         or (select private.can_access_store(store_id)));
create policy store_members_admin_insert on public.store_members for insert to authenticated
  with check ((select private.is_admin()));
create policy store_members_admin_delete on public.store_members for delete to authenticated
  using ((select private.is_admin()));

-- 自分自身を管理者から外す・無効化することは防ぐ（管理者がいなくなる事故の防止）
create or replace function private.guard_profile() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  if new.id = auth.uid() and (new.role <> 'admin' or not new.active) then
    raise exception '自分自身の役割・有効状態は変更できません';
  end if;
  new.email := old.email;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function private.guard_profile();

-- ───────────── 客室メモ（既存の清掃メモ。残すかは未決事項） ─────────────
alter table public.rooms drop constraint if exists rooms_room_id_check;
drop policy if exists rooms_select on public.rooms;
drop policy if exists rooms_insert on public.rooms;
drop policy if exists rooms_update on public.rooms;
create policy rooms_select on public.rooms for select to authenticated
  using ((select private.can_access_store(store_id)));
create policy rooms_insert on public.rooms for insert to authenticated
  with check ((select private.can_access_store(store_id)));
create policy rooms_update on public.rooms for update to authenticated
  using ((select private.can_access_store(store_id))) with check ((select private.can_access_store(store_id)));

-- ───────────── 修繕案件 ─────────────
create table public.repairs (
  id uuid primary key default gen_random_uuid(),
  store_id text not null references public.stores(id) on delete cascade,
  location_type text not null check (location_type in ('room', 'common')),
  location text not null,                 -- 部屋番号（例 305）または共用部名（例 屋上）
  spot text not null default '',          -- 室内の具体的な位置（例 エアコン・浴室）
  note text not null default '',
  report_photo_path text not null,
  reported_at timestamptz not null default now(),   -- 修繕依頼日（写真アップロード日）
  reported_by uuid references public.profiles(id) on delete set null,
  scheduled_date date,                    -- 対応予定日（本社がカレンダーから選ぶ）
  assignee_id uuid references public.profiles(id) on delete set null,
  assignee_name text not null default '', -- 担当者名（削除後も記録として残す）
  scheduled_by uuid references public.profiles(id) on delete set null,
  completion_photo_path text,
  completed_at timestamptz,               -- 対応完了日（完了写真アップロード日）
  completed_by uuid references public.profiles(id) on delete set null,
  cost integer check (cost is null or cost >= 0),
  photos_purged_at timestamptz,           -- 保管期間経過で写真を削除した日（記録は残す）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((completed_at is null) = (completion_photo_path is null))
);
alter table public.repairs enable row level security;
create index repairs_store_idx on public.repairs (store_id, completed_at);
create index repairs_scheduled_idx on public.repairs (scheduled_date) where completed_at is null;
create index repairs_assignee_idx on public.repairs (assignee_id);
create index repairs_reported_by_idx on public.repairs (reported_by);
create index repairs_scheduled_by_idx on public.repairs (scheduled_by);
create index repairs_completed_by_idx on public.repairs (completed_by);

create policy repairs_select on public.repairs for select to authenticated
  using ((select private.can_access_store(store_id)));
create policy repairs_insert on public.repairs for insert to authenticated
  with check ((select private.can_access_store(store_id)));
create policy repairs_update on public.repairs for update to authenticated
  using ((select private.can_access_store(store_id))) with check ((select private.can_access_store(store_id)));
create policy repairs_admin_delete on public.repairs for delete to authenticated
  using ((select private.is_admin()));

-- 日付・報告者は自動記録。予定の設定は管理者のみ。完了報告は店舗スタッフなら誰でも（担当者に限らない）
create or replace function private.guard_repair() returns trigger
language plpgsql set search_path = '' as $$
declare adm boolean := private.is_admin();
begin
  -- 管理画面（SQL・サービスロール）や外部キーの on delete set null による更新はそのまま通す
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    new.reported_at := now();
    new.reported_by := auth.uid();
    new.completion_photo_path := null; new.completed_at := null; new.completed_by := null; new.cost := null;
    new.photos_purged_at := null;
    if not adm then
      new.scheduled_date := null; new.assignee_id := null; new.assignee_name := ''; new.scheduled_by := null;
    end if;
  else
    -- 報告内容（場所・依頼日・報告者）は変えられない
    new.store_id := old.store_id; new.location_type := old.location_type; new.location := old.location;
    new.reported_at := old.reported_at; new.reported_by := old.reported_by; new.created_at := old.created_at;
    new.photos_purged_at := old.photos_purged_at;
    if not adm then
      new.spot := old.spot; new.note := old.note; new.report_photo_path := old.report_photo_path;
      new.scheduled_date := old.scheduled_date; new.assignee_id := old.assignee_id;
      new.assignee_name := old.assignee_name; new.scheduled_by := old.scheduled_by;
      if old.completed_at is not null then   -- 完了の取り消し・修正は管理者のみ
        new.completion_photo_path := old.completion_photo_path; new.cost := old.cost;
      elsif new.completion_photo_path is null then
        new.cost := old.cost;               -- 費用は完了写真と一緒に登録する
      end if;
    end if;
    if new.scheduled_date is distinct from old.scheduled_date or new.assignee_id is distinct from old.assignee_id
       or new.assignee_name is distinct from old.assignee_name then
      new.scheduled_by := auth.uid();
    end if;
  end if;
  -- 担当者名は利用者マスタから自動で入れる
  if new.assignee_id is not null then
    select p.display_name into new.assignee_name from public.profiles p where p.id = new.assignee_id;
  end if;
  -- 完了写真が登録された日＝対応完了日
  if new.completion_photo_path is null then
    new.completed_at := null; new.completed_by := null;
  elsif tg_op = 'INSERT' or old.completion_photo_path is distinct from new.completion_photo_path then
    new.completed_at := now(); new.completed_by := auth.uid();
  else
    new.completed_at := old.completed_at; new.completed_by := old.completed_by;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger repairs_guard before insert or update on public.repairs
  for each row execute function private.guard_repair();

-- ステータス色（4章）はアプリ側（js/app.js の colorOf）で日本時間の日付から計算する

-- ───────────── 写真 ─────────────
-- パス：{store_id}/{repair_id}/{before|after}-{時刻}.jpg。先頭フォルダの店舗を見られる人だけ扱える
insert into storage.buckets (id, name, public) values ('repair-photos', 'repair-photos', false)
  on conflict (id) do update set public = false;
create policy repair_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'repair-photos' and (select private.can_access_store((storage.foldername(name))[1])));
create policy repair_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'repair-photos' and (select private.can_access_store((storage.foldername(name))[1])));
create policy repair_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'repair-photos' and (select private.is_admin()));

-- 客室メモ用の写真バケットも同じ判定に置き換える
drop policy if exists room_photos_select on storage.objects;
drop policy if exists room_photos_insert on storage.objects;
drop policy if exists room_photos_update on storage.objects;
drop policy if exists room_photos_delete on storage.objects;
create policy room_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'room-photos' and (select private.can_access_store((storage.foldername(name))[1])));
create policy room_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'room-photos' and (select private.can_access_store((storage.foldername(name))[1])));
create policy room_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'room-photos' and (select private.can_access_store((storage.foldername(name))[1])));
create policy room_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'room-photos' and (select private.can_access_store((storage.foldername(name))[1])));

-- 旧方式の撤去
drop function if exists private.is_staff();
drop table if exists public.staff;

-- 既存の動作確認用店舗に、現在の建物（reference/全体画像.png）の形を入れる
update public.stores set building = '{
  "firstFloor": 2, "floors": 4, "roomsPerFloor": 9, "ground": "parking",
  "roomTypes": {"B": [1, 9]}, "defaultType": "A", "interiors": true,
  "commonAreas": ["屋上", "駐車場", "外壁", "廊下", "エントランス"]
}'::jsonb where building = '{}'::jsonb;
