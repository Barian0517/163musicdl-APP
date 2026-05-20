import { X, Monitor, Sun, Moon } from 'lucide-react';
import React, { useState, useEffect } from 'react';

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system');
  const [nameFormat, setNameFormat] = useState<'title-artist' | 'artist-title'>(
    (localStorage.getItem('nameFormat') as 'title-artist' | 'artist-title') || 'title-artist'
  );
  const [autoPlay, setAutoPlay] = useState(localStorage.getItem('autoPlay') === 'true');

  useEffect(() => {
    localStorage.setItem('nameFormat', nameFormat);
    window.dispatchEvent(new Event('settings-changed'));
  }, [nameFormat]);

  useEffect(() => {
    localStorage.setItem('autoPlay', autoPlay.toString());
    window.dispatchEvent(new Event('settings-changed'));
  }, [autoPlay]);

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

              <SwitchRow 
                title="獲取後自動播放" 
                subtitle="獲取資源後自動播放音樂" 
                checked={autoPlay} 
                onChange={setAutoPlay} 
              />
            </div>
          </section>
        </div>
      </div>
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

