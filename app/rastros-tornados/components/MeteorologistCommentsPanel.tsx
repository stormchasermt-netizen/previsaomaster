'use client';

import React, { useState, useEffect, useRef } from 'react';
import { db, storage } from '@/lib/firebase';
import { collection, query, where, orderBy, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { Send, Image as ImageIcon, Video, X, Loader2, MessageSquare, MapPin } from 'lucide-react';

export interface TrackComment {
  id: string;
  trackId: string;
  userId: string;
  userName: string;
  userRole: string;
  text: string;
  location: { lat: number; lng: number } | null;
  mediaUrls: { url: string; type: 'image' | 'video' }[];
  createdAt: number;
}

interface MeteorologistCommentsPanelProps {
  trackId: string;
  currentUser: { uid: string; displayName?: string | null } | null;
  userRole: string | null;
  onClose: () => void;
  isMobile: boolean;
  onFlyToLocation?: (lat: number, lng: number) => void;
}

export default function MeteorologistCommentsPanel({
  trackId,
  currentUser,
  userRole,
  onClose,
  isMobile,
  onFlyToLocation
}: MeteorologistCommentsPanelProps) {
  const [comments, setComments] = useState<TrackComment[]>([]);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<{ [fileName: string]: number }>({});
  const [isSending, setIsSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const hasPermission = userRole === 'admin' || userRole === 'meteorologista';

  useEffect(() => {
    if (!trackId) return;

    const q = query(
      collection(db, 'track_comments'),
      where('trackId', '==', trackId),
      orderBy('createdAt', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs: TrackComment[] = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        msgs.push({
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toMillis ? data.createdAt.toMillis() : Date.now()
        } as TrackComment);
      });
      setComments(msgs);
      setTimeout(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
      }, 100);
    });

    return () => unsubscribe();
  }, [trackId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setFiles(prev => [...prev, ...newFiles]);
    }
  };

  const uploadFile = async (file: File): Promise<{ url: string; type: 'image' | 'video' }> => {
    return new Promise((resolve, reject) => {
      const storageRef = ref(storage, `track_comments_media/${trackId}/${Date.now()}_${file.name}`);
      const task = uploadBytesResumable(storageRef, file);
      
      task.on('state_changed', 
        (snapshot) => {
          const p = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploadProgress(prev => ({ ...prev, [file.name]: p }));
        },
        (error) => reject(error),
        async () => {
          const url = await getDownloadURL(task.snapshot.ref);
          resolve({
            url,
            type: file.type.startsWith('video/') ? 'video' : 'image'
          });
        }
      );
    });
  };

  const handleSend = async () => {
    if (!text.trim() && files.length === 0) return;
    if (!currentUser) return;

    setIsSending(true);
    try {
      const uploadedMedia: { url: string; type: 'image' | 'video' }[] = [];
      for (const f of files) {
        const res = await uploadFile(f);
        uploadedMedia.push(res);
      }

      await addDoc(collection(db, 'track_comments'), {
        trackId,
        userId: currentUser.uid,
        userName: currentUser.displayName || 'Anônimo',
        userRole: userRole || 'meteorologist',
        text: text.trim(),
        location: null,
        mediaUrls: uploadedMedia,
        createdAt: serverTimestamp()
      });

      setText('');
      setFiles([]);
      setUploadProgress({});
    } catch (e) {
      console.error('Erro ao enviar mensagem', e);
      alert('Erro ao enviar mensagem.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0A0E17]/95 backdrop-blur-xl border-l border-white/10 w-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-white/10 shrink-0 bg-blue-950/30">
        <h3 className="font-bold text-blue-400 text-xs flex items-center gap-2">
          <MessageSquare className="w-4 h-4" />
          Fórum dos Meteorologistas {hasPermission ? '' : '(Leitura)'}
        </h3>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          title="Fechar painel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Message List */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-4">
        {comments.length === 0 ? (
          <div className="flex h-full items-center justify-center text-slate-500 text-xs text-center px-4">
            Nenhum comentário ainda. Seja o primeiro a discutir sobre este rastro!
          </div>
        ) : (
          comments.map(c => {
            const isMine = currentUser?.uid === c.userId;
            return (
              <div key={c.id} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[90%] md:max-w-[85%] rounded-xl p-3 ${isMine ? 'bg-blue-600/20 border border-blue-500/30' : 'bg-slate-800 border border-slate-700'}`}>
                  <div className="flex items-center gap-2 mb-1 justify-between">
                    <span className={`text-[10px] font-bold ${isMine ? 'text-blue-400' : 'text-slate-400'}`}>
                      {c.userName} {c.userRole === 'admin' ? '(Admin)' : ''}
                    </span>
                    <span className="text-[9px] text-slate-500">
                      {new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  
                  {c.location && (
                    <button 
                      onClick={() => onFlyToLocation?.(c.location!.lat, c.location!.lng)}
                      className="flex items-center gap-1 text-[10px] bg-sky-500/20 text-sky-300 px-2 py-1 rounded-md mb-2 hover:bg-sky-500/40 transition-colors"
                    >
                      <MapPin className="w-3 h-3" />
                      Pin no mapa
                    </button>
                  )}

                  {c.text && <p className="text-xs text-slate-200 whitespace-pre-wrap">{c.text}</p>}

                  {c.mediaUrls?.length > 0 && (
                    <div className="mt-2 flex flex-col gap-2">
                      {c.mediaUrls.map((m, i) => (
                        m.type === 'video' ? (
                          <video key={i} src={m.url} controls className="max-w-full rounded-md border border-white/10 max-h-48" preload="none" />
                        ) : (
                          <img key={i} src={m.url} alt="anexo" className="max-w-full rounded-md border border-white/10" loading="lazy" />
                        )
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* File Preview */}
      {hasPermission && files.length > 0 && (
        <div className="shrink-0 p-2 border-t border-white/5 flex gap-2 overflow-x-auto bg-black/20">
          {files.map((f, i) => (
            <div key={i} className="relative shrink-0 w-12 h-12 bg-slate-800 rounded-md border border-white/10 overflow-hidden group">
              {f.type.startsWith('video/') ? (
                <div className="w-full h-full flex items-center justify-center bg-slate-900"><Video className="w-5 h-5 text-slate-400" /></div>
              ) : (
                <img src={URL.createObjectURL(f)} alt="preview" className="w-full h-full object-cover" />
              )}
              {uploadProgress[f.name] !== undefined && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                  <span className="text-[9px] font-bold text-white">{Math.round(uploadProgress[f.name])}%</span>
                </div>
              )}
              {!isSending && (
                <button
                  type="button"
                  onClick={() => setFiles(prev => prev.filter((_, idx) => idx !== i))}
                  className="absolute -top-1 -right-1 bg-red-500 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3 text-white" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Input Form */}
      {hasPermission ? (
        <div className="shrink-0 p-3 bg-slate-900 border-t border-white/10 flex gap-2 items-end">
        <input 
          type="file" 
          ref={fileInputRef} 
          className="hidden" 
          multiple 
          accept="image/*,video/*"
          onChange={handleFileChange} 
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isSending}
          className="p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors shrink-0 disabled:opacity-50"
          title="Anexar imagem/vídeo"
        >
          <ImageIcon className="w-5 h-5" />
        </button>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Escreva um comentário..."
          disabled={isSending}
          rows={1}
          className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-400 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 min-h-[36px] max-h-24"
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <button
          onClick={handleSend}
          disabled={isSending || (!text.trim() && files.length === 0)}
          className="p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 transition-colors shrink-0"
        >
          {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
      ) : (
        <div className="shrink-0 p-3 bg-slate-900 border-t border-white/10 text-center flex flex-col items-center justify-center gap-1">
          <span className="text-xs text-slate-400 font-medium">Somente Leitura</span>
          <span className="text-[10px] text-slate-500">Apenas a equipe técnica pode enviar mensagens e anexos neste fórum.</span>
        </div>
      )}
    </div>
  );
}
