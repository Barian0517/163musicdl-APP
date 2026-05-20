import express from 'express';
import path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { createServer as createViteServer } from 'vite';
import NodeID3 from 'node-id3';
import { ZipArchive } from 'archiver';

const BASE_URL = "https://3g.gljlw.com/music/wy/";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API constraints: Search -> `GET search.php?keywords=...`
  app.get('/api/search', async (req, res) => {
    try {
      const keywords = req.query.keywords;
      if (!keywords || typeof keywords !== 'string') {
        res.status(400).json({ error: 'Keywords are required' });
        return;
      }

      const response = await axios.get(`${BASE_URL}search.php`, {
        params: { keywords },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36',
          'Referer': BASE_URL
        }
      });

      const $ = cheerio.load(response.data);
      const results: any[] = [];

      $('div.line1').each((_, el) => {
        const aTag = $(el).find('a[href^="info.php?id="]');
        if (aTag.length > 0) {
          const title = aTag.text().trim();
          const href = aTag.attr('href');
          const id = href?.split('id=')[1];
          if (id) {
            results.push({
              title,
              song_id: id,
            });
          }
        }
      });

      res.json({ data: results });
    } catch (error: any) {
      console.error('Search error:', error.message);
      res.status(500).json({ error: 'Failed to search' });
    }
  });

  // Fetch song info constraints: `GET info.php?id=...`
  app.get('/api/song', async (req, res) => {
    try {
      const id = req.query.id;
      if (!id || typeof id !== 'string') {
        res.status(400).json({ error: 'Song ID is required' });
        return;
      }

      const response = await axios.get(`${BASE_URL}info.php`, {
        params: { id },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36',
          'Referer': BASE_URL
        }
      });

      const $ = cheerio.load(response.data);

      const coverTag = $('img').first();
      const cover_url = coverTag.attr('src') || '';

      const audioTag = $('audio').first();
      let mp3_url = '';

      // 1. Try <audio src="...">
      if (audioTag.length > 0) {
        mp3_url = audioTag.attr('src') || '';
        // 2. Try <audio><source src="..."></audio>
        if (!mp3_url) {
          const sourceTag = audioTag.find('source');
          if (sourceTag.length > 0 && sourceTag.attr('src')) {
            mp3_url = sourceTag.attr('src') || '';
          }
        }
      }

      // 3. Try fallback link
      if (!mp3_url) {
        const dlLink = $('a').filter((_, el) => $(el).text().includes('下载地址')).first();
        if (dlLink.length > 0) {
          mp3_url = dlLink.attr('href') || '';
        }
      }

      // 4. Try regex matching for music.126.net links in the raw HTML if all else fails
      if (!mp3_url || !mp3_url.includes('music.126.net')) {
        const urlMatch = response.data.match(/https?:\/\/[a-zA-Z0-9-]+\.music\.126\.net\/[^"'<>\s]+\.mp3[^"'<>\s]*/);
        if (urlMatch) {
          mp3_url = urlMatch[0];
        }
      }

      const lyricLinkTag = $('a').filter((_, el) => $(el).text().includes('查看歌词')).first();
      let lyric_query = lyricLinkTag.attr('href') || '';
      
      const titleDiv = $('.bbstitle').first();
      const titleRaw = titleDiv.text().trim();
      const title = titleRaw.replace(/^歌曲:\s*/, '');

      res.json({
        data: {
          song_id: id,
          title: title,
          cover_url,
          mp3_url,
          lyric_query,
        }
      });
    } catch (error: any) {
      console.error('Song detail error:', error.message);
      res.status(500).json({ error: 'Failed to fetch song details' });
    }
  });

  // Fetch playlist info
  app.get('/api/playlist', async (req, res) => {
    try {
      const id = req.query.id;
      if (!id || typeof id !== 'string') {
        res.status(400).json({ error: 'Playlist ID is required' });
        return;
      }

      const response = await axios.get(`https://music.163.com/playlist?id=${id}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36',
        }
      });

      const $ = cheerio.load(response.data);
      const results: any[] = [];

      $('ul.f-hide li a').each((_, el) => {
        const title = $(el).text().trim();
        const href = $(el).attr('href');
        const match = href?.match(/\/song\?id=(\d+)/);
        if (title && match && match[1]) {
          results.push({
            title,
            song_id: match[1],
          });
        }
      });

      res.json({ data: results.slice(0, 10) });
    } catch (error: any) {
      console.error('Playlist error:', error.message);
      res.status(500).json({ error: 'Failed to fetch playlist' });
    }
  });

  // Download proxy endpoint
  app.get('/api/download', async (req, res) => {
    try {
      const { url, filename, title, artist, coverUrl } = req.query;
      if (!url || typeof url !== 'string') {
        res.status(400).json({ error: 'URL is required' });
        return;
      }

      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      let mp3Buffer = response.data;

      try {
        const tags: any = {};
        if (title) tags.title = String(title);
        if (artist) tags.artist = String(artist);
        
        if (coverUrl && typeof coverUrl === 'string') {
          const coverRes = await axios.get(coverUrl, { responseType: 'arraybuffer' });
          if (coverRes.data) {
            tags.image = {
              mime: (coverUrl.endsWith('.png') ? 'image/png' : 'image/jpeg'),
              type: { id: 3, name: 'front cover' },
              description: 'Cover',
              imageBuffer: Buffer.from(coverRes.data)
            };
          }
        }

        if (Object.keys(tags).length > 0) {
          const success = NodeID3.write(tags, mp3Buffer);
          if (success) {
            mp3Buffer = success;
          }
        }
      } catch (e) {
        console.error('Failed to write ID3 tags:', e);
      }

      const safeFilename = filename ? encodeURIComponent(filename as string) : 'music';
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeFilename}.mp3`);
      
      res.send(mp3Buffer);
    } catch (error: any) {
      console.error('Download proxy error:', error.message);
      res.status(500).json({ error: 'Failed to download file' });
    }
  });

  // Fetch lyrics
  app.get('/api/lyrics', async (req, res) => {
    try {
      const { id } = req.query;
      if (!id || typeof id !== 'string') {
        res.status(400).json({ error: 'Song ID is required' });
        return;
      }

      // Step 1: Request info.php
      const infoRes = await axios.get(`${BASE_URL}info.php`, {
        params: { id },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': BASE_URL
        }
      });
      const $info = cheerio.load(infoRes.data);
      const dlLink = $info('a').filter((_, el) => $info(el).text().includes('查看歌词')).first().attr('href');
      
      let lrcContent = '';

      if (dlLink) {
        // Step 2: Request lyricInfo.php
        const response = await axios.get(`${BASE_URL}${dlLink}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': `${BASE_URL}info.php?id=${id}`
          }
        });

        const $ = cheerio.load(response.data);
        const contentHtml = $('.content').html() || '';
        const parts = contentHtml.split('<hr>');
        
        const lines = parts.map(part => {
           const text = cheerio.load('<div>' + part + '</div>').text().trim();
           if (/^\[\d{2}:\d{2}\.\d{2,3}\]/.test(text)) {
              return text;
           }
           return null;
        }).filter(Boolean);
        
        lrcContent = lines.join('\n');
      }

      if (!lrcContent) {
         lrcContent = '[00:00.000] 暫無歌詞\n';
      }

      const filename = req.query.filename ? String(req.query.filename) : 'lyric';
      const safeFilename = encodeURIComponent(filename).replace(/['()]/g, escape).replace(/\*/g, '%2A');

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeFilename}.lrc`);
      res.send(lrcContent);
    } catch (error: any) {
      console.error('Lyrics fetch error:', error.message);
      res.status(500).json({ error: 'Failed to fetch lyrics' });
    }
  });

  app.post('/api/download-zip', async (req, res) => {
    try {
      const { songs, type, nameFormat } = req.body;
      if (!songs || !Array.isArray(songs)) {
        res.status(400).json({ error: 'Songs array is required' });
        return;
      }

      const archive = new ZipArchive({ zlib: { level: 9 } });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="playlist.zip"`);

      archive.pipe(res);

      const batchSize = 10;
      for (let i = 0; i < songs.length; i += batchSize) {
        const batch = songs.slice(i, i + batchSize);
        await Promise.all(batch.map(async (song: any) => {
          try {
            let mp3_url = '';
            let cover_url = '';
            let lrcContent = '';
            
            const infoRes = await axios.get(`${BASE_URL}info.php`, {
              params: { id: song.song_id },
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36',
                'Referer': BASE_URL
              }
            });

            const $ = cheerio.load(infoRes.data);
            
            if (type === 'all' || type === 'audio') {
              const audioTag = $('audio').first();
              if (audioTag.length > 0) {
                mp3_url = audioTag.attr('src') || '';
                if (!mp3_url) {
                  const sourceTag = audioTag.find('source');
                  if (sourceTag.length > 0 && sourceTag.attr('src')) {
                    mp3_url = sourceTag.attr('src') || '';
                  }
                }
              }
              if (!mp3_url) {
                const dlLink = $('a').filter((_, el) => $(el).text().includes('下载地址')).first();
                if (dlLink.length > 0) mp3_url = dlLink.attr('href') || '';
              }
              if (!mp3_url || !mp3_url.includes('music.126.net')) {
                const urlMatch = infoRes.data.match(/https?:\/\/[a-zA-Z0-9-]+\.music\.126\.net\/[^"'<>\s]+\.mp3[^"'<>\s]*/);
                if (urlMatch) mp3_url = urlMatch[0];
              }

              cover_url = $('img').first().attr('src') || '';
            }

            if ((type === 'all' || type === 'lyric')) {
              const dlLink = $('a').filter((_, el) => $(el).text().includes('查看歌词')).first().attr('href');
              if (dlLink) {
                try {
                  const response = await axios.get(`${BASE_URL}${dlLink}`, {
                    headers: {
                      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                      'Referer': `${BASE_URL}info.php?id=${song.song_id}`
                    }
                  });
                  const _$ = cheerio.load(response.data);
                  const contentHtml = _$('.content').html() || '';
                  const parts = contentHtml.split('<hr>');
                  const lines = parts.map(part => {
                    const text = cheerio.load('<div>' + part + '</div>').text().trim();
                    if (/^\[\d{2}:\d{2}\.\d{2,3}\]/.test(text)) return text;
                    return null;
                  }).filter(Boolean);
                  
                  lrcContent = lines.join('\n');
                } catch (e) {
                  console.error('Failed to get lrc from', dlLink, e);
                }
              }
              if (!lrcContent) {
                lrcContent = '[00:00.000] 暫無歌詞\n';
              }
            }

            let parsedSongName = song.title;
            let parsedArtist = '';
            if (song.title.includes(' - ')) {
              const parts = song.title.split(' - ');
              parsedSongName = parts[0].trim();
              parsedArtist = parts[1].trim();
            }

            let downloadFilename = nameFormat === 'artist-title' 
              ? (parsedArtist ? `${parsedArtist} - ${parsedSongName}` : parsedSongName)
              : (parsedArtist ? `${parsedSongName} - ${parsedArtist}` : parsedSongName);
            
            downloadFilename = downloadFilename.replace(/[/\\?%*:|"<>]/g, '-');

            if ((type === 'all' || type === 'audio') && mp3_url) {
              const audioRes = await axios.get(mp3_url, { responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' } });
              let mp3Buffer = Buffer.from(audioRes.data);

              try {
                const tags: any = {};
                if (parsedSongName) tags.title = parsedSongName;
                if (parsedArtist) tags.artist = parsedArtist;
                
                if (cover_url) {
                  const coverRes = await axios.get(cover_url, { responseType: 'arraybuffer' });
                  if (coverRes.data) {
                    tags.image = {
                      mime: (cover_url.endsWith('.png') ? 'image/png' : 'image/jpeg'),
                      type: { id: 3, name: 'front cover' },
                      description: 'Cover',
                      imageBuffer: Buffer.from(coverRes.data)
                    };
                  }
                }

                if (Object.keys(tags).length > 0) {
                  const success = NodeID3.write(tags, mp3Buffer);
                  if (success) mp3Buffer = success as Buffer;
                }
              } catch (e) {
                console.error('ID3 tags error in zip:', e);
              }
              archive.append(mp3Buffer, { name: `${downloadFilename}.mp3` });
            }

            if ((type === 'all' || type === 'lyric') && lrcContent) {
              archive.append(Buffer.from(lrcContent, 'utf-8'), { name: `${downloadFilename}.lrc` });
            }
          } catch (err) {
            console.error(`Error zipping song ${song.song_id}:`, err);
          }
        }));
      }

      archive.finalize();
    } catch (e: any) {
      console.error('Zip error:', e);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Zip failed' });
      }
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // Express v4 approach
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
