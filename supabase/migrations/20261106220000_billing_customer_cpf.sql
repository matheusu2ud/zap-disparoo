alter table public.profiles
  add column if not exists cpf text;

create or replace function public.is_valid_brazilian_cpf(value text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  digits text := regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g');
  total integer;
  remainder integer;
  expected_digit integer;
  index integer;
begin
  if digits !~ '^[0-9]{11}$' or digits ~ '^([0-9])\1{10}$' then
    return false;
  end if;

  total := 0;
  for index in 1..9 loop
    total := total
      + substring(digits from index for 1)::integer * (11 - index);
  end loop;
  remainder := (total * 10) % 11;
  expected_digit := case when remainder = 10 then 0 else remainder end;
  if expected_digit <> substring(digits from 10 for 1)::integer then
    return false;
  end if;

  total := 0;
  for index in 1..10 loop
    total := total
      + substring(digits from index for 1)::integer * (12 - index);
  end loop;
  remainder := (total * 10) % 11;
  expected_digit := case when remainder = 10 then 0 else remainder end;
  return expected_digit = substring(digits from 11 for 1)::integer;
end;
$$;

revoke all on function public.is_valid_brazilian_cpf(text)
  from public, anon, authenticated;

create or replace function public.fill_broadcast_hub_profile_cpf()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.cpf is null or btrim(new.cpf) = '' then
    select nullif(regexp_replace(coalesce(user_row.raw_user_meta_data ->> 'cpf', ''), '[^0-9]', '', 'g'), '')
      into new.cpf
    from auth.users as user_row
    where user_row.id = new.id;
  else
    new.cpf := nullif(regexp_replace(new.cpf, '[^0-9]', '', 'g'), '');
  end if;

  if new.cpf is not null and not public.is_valid_brazilian_cpf(new.cpf) then
    new.cpf := null;
  end if;

  return new;
end;
$$;

revoke all on function public.fill_broadcast_hub_profile_cpf()
  from public, anon, authenticated;

create trigger broadcast_hub_profiles_fill_cpf
  before insert or update of cpf on public.profiles
  for each row execute function public.fill_broadcast_hub_profile_cpf();

update public.profiles as profile
set cpf = nullif(
  regexp_replace(coalesce(user_row.raw_user_meta_data ->> 'cpf', ''), '[^0-9]', '', 'g'),
  ''
)
from auth.users as user_row
where user_row.id = profile.id
  and profile.cpf is null
  and public.is_valid_brazilian_cpf(user_row.raw_user_meta_data ->> 'cpf');
