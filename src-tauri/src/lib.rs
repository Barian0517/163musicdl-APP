use serde::{Deserialize, Serialize};
use scraper::{Html, Selector};
use id3::{Tag, Version, frame::Picture, frame::PictureType, TagLike};
use tauri::Emitter;
use regex::Regex;
use urlencoding::encode;
use std::fs;
use std::path::Path;
use aes::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyIvInit};
use cbc::Encryptor;
use aes::Aes128;
use base64::{Engine as _, engine::general_purpose::STANDARD};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SearchResult {
    pub title: String,
    pub song_id: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SongDetail {
    pub song_id: String,
    pub title: String,
    pub cover_url: String,
    pub mp3_url: String,
    pub lyric_query: Option<String>,
}

#[tauri::command]
async fn search_music(keywords: String) -> Result<Vec<SearchResult>, String> {
    let url = format!("https://3g.gljlw.com/music/wy/search.php?keywords={}", encode(&keywords));
    let client = reqwest::Client::new();
    let html = client.get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36")
        .header("Referer", "https://3g.gljlw.com/music/wy/")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let document = Html::parse_document(&html);
    let div_selector = Selector::parse("div.line1").unwrap();
    let a_selector = Selector::parse("a").unwrap();
    let mut results = Vec::new();

    for div in document.select(&div_selector) {
        for a in div.select(&a_selector) {
            if let Some(href) = a.value().attr("href") {
                if href.starts_with("info.php?id=") {
                    let title = a.text().collect::<Vec<_>>().join("").trim().to_string();
                    if let Some(id) = href.split("id=").nth(1) {
                        results.push(SearchResult {
                            title,
                            song_id: id.to_string(),
                        });
                    }
                }
            }
        }
    }
    Ok(results)
}

#[tauri::command]
async fn get_song_detail(id: String) -> Result<SongDetail, String> {
    let url = format!("https://3g.gljlw.com/music/wy/info.php?id={}", id);
    let client = reqwest::Client::new();
    let html = client.get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36")
        .header("Referer", "https://3g.gljlw.com/music/wy/")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let document = Html::parse_document(&html);

    // 1. Title
    let bbstitle_selector = Selector::parse(".bbstitle").unwrap();
    let title = if let Some(el) = document.select(&bbstitle_selector).next() {
        let raw = el.text().collect::<Vec<_>>().join("").trim().to_string();
        raw.strip_prefix("歌曲:").unwrap_or(&raw).trim().to_string()
    } else {
        "".to_string()
    };

    // 2. Cover URL
    let img_selector = Selector::parse("img").unwrap();
    let cover_url = if let Some(img) = document.select(&img_selector).next() {
        img.value().attr("src").unwrap_or("").to_string()
    } else {
        "".to_string()
    };

    // 3. Audio URL
    let mut mp3_url = "".to_string();
    let audio_selector = Selector::parse("audio").unwrap();
    if let Some(audio) = document.select(&audio_selector).next() {
        if let Some(src) = audio.value().attr("src") {
            mp3_url = src.to_string();
        } else {
            let source_selector = Selector::parse("source").unwrap();
            if let Some(source) = audio.select(&source_selector).next() {
                mp3_url = source.value().attr("src").unwrap_or("").to_string();
            }
        }
    }

    // Fallback link: a containing "下载地址"
    if mp3_url.is_empty() {
        let a_selector = Selector::parse("a").unwrap();
        for a in document.select(&a_selector) {
            let text = a.text().collect::<Vec<_>>().join("");
            if text.contains("下载地址") {
                if let Some(href) = a.value().attr("href") {
                    mp3_url = href.to_string();
                    break;
                }
            }
        }
    }

    // Fallback Regex for music.126.net MP3 links
    if mp3_url.is_empty() || !mp3_url.contains("music.126.net") {
        let re = Regex::new(r#"https?://[a-zA-Z0-9-]+\.music\.126\.net/[^"'<>\s]+\.mp3[^"'<>\s]*"#).unwrap();
        if let Some(mat) = re.find(&html) {
            mp3_url = mat.as_str().to_string();
        }
    }

    // 4. Lyric Link
    let mut lyric_query = "".to_string();
    let a_selector = Selector::parse("a").unwrap();
    for a in document.select(&a_selector) {
        let text = a.text().collect::<Vec<_>>().join("");
        if text.contains("查看歌词") {
            if let Some(href) = a.value().attr("href") {
                lyric_query = href.to_string();
                break;
            }
        }
    }

    Ok(SongDetail {
        song_id: id,
        title,
        cover_url,
        mp3_url,
        lyric_query: Some(lyric_query),
    })
}

#[derive(Deserialize)]
struct WeapiPlaylistResponse {
    playlist: Option<WeapiPlaylist>,
}

#[derive(Deserialize)]
struct WeapiPlaylist {
    tracks: Option<Vec<WeapiTrack>>,
}

#[derive(Deserialize)]
struct WeapiTrack {
    id: i64,
    name: String,
    ar: Vec<WeapiArtist>,
}

#[derive(Deserialize)]
struct WeapiArtist {
    name: String,
}

fn aes_encrypt(plaintext: &[u8], key: &[u8], iv: &[u8]) -> Result<String, String> {
    type Aes128CbcEnc = Encryptor<Aes128>;
    let enc = Aes128CbcEnc::new(key.into(), iv.into());
    let ct = enc.encrypt_padded_vec_mut::<Pkcs7>(plaintext);
    Ok(STANDARD.encode(&ct))
}

fn weapi_encrypt(text: &str) -> Result<(String, String), String> {
    let preset_key = b"0CoJUm6Qyw8W8jud";
    let iv = b"0102030405060708";
    
    // First AES encryption
    let enc_text = aes_encrypt(text.as_bytes(), preset_key, iv)?;
    
    // Second AES encryption (using preset_key as sec_key too)
    let params = aes_encrypt(enc_text.as_bytes(), preset_key, iv)?;
    
    // Hardcoded enc_sec_key
    let enc_sec_key = "bf50d0bcf56833b06d8d1219496a452a1d860fd58a14c0aafba3e770104ca77dc6856cb310ed3309039e6865081be4ddc2df52663373b20b70ac25b4d0c6ca466daef6b50174e93536e2d580c49e70649ad1936584899e85722eb83ceddfb4f56c1172fca5e60592d0e6ee3e8e02be1fe6e53f285b0389162d8e6ddc553857cd".to_string();
    
    Ok((params, enc_sec_key))
}

fn pkcs7_pad(data: &[u8], block_size: usize) -> Vec<u8> {
    let pad_len = block_size - (data.len() % block_size);
    let mut padded = data.to_vec();
    padded.extend(std::iter::repeat(pad_len as u8).take(pad_len));
    padded
}

fn aes_ecb_encrypt(plaintext: &[u8], key: &[u8]) -> Result<Vec<u8>, String> {
    use aes::cipher::{BlockEncrypt, KeyInit};
    let cipher = aes::Aes128::new_from_slice(key)
        .map_err(|e| format!("Invalid key length: {}", e))?;
    let padded = pkcs7_pad(plaintext, 16);
    let mut ciphertext = Vec::with_capacity(padded.len());
    
    for chunk in padded.chunks(16) {
        let mut block = aes::Block::clone_from_slice(chunk);
        cipher.encrypt_block(&mut block);
        ciphertext.extend_from_slice(&block);
    }
    
    Ok(ciphertext)
}

fn eapi_encrypt(url: &str, payload: &serde_json::Value) -> Result<String, String> {
    let url_parsed = reqwest::Url::parse(url).map_err(|e| e.to_string())?;
    let url_path = url_parsed.path().replace("/eapi/", "/api/");
    let payload_str = payload.to_string();
    
    let digest_input = format!("nobody{}use{}md5forencrypt", url_path, payload_str);
    let digest = format!("{:x}", md5::compute(digest_input.as_bytes()));
    
    let params_str = format!("{}-36cd479b6b5-{}-36cd479b6b5-{}", url_path, payload_str, digest);
    let key = b"e82ckenh8dichen8";
    let encrypted_bytes = aes_ecb_encrypt(params_str.as_bytes(), key)?;
    
    let hex_str = encrypted_bytes.iter().map(|b| format!("{:02x}", b)).collect::<String>();
    Ok(hex_str)
}

#[derive(Deserialize)]
struct UnikeyResponse {
    code: i32,
    unikey: Option<String>,
}

#[tauri::command]
async fn generate_qr_login() -> Result<String, String> {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis();
    let request_id = format!("{}", now % 10000000 + 20000000);
    
    let config = serde_json::json!({
        "os": "pc",
        "appver": "",
        "osver": "",
        "deviceId": "pyncm!",
        "requestId": request_id
    });
    
    let payload = serde_json::json!({
        "type": 1,
        "header": config.to_string()
    });
    
    let params = eapi_encrypt("https://interface3.music.163.com/eapi/login/qrcode/unikey", &payload)?;
    
    let client = reqwest::Client::new();
    let res = client.post("https://interface3.music.163.com/eapi/login/qrcode/unikey")
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/2.10.2.200154")
        .header("Referer", "https://music.163.com/")
        .header("Cookie", "os=pc; appver=; osver=; deviceId=pyncm!")
        .form(&[("params", &params)])
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
        
    let res_text = res.text().await.map_err(|e| format!("Failed to read response body: {}", e))?;
    let result: UnikeyResponse = serde_json::from_str(&res_text)
        .map_err(|e| format!("Failed to parse response JSON: {} - Raw: {}", e, res_text))?;
        
    if result.code == 200 {
        if let Some(unikey) = result.unikey {
            return Ok(unikey);
        }
    }
    
    Err("Failed to generate QR unikey from NetEase API".to_string())
}

#[derive(Serialize)]
struct QrStatusResult {
    code: i32,
    cookie: Option<String>,
}

#[derive(Deserialize)]
struct QrLoginResponse {
    code: i32,
}

#[tauri::command]
async fn check_qr_login(unikey: String) -> Result<QrStatusResult, String> {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis();
    let request_id = format!("{}", now % 10000000 + 20000000);
    
    let config = serde_json::json!({
        "os": "pc",
        "appver": "",
        "osver": "",
        "deviceId": "pyncm!",
        "requestId": request_id
    });
    
    let payload = serde_json::json!({
        "key": unikey,
        "type": 1,
        "header": config.to_string()
    });
    
    let params = eapi_encrypt("https://interface3.music.163.com/eapi/login/qrcode/client/login", &payload)?;
    
    let client = reqwest::Client::new();
    let res = client.post("https://interface3.music.163.com/eapi/login/qrcode/client/login")
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/2.10.2.200154")
        .header("Referer", "https://music.163.com/")
        .header("Cookie", "os=pc; appver=; osver=; deviceId=pyncm!")
        .form(&[("params", &params)])
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
        
    let mut music_u = None;
    for cookie_val in res.headers().get_all("set-cookie") {
        if let Ok(cookie_str) = cookie_val.to_str() {
            if let Some(pos) = cookie_str.find("MUSIC_U=") {
                let start = pos + 8;
                let end = cookie_str[start..].find(';').map(|i| start + i).unwrap_or(cookie_str.len());
                music_u = Some(cookie_str[start..end].to_string());
                break;
            }
        }
    }
    
    let res_text = res.text().await.map_err(|e| format!("Failed to read response body: {}", e))?;
    let result: QrLoginResponse = serde_json::from_str(&res_text)
        .map_err(|e| format!("Failed to parse response JSON: {} - Raw: {}", e, res_text))?;
        
    let cookie = if result.code == 803 {
        if let Some(music_u_val) = music_u {
            Some(format!("MUSIC_U={}; os=pc; appver=8.9.70;", music_u_val))
        } else {
            None
        }
    } else {
        None
    };
    
    Ok(QrStatusResult {
        code: result.code,
        cookie,
    })
}

#[tauri::command]
async fn get_playlist(id: String, cookie: String) -> Result<Vec<SearchResult>, String> {
    if !cookie.trim().is_empty() {
        let payload = serde_json::json!({
            "id": id,
            "n": 10000,
            "s": 8
        });
        
        let payload_str = payload.to_string();
        let (params, enc_sec_key) = weapi_encrypt(&payload_str)?;
        
        let client = reqwest::Client::new();
        let res = client.post("https://music.163.com/weapi/v6/playlist/detail?csrf_token=")
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .header("Referer", "https://music.163.com/")
            .header("Cookie", &cookie)
            .form(&[
                ("params", &params),
                ("encSecKey", &enc_sec_key)
            ])
            .send()
            .await
            .map_err(|e| format!("Failed to send Weapi request: {}", e))?;
            
        let res_text = res.text().await.map_err(|e| format!("Failed to read response body: {}", e))?;
        
        let api_res: WeapiPlaylistResponse = serde_json::from_str(&res_text)
            .map_err(|e| format!("Failed to parse Weapi response JSON: {} - Raw: {}", e, res_text))?;
            
        let mut results = Vec::new();
        if let Some(playlist) = api_res.playlist {
            if let Some(tracks) = playlist.tracks {
                for track in tracks {
                    let artists_str = track.ar.iter()
                        .map(|artist| artist.name.as_str())
                        .collect::<Vec<_>>()
                        .join("/");
                    let title = if artists_str.is_empty() {
                        track.name
                    } else {
                        format!("{} - {}", track.name, artists_str)
                    };
                    results.push(SearchResult {
                        title,
                        song_id: track.id.to_string(),
                    });
                }
            }
        }
        
        return Ok(results);
    }

    let url = format!("https://music.163.com/playlist?id={}", id);
    let client = reqwest::Client::new();
    let html = client.get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let document = Html::parse_document(&html);
    let li_selector = Selector::parse("ul.f-hide li a").unwrap();
    let re = Regex::new(r#"/song\?id=(\d+)"#).unwrap();
    let mut results = Vec::new();

    for a in document.select(&li_selector) {
        let title = a.text().collect::<Vec<_>>().join("").trim().to_string();
        if let Some(href) = a.value().attr("href") {
            if let Some(caps) = re.captures(href) {
                if let Some(song_id) = caps.get(1) {
                    results.push(SearchResult {
                        title,
                        song_id: song_id.as_str().to_string(),
                    });
                }
            }
        }
    }

    if results.len() > 10 {
        results.truncate(10);
    }

    Ok(results)
}

#[tauri::command]
async fn get_lyrics(id: String) -> Result<String, String> {
    let song_detail = get_song_detail(id.clone()).await?;
    let lyric_query = song_detail.lyric_query.unwrap_or_default();
    if lyric_query.is_empty() {
        return Ok("[00:00.000] 暫無歌詞\n".to_string());
    }

    let url = format!("https://3g.gljlw.com/music/wy/{}", lyric_query);
    let client = reqwest::Client::new();
    let html = client.get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .header("Referer", &format!("https://3g.gljlw.com/music/wy/info.php?id={}", id))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let document = Html::parse_document(&html);
    let content_selector = Selector::parse(".content").unwrap();
    
    let mut lrc_content = "".to_string();
    if let Some(content) = document.select(&content_selector).next() {
        let html_str = content.html();
        let parts: Vec<&str> = html_str.split("<hr>").collect();
        let re_lrc = Regex::new(r#"^\[\d{2}:\d{2}\.\d{2,3}\]"#).unwrap();
        
        let mut lines = Vec::new();
        for part in parts {
            let part_doc = Html::parse_fragment(part);
            let text = part_doc.root_element().text().collect::<Vec<_>>().join("").trim().to_string();
            if re_lrc.is_match(&text) {
                lines.push(text);
            }
        }
        lrc_content = lines.join("\n");
    }

    if lrc_content.is_empty() {
        lrc_content = "[00:00.000] 暫無歌詞\n".to_string();
    }

    Ok(lrc_content)
}

#[tauri::command]
fn select_download_directory() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
async fn download_song(
    window: tauri::Window,
    task_id: String,
    url: String,
    filename: String,
    title: String,
    artist: String,
    cover_url: String,
    download_dir: String,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    
    // We emit an event when starting
    let _ = window.emit("download-progress", serde_json::json!({
        "taskId": task_id,
        "progress": 0,
        "status": "downloading"
    }));

    // 1. Download MP3
    let mut mp3_res = client.get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .send()
        .await
        .map_err(|e| format!("Failed to download MP3: {}", e))?;
    
    let total_size = mp3_res.content_length().unwrap_or(0);
    let mut mp3_bytes = Vec::new();
    if total_size > 0 {
        mp3_bytes.reserve(total_size as usize);
    }

    let mut downloaded = 0u64;
    let mut last_emitted_progress = 0u32;

    while let Some(chunk) = mp3_res.chunk().await.map_err(|e| format!("Error reading body chunk: {}", e))? {
        mp3_bytes.extend_from_slice(&chunk);
        downloaded += chunk.len() as u64;
        
        if total_size > 0 {
            let percentage = (downloaded as f64 / total_size as f64 * 100.0) as u32;
            if percentage > last_emitted_progress {
                last_emitted_progress = percentage;
                let progress_val = std::cmp::min(percentage, 99);
                let _ = window.emit("download-progress", serde_json::json!({
                    "taskId": task_id,
                    "progress": progress_val,
                    "status": "downloading"
                }));
            }
        }
    }

    // 2. Download Cover (if any)
    let mut cover_bytes: Option<Vec<u8>> = None;
    if !cover_url.is_empty() {
        if let Ok(cover_res) = client.get(&cover_url).header("User-Agent", "Mozilla/5.0").send().await {
            if let Ok(bytes) = cover_res.bytes().await {
                cover_bytes = Some(bytes.to_vec());
            }
        }
    }

    // 3. Write file
    let safe_filename = filename.replace(|c: char| "/\\?%*:|\"<>".contains(c), "-");
    let path = Path::new(&download_dir).join(format!("{}.mp3", safe_filename));

    fs::write(&path, &mp3_bytes)
        .map_err(|e| format!("Failed to write MP3 file: {}", e))?;

    // 4. Write ID3 Tags
    let mut tag = Tag::read_from_path(&path).unwrap_or_else(|_| Tag::new());
    tag.set_title(title);
    tag.set_artist(artist);
    if let Some(cb) = cover_bytes {
        let mime = if cover_url.ends_with(".png") { "image/png" } else { "image/jpeg" };
        tag.add_frame(Picture {
            mime_type: mime.to_string(),
            picture_type: PictureType::CoverFront,
            description: "Cover".to_string(),
            data: cb,
        });
    }
    let _ = tag.write_to_path(&path, Version::Id3v24);

    let _ = window.emit("download-progress", serde_json::json!({
        "taskId": task_id,
        "progress": 100,
        "status": "completed"
    }));

    Ok(())
}

#[tauri::command]
async fn download_lyrics(
    window: tauri::Window,
    task_id: String,
    id: String,
    filename: String,
    download_dir: String,
) -> Result<(), String> {
    let _ = window.emit("download-progress", serde_json::json!({
        "taskId": task_id,
        "progress": 0,
        "status": "downloading"
    }));

    let lrc_content = get_lyrics(id).await?;
    let safe_filename = filename.replace(|c: char| "/\\?%*:|\"<>".contains(c), "-");
    let path = Path::new(&download_dir).join(format!("{}.lrc", safe_filename));
    fs::write(&path, lrc_content.as_bytes())
        .map_err(|e| format!("Failed to write lyrics: {}", e))?;

    let _ = window.emit("download-progress", serde_json::json!({
        "taskId": task_id,
        "progress": 100,
        "status": "completed"
    }));
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            search_music,
            get_song_detail,
            get_playlist,
            get_lyrics,
            select_download_directory,
            download_song,
            download_lyrics,
            generate_qr_login,
            check_qr_login
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
