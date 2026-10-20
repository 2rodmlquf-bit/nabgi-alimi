-- 보안: 모든 표에 RLS를 켜고 본인(user_id) 행만 접근. 로그인하지 않은 요청(anon)은 아무것도 못 한다.
-- 쌓는 기록은 DB에서도 append-only: 지우기(delete)와 deleted_at / deleted_reason 이외 열의 수정을 막는다.

do $$
declare
  t text;
begin
  -- 쌓는 기록 5개: 읽기, 쓰기(새 행), 삭제 표시(deleted_at, deleted_reason)만
  foreach t in array array['inform_logs', 'quick_notes', 'substitute_checks', 'schedule_entries', 'supplier_contact_logs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert on table public.%I to authenticated', t);
    execute format('grant update (deleted_at, deleted_reason) on table public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t || '_update_own', t);
  end loop;

  -- 현재 값 3개: 읽기, 쓰기, 수정 (지우기는 막는다)
  foreach t in array array['order_meta', 'supplier_contact_marks', 'user_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update on table public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t || '_update_own', t);
  end loop;
end
$$;

-- 현재 값 표: 더 오래된 updated_at으로 덮어쓰려 하면 조용히 무시한다 (최신이 이긴다, last-write-wins)
create function public.keep_newest_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.updated_at < old.updated_at then
    return old;
  end if;
  return new;
end
$$;

revoke execute on function public.keep_newest_updated_at() from public, anon, authenticated;

create trigger order_meta_keep_newest before update on public.order_meta
  for each row execute function public.keep_newest_updated_at();
create trigger supplier_contact_marks_keep_newest before update on public.supplier_contact_marks
  for each row execute function public.keep_newest_updated_at();
create trigger user_settings_keep_newest before update on public.user_settings
  for each row execute function public.keep_newest_updated_at();
