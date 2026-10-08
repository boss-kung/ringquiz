-- Link each opened chest to the append-only wallet entry created by its first open.
alter table public.tq_chest_opens
  add column if not exists wallet_entry_id uuid references public.tq_wallet_entries(id);

create unique index if not exists tq_chest_opens_wallet_entry_idx
  on public.tq_chest_opens(wallet_entry_id)
  where wallet_entry_id is not null;
