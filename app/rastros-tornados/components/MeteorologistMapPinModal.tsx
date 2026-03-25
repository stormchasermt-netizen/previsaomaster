'use client';

import React, { useState, useRef } from 'react';
import { db, storage } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { MapPin, X, Image as ImageIcon, Video, Send, Loader2 } from 'lucide-react';

interface MeteorologistMapPinModalProps {
  trackId: string;
  lat: number;
  lng: number;
  currentUser: { uid: string; displayName?: string | null } | null;
  userRole: string | null;
  onClose: () => void;
}

export default function MeteorologistMapPinModal({
  trackId,
  lat,
  lng,
  currentUser,
  userRole,
  onClose
}: MeteorologistMapPinModalProps) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<{ [fileName: string]: number }>({});
  const [isSending, setIsSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(prev => [...prev, ...Array.from(e.target.files!)]);
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
        reject,
        async () => {
          const url = await getDownloadURL(task.snapshot.ref);
          resolve({ url, type: file.type.startsWith('video/') ? 'video' : 'image' });
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
        uploadedMedia.push(await uploadFile(f));
      }

      await addDoc(collection(db, 'track_comments'), {
        trackId,
        userId: currentUser.uid,
        userName: currentUser.displayName || 'Anônimo',
        userRole: userRole || 'meteorologist',
        text: text.trim(),
        location: { lat, lng },
        mediaUrls: uploadedMedia,
        createdAt: serverTimestamp()
      });

      onClose();
    } catch (e) {
      console.error('Erro ao salvar pin georreferenciado', e);
      alert('Erro ao salvar o pin.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="bg-[#0A0E17] border border-blue-500/30 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-white/10 shrink-0 bg-blue-950/30">
          <h3 className="font-bold text-sky-400 text-xs flex items-center gap-2 uppercase tracking-wider">
            <MapPin className="w-4 h-4" />
            Adicionar Pin no Mapa
          </h3>
          <button onClick={onClose} disabled={isSending} className="p-1 hover:bg-white/10 rounded-md text-slate-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Coords display */}
        <div className="bg-black/30 px-4 py-2 text-[10px] text-slate-400 font-mono tracking-widest border-b border-white/5 flex justify-between">
          <span>LAT: {lat.toFixed(5)}</span>
          <span>LNG: {lng.toFixed(5)}</span>
        </div>

        {/* Input Text */}
        <div className="p-4">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            disabled={isSending}
            placeholder="Qual observação sobre este local exato?"
            className="w-full h-24 bg-slate-800/50 border border-slate-700/50 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 resize-none focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-50"
          />
        </div>

        {/* File Preview */}
        {files.length > 0 && (
          <div className="px-4 pb-2 flex gap-2 overflow-x-auto">
            {files.map((f, i) => (
              <div key={i} className="relative shrink-0 w-12 h-12 bg-slate-800 rounded-md border border-white/10 overflow-hidden group">
                {f.type.startsWith('video/') ? (
                  <div className="w-full h-full flex items-center justify-center"><Video className="w-5 h-5 text-slate-500" /></div>
                ) : (
                  <img src={URL.createObjectURL(f)} alt="preview" className="w-full h-full object-cover" />
                )}
                {uploadProgress[f.name] !== undefined && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                    <span className="text-[9px] font-bold text-white">{Math.round(uploadProgress[f.name])}%</span>
                  </div>
                )}
                {!isSending && (
                  <button onClick={() => setFiles(prev => prev.filter((_, idx) => idx !== i))} className="absolute top-0 right-0 bg-red-500 p-0.5 rounded-bl opacity-0 group-hover:opacity-100 transition-opacity">
                    <X className="w-3 h-3 text-white" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Actions Footer */}
        <div className="bg-slate-900 border-t border-white/10 p-3 flex justify-between items-center">
          <input type="file" ref={fileInputRef} hidden multiple accept="image/*,video/*" onChange={handleFileChange} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isSending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sky-400 text-xs font-semibold hover:bg-sky-500/10 disabled:opacity-50 transition-colors"
          >
            <ImageIcon className="w-4 h-4" /> Anexar Mídia
          </button>
          <button
            onClick={handleSend}
            disabled={isSending || (!text.trim() && files.length === 0)}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-sky-600/90 hover:bg-sky-500 text-white text-xs font-bold disabled:bg-slate-800 disabled:text-slate-500 transition-colors"
          >
            {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
