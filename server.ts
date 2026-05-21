import express from 'express';
import path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { createServer as createViteServer } from 'vite';
import NodeID3 from 'node-id3';
import * as archiverModule from 'archiver';
import crypto from 'crypto';
// @ts-ignore
import Metaflac from 'metaflac-js';

const archiver = ((archiverModule as any).default || archiverModule) as any;

const BASE_URL = "https://3g.gljlw.com/music/wy/";

function determineExtension(url: string, contentType: string = ''): string {
  const urlLower = url.toLowerCase();
  if (urlLower.includes('.flac')) return 'flac';
  if (urlLower.includes('.mp3')) return 'mp3';
  if (urlLower.includes('.m4a')) return 'm4a';
  
  const ctLower = contentType.toLowerCase();
  if (ctLower.includes('flac')) return 'flac';
  if (ctLower.includes('mpeg') || ctLower.includes('mp3')) return 'mp3';
  if (ctLower.includes('mp4') || ctLower.includes('m4a')) return 'm4a';
  return 'mp3';
}

function aesEncrypt(plaintext: string | Buffer, key: Buffer | string, iv: Buffer | string): string {
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  let encrypted = cipher.update(plaintext);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return encrypted.toString('base64');
}

function weapiEncrypt(text: string): { params: string; encSecKey: string } {
  const presetKey = '0CoJUm6Qyw8W8jud';
  const iv = '0102030405060708';
  const encText = aesEncrypt(text, presetKey, iv);
  const params = aesEncrypt(encText, presetKey, iv);
  const encSecKey = 'bf50d0bcf56833b06d8d1219496a452a1d860fd58a14c0aafba3e770104ca77dc6856cb310ed3309039e6865081be4ddc2df52663373b20b70ac25b4d0c6ca466daef6b50174e93536e2d580c49e70649ad1936584899e85722eb83ceddfb4f56c1172fca5e60592d0e6ee3e8e02be1fe6e53f285b0389162d8e6ddc553857cd';
  return { params, encSecKey };
}

