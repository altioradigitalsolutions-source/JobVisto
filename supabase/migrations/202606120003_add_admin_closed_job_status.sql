alter type public.job_status add value if not exists 'admin_closed';

notify pgrst, 'reload schema';
