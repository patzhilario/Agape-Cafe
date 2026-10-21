do $$
declare
  status_definition text;
begin
  status_definition := pg_get_functiondef(
    'public.update_order_status(uuid,public.order_status,text)'::regprocedure
  );

  status_definition := replace(
    status_definition,
    'if cancellation_reason is null',
    'if $3 is null'
  );
  status_definition := replace(
    status_definition,
    'btrim(cancellation_reason)',
    'btrim($3)'
  );

  if position('if cancellation_reason is null' in status_definition) > 0
      or position('btrim(cancellation_reason)' in status_definition) > 0 then
    raise exception 'Ambiguous cancellation-reason references remain in update_order_status.';
  end if;

  execute status_definition;
end;
$$;
