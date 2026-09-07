-- Badminton Payment Tracker — Supabase schema
-- Run this in Supabase Studio > SQL Editor

-- ─────────────────────────────────────────────
-- PLAYERS: your permanent roster
-- ─────────────────────────────────────────────
create table players (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  status text not null check (status in ('regular', 'guest')) default 'regular',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- SESSIONS: one row per playing day (e.g. "August 28")
--
-- Shuttle cost per person is DERIVED, not stored: it's
--   (shuttle_count * shuttle_price_each) / (sum of headcounts this session)
--
-- Court fee is one of two modes:
--   'per_person' → everyone pays court_fee_per_slot
--   'split'      → court_fee_total is divided by the sum of headcounts
-- ─────────────────────────────────────────────
create table sessions (
  id uuid primary key default gen_random_uuid(),
  session_date date not null,
  court_fee_mode text not null check (court_fee_mode in ('per_person', 'split')) default 'per_person',
  court_fee_per_slot numeric(10,2) not null default 175,   -- used when court_fee_mode = 'per_person'
  court_fee_total numeric(10,2) not null default 0,         -- used when court_fee_mode = 'split'
  shuttle_count numeric(10,2) not null default 0,           -- shuttles used this session
  shuttle_price_each numeric(10,2) not null default 0,      -- price per shuttle
  guest_fixed_rate numeric(10,2) not null default 300,
  notes text,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- PAYMENT GROUPS: one row per "who pays" line on the sheet
-- e.g. Carl covering himself + 4 friends = headcount 5
-- ─────────────────────────────────────────────
create table payment_groups (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  payer_id uuid not null references players(id) on delete restrict,
  payer_status_snapshot text not null check (payer_status_snapshot in ('regular', 'guest')),
  headcount int not null default 1 check (headcount > 0),
  water_cost numeric(10,2) not null default 0,
  penalty numeric(10,2) not null default 0,
  members text, -- free-text note of who's covered, e.g. "Carl, wife, 3 friends"
  created_at timestamptz not null default now()
);

-- Helpful view: everything pre-calculated, mirrors your spreadsheet.
-- Per-person court + shuttle rates are derived from session totals divided by
-- the sum of headcounts in that session.
create view session_summary as
with head_totals as (
  select session_id, sum(headcount) as total_headcount
  from payment_groups
  group by session_id
),
rates as (
  select
    s.id as session_id,
    case
      when s.court_fee_mode = 'split'
        then s.court_fee_total / nullif(ht.total_headcount, 0)
      else s.court_fee_per_slot
    end as court_unit_cost,
    (s.shuttle_count * s.shuttle_price_each) / nullif(ht.total_headcount, 0) as shuttle_unit_cost
  from sessions s
  left join head_totals ht on ht.session_id = s.id
)
select
  pg.id as group_id,
  s.id as session_id,
  s.session_date,
  p.name as payer_name,
  pg.payer_status_snapshot as status,
  pg.headcount,
  coalesce(r.court_unit_cost, 0) * pg.headcount as court_total,
  coalesce(r.shuttle_unit_cost, 0) * pg.headcount as shuttle_total,
  pg.water_cost,
  pg.penalty,
  (coalesce(r.court_unit_cost, 0) + coalesce(r.shuttle_unit_cost, 0)) * pg.headcount + pg.water_cost as actual_cost,
  case
    when pg.payer_status_snapshot = 'guest'
      then s.guest_fixed_rate * pg.headcount
    else (coalesce(r.court_unit_cost, 0) + coalesce(r.shuttle_unit_cost, 0)) * pg.headcount + pg.water_cost
  end as amount_to_pay,
  case
    when pg.payer_status_snapshot = 'guest'
      then (s.guest_fixed_rate * pg.headcount)
           - ((coalesce(r.court_unit_cost, 0) + coalesce(r.shuttle_unit_cost, 0)) * pg.headcount + pg.water_cost)
    else 0
  end as funds_generated
from payment_groups pg
join sessions s on s.id = pg.session_id
join players p on p.id = pg.payer_id
left join rates r on r.session_id = s.id;

-- ─────────────────────────────────────────────
-- Row Level Security
-- Simple model: any authenticated user (you + co-admins) can read/write.
-- Tighten later if you add public read-only views.
-- ─────────────────────────────────────────────
alter table players enable row level security;
alter table sessions enable row level security;
alter table payment_groups enable row level security;

create policy "authenticated read players" on players for select using (auth.role() = 'authenticated');
create policy "authenticated write players" on players for all using (auth.role() = 'authenticated');

create policy "authenticated read sessions" on sessions for select using (auth.role() = 'authenticated');
create policy "authenticated write sessions" on sessions for all using (auth.role() = 'authenticated');

create policy "authenticated read groups" on payment_groups for select using (auth.role() = 'authenticated');
create policy "authenticated write groups" on payment_groups for all using (auth.role() = 'authenticated');

-- ─────────────────────────────────────────────
-- MIGRATION — run this INSTEAD of the block above if you already
-- created the tables with the older schema (which had a stored
-- `shuttle_unit_cost` column and no court-fee mode).
-- ─────────────────────────────────────────────
-- alter table sessions
--   add column if not exists court_fee_mode text not null
--     check (court_fee_mode in ('per_person', 'split')) default 'per_person',
--   add column if not exists court_fee_total numeric(10,2) not null default 0,
--   add column if not exists shuttle_count numeric(10,2) not null default 0,
--   add column if not exists shuttle_price_each numeric(10,2) not null default 0;
--
-- -- Old sessions stored only a per-person shuttle figure. The new model needs a
-- -- count and a price, so past sessions will show ₱0 shuttle until you fill those
-- -- in. If you want to keep an old session's numbers roughly intact, set for that
-- -- session: shuttle_count = 1, shuttle_price_each = (old shuttle_unit_cost) *
-- -- (that session's total headcount). Then:
-- alter table sessions drop column if exists shuttle_unit_cost;
--
-- drop view if exists session_summary;
-- -- then re-run the `create view session_summary` statement above.
