// Ovde menjaš predmete i vrste materijala za svoje odeljenje.
// id sme da sadrži samo mala slova, brojeve i crticu.

export const SUBJECTS = [
  { id: 'matematika', name: 'Matematika', color: '#007AFF' },
  { id: 'srpski', name: 'Srpski jezik', color: '#FF3B30' },
  { id: 'engleski', name: 'Engleski jezik', color: '#FF9500' },
  { id: 'fizika', name: 'Fizika', color: '#5856D6' },
  { id: 'hemija', name: 'Hemija', color: '#34C759' },
  { id: 'biologija', name: 'Biologija', color: '#30B0C7' },
  { id: 'istorija', name: 'Istorija', color: '#A2845E' },
  { id: 'geografija', name: 'Geografija', color: '#00C7BE' },
  { id: 'informatika', name: 'Informatika', color: '#AF52DE' },
  { id: 'ostalo', name: 'Ostalo', color: '#8E8E93' }
];

// Ako dodaš novu vrstu, dodaj je i u TYPES u server.js
export const TYPES = [
  { id: 'odgovaranje', name: 'Odgovaranje', short: 'Odgovaranje' },
  { id: 'domaci', name: 'Domaći zadatak', short: 'Domaći' },
  { id: 'test', name: 'Kontrolni i testovi', short: 'Kontrolni' },
  { id: 'beleske', name: 'Beleške', short: 'Beleške' }
];

export const MAX_FILE_MB = 25;
export const MAX_FILES = 10;

export const ALLOWED_EXT = [
  'pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md',
  'ppt', 'pptx', 'odp', 'key',
  'xls', 'xlsx', 'ods', 'csv',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif',
  'mp3', 'm4a', 'wav', 'ogg',
  'mp4', 'mov', 'webm',
  'zip', 'rar', '7z',
  'py', 'java', 'c', 'cpp', 'cs', 'js', 'ts', 'html', 'css', 'json', 'sql', 'ipynb', 'ggb'
];
