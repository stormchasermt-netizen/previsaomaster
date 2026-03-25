'use client';

import React, { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, orderBy, limitToLast, onSnapshot } from 'firebase/firestore';
import { ChevronRight, MessageSquare } from 'lucide-react';

interface RecentCommentPreviewProps {
  trackId: string;
}

export default function RecentCommentPreview({ trackId }: RecentCommentPreviewProps) {
  const [comment, setComment] = useState<{ userName: string; text?: string; hasMedia: boolean } | null>(null);

  useEffect(() => {
    if (!trackId) return;

    // Usando limitToLast(1) com orderBy ascendente para usar o mesmo índice (trackId ASC, createdAt ASC)
    const q = query(
      collection(db, 'track_comments'),
      where('trackId', '==', trackId),
      orderBy('createdAt', 'asc'),
      limitToLast(1)
    );

    const unsub = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        const doc = snapshot.docs[0].data();
        setComment({
          userName: doc.userName,
          text: doc.text,
          hasMedia: Array.isArray(doc.mediaUrls) && doc.mediaUrls.length > 0,
        });
      } else {
        setComment(null);
      }
    });

    return () => unsub();
  }, [trackId]);

  if (!comment) return null;

  const previewText = comment.text 
    ? (comment.text.length > 40 ? comment.text.substring(0, 40) + '...' : comment.text)
    : (comment.hasMedia ? 'Anexo 📎' : '...');

  return (
    <div className="mt-2.5 flex items-center justify-between text-[10px] bg-sky-950/30 p-2 rounded-lg border border-sky-500/20 group-hover:bg-sky-900/40 transition-colors w-full">
      <div className="truncate flex-1 pr-2 flex items-center gap-1.5 min-w-0">
        <MessageSquare className="w-3 h-3 text-sky-400 shrink-0" />
        <span className="text-sky-300 font-bold truncate shrink-0 max-w-[40%]">{comment.userName}:</span>
        <span className="italic text-slate-300 truncate">{previewText}</span>
      </div>
      <div className="flex items-center gap-1 text-cyan-400 font-bold whitespace-nowrap shrink-0 opacity-80 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all">
        Ver conversa <ChevronRight className="w-3 h-3" />
      </div>
    </div>
  );
}
