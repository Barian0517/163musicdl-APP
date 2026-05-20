/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Search, Link as LinkIcon, FileText, Folder, Settings, Music, Play, Download, Loader2, Music2 } from 'lucide-react';
import axios from 'axios';
import { SearchResult, SongDetail } from './types';
import { SettingsModal } from './components/SettingsModal';

export default function App() {
  const [activeTab, setActiveTab] = useState<'link' | 'playlist' | 'album' | 'search'>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [currentSong, setCurrentSong] = useState<SongDetail | null>(null);

  const [showSettings, setShowSettings] = useState(false);

  const [settings, setSettings] = useState({
    nameFormat: localStorage.getItem('nameFormat') || 'title-artist',
    autoPlay: localStorage.getItem('autoPlay') === 'true'
  });

  useEffect(() => {
    const handleSettingsChange = () => {
      setSettings({
        nameFormat: localStorage.getItem('nameFormat') || 'title-artist',
        autoPlay: localStorage.getItem('autoPlay') === 'true'
      });
    };
    window.addEventListener('settings-changed', handleSettingsChange);
    return () => window.removeEventListener('settings-changed', handleSettingsChange);
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    
    setIsSearching(true);
    setCurrentSong(null);
    try {
      const { data } = await axios.get('/api/search', {
        params: { keywords: searchQuery }
      });
      setSearchResults(data.data || []);
    } catch (err) {
      console.error(err);
      alert('搜尋失敗，請重試');
    } finally {
      setIsSearching(false);
    }
  };

  const handleLinkParse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    let id = searchQuery.trim();
    const idMatch = id.match(/id=(\d+)/) || id.match(/song\/(\d+)/);
    if (idMatch) {
      id = idMatch[1];
    } else if (!/^\d+$/.test(id)) {
      alert('請輸入有效的網易雲音樂分享連結或音樂ID');
      return;
    }

    setIsLoadingDetail(true);
    setCurrentSong(null);
    setSearchResults([]);
    
    try {
      const { data } = await axios.get('/api/song', {
        params: { id }
      });
      setCurrentSong(data.data);
    } catch (err) {
      console.error(err);
      alert('解析歌曲失敗，請確認連結或ID是否正確');
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const handlePlaylistParse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    let id = searchQuery.trim();
    const idMatch = id.match(/id=(\d+)/) || id.match(/playlist\/(\d+)/);
    if (idMatch) {
      id = idMatch[1];
    } else if (!/^\d+$/.test(id)) {
      alert('請輸入有效的網易雲音樂歌單連結或ID');
      return;
    }

    setIsSearching(true);
    setCurrentSong(null);
    setSearchResults([]);
    
    try {
      const { data } = await axios.get('/api/playlist', {
        params: { id }
      });
      setSearchResults(data.data || []);
      if (!data.data || data.data.length === 0) {
          alert('未能獲取到歌單內容，可能是權限限制或為空');
      }
    } catch (err) {
      console.error(err);
      alert('解析歌單失敗，請確認連結或ID是否正確');
    } finally {
      setIsSearching(false);
    }
  };

  const [isZipping, setIsZipping] = useState(false);

  const handleDownloadZip = async (type: 'all' | 'audio' | 'lyric') => {
    if (searchResults.length === 0) return;
    setIsZipping(true);
    try {
      const response = await axios.post('/api/download-zip', {
        songs: searchResults,
        type,
        nameFormat: settings.nameFormat
      }, {
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'playlist.zip');
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert('打包下載失敗，請稍後重試');
    } finally {
      setIsZipping(false);
    }
  };

  const handleSelectSong = async (song: SearchResult) => {
    setIsLoadingDetail(true);
    setCurrentSong(null);
    try {
      const { data } = await axios.get('/api/song', {
        params: { id: song.song_id }
      });
      setCurrentSong(data.data);
    } catch (err) {
      console.error(err);
      alert('解析歌曲失敗');
    } finally {
      setIsLoadingDetail(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0b0e] text-gray-200 font-sans selection:bg-[#3885ff]/30 flex flex-col">
      {/* Header Bar */}
      <header className="flex justify-between items-center p-4 md:px-8 border-b border-white/5">
        <div className="flex items-center gap-2 text-[#e33737]">
          <Music2 size={24} />
          <span className="font-medium text-gray-200">網易雲音樂歌曲下載器</span>
        </div>
        <button 
          onClick={() => setShowSettings(true)}
          className="p-2 rounded-full hover:bg-white/10 transition-colors"
        >
          <Settings size={20} className="text-gray-400" />
        </button>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-12 md:py-20 flex flex-col items-center">
        {/* Title Area */}
        <div className="text-center mb-12 space-y-4">
          <h1 className="text-3xl md:text-5xl font-semibold tracking-tight text-white">網易雲音樂歌曲下載器</h1>
          <p className="text-gray-400 text-sm md:text-base">永久免費的網易雲音樂高品質解析</p>
        </div>

        <div className="w-full max-w-3xl mx-auto space-y-6">
            {/* Parse Methods container */}
            <div className="bg-[#121216] border border-[#2a2a2f] rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-4 text-gray-300">
                <Search size={18} />
                <span className="font-medium">選擇解析方式</span>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <TabButton 
                  icon={<LinkIcon size={20} />} 
                  label="單曲解析" 
                  active={activeTab === 'link'} 
                  onClick={() => setActiveTab('link')} 
                />
                <TabButton 
                  icon={<FileText size={20} />} 
                  label="歌單解析" 
                  active={activeTab === 'playlist'} 
                  onClick={() => setActiveTab('playlist')} 
                />
                <TabButton 
                  icon={<Folder size={20} />} 
                  label="專輯解析" 
                  active={activeTab === 'album'} 
                  onClick={() => setActiveTab('album')} 
                />
                <TabButton 
                  icon={<Search size={20} />} 
                  label="音樂搜尋" 
                  active={activeTab === 'search'} 
                  onClick={() => setActiveTab('search')} 
                />
              </div>
            </div>

            {/* Content Area based on Tab */}
            <div className="bg-[#121216] border border-[#2a2a2f] rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-6 text-gray-300">
                <Music size={18} />
                <span className="font-medium">歌曲解析</span>
              </div>

              {activeTab === 'search' && (
                <form onSubmit={handleSearch} className="space-y-4">
                  <div className="flex flex-col gap-2">
                    <label className="text-sm border-l-2 border-[#3885ff] pl-2 text-gray-400">音樂搜尋</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Search className="h-5 w-5 text-gray-500" />
                      </div>
                      <input 
                        type="text" 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="請輸入歌曲名或歌手名進行搜尋" 
                        className="bg-[#0b0b0e] border border-[#2a2a2f] focus:border-[#3885ff] focus:ring-1 focus:ring-[#3885ff] text-white rounded-lg block w-full pl-10 p-3 transition-colors outline-none"
                      />
                    </div>
                  </div>
                  
                  <button 
                    type="submit" 
                    disabled={isSearching || !searchQuery.trim()}
                    className="w-full bg-[#3885ff] hover:bg-[#2c6cd6] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium p-3 rounded-lg flex items-center justify-center gap-2 transition-colors"
                  >
                    {isSearching ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
                    {isSearching ? '搜尋中...' : '開始搜尋'}
                  </button>
                </form>
              )}

              {activeTab === 'link' && (
                <form onSubmit={handleLinkParse} className="space-y-4">
                  <div className="flex flex-col gap-2">
                    <label className="text-sm border-l-2 border-[#3885ff] pl-2 text-gray-400">單曲解析</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <LinkIcon className="h-5 w-5 text-gray-500" />
                      </div>
                      <input 
                        type="text" 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="請輸入網易雲音樂分享連結或者音樂ID" 
                        className="bg-[#0b0b0e] border border-[#2a2a2f] focus:border-[#3885ff] focus:ring-1 focus:ring-[#3885ff] text-white rounded-lg block w-full pl-10 p-3 transition-colors outline-none"
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-1 pl-1">※ 可以使用單曲ID或單曲連結</p>
                  </div>
                  
                  <button 
                    type="submit" 
                    disabled={isLoadingDetail || !searchQuery.trim()}
                    className="w-full bg-[#3885ff] hover:bg-[#2c6cd6] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium p-3 rounded-lg flex items-center justify-center gap-2 transition-colors"
                  >
                    {isLoadingDetail ? <Loader2 size={18} className="animate-spin" /> : <LinkIcon size={18} />}
                    {isLoadingDetail ? '解析中...' : '開始解析'}
                  </button>
                </form>
              )}

              {activeTab === 'playlist' && (
                <form onSubmit={handlePlaylistParse} className="space-y-4">
                  <div className="flex flex-col gap-2">
                    <label className="text-sm border-l-2 border-[#3885ff] pl-2 text-gray-400">歌單解析 (使用分享連結)</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <FileText className="h-5 w-5 text-gray-500" />
                      </div>
                      <input 
                        type="text" 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="請輸入網易雲音樂歌單分享連結或者歌單ID" 
                        className="bg-[#0b0b0e] border border-[#2a2a2f] focus:border-[#3885ff] focus:ring-1 focus:ring-[#3885ff] text-white rounded-lg block w-full pl-10 p-3 transition-colors outline-none"
                      />
                    </div>
                    <p className="text-xs text-yellow-500/80 mt-1 pl-1">※ 由於本站無須登入無須cookie，因此最多檢索前十首</p>
                  </div>
                  
                  <button 
                    type="submit" 
                    disabled={isSearching || !searchQuery.trim()}
                    className="w-full bg-[#3885ff] hover:bg-[#2c6cd6] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium p-3 rounded-lg flex items-center justify-center gap-2 transition-colors"
                  >
                    {isSearching ? <Loader2 size={18} className="animate-spin" /> : <FileText size={18} />}
                    {isSearching ? '解析中...' : '開始解析'}
                  </button>
                </form>
              )}

              {activeTab !== 'search' && activeTab !== 'link' && activeTab !== 'playlist' && (
                <div className="text-center py-10 text-gray-500">
                  當前演示僅實現 [音樂搜尋]、[單曲解析] 與 [歌單解析] 邏輯
                </div>
              )}
            </div>

            {/* Results */}
            {(searchResults.length > 0 && !currentSong && !isLoadingDetail) && (
              <div className="bg-[#121216] border border-[#2a2a2f] rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-medium text-gray-300">搜尋結果 ({searchResults.length})</h3>
                  {activeTab === 'playlist' && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button 
                        onClick={() => handleDownloadZip('audio')}
                        disabled={isZipping}
                        className="text-xs sm:text-sm bg-[#3885ff] hover:bg-[#2c6cd6] disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors"
                      >
                        {isZipping ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} 打包音頻
                      </button>
                      <button 
                        onClick={() => handleDownloadZip('lyric')}
                        disabled={isZipping}
                        className="text-xs sm:text-sm bg-[#1e1e23] border border-[#2a2a2f] hover:bg-[#2a2a2f] disabled:opacity-50 disabled:cursor-not-allowed text-gray-300 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors"
                      >
                        {isZipping ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} 打包歌詞
                      </button>
                      <button 
                        onClick={() => handleDownloadZip('all')}
                        disabled={isZipping}
                        className="text-xs sm:text-sm bg-[#1e1e23] border border-[#2a2a2f] hover:bg-[#2a2a2f] disabled:opacity-50 disabled:cursor-not-allowed text-gray-300 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors"
                      >
                        {isZipping ? <Loader2 size={14} className="animate-spin" /> : <Folder size={14} />} 打包全部
                      </button>
                    </div>
                  )}
                </div>
                <div className="space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                  {searchResults.map(song => (
                    <div 
                      key={song.song_id} 
                      className="flex items-center justify-between p-3 rounded-xl border border-[#2a2a2f] hover:border-[#3885ff]/50 bg-[#1e1e23] hover:bg-[#25252b] cursor-pointer transition-colors"
                      onClick={() => handleSelectSong(song)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-[#2a2a2f] rounded flex items-center justify-center text-gray-500">
                          <Music size={20} />
                        </div>
                        <div className="font-medium text-[15px]">{song.title}</div>
                      </div>
                      <button className="px-4 py-1.5 rounded-lg bg-[#3885ff]/10 text-[#3885ff] text-sm hover:bg-[#3885ff]/20 transition-colors">
                        解析
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Detail Loading state */}
            {isLoadingDetail && (
              <div className="bg-[#121216] border border-[#2a2a2f] rounded-2xl p-12 flex flex-col items-center justify-center gap-4 text-gray-400">
                <Loader2 size={32} className="animate-spin text-[#3885ff]" />
                <p>正在努力解析中...</p>
              </div>
            )}

            {/* Current Song Preview */}
            {currentSong && (() => {
              let parsedSongName = currentSong.title;
              let parsedArtist = '';
              if (currentSong.title.includes(' - ')) {
                const parts = currentSong.title.split(' - ');
                parsedSongName = parts[0].trim();
                parsedArtist = parts[1].trim();
              }

              let downloadFilename = settings.nameFormat === 'artist-title' 
                ? (parsedArtist ? `${parsedArtist} - ${parsedSongName}` : parsedSongName)
                : (parsedArtist ? `${parsedSongName} - ${parsedArtist}` : parsedSongName);
              
              const downloadQueryParams = new URLSearchParams({
                url: currentSong.mp3_url,
                filename: downloadFilename,
                title: parsedSongName,
                artist: parsedArtist
              });
              if (currentSong.cover_url) {
                downloadQueryParams.append('coverUrl', currentSong.cover_url);
              }

              return (
              <div className="bg-[#121216] border border-[#2a2a2f] rounded-2xl p-6 overflow-hidden relative">
                <div className="flex flex-col sm:flex-row gap-6 items-center sm:items-start relative z-10">
                  <div className="w-32 h-32 rounded-xl border border-[#2a2a2f] overflow-hidden shrink-0 shadow-xl bg-[#1e1e23] flex items-center justify-center">
                    {currentSong.cover_url ? (
                      <img src={currentSong.cover_url} alt={currentSong.title} className="w-full h-full object-cover" />
                    ) : (
                      <Music size={40} className="text-gray-500" />
                    )}
                  </div>
                  
                  <div className="flex-1 w-full space-y-4">
                    <div>
                      <h3 className="text-xl md:text-2xl font-bold text-white mb-1 leading-tight">{currentSong.title}</h3>
                      <p className="text-gray-400 text-sm">網易雲單曲</p>
                    </div>
                    
                    {currentSong.mp3_url ? (
                      <div className="space-y-4">
                        <audio controls autoPlay={settings.autoPlay} src={currentSong.mp3_url} className="w-full h-10 custom-audio" />
                        <div className="flex gap-3">
                          <a 
                            href={`/api/download?${downloadQueryParams.toString()}`} 
                            download={`${downloadFilename}.mp3`}
                            className="bg-[#3885ff] hover:bg-[#2c6cd6] text-white px-5 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors"
                          >
                            <Download size={16} />
                            下載音頻
                          </a>
                          {currentSong.song_id && (
                            <a 
                              href={`/api/lyrics?id=${currentSong.song_id}&filename=${encodeURIComponent(downloadFilename)}`}
                              download={`${downloadFilename}.lrc`}
                              className="bg-[#1e1e23] border border-[#2a2a2f] hover:bg-[#2a2a2f] text-gray-300 px-5 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors"
                            >
                              <FileText size={16} />
                              下載歌詞
                            </a>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                        抱歉，無法提取該歌曲的直鏈音頻，可能是版權受限。
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
            })()}
        </div>
      </main>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}

      {/* Footer */}
      <footer className="w-full text-center py-6 text-sm text-gray-500 mt-auto">
        <p>
          <a href="https://barian.moe" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">
            幽影櫻製作
          </a>
        </p>
      </footer>
    </div>
  );
}

// UI Helpers
function TabButton({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`flex flex-col items-center justify-center p-4 rounded-xl border transition-all
        ${active ? 'border-[#3885ff] bg-[#3885ff]/10 text-[#3885ff]' : 'border-[#2a2a2f] bg-transparent text-gray-400 hover:border-gray-600'}
      `}
    >
      <div className="mb-2">{icon}</div>
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}
