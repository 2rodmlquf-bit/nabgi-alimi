-- 공급사 회신·약속일 (ADR-0007, docs/erd.md 2-2절). 주문번호(order_no) 단위로 쌓는 기록이고 supplier_contact_logs와는 별개다.
-- 보안은 기존 쌓는 기록 표와 같다: RLS, 본인 행만, 넣기와 deleted_at·deleted_reason 수정만, 지우기 금지, anon 차단.

create table public.order_replies (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  order_no text not null check (char_length(order_no) between 1 and 100),
  supplier_name text not null check (char_length(supplier_name) between 1 and 100),
  replied_on date not null,
  promised_on date,
  channel text not null check (channel in ('메일', '카톡·문자', '전화', '구두', '기타')),
  source text not null check (source in ('manual', 'email')),
  note text not null default '' check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_reason text check (deleted_reason in ('user', 'cap')),
  constraint order_replies_deleted_pair check ((deleted_at is null) = (deleted_reason is null))
);
comment on table public.order_replies is '공급사 회신·약속일. 주문번호별로 쌓기만 한다. 회신 늦음은 저장하지 않고 앱이 계산한다 (ADR-0008)';
comment on column public.order_replies.source is 'manual = 직접 기록, email = 메일에서 제안해 기록';
comment on column public.order_replies.deleted_reason is 'user = 사용자가 취소, cap = 주문당 한도(20건)로 밀림';

create index order_replies_user_order_created_idx on public.order_replies (user_id, order_no, created_at);

alter table public.order_replies enable row level security;
revoke all on table public.order_replies from anon, authenticated;
grant select, insert on table public.order_replies to authenticated;
grant update (deleted_at, deleted_reason) on table public.order_replies to authenticated;
create policy order_replies_select_own on public.order_replies for select to authenticated using (user_id = (select auth.uid()));
create policy order_replies_insert_own on public.order_replies for insert to authenticated with check (user_id = (select auth.uid()));
create policy order_replies_update_own on public.order_replies for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
