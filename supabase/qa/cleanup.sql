-- QA 정리용 SQL. Supabase 대시보드의 SQL Editor(또는 Claude에게 "QA 정리해줘")로 실행한다.
-- DB는 앱 계정의 지우기를 막아 두었으므로(append-only), 지우기는 관리자 권한(SQL Editor)으로만 된다.

-- [1] 시험이 남긴 행만 지운다 (자동 시험 db-tests.js와 QA 화면이 만든 행). 시험 데이터(QA-PO-…)와 계정은 그대로 둔다.
delete from public.inform_logs where order_no like 'QA-T-%' or order_no like 'QA-PAGE-%';
delete from public.quick_notes where order_no like 'QA-T-%' or order_no like 'QA-PAGE-%';
delete from public.substitute_checks where order_no like 'QA-T-%' or order_no like 'QA-PAGE-%';
delete from public.schedule_entries where order_no like 'QA-T-%' or order_no like 'QA-PAGE-%';
delete from public.supplier_contact_logs where supplier_name like 'QA-T-%';
delete from public.order_meta where order_no like 'QA-T-%' or order_no like 'QA-PAGE-%';
delete from public.supplier_contact_marks where supplier_name like 'QA-T-%';

-- [2] QA를 다 끝냈을 때: 시험 계정 2개를 지운다. 두 계정의 모든 행도 함께 사라진다 (user_id 외래키가 on delete cascade).
-- 실제 로그인 계정을 만든 뒤에 실행하세요. 아래 두 이메일만 지운다.
-- delete from auth.users where email in ('qa-a@nabgi-qa.test', 'qa-b@nabgi-qa.test');

-- [3] 앱의 올리기·복원 점검(tools/cloud-live-check.js)이 남긴 행. 점검을 다시 돌리기 전에 지운다 (안 지우면 다시 돌릴 때 기록이 겹쳐 쌓인다).
delete from public.inform_logs where order_no like 'QA-LIVE-%';
delete from public.quick_notes where order_no like 'QA-LIVE-%';
delete from public.substitute_checks where order_no like 'QA-LIVE-%';
delete from public.schedule_entries where order_no like 'QA-LIVE-%';
delete from public.supplier_contact_logs where supplier_name like 'QA-LIVE-%';
delete from public.order_meta where order_no like 'QA-LIVE-%';
delete from public.supplier_contact_marks where supplier_name like 'QA-LIVE-%';
