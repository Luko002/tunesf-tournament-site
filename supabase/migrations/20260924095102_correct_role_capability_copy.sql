update public.roles
set blurb='Federation-wide authority for user moderation, audit review, and competition administration.'
where key='PLATFORM_ADMIN';

update public.permissions
set label='Manage prize schedules and approve award records'
where key='RELEASE_PRIZES';

insert into public.role_permissions(role_key,permission_key)
values('PLAYER','CREATE_TEAM')
on conflict do nothing;
