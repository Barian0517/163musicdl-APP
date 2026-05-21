import { X, Monitor, Sun, Moon, Folder } from 'lucide-react';
import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

const isTauri = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system');
  const [nameFormat, setNameFormat] = useState<'title-artist' | 'artist-title'>(
    (localStorage.getItem('nameFormat') as 'title-artist' | 'artist-title') || 'title-artist'
  );
  const [autoPlay, setAutoPlay] = useState(localStorage.getItem('autoPlay') === 'true');
  const [downloadPath, setDownloadPath] = useState(localStorage.getItem('downloadPath') || '');
  const [cookie, setCookie] = useState(localStorage.getItem('neteaseCookie') || '');

  const selectDirectory = async () => {
    try {
      const selected = await invoke<string | null>('select_download_directory');
      if (selected) {
        setDownloadPath(selected);
        localStorage.setItem('downloadPath', selected);
        window.dispatchEvent(new Event('settings-changed'));
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    localStorage.setItem('nameFormat', nameFormat);
    window.dispatchEvent(new Event('settings-changed'));
  }, [nameFormat]);

  useEffect(() => {
    localStorage.setItem('autoPlay', autoPlay.toString());
    window.dispatchEvent(new Event('settings-changed'));
  }, [autoPlay]);

  useEffect(() => {
    localStorage.setItem('neteaseCookie', cookie);
    window.dispatchEvent(new Event('settings-changed'));
  }, [cookie]);

  const [showQrModal, setShowQrModal] = useState(false);
  const [qrUnikey, setQrUnikey] = useState<string | null>(null);
  const [qrStatusText, setQrStatusText] = useState('正在初始化...');
  const [qrLoading, setQrLoading] = useState(false);

  const startQrLogin = async () => {
    setQrLoading(true);
    setShowQrModal(true);
    setQrUnikey(null);
    setQrStatusText('正在獲取二維碼...');
    try {
      const unikey = await invoke<string>('generate_qr_login');
      setQrUnikey(unikey);
      setQrStatusText('請使用網易雲音樂 App 掃描二維碼');
      setQrLoading(false);
    } catch (err) {
      console.error(err);
      setQrStatusText('獲取二維碼失敗: ' + err);
      setQrLoading(false);
    }
  };

  useEffect(() => {
    if (!showQrModal || !qrUnikey) return;

    let timer: number;
    let isMounted = true;

    const checkStatus = async () => {
      try {
        const result = await invoke<{ code: number; cookie: string | null }>('check_qr_login', { unikey: qrUnikey });
        if (!isMounted) return;

        if (result.code === 800) {
          setQrStatusText('二維碼已過期，請重新整理');
        } else if (result.code === 801) {
          setQrStatusText('等待掃碼...');
          timer = window.setTimeout(checkStatus, 2000);
        } else if (result.code === 802) {
          setQrStatusText('已掃描，請在手機上確認登入...');
          timer = window.setTimeout(checkStatus, 2000);
        } else if (result.code === 803) {
          setQrStatusText('登入成功！');
          if (result.cookie) {
            setCookie(result.cookie);
          }
          timer = window.setTimeout(() => {
            if (isMounted) setShowQrModal(false);
          }, 1500);
        } else {
          setQrStatusText(`狀態碼: ${result.code}`);
          timer = window.setTimeout(checkStatus, 2000);
        }
      } catch (err) {
        console.error(err);
        if (isMounted) {
          setQrStatusText('檢查狀態時發生錯誤');
          timer = window.setTimeout(checkStatus, 2000);
        }
      }
    };

    timer = window.setTimeout(checkStatus, 2000);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [showQrModal, qrUnikey]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#18181c] border border-[#2a2a2f] rounded-2xl w-full max-w-md overflow-hidden text-gray-200 flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-5 border-b border-[#2a2a2f]">
          <h2 className="text-xl font-medium tracking-tight">網站設置</h2>
          <button onClick={onClose} className="p-2 -mr-2 rounded-lg hover:bg-white/5 text-gray-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>
        
        <div className="p-5 overflow-y-auto space-y-8 custom-scrollbar">
          {/* Theme */}
          <section className="space-y-4">
            <h3 className="text-[15px] text-gray-400 font-medium">主題外觀</h3>
            <div className="grid grid-cols-3 gap-3">
              <button 
                onClick={() => setTheme('system')}
                className={`flex flex-col items-center justify-center py-4 rounded-xl border ${theme === 'system' ? 'border-[#3885ff] bg-[#3885ff]/10 text-white' : 'border-[#2a2a2f] bg-[#1e1e23] hover:border-gray-500 text-gray-400'} transition-all`}
              >
                <Monitor size={24} className="mb-2" />
                <span className="text-sm">跟隨系統</span>
                <span className="text-[10px] opacity-60">自動適配</span>
              </button>
              <button 
                onClick={() => setTheme('light')}
                className={`flex flex-col items-center justify-center py-4 rounded-xl border ${theme === 'light' ? 'border-[#3885ff] bg-[#3885ff]/10 text-white' : 'border-[#2a2a2f] bg-[#1e1e23] hover:border-gray-500 text-gray-400'} transition-all`}
              >
                <Sun size={24} className="mb-2" />
                <span className="text-sm">淺色模式</span>
                <span className="text-[10px] opacity-60">明亮界面</span>
              </button>
              <button 
                onClick={() => setTheme('dark')}
                className={`flex flex-col items-center justify-center py-4 rounded-xl border ${theme === 'dark' ? 'border-[#3885ff] bg-[#3885ff]/10 text-white' : 'border-[#2a2a2f] bg-[#1e1e23] hover:border-gray-500 text-gray-400'} transition-all`}
              >
                <Moon size={24} className="mb-2" />
                <span className="text-sm">深色模式</span>
                <span className="text-[10px] opacity-60">護眼界面</span>
              </button>
            </div>
          </section>

          {/* Download Config */}
          <section className="space-y-4">
            <h3 className="text-[15px] text-gray-400 font-medium">下載配置</h3>
            
            <div className="space-y-3">
              <p className="text-sm text-gray-400 mb-2">檔案命名格式</p>
              
              <label className="flex items-center justify-between p-4 rounded-xl border border-[#2a2a2f] bg-[#1e1e23] cursor-pointer">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[15px]">歌曲名 - 歌手名</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#3885ff]/20 text-[#3885ff]">默認</span>
                  </div>
                  <div className="text-xs text-gray-500">夜曲 - 周杰倫</div>
                </div>
                <input 
                  type="radio" 
                  name="nameFormat" 
                  checked={nameFormat === 'title-artist'}
                  onChange={() => setNameFormat('title-artist')}
                  className="w-5 h-5 accent-[#3885ff] bg-[#2a2a2f] border-none" 
                />
              </label>

              <label className="flex items-center justify-between p-4 rounded-xl border border-[#2a2a2f] bg-[#1e1e23] cursor-pointer">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[15px]">歌手名 - 歌曲名</span>
                  </div>
                  <div className="text-xs text-gray-500">周杰倫 - 夜曲</div>
                </div>
                <input 
                  type="radio" 
                  name="nameFormat" 
                  checked={nameFormat === 'artist-title'}
                  onChange={() => setNameFormat('artist-title')}
                  className="w-5 h-5 accent-[#3885ff] bg-[#2a2a2f] border-none" 
                />
              </label>

              {isTauri && (
                <div className="flex items-center justify-between p-4 rounded-xl border border-[#2a2a2f] bg-[#1e1e23]">
                  <div className="flex-1 min-w-0 mr-4">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[15px]">預設下載目錄</span>
                    </div>
                    <div className="text-xs text-gray-500 truncate" title={downloadPath || '下載時將提示選擇'}>
                      {downloadPath || '未設定，下載時將提示選擇'}
                    </div>
                  </div>
                  <button 
                    onClick={selectDirectory}
                    className="p-2 rounded-lg bg-[#3885ff]/10 text-[#3885ff] hover:bg-[#3885ff]/20 transition-colors flex items-center gap-1.5 text-xs font-medium shrink-0"
                  >
                    <Folder size={14} />
                    選擇目錄
                  </button>
                </div>
              )}

              <SwitchRow 
                title="獲取後自動播放" 
                subtitle="獲取資源後自動播放音樂" 
                checked={autoPlay} 
                onChange={setAutoPlay} 
              />
            </div>
          </section>

          {/* Cookie Config */}
          <section className="space-y-4 pt-4 border-t border-[#2a2a2f]">
            <h3 className="text-[15px] text-gray-400 font-medium">網易雲 Cookie 配置</h3>
            
            <div className="space-y-3">
              <div className="p-4 rounded-xl border border-[#2a2a2f] bg-[#1e1e23] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[15px]">使用者 Cookie</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#3885ff]/20 text-[#3885ff]">用於完整解析歌單</span>
                </div>
                <textarea 
                  value={cookie}
                  onChange={(e) => setCookie(e.target.value)}
                  placeholder="請在此貼入網易雲音樂的 Cookie (如 MUSIC_U=xxxx; ...)"
                  className="w-full h-20 text-xs bg-[#121214] border border-[#2a2a2f] rounded-lg p-2 text-gray-300 focus:outline-none focus:border-[#3885ff] resize-none mb-2"
                />
                {isTauri && (
                  <button
                    onClick={startQrLogin}
                    className="w-full py-2 bg-[#3885ff]/10 hover:bg-[#3885ff]/20 text-[#3885ff] text-xs font-medium rounded-xl border border-[#3885ff]/30 transition-all duration-200 cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <span>使用掃碼登入獲取 Cookie</span>
                  </button>
                )}
                <p className="text-[10px] text-gray-500">
                  貼入 Cookie 後，解析歌單時將使用「方案 B（官方 Weapi）」以獲取歌單中全部的歌曲列表（非 10 首限制）。
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>

      {showQrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4">
          <div className="bg-[#18181c] border border-[#2a2a2f] rounded-2xl w-full max-w-sm overflow-hidden text-gray-200 p-6 flex flex-col items-center space-y-5 relative shadow-2xl">
            <button 
              onClick={() => setShowQrModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
            >
              <X size={20} />
            </button>

            <h4 className="text-base font-semibold">網易雲音樂 掃碼登入</h4>

            <div className="relative w-48 h-48 bg-white rounded-xl flex items-center justify-center p-2 shadow-inner">
              {qrLoading ? (
                <div className="flex flex-col items-center space-y-2">
                  <div className="w-8 h-8 border-2 border-[#3885ff] border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-xs text-gray-500">加載中...</span>
                </div>
              ) : qrUnikey ? (
                <img 
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`https://music.163.com/login?codekey=${qrUnikey}`)}`}
                  alt="QR Code"
                  className="w-full h-full object-contain"
                />
              ) : (
                <span className="text-xs text-gray-400">無法載入二維碼</span>
              )}
            </div>

            <div className="text-center space-y-1">
              <p className="text-sm text-gray-300 font-medium">{qrStatusText}</p>
              <p className="text-[10px] text-gray-500">請使用網易雲音樂 App 掃描二維碼進行登入</p>
            </div>

            {!qrLoading && qrStatusText.includes('已過期') && (
              <button 
                onClick={startQrLogin}
                className="w-full py-2 bg-[#3885ff] hover:bg-[#2d74e5] text-white text-xs font-medium rounded-xl transition-all duration-200 cursor-pointer shadow-lg shadow-[#3885ff]/20"
              >
                重新產生二維碼
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SwitchRow({ title, subtitle, checked, onChange, badge, badgeColor }: { title: string, subtitle: string, checked: boolean, onChange: (c: boolean) => void, badge?: string, badgeColor?: string }) {
  return (
    <div className="flex items-center justify-between p-4 rounded-xl border border-[#2a2a2f] bg-[#1e1e23]">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[15px]">{title}</span>
          {badge && <span className={`text-[10px] px-1.5 py-0.5 rounded ${badgeColor}`}>{badge}</span>}
        </div>
        <div className="text-xs text-gray-500">{subtitle}</div>
      </div>
      <button 
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${checked ? 'bg-[#3885ff]' : 'bg-gray-600'}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  );
}

