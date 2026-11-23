import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Copy, Send, SlidersHorizontal, Sparkles, Trash2 } from 'lucide-react';
import { localize, type AppLanguage } from '../lib/i18n';
import { readAppSetting, saveAppSetting } from '../lib/storage';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AiConfig {
  endpoint: string;
  model: string;
  apiKey: string;
}

const AI_CONFIG_KEY = 'di-ai-chat-config';
const DEFAULT_AI_CONFIG: AiConfig = {
  endpoint: 'https://api.openai.com/v1/chat/completions',
  model: 'gpt-4o-mini',
  apiKey: ''
};

function readAiConfig(): AiConfig {
  const stored = readAppSetting<Partial<AiConfig> | null>(AI_CONFIG_KEY, null);
  if (!stored || typeof stored !== 'object') return DEFAULT_AI_CONFIG;
  return {
    endpoint: typeof stored.endpoint === 'string' && stored.endpoint.trim() ? stored.endpoint : DEFAULT_AI_CONFIG.endpoint,
    model: typeof stored.model === 'string' && stored.model.trim() ? stored.model : DEFAULT_AI_CONFIG.model,
    apiKey: typeof stored.apiKey === 'string' ? stored.apiKey : ''
  };
}

interface AiChatTabProps {
  language: AppLanguage;
  onCopy: (text: string) => void;
  onNotice: (title: string, body: string) => void;
}

export default function AiChatTab({ language, onCopy, onNotice }: AiChatTabProps) {
  const [config, setConfig] = useState<AiConfig>(readAiConfig);
  const [showConfig, setShowConfig] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    saveAppSetting(AI_CONFIG_KEY, config);
  }, [config]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const sendMessage = async () => {
    const prompt = input.trim();
    if (!prompt || loading) return;

    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: prompt }];
    setMessages(nextMessages);
    setInput('');
    setErrorText(null);
    setLoading(true);

    try {
      const reply = await invoke<string>('send_ai_chat', {
        endpoint: config.endpoint,
        apiKey: config.apiKey,
        model: config.model,
        messages: nextMessages.slice(-12)
      });
      setMessages((current) => [...current, { role: 'assistant', content: reply }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorText(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ai-chat">
      <div className="ai-chat__toolbar">
        <span className="ai-chat__badge">
          <Sparkles size={12} />
          <strong>{config.model || 'AI'}</strong>
        </span>
        <div className="ai-chat__toolbar-actions">
          <button
            type="button"
            className={`ai-chat__icon-btn${showConfig ? ' is-active' : ''}`}
            title={localize(language, 'Pengaturan endpoint AI', 'AI endpoint settings')}
            onClick={() => setShowConfig((open) => !open)}
          >
            <SlidersHorizontal size={12} />
          </button>
          <button
            type="button"
            className="ai-chat__icon-btn"
            disabled={messages.length === 0}
            title={localize(language, 'Bersihkan chat', 'Clear chat')}
            onClick={() => {
              setMessages([]);
              setErrorText(null);
            }}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {showConfig && (
        <div className="ai-chat__config">
          <input
            type="text"
            value={config.endpoint}
            placeholder="https://api.openai.com/v1/chat/completions"
            onChange={(event) => setConfig((c) => ({ ...c, endpoint: event.target.value }))}
          />
          <div className="ai-chat__config-row">
            <input
              type="text"
              value={config.model}
              placeholder="gpt-4o-mini / llama3"
              onChange={(event) => setConfig((c) => ({ ...c, model: event.target.value }))}
            />
            <input
              type="password"
              value={config.apiKey}
              placeholder={localize(language, 'API Key (opsional lokal)', 'API Key (optional local)')}
              onChange={(event) => setConfig((c) => ({ ...c, apiKey: event.target.value }))}
            />
          </div>
        </div>
      )}

      <div className="ai-chat__messages" ref={listRef}>
        {messages.length === 0 ? (
          <p className="ai-chat__empty">
            {localize(
              language,
              'Tanya apa saja. Mendukung OpenAI, OpenRouter, Groq, atau Ollama lokal.',
              'Ask anything. Supports OpenAI, OpenRouter, Groq, or local Ollama.'
            )}
          </p>
        ) : (
          messages.map((msg, index) => (
            <div key={`${msg.role}-${index}`} className={`ai-chat__bubble ai-chat__bubble--${msg.role}`}>
              <span>{msg.content}</span>
              {msg.role === 'assistant' && (
                <button
                  type="button"
                  className="ai-chat__copy"
                  title={localize(language, 'Salin jawaban', 'Copy reply')}
                  onClick={() => {
                    onCopy(msg.content);
                    onNotice('AI Chat', localize(language, 'Jawaban disalin ke clipboard', 'Reply copied to clipboard'));
                  }}
                >
                  <Copy size={10} />
                </button>
              )}
            </div>
          ))
        )}
        {loading && (
          <div className="ai-chat__bubble ai-chat__bubble--assistant ai-chat__bubble--loading">
            {localize(language, 'Berpikir…', 'Thinking…')}
          </div>
        )}
        {errorText && <p className="ai-chat__error">{errorText}</p>}
      </div>

      <form
        className="ai-chat__composer"
        onSubmit={(event) => {
          event.preventDefault();
          void sendMessage();
        }}
      >
        <input
          type="text"
          value={input}
          placeholder={localize(language, 'Ketik pesan ke AI…', 'Message AI…')}
          onChange={(event) => setInput(event.target.value)}
        />
        <button type="submit" disabled={loading || !input.trim()} aria-label={localize(language, 'Kirim', 'Send')}>
          <Send size={13} />
        </button>
      </form>
    </div>
  );
}

