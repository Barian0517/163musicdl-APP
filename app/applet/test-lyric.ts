const axios = require('axios');
const cheerio = require('cheerio');

async function test() {
  const infoRes = await axios.get('https://3g.gljlw.com/music/wy/info.php?id=2619781289');
  const $ = cheerio.load(infoRes.data);
  const link = $('a').filter((_, el) => $(el).text().includes('查看歌词')).first().attr('href');
  console.log('Link:', link);
  if (link) {
    const lRes = await axios.get('https://3g.gljlw.com/music/wy/' + link);
    const _$ = cheerio.load(lRes.data);
    const content = _$('.content').html();
    console.log(content.substring(0, 100));
    
    const parts = content.split('<hr>');
    const lines = parts.map(part => {
      const text = cheerio.load('<div>' + part + '</div>').text().trim();
      if (/^\[\d{2}:\d{2}\.\d{2,3}\]/.test(text)) return text;
      return null;
    }).filter(Boolean);
    console.log(lines.join('\n').substring(0, 500));
  }
}
test();
