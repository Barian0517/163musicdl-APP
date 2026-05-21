import crypto from 'crypto';
import axios from 'axios';

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

async function testAll() {
  const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/2.10.2.200154';
  const REFERER = 'https://music.163.com/';

  try {
    // 1. PC Search test
    console.log("--- Testing PC Search ---");
    const searchRes = await axios.post('https://music.163.com/api/cloudsearch/pc', 
      's=夜曲&type=1&limit=2',
      {
        headers: {
          'User-Agent': USER_AGENT,
          'Referer': REFERER,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
    console.log("Search response status:", searchRes.status);
    const searchSongs = searchRes.data?.result?.songs || [];
    console.log("Found songs:", searchSongs.map((s: any) => `${s.id}: ${s.name} - ${s.ar?.map((a: any) => a.name).join('/')}`));

    if (searchSongs.length > 0) {
      const songId = searchSongs[0].id;

      // 2. Detail test
      console.log("--- Testing Detail ---");
      const detailRes = await axios.post('https://interface3.music.163.com/api/v3/song/detail',
        `c=${encodeURIComponent(JSON.stringify([{ id: songId, v: 0 }]))}`,
        {
          headers: {
            'User-Agent': USER_AGENT,
            'Referer': REFERER,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );
      console.log("Detail response status:", detailRes.status);
      const songDetail = detailRes.data?.songs?.[0];
      console.log("Detail metadata:", {
        id: songDetail?.id,
        name: songDetail?.name,
        ar: songDetail?.ar?.map((a: any) => a.name).join('/'),
        picUrl: songDetail?.al?.picUrl
      });

      // 3. Playback URL test (Eapi)
      console.log("--- Testing Playback URL ---");
      const config = {
        os: 'pc',
        appver: '',
        osver: '',
        deviceId: 'pyncm!',
        requestId: String(Math.floor(20000000 + Math.random() * 10000000))
      };
      const payload = {
        ids: [songId],
        level: 'lossless',
        encodeType: 'flac',
        header: JSON.stringify(config)
      };
      const params = eapiEncrypt('https://interface3.music.163.com/eapi/song/enhance/player/url/v1', payload);
      const urlRes = await axios.post('https://interface3.music.163.com/eapi/song/enhance/player/url/v1',
        `params=${encodeURIComponent(params)}`,
        {
          headers: {
            'User-Agent': USER_AGENT,
            'Referer': REFERER,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );
      console.log("Playback URL response status:", urlRes.status);
      console.log("Playback data:", JSON.stringify(urlRes.data?.data?.[0]));

      // 4. Lyric test
      console.log("--- Testing Lyric ---");
      const lyricRes = await axios.post('https://interface3.music.163.com/api/song/lyric',
        `id=${songId}&cp=false&tv=0&lv=0&rv=0&kv=0&yv=0&ytv=0&yrv=0`,
        {
          headers: {
            'User-Agent': USER_AGENT,
            'Referer': REFERER,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );
      console.log("Lyric response status:", lyricRes.status);
      console.log("Lyric sample:", lyricRes.data?.lrc?.lyric?.substring(0, 100));
    }
  } catch (e: any) {
    console.error("Test failed with error:", e.response?.data || e.message);
  }
}

testAll();
