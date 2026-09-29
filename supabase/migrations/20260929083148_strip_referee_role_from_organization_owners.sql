-- Organization owners cannot keep a global referee role alongside ownership.
delete from public.user_roles ur
using public.organizations o
where o.owner_id=ur.user_id and ur.role_key='REFEREE';
