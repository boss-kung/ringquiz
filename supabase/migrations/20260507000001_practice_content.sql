create table if not exists public.practice_content (
  key text primary key,
  title text not null,
  prompt text not null,
  instruction text not null,
  image_url text not null,
  mask_url text not null,
  reveal_image_url text null,
  circle_radius_ratio double precision not null check (circle_radius_ratio > 0 and circle_radius_ratio <= 0.5),
  image_width integer not null check (image_width > 0),
  image_height integer not null check (image_height > 0),
  mask_width integer not null check (mask_width > 0),
  mask_height integer not null check (mask_height > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.practice_content enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'practice_content'
      and policyname = 'practice_content_public_read'
  ) then
    create policy practice_content_public_read
      on public.practice_content
      for select
      using (true);
  end if;
end $$;

insert into public.practice_content (
  key,
  title,
  prompt,
  instruction,
  image_url,
  mask_url,
  reveal_image_url,
  circle_radius_ratio,
  image_width,
  image_height,
  mask_width,
  mask_height
)
select
  'waiting_practice',
  'มาซ้อมก่อนเริ่มเกมกันเถอะ!',
  'ซ้อมก่อนเริ่ม',
  'วิธีเล่น: อ่านโจทย์ → วางวงกลมที่คิดว่าเป็นคำตอบ → กดปุ่มยืนยันคำตอบ',
  'practice/practice-demo-image.svg',
  'practice/practice-demo-mask.svg',
  'practice/practice-demo-reveal.svg',
  0.085,
  1200,
  900,
  1200,
  900
where not exists (
  select 1 from public.practice_content where key = 'waiting_practice'
);
