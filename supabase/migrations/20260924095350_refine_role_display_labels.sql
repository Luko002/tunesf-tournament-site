update public.roles
set blurb='Federation owner with oversight of all configured platform permissions.'
where key='SUPER_ADMIN';

update public.permissions
set label='Manage prize schedules and approve award records; does not transfer funds'
where key='RELEASE_PRIZES';

update public.permissions
set label='Platform settings management (not configured)'
where key='PLATFORM_SETTINGS';
