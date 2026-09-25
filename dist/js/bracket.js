/* Brackets live inside the selected tournament's detail page. */
const tournamentId=new URLSearchParams(location.search).get('tournament');
location.replace(tournamentId?`tournament.html?id=${encodeURIComponent(tournamentId)}#eventBrackets`:'tournaments.html');
