import crypto from 'crypto';

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

console.log("Weapi test:", weapiEncrypt('{"id":"123"}'));
console.log("Eapi test:", eapiEncrypt('https://interface3.music.163.com/eapi/login/qrcode/unikey', { type: 1 }));
