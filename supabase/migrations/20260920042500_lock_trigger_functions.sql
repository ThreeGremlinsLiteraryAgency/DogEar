-- Trigger functions are invoked by PostgreSQL, never directly by web clients.
revoke execute on function public.handle_new_user()
  from authenticated;

revoke execute on function public.create_initial_beta_round()
  from authenticated;

revoke execute on function public.validate_beta_manuscript_storage_path()
  from authenticated;
