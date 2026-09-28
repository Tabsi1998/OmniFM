import { useState, useEffect, useCallback, useRef } from 'react';
import { Bold, Italic, Underline, Strikethrough, Code, List, Link2, Eye, PenLine, Smile, X, Search } from 'lucide-react';
import EMOJI_CATEGORIES from './emojiData.js';
import { EVENT_PLACEHOLDERS, renderDiscordMarkdown, renderEventTemplate } from '../lib/dashboardEvents.js';

function ToolbarButton({ icon: Icon, label, onClick, active, testId }) {
  return (
    <button
      data-testid={testId} title={label} onClick={onClick}
      style={{
        border: '1px solid', borderColor: active ? '#5865F2' : '#1A1A2E',
        background: active ? 'rgba(88,101,242,0.15)' : 'transparent',
        color: '#A1A1AA', width: 32, height: 32, cursor: 'pointer',
        display: 'grid', placeItems: 'center', transition: 'all 0.12s',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.borderColor = '#5865F2'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.borderColor = '#1A1A2E'; }}
    >
      <Icon size={14} />
    </button>
  );
}

function EmojiPicker({ serverEmojis, loading, onSelectUnicode, onSelectCustom, onClose, t }) {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('server');
  const isDE = t('de', 'en') === 'de';

  const hasServer = serverEmojis.length > 0;

  const tabs = [
    ...(hasServer ? [{ id: 'server', label: t('Server', 'Server') }] : []),
    ...EMOJI_CATEGORIES.map(c => ({ id: c.id, label: isDE ? c.label.de : c.label.en })),
  ];

  // Set default tab
  useEffect(() => {
    if (!hasServer && activeTab === 'server') {
      setActiveTab(EMOJI_CATEGORIES[0]?.id || 'people');
    }
  }, [hasServer, activeTab]);

  // Search across all categories
  const searchLower = search.toLowerCase();
  // Unicode emojis cannot be searched by name, so the search covers the server's own.
  let filteredServer = serverEmojis;
  if (search) {
    filteredServer = serverEmojis.filter(e => e.name.toLowerCase().includes(searchLower));
  }

  const isSearchMode = search.length > 0;

  return (
    <div data-testid="emoji-picker-panel" style={{
      position: 'absolute', top: '100%', right: 0, zIndex: 50, marginTop: 4,
      width: 'min(420px, calc(100vw - 32px))', maxHeight: 470, background: '#0A0A0A', border: '1px solid #1A1A2E',
      display: 'flex', flexDirection: 'column', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderBottom: '1px solid #1A1A2E' }}>
        <span style={{ fontSize: 12, color: '#71717A', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Emojis
        </span>
        <button data-testid="emoji-picker-close" onClick={onClose} style={{ border: 'none', background: 'transparent', color: '#71717A', cursor: 'pointer', padding: 2 }}>
          <X size={14} />
        </button>
      </div>

      {/* Search */}
      <div style={{ padding: '6px 10px', borderBottom: '1px solid #1A1A2E' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid #1A1A2E', background: '#050505', padding: '0 8px', height: 32 }}>
          <Search size={12} color="#52525B" />
          <input
            data-testid="emoji-search-input" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={t('Emoji suchen...', 'Search emoji...')}
            style={{ flex: 1, border: 'none', background: 'transparent', color: '#fff', fontSize: 12, outline: 'none' }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ border: 'none', background: 'transparent', color: '#52525B', cursor: 'pointer', padding: 0 }}>
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Category Tabs */}
      {!isSearchMode && (
        <div style={{ display: 'flex', flexWrap: 'wrap', borderBottom: '1px solid #1A1A2E', padding: '6px 6px 2px', gap: 4 }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              data-testid={`emoji-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              style={{
                border: 'none', background: 'transparent', cursor: 'pointer',
                padding: '6px 9px', fontSize: 11, whiteSpace: 'nowrap',
                color: activeTab === tab.id ? '#5865F2' : '#52525B',
                borderBottom: activeTab === tab.id ? '2px solid #5865F2' : '2px solid transparent',
                fontWeight: activeTab === tab.id ? 600 : 400,
                transition: 'all 0.12s',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Emoji Grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 8, minHeight: 180 }}>
        {loading && <div style={{ color: '#52525B', fontSize: 12, textAlign: 'center', padding: 20 }}>{t('Lade...', 'Loading...')}</div>}

        {/* Search mode: show server emojis + matching category name for context */}
        {isSearchMode && !loading && (
          <>
            {filteredServer.length > 0 && (
              <>
                <div style={{ fontSize: 10, color: '#52525B', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '4px 2px 6px', fontWeight: 600 }}>
                  {t('Server-Emojis', 'Server emojis')}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(40px, 1fr))', gap: 6, marginBottom: 10 }}>
                  {filteredServer.map(emoji => (
                    <button
                      key={emoji.id} data-testid={`emoji-btn-${emoji.name}`}
                      onClick={() => onSelectCustom(emoji)} title={`:${emoji.name}:`}
                      style={{ border: '1px solid transparent', background: 'transparent', cursor: 'pointer', width: 40, height: 40, display: 'grid', placeItems: 'center', borderRadius: 6, transition: 'all 0.1s' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#1A1A2E'; e.currentTarget.style.borderColor = '#5865F2'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}
                    >
                      <img src={emoji.url} alt={`:${emoji.name}:`} style={{ width: 24, height: 24, objectFit: 'contain' }} loading="lazy" />
                    </button>
                  ))}
                </div>
              </>
            )}
            {filteredServer.length === 0 && serverEmojis.length === 0 && (
              <div style={{ color: '#3F3F46', fontSize: 12, textAlign: 'center', padding: 12 }}>
                {t('Tipp: Wähle eine Kategorie oder tippe ein Emoji ein.', 'Tip: Select a category or type an emoji.')}
              </div>
            )}
          </>
        )}

        {/* Normal mode: show active tab content */}
        {!isSearchMode && !loading && activeTab === 'server' && (
          <>
            {serverEmojis.length === 0 ? (
              <div style={{ color: '#52525B', fontSize: 12, textAlign: 'center', padding: 20 }}>
                {t('Keine Server-Emojis vorhanden.', 'No server emojis available.')}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(40px, 1fr))', gap: 6 }}>
                {serverEmojis.map(emoji => (
                  <button
                    key={emoji.id} data-testid={`emoji-btn-${emoji.name}`}
                    onClick={() => onSelectCustom(emoji)} title={`:${emoji.name}:`}
                    style={{ border: '1px solid transparent', background: 'transparent', cursor: 'pointer', width: 40, height: 40, display: 'grid', placeItems: 'center', borderRadius: 6, transition: 'all 0.1s' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#1A1A2E'; e.currentTarget.style.borderColor = '#5865F2'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}
                  >
                    <img src={emoji.url} alt={`:${emoji.name}:`} style={{ width: 24, height: 24, objectFit: 'contain' }} loading="lazy" />
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {!isSearchMode && !loading && activeTab !== 'server' && (
          <>
            {EMOJI_CATEGORIES.filter(c => c.id === activeTab).map(cat => (
              <div key={cat.id} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(40px, 1fr))', gap: 6 }}>
                {cat.emojis.map((emoji, i) => (
                  <button
                    key={`${cat.id}-${i}`}
                    data-testid={`emoji-unicode-${cat.id}-${i}`}
                    onClick={() => onSelectUnicode(emoji)}
                    style={{
                      border: '1px solid transparent', background: 'transparent', cursor: 'pointer',
                      width: 40, height: 40, display: 'grid', placeItems: 'center', borderRadius: 6,
                      fontSize: 22, lineHeight: 1, transition: 'all 0.1s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#1A1A2E'; e.currentTarget.style.borderColor = '#5865F2'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

export default function RichMessageEditor({
  value,
  onChange,
  t,
  testId,
  apiRequest,
  selectedGuildId,
  serverEmojis: providedServerEmojis = null,
  label = null,
  previewValues = null,
  previewText = null,
  previewAsMarkdown = true,
  placeholderText = null,
  placeholders = EVENT_PLACEHOLDERS,
  showToolbar = true,
  emptyPreviewText = null,
}) {
  const [mode, setMode] = useState('edit');
  const [showEmojis, setShowEmojis] = useState(false);
  const [serverEmojis, setServerEmojis] = useState([]);
  const [emojisLoading, setEmojisLoading] = useState(false);
  const [emojisLoaded, setEmojisLoaded] = useState(false);
  const textareaRef = useRef(null);
  const containerRef = useRef(null);
  const usingProvidedServerEmojis = Array.isArray(providedServerEmojis);
  const resolvedServerEmojis = usingProvidedServerEmojis ? providedServerEmojis : serverEmojis;

  const loadServerEmojis = useCallback(async () => {
    if (usingProvidedServerEmojis || emojisLoaded || !apiRequest || !selectedGuildId) return;
    setEmojisLoading(true);
    try {
      const result = await apiRequest(`/api/dashboard/emojis?serverId=${encodeURIComponent(selectedGuildId)}`);
      setServerEmojis(result.emojis || []);
    } catch {
      setServerEmojis([]);
    } finally {
      setEmojisLoading(false);
      setEmojisLoaded(true);
    }
  }, [apiRequest, selectedGuildId, emojisLoaded, usingProvidedServerEmojis]);

  const toggleEmojis = () => {
    if (!showEmojis) loadServerEmojis();
    setShowEmojis(!showEmojis);
  };

  useEffect(() => {
    if (!showEmojis) return;
    const handleClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setShowEmojis(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showEmojis]);

  useEffect(() => {
    if (mode === 'preview') loadServerEmojis();
  }, [mode, loadServerEmojis]);

  useEffect(() => {
    setServerEmojis([]);
    setEmojisLoaded(false);
    setEmojisLoading(false);
    setShowEmojis(false);
  }, [selectedGuildId, usingProvidedServerEmojis]);

  const insertAtCursor = (before, after = '') => {
    const ta = textareaRef.current;
    if (!ta) { onChange(value + before + after); return; }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = value.substring(start, end);
    const newText = value.substring(0, start) + before + selected + after + value.substring(end);
    onChange(newText);
    setTimeout(() => {
      ta.focus();
      const cursor = start + before.length + selected.length;
      ta.setSelectionRange(cursor, cursor);
    }, 0);
  };

  const wrapSelection = (wrapper) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (start === end) {
      insertAtCursor(wrapper, wrapper);
    } else {
      const selected = value.substring(start, end);
      const newText = value.substring(0, start) + wrapper + selected + wrapper + value.substring(end);
      onChange(newText);
      setTimeout(() => { ta.focus(); ta.setSelectionRange(start + wrapper.length, end + wrapper.length); }, 0);
    }
  };

  const insertCustomEmoji = (emoji) => {
    const emojiText = `:${emoji.name}:`;
    insertAtCursor(emojiText);
    setShowEmojis(false);
  };

  const insertUnicodeEmoji = (emoji) => {
    insertAtCursor(emoji);
    setShowEmojis(false);
  };

  const toolbarActions = [
    { icon: Bold, label: t('Fett', 'Bold'), action: () => wrapSelection('**'), testId: 'fmt-bold' },
    { icon: Italic, label: t('Kursiv', 'Italic'), action: () => wrapSelection('*'), testId: 'fmt-italic' },
    { icon: Underline, label: t('Unterstrichen', 'Underline'), action: () => wrapSelection('__'), testId: 'fmt-underline' },
    { icon: Strikethrough, label: t('Durchgestrichen', 'Strikethrough'), action: () => wrapSelection('~~'), testId: 'fmt-strike' },
    { icon: Code, label: t('Code', 'Code'), action: () => wrapSelection('`'), testId: 'fmt-code' },
    { icon: List, label: t('Codeblock', 'Code block'), action: () => insertAtCursor('```\n', '\n```'), testId: 'fmt-codeblock' },
    { icon: Link2, label: t('Link', 'Link'), action: () => insertAtCursor('[', '](url)'), testId: 'fmt-link' },
  ];
  const resolvedPreviewText = previewText !== null
    ? String(previewText || '')
    : renderEventTemplate(value, previewValues || {});
  const previewEmptyLabel = emptyPreviewText || t('Keine Nachricht', 'No message');
  const resolvedLabel = label || t('Nachricht (Discord Markdown)', 'Message (Discord Markdown)');
  const resolvedPlaceholder = placeholderText || t(
    'z.B. **{event}** startet jetzt auf {voice} mit {station}!\n\nMarkdown: **fett** *kursiv* __unterstrichen__ ~~durchgestrichen~~ `code`',
    'e.g. **{event}** is starting now on {voice} with {station}!\n\nMarkdown: **bold** *italic* __underline__ ~~strikethrough~~ `code`'
  );

  return (
    <div data-testid={testId} ref={containerRef}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <label style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {resolvedLabel}
        </label>
        <div style={{ display: 'flex', gap: 4 }}>
          <button data-testid="editor-mode-edit" onClick={() => setMode('edit')} style={{
            border: '1px solid', borderColor: mode === 'edit' ? '#5865F2' : '#1A1A2E',
            background: mode === 'edit' ? 'rgba(88,101,242,0.15)' : 'transparent',
            color: '#A1A1AA', height: 26, padding: '0 10px', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <PenLine size={11} /> {t('Editor', 'Editor')}
          </button>
          <button data-testid="editor-mode-preview" onClick={() => setMode('preview')} style={{
            border: '1px solid', borderColor: mode === 'preview' ? '#5865F2' : '#1A1A2E',
            background: mode === 'preview' ? 'rgba(88,101,242,0.15)' : 'transparent',
            color: '#A1A1AA', height: 26, padding: '0 10px', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <Eye size={11} /> {t('Vorschau', 'Preview')}
          </button>
        </div>
      </div>

      {mode === 'edit' && (
        <>
          {showToolbar && (
            <div style={{ display: 'flex', gap: 3, marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {toolbarActions.map((btn) => (
                <ToolbarButton key={btn.testId} icon={btn.icon} label={btn.label} onClick={btn.action} testId={btn.testId} />
              ))}
              <div style={{ width: 1, height: 20, background: '#1A1A2E', margin: '0 4px' }} />
              <div style={{ position: 'relative' }}>
                <ToolbarButton icon={Smile} label={t('Emoji', 'Emoji')} onClick={toggleEmojis} active={showEmojis} testId="fmt-emoji" />
                {showEmojis && (
                  <EmojiPicker
                    serverEmojis={resolvedServerEmojis}
                    loading={emojisLoading}
                    onSelectUnicode={insertUnicodeEmoji}
                    onSelectCustom={insertCustomEmoji}
                    onClose={() => setShowEmojis(false)}
                    t={t}
                  />
                )}
              </div>
              {Array.isArray(placeholders) && placeholders.length > 0 && (
                <>
                  <div style={{ width: 1, height: 20, background: '#1A1A2E', margin: '0 4px' }} />
                  {placeholders.map((placeholderToken) => (
                    <button key={placeholderToken} data-testid={`placeholder-${placeholderToken}`} onClick={() => insertAtCursor(placeholderToken)} style={{
                      border: '1px solid #1A1A2E', background: '#080808', color: '#8B5CF6', padding: '4px 8px',
                      cursor: 'pointer', fontSize: 11, fontFamily: "'JetBrains Mono', monospace", height: 32,
                    }}>{placeholderToken}</button>
                  ))}
                </>
              )}
            </div>
          )}
          <textarea
            ref={textareaRef}
            data-testid="message-editor-textarea"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={5}
            placeholder={resolvedPlaceholder}
            style={{
              width: '100%', padding: 10, border: '1px solid #1A1A2E', background: '#050505',
              color: '#fff', resize: 'vertical', fontSize: 13, boxSizing: 'border-box',
              fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.6, minHeight: 100,
            }}
          />
        </>
      )}

      {mode === 'preview' && (
        <div data-testid="message-preview" style={{
          minHeight: 100, border: '1px solid #1A1A2E', background: '#050505', padding: 12,
          color: '#D4D4D8', fontSize: 13, lineHeight: 1.7,
        }}>
          {resolvedPreviewText ? (
            previewAsMarkdown ? (
              <div dangerouslySetInnerHTML={{ __html: renderDiscordMarkdown(resolvedPreviewText, { serverEmojis: resolvedServerEmojis }) }} />
            ) : (
              <div style={{ whiteSpace: 'pre-wrap' }}>{resolvedPreviewText}</div>
            )
          ) : (
            <span style={{ color: '#3F3F46' }}>{previewEmptyLabel}</span>
          )}
        </div>
      )}
    </div>
  );
}
