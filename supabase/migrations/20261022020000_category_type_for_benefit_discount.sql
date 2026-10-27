-- Add a 'type' column to categories so each category can be classified as a drink, food, or other item.
-- This is used by the benefit discount logic to enforce the 1-drink + 1-food-per-beneficiary rule.

alter table public.categories
  add column if not exists type text not null default 'other'
    check (type in ('drink', 'food', 'other'));

comment on column public.categories.type is
  'Classifies the category for the PWD/Senior benefit discount rule (1 drink + 1 food per beneficiary).';
