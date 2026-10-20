-- 납기 알리미: 기록류 8개 표 (docs/erd.md). 주문과 공급사는 표가 아니라 order_no / supplier_name 글자로 가리킨다.
-- user_id는 앱이 보내지 않고 DB가 로그인한 사용자로 채운다 (default auth.uid()).

-- ===== 쌓는 기록 (append-only): 행은 고치지 않고, 지울 때 deleted_at / deleted_reason만 채운다 =====

create table public.inform_logs (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  order_no text not null check (char_length(order_no) between 1 and 100),
  logged_on date not null,
  channel text not null check (channel in ('메일', '카톡·문자', '전화', '구두', '기타')),
  status text not null check (status in ('지연', '임박', '확인필요')),
  due text not null default '' check (char_length(due) <= 40),
  note text not null default '' check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_reason text check (deleted_reason in ('user', 'cap')),
  constraint inform_logs_deleted_pair check ((deleted_at is null) = (deleted_reason is null))
);
comment on table public.inform_logs is '연구원 안내 기록. 주문번호별로 쌓기만 한다 (GLOSSARY: 안내 기록)';
comment on column public.inform_logs.deleted_reason is 'user = 사용자가 취소, cap = 주문당 한도(50건)로 밀림';

create table public.quick_notes (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  order_no text not null check (char_length(order_no) between 1 and 100),
  body text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_reason text check (deleted_reason in ('user', 'cap')),
  constraint quick_notes_deleted_pair check ((deleted_at is null) = (deleted_reason is null))
);
comment on table public.quick_notes is '빠른 메모. 전화·메신저로 들은 소식. 안내 상태에는 영향이 없다';

create table public.substitute_checks (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  order_no text not null check (char_length(order_no) between 1 and 100),
  state text not null check (state in ('의심', '확인요청중', '승인', '거절')),
  note text not null default '' check (char_length(note) <= 120),
  sup_item text not null default '' check (char_length(sup_item) <= 120),
  sup_spec text not null default '' check (char_length(sup_spec) <= 120),
  sup_qty text not null default '' check (char_length(sup_qty) <= 120),
  source text not null default '' check (char_length(source) <= 120),
  checked_on date,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_reason text check (deleted_reason in ('user', 'cap')),
  constraint substitute_checks_deleted_pair check ((deleted_at is null) = (deleted_reason is null))
);
comment on table public.substitute_checks is '대체품 확인. 상태가 바뀔 때마다 새 행. 현재 상태 = 삭제 표시 없는 가장 최근 행';

create table public.schedule_entries (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  order_no text not null check (char_length(order_no) between 1 and 100),
  arrives_on date not null,
  qty text not null default '' check (char_length(qty) <= 20),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_reason text check (deleted_reason in ('user', 'cap')),
  constraint schedule_entries_deleted_pair check ((deleted_at is null) = (deleted_reason is null))
);
comment on table public.schedule_entries is '분납 일정. 현재 일정 = 주문의 삭제 표시 없는 모든 행';

create table public.supplier_contact_logs (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  supplier_name text not null check (char_length(supplier_name) between 1 and 100),
  logged_on date not null,
  kind text not null check (kind in ('attempt', 'reply')),
  channel text not null default '기타' check (char_length(channel) <= 10),
  promised_on date,
  note text not null default '' check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_reason text check (deleted_reason in ('user', 'cap')),
  constraint supplier_contact_logs_deleted_pair check ((deleted_at is null) = (deleted_reason is null))
);
comment on table public.supplier_contact_logs is '공급사 연락 기록. attempt = 연락함, reply = 답변 받음';

-- ===== 현재 값 (last-write-wins): 키 하나에 행 하나, updated_at이 최신인 쪽이 이긴다 =====

create table public.order_meta (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  order_no text not null check (char_length(order_no) between 1 and 100),
  reason text check (char_length(reason) <= 500),
  cause_override text check (char_length(cause_override) <= 40),
  edited_from text check (char_length(edited_from) <= 40),
  edited_to text check (char_length(edited_to) <= 40),
  updated_at timestamptz not null default now(),
  primary key (user_id, order_no)
);
comment on table public.order_meta is '주문 메타: 지연 사유, 원인 직접 지정, 납기 변경(전·후). 주문 하나에 행 하나';

create table public.supplier_contact_marks (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  supplier_name text not null check (char_length(supplier_name) between 1 and 100),
  last_contacted_on date not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, supplier_name)
);
comment on table public.supplier_contact_marks is '연락함 표시: 공급사별 마지막 연락일';

create table public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 200000),
  updated_at timestamptz not null default now()
);
comment on table public.user_settings is '설정: 안내문 템플릿·서명, 품목별 임박 기준, 다시 안내 기준 일수 (jsonb 한 덩어리)';

-- ===== 인덱스: user_id로 시작해서 외래키 조회와 주문별·공급사별 조회를 함께 받는다 =====
create index inform_logs_order_idx on public.inform_logs (user_id, order_no, created_at);
create index quick_notes_order_idx on public.quick_notes (user_id, order_no, created_at);
create index substitute_checks_order_idx on public.substitute_checks (user_id, order_no, created_at);
create index schedule_entries_order_idx on public.schedule_entries (user_id, order_no, created_at);
create index supplier_contact_logs_supplier_idx on public.supplier_contact_logs (user_id, supplier_name, created_at);
