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
-- ─────────────────────────────────────────────
create table sessions (
  id uuid primary key default gen_random_uuid(),
  session_date date not null,
  court_fee_per_slot numeric(10,2) not null default 175,
  shuttle_unit_cost numeric(10,2) not null default 93.33,
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

-- Helpful view: everything pre-calculated, mirrors your spreadsheet
create view session_summary as
select
  pg.id as group_id,
  s.id as session_id,
  s.session_date,
  p.name as payer_name,
  pg.payer_status_snapshot as status,
  pg.headcount,
  s.court_fee_per_slot * pg.headcount as court_total,
  s.shuttle_unit_cost * pg.headcount as shuttle_total,
  pg.water_cost,
  pg.penalty,
  (s.court_fee_per_slot + s.shuttle_unit_cost) * pg.headcount + pg.water_cost as actual_cost,
  case
    when pg.payer_status_snapshot = 'guest'
      then s.guest_fixed_rate * pg.headcount
    else (s.court_fee_per_slot + s.shuttle_unit_cost) * pg.headcount + pg.water_cost
  end as amount_to_pay,
  case
    when pg.payer_status_snapshot = 'guest'
      then (s.guest_fixed_rate * pg.headcount) - ((s.court_fee_per_slot + s.shuttle_unit_cost) * pg.headcount + pg.water_cost)
    else 0
  end as funds_generated
from payment_groups pg
join sessions s on s.id = pg.session_id
join players p on p.id = pg.payer_id;

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
