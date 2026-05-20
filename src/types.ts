export interface SearchResult {
  title: string;
  song_id: string;
}

export interface SongDetail {
  song_id: string;
  title: string;
  cover_url: string;
  mp3_url: string;
  lyric_query?: string;
}
