alter table holdings add column if not exists linked_deal_id uuid references deals(id);
alter table holdings add column if not exists status text default 'active';
