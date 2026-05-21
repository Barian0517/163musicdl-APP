/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Search, Link as LinkIcon, FileText, Folder, Settings, Music, Play, Download, Loader2, Music2, RotateCcw, X, ChevronDown, ChevronUp, CheckCircle2 } from 'lucide-react';
import axios from 'axios';
import { SearchResult, SongDetail } from './types';
import { SettingsModal } from './components/SettingsModal';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const isTauri = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;

interface DownloadTask {
  id: string;
  songId: string;
  title: string;
  filename: string;
  type: 'audio' | 'lyric';
  status: 'pending' | 'downloading' | 'completed' | 'failed';
  progress: number;
  errorMsg?: string;
  retryPayload: {
    songId: string;
    url: string;
    filename: string;
    title: string;
    artist: string;
    coverUrl: string;
    type: string;
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'link' | 'playlist' | 'album' | 'search'>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [currentSong, setCurrentSong] = useState<SongDetail | null>(null);

  const [showSettings, setShowSettings] = useState(false);

  const [downloadQueue, setDownloadQueue] = useState<DownloadTask[]>([]);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [isQueueMinimized, setIsQueueMinimized] = useState(false);

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

  // --- 下載佇列 Worker 與控制邏輯 ---
  const startTaskDownload = async (task: DownloadTask) => {
    setDownloadQueue(prev => prev.map(t => t.id === task.id ? { ...t, status: 'downloading', progress: 0 } : t));

    try {
      const { retryPayload } = task;
      if (isTauri) {
        let downloadDir = localStorage.getItem('downloadPath');
        if (!downloadDir) {
          const selected = await invoke<string | null>('select_download_directory');
          if (!selected) {
            throw new Error('未選擇下載路徑');
          }
          downloadDir = selected;
          localStorage.setItem('downloadPath', selected);
          window.dispatchEvent(new Event('settings-changed'));
        }

        if (task.type === 'audio') {
          await invoke('download_song', {
            taskId: task.id,
            url: retryPayload.url,
            filename: retryPayload.filename,
            title: retryPayload.title,
            artist: retryPayload.artist,
            coverUrl: retryPayload.coverUrl,
            downloadDir
          });
        } else {
          await invoke('download_lyrics', {
            taskId: task.id,
            id: retryPayload.songId,
            filename: retryPayload.filename,
            downloadDir
          });
        }
      } else {
        // Web 模式下載
        if (task.songId === 'zip') {
          const response = await axios.post('/api/download-zip', {
            songs: searchResults,
            type: retryPayload.type,
            nameFormat: settings.nameFormat
          }, {
            responseType: 'blob',
            onDownloadProgress: (progressEvent) => {
              if (progressEvent.total) {
                const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                setDownloadQueue(prev => prev.map(t => t.id === task.id ? { ...t, progress: Math.min(percent, 99) } : t));
              }
            }
          });
          
          const url = window.URL.createObjectURL(new Blob([response.data]));
          const link = document.createElement('a');
          link.href = url;
          link.setAttribute('download', `${task.filename}.zip`);
          document.body.appendChild(link);
          link.click();
          link.parentNode?.removeChild(link);
          window.URL.revokeObjectURL(url);
        } else if (task.type === 'audio') {
          const downloadQueryParams = new URLSearchParams({
            url: retryPayload.url,
            filename: retryPayload.filename,
            title: retryPayload.title,
            artist: retryPayload.artist
          });
          if (retryPayload.coverUrl) {
            downloadQueryParams.append('coverUrl', retryPayload.coverUrl);
          }

          const response = await axios.get(`/api/download?${downloadQueryParams.toString()}`, {
            responseType: 'blob',
            onDownloadProgress: (progressEvent) => {
              if (progressEvent.total) {
                const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                setDownloadQueue(prev => prev.map(t => t.id === task.id ? { ...t, progress: Math.min(percent, 99) } : t));
              }
            }
          });

          const url = window.URL.createObjectURL(new Blob([response.data]));
          const link = document.createElement('a');
          link.href = url;
          link.setAttribute('download', `${retryPayload.filename}.mp3`);
          document.body.appendChild(link);
          link.click();
          link.parentNode?.removeChild(link);
          window.URL.revokeObjectURL(url);
        } else {
          const response = await axios.get(`/api/lyrics`, {
            params: {
              id: retryPayload.songId,
              filename: retryPayload.filename
            },
            responseType: 'blob',
            onDownloadProgress: (progressEvent) => {
              if (progressEvent.total) {
                const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                setDownloadQueue(prev => prev.map(t => t.id === task.id ? { ...t, progress: Math.min(percent, 99) } : t));
              }
            }
          });

          const url = window.URL.createObjectURL(new Blob([response.data]));
          const link = document.createElement('a');
          link.href = url;
          link.setAttribute('download', `${retryPayload.filename}.lrc`);
          document.body.appendChild(link);
          link.click();
          link.parentNode?.removeChild(link);
          window.URL.revokeObjectURL(url);
        }

        // Web 模式下載後標記完成
        setDownloadQueue(prev => prev.map(t => t.id === task.id ? { ...t, status: 'completed', progress: 100 } : t));
      }
    } catch (err: any) {
      console.error(err);
      setDownloadQueue(prev => prev.map(t => t.id === task.id ? { ...t, status: 'failed', errorMsg: err.message || String(err) } : t));
    }
  };

  // 監聽佇列，執行併發限制為 3 的下載
  useEffect(() => {
    const activeDownloads = downloadQueue.filter(t => t.status === 'downloading');
    if (activeDownloads.length >= 3) return;

    const nextTask = downloadQueue.find(t => t.status === 'pending');
    if (!nextTask) return;

    startTaskDownload(nextTask);
  }, [downloadQueue]);

  // 監聽 Tauri 事件回傳的進度
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    
    const setupListener = async () => {
      unlisten = await listen<{ taskId: string; progress: number; status: string }>('download-progress', (event) => {
        const { taskId, progress, status } = event.payload;
        setDownloadQueue(prev => prev.map(t => {
          if (t.id === taskId) {
            return {
              ...t,
              progress: progress,
              status: status as any
            };
          }
          return t;
        }));
      });
    };

    if (isTauri) {
      setupListener();
    }

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  const handleRetryTask = (taskId: string) => {
    setDownloadQueue(prev => prev.map(t => t.id === taskId ? { ...t, status: 'pending', progress: 0 } : t));
  };

  const handleRetryAllFailed = () => {
    setDownloadQueue(prev => prev.map(t => t.status === 'failed' ? { ...t, status: 'pending', progress: 0 } : t));
  };

  const handleRemoveTask = (taskId: string) => {
    setDownloadQueue(prev => prev.filter(t => t.id !== taskId));
  };

  const isTaskActive = (songId: string, type: 'audio' | 'lyric') => {
    return downloadQueue.some(t => t.songId === songId && t.type === type && (t.status === 'downloading' || t.status === 'pending'));
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    
    setIsSearching(true);
    setCurrentSong(null);
    try {
      if (isTauri) {
        const results = await invoke<SearchResult[]>('search_music', { keywords: searchQuery });
        setSearchResults(results);
      } else {
        const { data } = await axios.get('/api/search', {
          params: { keywords: searchQuery }
        });
        setSearchResults(data.data || []);
      }
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
      if (isTauri) {
        const detail = await invoke<SongDetail>('get_song_detail', { id });
        setCurrentSong(detail);
      } else {
        const { data } = await axios.get('/api/song', {
          params: { id }
        });
        setCurrentSong(data.data);
      }
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
      if (isTauri) {
        const neteaseCookie = localStorage.getItem('neteaseCookie') || '';
        const results = await invoke<SearchResult[]>('get_playlist', { id, cookie: neteaseCookie });
        setSearchResults(results);
        if (results.length === 0) {
          alert('未能獲取到歌單內容，可能是權限限制或為空');
        }
      } else {
        const { data } = await axios.get('/api/playlist', {
          params: { id }
        });
        setSearchResults(data.data || []);
        if (!data.data || data.data.length === 0) {
            alert('未能獲取到歌單內容，可能是權限限制或為空');
        }
      }
    } catch (err) {
      console.error(err);
      alert('解析歌單失敗，請確認連結或ID是否正確');
    } finally {
      setIsSearching(false);
    }
  };

  const isDownloading = downloadQueue.some(t => t.status === 'downloading' || t.status === 'pending');
  const isZipping = downloadQueue.some(t => t.status === 'downloading' && t.songId === 'zip');

  const handleDownloadZip = async (type: 'all' | 'audio' | 'lyric') => {
    if (searchResults.length === 0) return;

    const taskId = `zip-batch-${Date.now()}`;
    const newTask: DownloadTask = {
      id: taskId,
      songId: 'zip',
      title: `打包歌單_${type === 'all' ? '全部' : type === 'audio' ? '音頻' : '歌詞'}.zip`,
      filename: `打包歌單_${type === 'all' ? '全部' : type === 'audio' ? '音頻' : '歌詞'}`,
      type: 'audio',
      status: 'pending',
      progress: 0,
      retryPayload: {
        songId: 'zip',
        url: '',
        filename: `打包歌單_${type === 'all' ? '全部' : type === 'audio' ? '音頻' : '歌詞'}`,
        title: '',
        artist: '',
        coverUrl: '',
        type
      }
    };

    setDownloadQueue(prev => [...prev, newTask]);
    setIsQueueOpen(true);
    setIsQueueMinimized(false);
  };

  const handleWebSingleDownload = async (type: 'audio' | 'lyric') => {
    if (!currentSong) return;

    let parsedSongName = currentSong.title;
    let parsedArtist = '';
    if (currentSong.title.includes(' - ')) {
      const parts = currentSong.title.split(' - ');
      parsedSongName = parts[0].trim();
      parsedArtist = parts[1].trim();
    }

    const filename = settings.nameFormat === 'artist-title' 
      ? (parsedArtist ? `${parsedArtist} - ${parsedSongName}` : parsedSongName)
      : (parsedArtist ? `${parsedSongName} - ${parsedArtist}` : parsedSongName);

    const taskId = `${currentSong.song_id}-${type}-${Date.now()}`;
    const newTask: DownloadTask = {
      id: taskId,
      songId: currentSong.song_id,
      title: `${filename}.${type === 'audio' ? 'mp3' : 'lrc'}`,
      filename,
      type,
      status: 'pending',
      progress: 0,
      retryPayload: {
        songId: currentSong.song_id,
        url: currentSong.mp3_url,
        filename,
        title: parsedSongName,
        artist: parsedArtist,
        coverUrl: currentSong.cover_url || '',
        type
      }
    };

    setDownloadQueue(prev => [...prev, newTask]);
    setIsQueueOpen(true);
    setIsQueueMinimized(false);
  };

  const handleTauriSingleDownload = async (type: 'audio' | 'lyric') => {
    if (!currentSong) return;
    let downloadDir = localStorage.getItem('downloadPath');
    if (!downloadDir) {
      const selected = await invoke<string | null>('select_download_directory');
      if (!selected) return;
      downloadDir = selected;
      localStorage.setItem('downloadPath', selected);
      window.dispatchEvent(new Event('settings-changed'));
    }

    let parsedSongName = currentSong.title;
    let parsedArtist = '';
    if (currentSong.title.includes(' - ')) {
      const parts = currentSong.title.split(' - ');
      parsedSongName = parts[0].trim();
      parsedArtist = parts[1].trim();
    }

    const filename = settings.nameFormat === 'artist-title' 
      ? (parsedArtist ? `${parsedArtist} - ${parsedSongName}` : parsedSongName)
      : (parsedArtist ? `${parsedSongName} - ${parsedArtist}` : parsedSongName);

    const taskId = `${currentSong.song_id}-${type}-${Date.now()}`;
    const newTask: DownloadTask = {
      id: taskId,
      songId: currentSong.song_id,
      title: `${filename}.${type === 'audio' ? 'mp3' : 'lrc'}`,
      filename,
      type,
      status: 'pending',
      progress: 0,
      retryPayload: {
        songId: currentSong.song_id,
        url: currentSong.mp3_url,
        filename,
        title: parsedSongName,
        artist: parsedArtist,
        coverUrl: currentSong.cover_url || '',
        type
      }
    };

    setDownloadQueue(prev => [...prev, newTask]);
    setIsQueueOpen(true);
    setIsQueueMinimized(false);
  };

  const handleTauriBatchDownload = async (type: 'all' | 'audio' | 'lyric') => {
    if (searchResults.length === 0) return;
    let downloadDir = localStorage.getItem('downloadPath');
    if (!downloadDir) {
      const selected = await invoke<string | null>('select_download_directory');
      if (!selected) return;
      downloadDir = selected;
      localStorage.setItem('downloadPath', selected);
      window.dispatchEvent(new Event('settings-changed'));
    }

    setIsQueueOpen(true);
    setIsQueueMinimized(false);

    // 非同步在背景解析歌曲詳情並推入下載佇列
    (async () => {
      for (const song of searchResults) {
        try {
          const detail = await invoke<SongDetail>('get_song_detail', { id: song.song_id });
          let parsedSongName = detail.title;
          let parsedArtist = '';
          if (detail.title.includes(' - ')) {
            const parts = detail.title.split(' - ');
            parsedSongName = parts[0].trim();
            parsedArtist = parts[1].trim();
          }

          const filename = settings.nameFormat === 'artist-title' 
            ? (parsedArtist ? `${parsedArtist} - ${parsedSongName}` : parsedSongName)
            : (parsedArtist ? `${parsedSongName} - ${parsedArtist}` : parsedSongName);

          const newTasks: DownloadTask[] = [];

          if ((type === 'all' || type === 'audio') && detail.mp3_url) {
            newTasks.push({
              id: `${detail.song_id}-audio-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
              songId: detail.song_id,
              title: `${filename}.mp3`,
              filename,
              type: 'audio',
              status: 'pending',
              progress: 0,
              retryPayload: {
                songId: detail.song_id,
                url: detail.mp3_url,
                filename,
                title: parsedSongName,
                artist: parsedArtist,
                coverUrl: detail.cover_url || '',
                type: 'audio'
              }
            });
          }

          if (type === 'all' || type === 'lyric') {
            newTasks.push({
              id: `${detail.song_id}-lyric-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
              songId: detail.song_id,
              title: `${filename}.lrc`,
              filename,
              type: 'lyric',
              status: 'pending',
              progress: 0,
              retryPayload: {
                songId: detail.song_id,
                url: detail.mp3_url,
                filename,
                title: parsedSongName,
                artist: parsedArtist,
                coverUrl: detail.cover_url || '',
                type: 'lyric'
              }
            });
          }

          if (newTasks.length > 0) {
            setDownloadQueue(prev => [...prev, ...newTasks]);
          }
        } catch (songErr) {
          console.error(`Failed resolving ${song.title}`, songErr);
          setDownloadQueue(prev => [...prev, {
            id: `${song.song_id}-failed-${Date.now()}`,
            songId: song.song_id,
            title: `${song.title} (解析失敗)`,
            filename: song.title,
            type: 'audio',
            status: 'failed',
            progress: 0,
            errorMsg: '解析歌曲詳情失敗',
            retryPayload: {
              songId: song.song_id,
              url: '',
              filename: song.title,
              title: song.title,
              artist: '',
              coverUrl: '',
              type: 'audio'
            }
          }]);
        }
      }
    })();
  };

  const handleSelectSong = async (song: SearchResult) => {
    setIsLoadingDetail(true);
    setCurrentSong(null);
    try {
      if (isTauri) {
        const detail = await invoke<SongDetail>('get_song_detail', { id: song.song_id });
        setCurrentSong(detail);
      } else {
        const { data } = await axios.get('/api/song', {
          params: { id: song.song_id }
        });
        setCurrentSong(data.data);
      }
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
                        onClick={() => isTauri ? handleTauriBatchDownload('audio') : handleDownloadZip('audio')}
                        disabled={isZipping}
                        className="text-xs sm:text-sm bg-[#3885ff] hover:bg-[#2c6cd6] disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors"
                      >
                        {isZipping ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} {isTauri ? '下載音頻' : '打包音頻'}
                      </button>
                      <button 
                        onClick={() => isTauri ? handleTauriBatchDownload('lyric') : handleDownloadZip('lyric')}
                        disabled={isZipping}
                        className="text-xs sm:text-sm bg-[#1e1e23] border border-[#2a2a2f] hover:bg-[#2a2a2f] disabled:opacity-50 disabled:cursor-not-allowed text-gray-300 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors"
                      >
                        {isZipping ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} {isTauri ? '下載歌詞' : '打包歌詞'}
                      </button>
                      <button 
                        onClick={() => isTauri ? handleTauriBatchDownload('all') : handleDownloadZip('all')}
                        disabled={isZipping}
                        className="text-xs sm:text-sm bg-[#1e1e23] border border-[#2a2a2f] hover:bg-[#2a2a2f] disabled:opacity-50 disabled:cursor-not-allowed text-gray-300 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors"
                      >
                        {isZipping ? <Loader2 size={14} className="animate-spin" /> : <Folder size={14} />} {isTauri ? '下載全部' : '打包全部'}
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
                          {isTauri ? (
                            <button 
                              onClick={() => handleTauriSingleDownload('audio')}
                              disabled={isTaskActive(currentSong.song_id, 'audio')}
                              className="bg-[#3885ff] hover:bg-[#2c6cd6] text-white px-5 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {isTaskActive(currentSong.song_id, 'audio') ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                              下載音頻
                            </button>
                          ) : (
                            <button 
                              onClick={() => handleWebSingleDownload('audio')}
                              disabled={isTaskActive(currentSong.song_id, 'audio')}
                              className="bg-[#3885ff] hover:bg-[#2c6cd6] text-white px-5 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {isTaskActive(currentSong.song_id, 'audio') ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                              下載音頻
                            </button>
                          )}

                          {currentSong.song_id && (
                            isTauri ? (
                              <button 
                                onClick={() => handleTauriSingleDownload('lyric')}
                                disabled={isTaskActive(currentSong.song_id, 'lyric')}
                                className="bg-[#1e1e23] border border-[#2a2a2f] hover:bg-[#2a2a2f] text-gray-300 px-5 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {isTaskActive(currentSong.song_id, 'lyric') ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                                下載歌詞
                              </button>
                            ) : (
                              <button 
                                onClick={() => handleWebSingleDownload('lyric')}
                                disabled={isTaskActive(currentSong.song_id, 'lyric')}
                                className="bg-[#1e1e23] border border-[#2a2a2f] hover:bg-[#2a2a2f] text-gray-300 px-5 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {isTaskActive(currentSong.song_id, 'lyric') ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                                下載歌詞
                              </button>
                            )
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

      {/* 下載佇列浮動面板 */}
      {!isQueueOpen && downloadQueue.length > 0 && (
        <button
          onClick={() => setIsQueueOpen(true)}
          className="fixed bottom-6 right-6 z-40 bg-[#3885ff] hover:bg-[#2c6cd6] text-white px-4 py-2.5 rounded-full shadow-lg shadow-blue-500/20 flex items-center gap-2 text-sm font-medium transition-all duration-200 hover:scale-105 cursor-pointer"
        >
          {downloadQueue.some(t => t.status === 'downloading') ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Download size={16} />
          )}
          <span>下載佇列 ({downloadQueue.filter(t => t.status === 'downloading' || t.status === 'pending').length}/{downloadQueue.length})</span>
        </button>
      )}

      {isQueueOpen && (
        <div className="fixed bottom-6 right-6 z-40 w-96 max-w-[calc(100vw-2rem)] bg-[#121216]/95 border border-[#2a2a2f] rounded-2xl shadow-2xl backdrop-blur-md flex flex-col transition-all duration-300 ease-out">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-[#2a2a2f]/50">
            <div className="flex items-center gap-2">
              <Download size={16} className="text-[#3885ff]" />
              <span className="font-semibold text-sm text-white">下載佇列</span>
              <span className="text-[10px] text-gray-500">
                ({downloadQueue.filter(t => t.status === 'completed').length}/{downloadQueue.length})
              </span>
            </div>
            
            <div className="flex items-center gap-1.5">
              {downloadQueue.some(t => t.status === 'failed') && (
                <button
                  onClick={handleRetryAllFailed}
                  className="text-[11px] px-2 py-1 rounded bg-[#3885ff]/15 hover:bg-[#3885ff]/25 text-[#3885ff] transition-colors flex items-center gap-1 font-medium cursor-pointer"
                  title="重新下載所有失敗任務"
                >
                  <RotateCcw size={10} />
                  <span>重試全部</span>
                </button>
              )}
              
              <button
                onClick={() => setIsQueueMinimized(!isQueueMinimized)}
                className="p-1 rounded hover:bg-white/5 text-gray-400 hover:text-white transition-colors cursor-pointer"
              >
                {isQueueMinimized ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              
              <button
                onClick={() => setIsQueueOpen(false)}
                className="p-1 rounded hover:bg-white/5 text-gray-400 hover:text-white transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Content */}
          {!isQueueMinimized && (
            <div className="flex-1 max-h-80 overflow-y-auto custom-scrollbar p-4 space-y-3">
              {downloadQueue.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-gray-500 text-xs gap-2">
                  <Download size={28} className="opacity-30" />
                  <span>暫無下載任務</span>
                </div>
              ) : (
                downloadQueue.map(task => {
                  const isDownloading = task.status === 'downloading';
                  const isCompleted = task.status === 'completed';
                  const isFailed = task.status === 'failed';
                  const isPending = task.status === 'pending';

                  return (
                    <div
                      key={task.id}
                      className="bg-[#1e1e23]/60 border border-[#2a2a2f] rounded-xl p-3 flex flex-col gap-2 relative overflow-hidden transition-all hover:bg-[#1e1e23]/80"
                    >
                      <div className="flex items-center justify-between gap-3 relative z-10">
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <div className="shrink-0 flex items-center justify-center">
                            {isDownloading ? (
                              <Loader2 size={16} className="animate-spin text-[#3885ff]" />
                            ) : isCompleted ? (
                              <CheckCircle2 size={16} className="text-emerald-500" />
                            ) : isFailed ? (
                              <X size={16} className="text-rose-500 border border-rose-500/30 rounded-full p-[1px]" />
                            ) : (
                              task.type === 'audio' ? (
                                <Music size={16} className="text-gray-500" />
                              ) : (
                                <FileText size={16} className="text-gray-500" />
                              )
                            )}
                          </div>
                          
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="text-xs font-medium text-gray-200 truncate" title={task.title}>
                              {task.title}
                            </span>
                            <span className="text-[10px] text-gray-500 mt-0.5">
                              {isPending && "等待中..."}
                              {isDownloading && `下載中 (${task.progress}%)`}
                              {isCompleted && "下載完成"}
                              {isFailed && `下載失敗: ${task.errorMsg || '網路錯誤'}`}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {isFailed && (
                            <button
                              onClick={() => handleRetryTask(task.id)}
                              className="p-1 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 transition-colors cursor-pointer flex items-center justify-center"
                              title="重試此任務"
                            >
                              <RotateCcw size={12} />
                            </button>
                          )}
                          {!isDownloading && (
                            <button
                              onClick={() => handleRemoveTask(task.id)}
                              className="p-1 rounded hover:bg-white/5 text-gray-500 hover:text-gray-300 transition-colors cursor-pointer flex items-center justify-center"
                              title="清除任務"
                            >
                              <X size={12} />
                            </button>
                          )}
                        </div>
                      </div>

                      {isDownloading && (
                        <div className="w-full h-1 bg-[#2a2a2f] rounded-full overflow-hidden relative z-10">
                          <div
                            className="h-full bg-[#3885ff] transition-all duration-200 rounded-full"
                            style={{ width: `${task.progress}%` }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}

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
