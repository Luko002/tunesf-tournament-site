create unique index player_game_identity_links_claim_uidx
  on public.player_game_identity_links(game_key,lower(player_id),coalesce(lower(platform),''));