function eapiEncrypt(url: string, payload: any): string {
  const urlPath = new URL(url).pathname.replace('/eapi/', '/api/');
  const payloadStr = JSON.stringify(payload);
  const digestInput = `nobody${urlPath}use${payloadStr}md5forencrypt`;
  const digest = crypto.createHash('md5').update(digestInput, 'utf8').digest('hex');
  const paramsStr = `${urlPath}-36cd479b6b5-${payloadStr}-36cd479b6b5-${digest}`;
  
  const key = Buffer.from('e82ckenh8dichen8', 'utf8');
  const cipher = crypto.createCipheriv('aes-128-ecb', key, Buffer.alloc(0));
  let encrypted = cipher.update(paramsStr, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return encrypted.toString('hex');
}

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

      const apiBaseParam = req.query.api_base;
      if (apiBaseParam === 'official') {
        const cookie = req.query.cookie as string || '';
        const headers: any = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/2.10.2.200154',
          'Referer': 'https://music.163.com/',
          'Content-Type': 'application/x-www-form-urlencoded',
        };
        if (cookie.trim()) {
          headers['Cookie'] = cookie;
        }

        const response = await axios.post(
          'https://music.163.com/api/cloudsearch/pc',
          `s=${encodeURIComponent(keywords)}&type=1&limit=30`,
          { headers }
        );

        const songs = response.data?.result?.songs || [];
        const results = songs.map((song: any) => {
          let title = song.name || '';
          if (song.ar && song.ar.length > 0) {
            const artists = song.ar.map((ar: any) => ar.name).join('/');
            title = `${title} - ${artists}`;
          }
          return {
            title,
            song_id: String(song.id),
          };
        });

        res.json({ data: results });
        return;
      }

      let apiBase = typeof apiBaseParam === 'string' && apiBaseParam ? apiBaseParam : BASE_URL;
      if (!apiBase.endsWith('/')) {
        apiBase += '/';
      }

      const response = await axios.get(`${apiBase}search.php`, {
        params: { keywords },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36',
          'Referer': apiBase
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

      const apiBaseParam = req.query.api_base;
      if (apiBaseParam === 'official') {
        const cookie = req.query.cookie as string || '';
        const quality = req.query.quality as string || 'lossless';
        const headers: any = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/2.10.2.200154',
          'Referer': 'https://music.163.com/',
          'Content-Type': 'application/x-www-form-urlencoded',
        };
        if (cookie.trim()) {
          headers['Cookie'] = cookie;
        }

        // 1. Fetch metadata via api/v3/song/detail
        const cPayload = JSON.stringify([{ id: Number(id), v: 0 }]);
        const detailRes = await axios.post(
          'https://interface3.music.163.com/api/v3/song/detail',
          `c=${encodeURIComponent(cPayload)}`,
          { headers }
        );

        const song = detailRes.data?.songs?.[0];
        if (!song) {
          res.status(404).json({ error: 'Song not found' });
          return;
        }

        const name = song.name || '';
        const artistNames = song.ar?.map((ar: any) => ar.name) || [];
        const artists = artistNames.join('/');
        const title = artists ? `${name} - ${artists}` : name;
        const cover_url = song.al?.picUrl || '';

        // 2. Fetch player URL using Eapi with fallback
        let mp3_url = '';
        const levelsToTry = [quality];
        if (quality !== 'standard') {
          levelsToTry.push('standard');
        }

        for (const currentLevel of levelsToTry) {
          const requestId = String(Math.floor(20000000 + Math.random() * 10000000));
          const config = {
            os: 'pc',
            appver: '',
            osver: '',
            deviceId: 'pyncm!',
            requestId
          };
          const payload = {
            ids: [Number(id)],
            level: currentLevel,
            encodeType: 'flac',
            header: JSON.stringify(config)
          };
          const params = eapiEncrypt('https://interface3.music.163.com/eapi/song/enhance/player/url/v1', payload);

          const urlRes = await axios.post(
            'https://interface3.music.163.com/eapi/song/enhance/player/url/v1',
            `params=${encodeURIComponent(params)}`,
            { headers }
          );

          const fetchedUrl = urlRes.data?.data?.[0]?.url;
          if (fetchedUrl) {
            mp3_url = fetchedUrl;
            break;
          }
        }

        const album = song.al?.name || '';
        res.json({
          data: {
            song_id: id,
            title,
            cover_url,
            mp3_url,
            lyric_query: 'official',
            album
          }
        });
        return;
      }

      let apiBase = typeof apiBaseParam === 'string' && apiBaseParam ? apiBaseParam : BASE_URL;
      if (!apiBase.endsWith('/')) {
        apiBase += '/';
      }

      const response = await axios.get(`${apiBase}info.php`, {
        params: { id },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36',
          'Referer': apiBase
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
          album: '',
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

      const cookie = req.query.cookie as string || '';
      if (cookie.trim()) {
        const payload = JSON.stringify({
          id,
          n: 10000,
          s: 8
        });
        const { params, encSecKey } = weapiEncrypt(payload);

        const response = await axios.post(
          'https://music.163.com/weapi/v6/playlist/detail?csrf_token=',
          `params=${encodeURIComponent(params)}&encSecKey=${encodeURIComponent(encSecKey)}`,
          {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Referer': 'https://music.163.com/',
              'Content-Type': 'application/x-www-form-urlencoded',
              'Cookie': cookie
            }
          }
        );

        const tracks = response.data?.playlist?.tracks || [];
        const results = tracks.map((track: any) => {
          const artistsStr = track.ar?.map((artist: any) => artist.name).join('/') || '';
          const title = artistsStr ? `${track.name} - ${artistsStr}` : track.name;
          return {
            title,
            song_id: String(track.id),
          };
        });

        res.json({ data: results });
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
      const { url, filename, title, artist, coverUrl, album } = req.query;
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
      const contentTypeHeader = (response.headers['content-type'] as string) || '';
      const fileExt = determineExtension(url, contentTypeHeader);

      let coverBuffer: Buffer | null = null;
      if (coverUrl && typeof coverUrl === 'string') {
        try {
          const coverRes = await axios.get(coverUrl, { responseType: 'arraybuffer' });
          if (coverRes.data) {
            coverBuffer = Buffer.from(coverRes.data);
          }
        } catch (e) {
          console.error('Failed to download cover:', e);
        }
      }

      try {
        if (fileExt === 'mp3') {
          const tags: any = {};
          if (title) tags.title = String(title);
          if (artist) tags.artist = String(artist);
          if (album) tags.album = String(album);
          if (coverBuffer) {
            tags.image = {
              mime: (coverUrl && typeof coverUrl === 'string' && coverUrl.endsWith('.png') ? 'image/png' : 'image/jpeg'),
              type: { id: 3, name: 'front cover' },
              description: 'Cover',
              imageBuffer: coverBuffer
            };
          }
          if (Object.keys(tags).length > 0) {
            const success = NodeID3.write(tags, mp3Buffer);
            if (success) {
              mp3Buffer = success;
            }
          }
        } else if (fileExt === 'flac') {
          const flac = new Metaflac(mp3Buffer);
          if (title) flac.setTag(`TITLE=${title}`);
          if (artist) flac.setTag(`ARTIST=${artist}`);
          if (album) flac.setTag(`ALBUM=${album}`);
          if (coverBuffer) {
            flac.importPictureFromBuffer(coverBuffer);
          }
          mp3Buffer = flac.save();
        }
      } catch (e) {
        console.error('Failed to write metadata tags:', e);
      }

      const safeFilename = filename ? encodeURIComponent(filename as string) : 'music';
      const mimeTypes: Record<string, string> = {
        mp3: 'audio/mpeg',
        flac: 'audio/flac',
        m4a: 'audio/mp4'
      };
      
      res.setHeader('Content-Type', mimeTypes[fileExt] || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeFilename}.${fileExt}`);
      
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

      const apiBaseParam = req.query.api_base;
      if (apiBaseParam === 'official') {
        const cookie = req.query.cookie as string || '';
        const headers: any = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/2.10.2.200154',
          'Referer': 'https://music.163.com/',
          'Content-Type': 'application/x-www-form-urlencoded',
        };
        if (cookie.trim()) {
          headers['Cookie'] = cookie;
        }

        const response = await axios.post(
          'https://interface3.music.163.com/api/song/lyric',
          `id=${id}&cp=false&tv=0&lv=0&rv=0&kv=0&yv=0&ytv=0&yrv=0`,
          { headers }
        );

        let lrcContent = response.data?.lrc?.lyric || '';
        if (!lrcContent) {
          lrcContent = '[00:00.000] 暫無歌詞\n';
        }

        const filename = req.query.filename ? String(req.query.filename) : 'lyric';
        const safeFilename = encodeURIComponent(filename).replace(/['()]/g, escape).replace(/\*/g, '%2A');

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeFilename}.lrc`);
        res.send(lrcContent);
        return;
      }

      let apiBase = typeof apiBaseParam === 'string' && apiBaseParam ? apiBaseParam : BASE_URL;
      if (!apiBase.endsWith('/')) {
        apiBase += '/';
      }

      // Step 1: Request info.php
      const infoRes = await axios.get(`${apiBase}info.php`, {
        params: { id },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': apiBase
        }
      });
      const $info = cheerio.load(infoRes.data);
      const dlLink = $info('a').filter((_, el) => $info(el).text().includes('查看歌词')).first().attr('href');
      
      let lrcContent = '';

      if (dlLink) {
        // Step 2: Request lyricInfo.php
        const response = await axios.get(`${apiBase}${dlLink}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': `${apiBase}info.php?id=${id}`
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
      const { songs, type, nameFormat, api_base, cookie, quality } = req.body;
      if (!songs || !Array.isArray(songs)) {
        res.status(400).json({ error: 'Songs array is required' });
        return;
      }

      const apiBaseParam = api_base;
      let apiBase = typeof apiBaseParam === 'string' && apiBaseParam ? apiBaseParam : BASE_URL;
      if (!apiBase.endsWith('/')) {
        apiBase += '/';
      }

      const archive = archiver('zip', { zlib: { level: 9 } });

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
            let parsedSongName = song.title;
            let parsedArtist = '';
            let parsedAlbum = '';
            if (song.title.includes(' - ')) {
              const parts = song.title.split(' - ');
              parsedSongName = parts[0].trim();
              parsedArtist = parts[1].trim();
            }

            if (api_base === 'official') {
              const neteaseCookie = cookie as string || '';
              const neteaseQuality = quality as string || 'lossless';
              const headers: any = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/2.10.2.200154',
                'Referer': 'https://music.163.com/',
                'Content-Type': 'application/x-www-form-urlencoded',
              };
              if (neteaseCookie.trim()) {
                headers['Cookie'] = neteaseCookie;
              }

              // 1. Detail API for metadata
              const cPayload = JSON.stringify([{ id: Number(song.song_id), v: 0 }]);
              const detailRes = await axios.post(
                'https://interface3.music.163.com/api/v3/song/detail',
                `c=${encodeURIComponent(cPayload)}`,
                { headers }
              );
              const songData = detailRes.data?.songs?.[0];
              if (songData) {
                parsedSongName = songData.name || '';
                const artistNames = songData.ar?.map((ar: any) => ar.name) || [];
                parsedArtist = artistNames.join('/');
                cover_url = songData.al?.picUrl || '';
                parsedAlbum = songData.al?.name || '';
              }

              // 2. Playback URL using Eapi with fallback
              if (type === 'all' || type === 'audio') {
                const levelsToTry = [neteaseQuality];
                if (neteaseQuality !== 'standard') {
                  levelsToTry.push('standard');
                }

                for (const currentLevel of levelsToTry) {
                  const requestId = String(Math.floor(20000000 + Math.random() * 10000000));
                  const config = {
                    os: 'pc',
                    appver: '',
                    osver: '',
                    deviceId: 'pyncm!',
                    requestId
                  };
                  const payload = {
                    ids: [Number(song.song_id)],
                    level: currentLevel,
                    encodeType: 'flac',
                    header: JSON.stringify(config)
                  };
                  const params = eapiEncrypt('https://interface3.music.163.com/eapi/song/enhance/player/url/v1', payload);

                  const urlRes = await axios.post(
                    'https://interface3.music.163.com/eapi/song/enhance/player/url/v1',
                    `params=${encodeURIComponent(params)}`,
                    { headers }
                  );

                  const fetchedUrl = urlRes.data?.data?.[0]?.url;
                  if (fetchedUrl) {
                    mp3_url = fetchedUrl;
                    break;
                  }
                }
              }

              // 3. Lyrics
              if (type === 'all' || type === 'lyric') {
                const lyricRes = await axios.post(
                  'https://interface3.music.163.com/api/song/lyric',
                  `id=${song.song_id}&cp=false&tv=0&lv=0&rv=0&kv=0&yv=0&ytv=0&yrv=0`,
                  { headers }
                );
                lrcContent = lyricRes.data?.lrc?.lyric || '';
                if (!lrcContent) {
                  lrcContent = '[00:00.000] 暫無歌詞\n';
                }
              }
            } else {
              const infoRes = await axios.get(`${apiBase}info.php`, {
                params: { id: song.song_id },
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36',
                  'Referer': apiBase
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
                    const response = await axios.get(`${apiBase}${dlLink}`, {
                      headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Referer': `${apiBase}info.php?id=${song.song_id}`
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
            }

            let downloadFilename = nameFormat === 'artist-title' 
              ? (parsedArtist ? `${parsedArtist} - ${parsedSongName}` : parsedSongName)
              : (parsedArtist ? `${parsedSongName} - ${parsedArtist}` : parsedSongName);
            
            downloadFilename = downloadFilename.replace(/[/\\?%*:|"<>]/g, '-');

            if ((type === 'all' || type === 'audio') && mp3_url) {
              const audioRes = await axios.get(mp3_url, { responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' } });
              let mp3Buffer = Buffer.from(audioRes.data);

              const contentTypeHeader = (audioRes.headers['content-type'] as string) || '';
              const fileExt = determineExtension(mp3_url, contentTypeHeader);

              let coverBuffer: Buffer | null = null;
              if (cover_url) {
                try {
                  const coverRes = await axios.get(cover_url, { responseType: 'arraybuffer' });
                  if (coverRes.data) {
                    coverBuffer = Buffer.from(coverRes.data);
                  }
                } catch (e) {
                  console.error('Failed to download cover in zip:', e);
                }
              }

              try {
                if (fileExt === 'mp3') {
                  const tags: any = {};
                  if (parsedSongName) tags.title = parsedSongName;
                  if (parsedArtist) tags.artist = parsedArtist;
                  if (parsedAlbum) tags.album = parsedAlbum;
                  if (coverBuffer) {
                    tags.image = {
                      mime: (cover_url.endsWith('.png') ? 'image/png' : 'image/jpeg'),
                      type: { id: 3, name: 'front cover' },
                      description: 'Cover',
                      imageBuffer: coverBuffer
                    };
                  }
                  if (Object.keys(tags).length > 0) {
                    const success = NodeID3.write(tags, mp3Buffer);
                    if (success) mp3Buffer = success as Buffer;
                  }
                } else if (fileExt === 'flac') {
                  const flac = new Metaflac(mp3Buffer);
                  if (parsedSongName) flac.setTag(`TITLE=${parsedSongName}`);
                  if (parsedArtist) flac.setTag(`ARTIST=${parsedArtist}`);
                  if (parsedAlbum) flac.setTag(`ALBUM=${parsedAlbum}`);
                  if (coverBuffer) {
                    flac.importPictureFromBuffer(coverBuffer);
                  }
                  mp3Buffer = flac.save();
                }
              } catch (e) {
                console.error('FLAC/ID3 tags error in zip:', e);
              }
              archive.append(mp3Buffer, { name: `${downloadFilename}.${fileExt}` });
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
