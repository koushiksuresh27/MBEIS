import { useState, useRef, useEffect } from 'react';

interface ErisDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  scenarioId: string | null;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const ErisFormattedMessage = ({ content }: { content: string }) => {
  const lines = content.split('\n');
  
  let recommendedActionText = "";
  let mainLines: string[] = [];

  const actionPrefixes = ["→ Recommended action:", "→ Recommended Action:", "→"];
  
  let foundAction = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!foundAction && actionPrefixes.some(prefix => line.trim().startsWith(prefix))) {
      foundAction = true;
      recommendedActionText += line + "\n";
    } else if (foundAction) {
      recommendedActionText += line + "\n";
    } else {
      mainLines.push(line);
    }
  }

  const blocks = mainLines.filter(line => line.trim().length > 0);

  return (
    <div className="flex flex-col font-sans text-[13px] leading-[1.6] text-on-surface">
      {blocks.map((block, idx) => {
        const isEmojiSection = /^(🔴|🟡|🟢|📊|⚠️)/.test(block.trim());
        if (isEmojiSection) {
          return (
            <div key={idx} className="font-semibold text-[#374151] mt-2 mb-1">
              {block}
            </div>
          );
        }
        return (
          <div key={idx} className="mb-1">
            {block}
          </div>
        );
      })}
      
      {recommendedActionText && (
        <div className="mt-3 pl-3 border-l-2 border-primary italic text-[12px] text-on-surface-variant">
          {recommendedActionText.trim()}
        </div>
      )}
    </div>
  );
};

export default function ErisDrawer({ isOpen, onClose, scenarioId }: ErisDrawerProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: "Hello. I'm ERIS — I have the current simulation loaded.\nAsk me about intervention effectiveness, city-level risk, resource projections, or what the model is telling you."
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationHistory, setConversationHistory] = useState<{role: string, content: string}[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleSend = async () => {
    if (!inputValue.trim() || !scenarioId || isLoading) return;

    const userMessage = inputValue.trim();
    setInputValue('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    try {
      const response = await fetch('http://localhost:8000/api/v1/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario_id: scenarioId,
          message: userMessage,
          conversation_history: conversationHistory
        })
      });

      if (!response.ok) throw new Error('API Error');

      const data = await response.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.response }]);
      setConversationHistory(data.conversation_history);
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'assistant', content: "SYSTEM ERROR: Backend connection failed." }]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed z-50 flex flex-col bg-background shadow-[0_8px_32px_rgba(0,0,0,0.18)] rounded-xl overflow-hidden border-l-2 border-primary"
      style={{
        right: '16px',
        top: '70px',
        bottom: '16px',
        width: '380px'
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-surface border-b border-outline shrink-0">
        <div className="flex items-center gap-3">
          <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
          </svg>
          <div className="flex flex-col">
            <span className="font-bold text-on-surface text-sm tracking-tight leading-tight">ERIS</span>
            <span className="text-[10px] text-on-surface-variant font-medium uppercase tracking-wider">Epidemic Response Intelligence</span>
          </div>
        </div>
        <button 
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-surface-variant transition-colors text-on-surface-variant hover:text-on-surface"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-5 flex flex-col gap-5 bg-[#f8f9fa]">
        {messages.map((msg, idx) => (
          <div key={idx} className="w-full flex flex-col">
            {msg.role === 'user' ? (
              <div className="self-end max-w-[70%]">
                <div className="text-right italic text-[#6b7280] text-[13px] leading-relaxed font-sans">
                  {msg.content}
                </div>
              </div>
            ) : (
              <div className="flex flex-col">
                <div className="text-left text-[10px] font-bold text-primary tracking-[0.1em] mb-1.5 uppercase">ERIS</div>
                <div className="bg-white p-3 rounded-r-lg border-l-[3px] border-primary shadow-[0_1px_3px_rgba(0,0,0,0.06)] self-start w-[90%]">
                  <ErisFormattedMessage content={msg.content} />
                </div>
              </div>
            )}
          </div>
        ))}
        
        {isLoading && (
          <div className="w-full flex flex-col">
            <div className="text-left text-[10px] font-bold text-primary tracking-[0.1em] mb-1.5 uppercase">ERIS</div>
            <div className="bg-white p-3 rounded-r-lg border-l-[3px] border-primary shadow-[0_1px_3px_rgba(0,0,0,0.06)] self-start flex items-center h-10 w-24">
              <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse mr-1"></span>
              <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse animation-delay-200 mr-1"></span>
              <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse animation-delay-400"></span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-outline bg-background shrink-0">
        {!scenarioId && (
          <div className="text-[11px] text-error font-medium mb-3 tracking-wide">
            SETUP REQUIRED: NO ACTIVE SCENARIO
          </div>
        )}
        <div className="flex items-center bg-surface-container rounded-full px-4 py-2 border border-outline focus-within:border-primary transition-colors shadow-sm">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask ERIS..."
            disabled={!scenarioId || isLoading}
            className="flex-1 bg-transparent text-sm text-on-surface focus:outline-none disabled:opacity-50 placeholder-on-surface-variant"
          />
          <button
            onClick={handleSend}
            disabled={!scenarioId || isLoading || !inputValue.trim()}
            className={`p-1.5 rounded-full transition-colors ml-2 ${
              inputValue.trim() && !isLoading ? 'text-primary hover:bg-surface-variant' : 'text-on-surface-variant opacity-40'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
