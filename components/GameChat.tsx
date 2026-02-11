import React, { useState, useEffect, useRef } from 'react';
import { useMultiplayer } from '@/contexts/MultiplayerContext';
import { useAuth } from '@/contexts/AuthContext';
import { MessageSquare, Send, ChevronDown, ChevronUp } from 'lucide-react';
import clsx from 'clsx';

export function GameChat() {
  const { chatMessages, sendChatMessage } = useMultiplayer();
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false); 
  const [inputText, setInputText] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastMessageCountRef = useRef(0);
  
  // Auto scroll and Unread Logic
  useEffect(() => {
    // Check if new messages arrived
    if (chatMessages.length > lastMessageCountRef.current) {
        if (isOpen) {
             messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
             setUnreadCount(0);
        } else {
             // Only increment if not me
             const lastMsg = chatMessages[chatMessages.length - 1];
             if (lastMsg && lastMsg.senderId !== user?.uid) {
                 setUnreadCount(prev => prev + 1);
             }
        }
    }
    lastMessageCountRef.current = chatMessages.length;
  }, [chatMessages, isOpen, user?.uid]);

  // Clear unread when opening
  useEffect(() => {
      if (isOpen) {
          setUnreadCount(0);
          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'auto' }), 100);
      }
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputText.trim()) {
      sendChatMessage(inputText);
      setInputText('');
    }
  };

  return (
    <div className={clsx("fixed bottom-12 left-4 z-[60] flex flex-col transition-all duration-300 shadow-2xl font-sans", 
        isOpen ? "w-80 h-80 md:h-96" : "w-auto h-auto"
    )}>
        {/* Header / Toggle Button */}
        <button 
            onClick={() => setIsOpen(!isOpen)}
            className={clsx(
                "flex items-center gap-2 px-4 py-3 bg-slate-900 border border-white/10 hover:bg-slate-800 transition-colors w-full",
                isOpen ? "rounded-t-xl border-b-0" : "rounded-xl shadow-lg hover:scale-105 active:scale-95"
            )}
        >
            <div className="relative">
                <MessageSquare className="w-5 h-5 text-cyan-400" />
                {unreadCount > 0 && !isOpen && (
                    <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full animate-bounce border border-slate-900">
                        {unreadCount}
                    </span>
                )}
            </div>
            
            <span className="font-bold text-white text-sm">Chat da Sala</span>
            
            <div className="ml-auto">
                {isOpen ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronUp className="w-4 h-4 text-slate-400" />}
            </div>
        </button>

        {/* Chat Body */}
        {isOpen && (
            <div className="flex-1 bg-slate-900/95 backdrop-blur-md border-x border-b border-white/10 rounded-b-xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-2 duration-200">
                
                {/* Messages List */}
                <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
                    {chatMessages.length === 0 && (
                        <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs">
                            <MessageSquare className="w-8 h-8 mb-2 opacity-20" />
                            <p>Sem mensagens ainda.</p>
                            <p>Diga olá para os outros jogadores!</p>
                        </div>
                    )}
                    {chatMessages.map((msg) => {
                        const isMe = msg.senderId === user?.uid;
                        return (
                            <div key={msg.id} className={clsx("flex flex-col max-w-[90%]", isMe ? "ml-auto items-end" : "mr-auto items-start")}>
                                <div className="text-[10px] text-slate-400 mb-1 px-1 flex items-center gap-1">
                                    <span className="font-bold text-slate-300">{isMe ? 'Você' : msg.senderName}</span>
                                </div>
                                <div className={clsx(
                                    "px-3 py-2 rounded-2xl text-sm break-words shadow-sm",
                                    isMe 
                                        ? "bg-cyan-600 text-white rounded-tr-sm" 
                                        : "bg-slate-700 text-slate-200 rounded-tl-sm"
                                )}>
                                    {msg.text}
                                </div>
                            </div>
                        );
                    })}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <form onSubmit={handleSubmit} className="p-3 bg-black/20 border-t border-white/5 flex gap-2 shrink-0">
                    <input 
                        type="text"
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        placeholder="Digite sua mensagem..."
                        className="flex-1 bg-slate-800/50 text-white text-sm rounded-lg px-3 py-2 outline-none border border-white/5 focus:border-cyan-500/50 focus:bg-slate-800 transition-all placeholder:text-slate-600"
                    />
                    <button 
                        type="submit"
                        disabled={!inputText.trim()}
                        className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white p-2 rounded-lg transition-colors shadow-lg shadow-cyan-900/20"
                    >
                        <Send className="w-4 h-4" />
                    </button>
                </form>
            </div>
        )}
    </div>
  );
}