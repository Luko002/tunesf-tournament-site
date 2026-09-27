-- The primary-key indexes already start with these columns.
drop index if exists public.user_roles_user_idx;
drop index if exists public.role_permissions_role_idx;
