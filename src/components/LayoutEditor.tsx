import { useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { localize, type AppLanguage } from '../lib/i18n';
import {
  cloneLayoutPreset,
  type IdleWidgetId,
  type IslandLayoutSettings,
  type LauncherColumns,
  type LauncherItemId,
  type LayoutItemConfig,
  type LayoutPresetId,
  type ToolsNavLayout,
  type ToolTabId
} from '../lib/layoutSettings';

interface LayoutEditorProps {
  language: AppLanguage;
  layout: IslandLayoutSettings;
  onChange: (next: IslandLayoutSettings) => void;
}

type EditorSection = 'idle' | 'launcher' | 'tools';

function reorderItems<T extends string>(
  items: LayoutItemConfig<T>[],
  fromIndex: number,
  toIndex: number
): LayoutItemConfig<T>[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) {
    return items;
  }
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export default function LayoutEditor({ language, layout, onChange }: LayoutEditorProps) {
  const [section, setSection] = useState<EditorSection>('idle');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [shortcutLabel, setShortcutLabel] = useState('');
  const [shortcutTarget, setShortcutTarget] = useState('');

  const idleLabels: Record<IdleWidgetId, string> = {
    pet: localize(language, 'Karakter Pet', 'Pet'),
    privacy: localize(language, 'Privasi (Cam/Mic)', 'Privacy (Cam/Mic)'),
    live: localize(language, 'Download & BT', 'Download & BT'),
    clock: localize(language, 'Jam', 'Clock'),
    date: localize(language, 'Tanggal', 'Date'),
    battery: localize(language, 'Baterai', 'Battery')
  };

  const launcherLabels: Record<LauncherItemId, string> = {
    tools: localize(language, 'Alat', 'Tools'),
    music: localize(language, 'Musik', 'Music'),
    monitor: 'Monitor',
    ai: 'AI Chat',
    capture: 'Capture & OCR',
    lock: localize(language, 'Kunci PC', 'Lock PC')
  };

  const tabLabels: Record<ToolTabId, string> = {
    focus: 'Focus',
    tasks: 'To-do',
    ai: 'AI Chat',
    clipboard: 'Clipboard',
    shelf: 'File Shelf',
    prayer: localize(language, 'Jadwal Salat', 'Prayer'),
    capture: 'Capture & OCR',
    settings: localize(language, 'Pengaturan (wajib)', 'Settings (locked)')
  };

  const presets: { id: LayoutPresetId; label: string }[] = [
    { id: 'balanced', label: 'Balanced' },
    { id: 'minimal', label: 'Minimal' },
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'focus-mode', label: 'Focus' }
  ];

  const renderReorderList = <T extends string>(
    items: LayoutItemConfig<T>[],
    labels: Record<T, string>,
    onUpdate: (nextItems: LayoutItemConfig<T>[]) => void,
    lockedId?: T
  ) => (
    <div className="layout-editor__list">
      {items.map((item, index) => {
        const isLocked = item.id === lockedId;
        return (
          <div
            key={item.id}
            className={`layout-editor__row${item.visible ? '' : ' is-hidden'}${dragIndex === index ? ' is-dragging' : ''}`}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (dragIndex !== null && dragIndex !== index) {
                onUpdate(reorderItems(items, dragIndex, index));
              }
              setDragIndex(null);
            }}
            onDragEnd={() => setDragIndex(null)}
          >
            <span className="layout-editor__grip" aria-hidden="true"><GripVertical size={12} /></span>
            <span className="layout-editor__name">{labels[item.id]}</span>
            <div className="layout-editor__actions">
              <button
                type="button"
                className="layout-editor__btn"
                disabled={index === 0}
                title={localize(language, 'Geser ke atas', 'Move up')}
                onClick={() => onUpdate(reorderItems(items, index, index - 1))}
              >
                <ArrowUp size={11} />
              </button>
              <button
                type="button"
                className="layout-editor__btn"
                disabled={index === items.length - 1}
                title={localize(language, 'Geser ke bawah', 'Move down')}
                onClick={() => onUpdate(reorderItems(items, index, index + 1))}
              >
                <ArrowDown size={11} />
              </button>
              <button
                type="button"
                className={`layout-editor__btn${item.visible ? ' is-visible' : ''}`}
                disabled={isLocked}
                title={isLocked
                  ? localize(language, 'Wajib aktif', 'Always visible')
                  : item.visible
                    ? localize(language, 'Sembunyikan', 'Hide')
                    : localize(language, 'Tampilkan', 'Show')}
                onClick={() => {
                  if (isLocked) return;
                  const next = items.map((entry, idx) => (
                    idx === index ? { ...entry, visible: !entry.visible } : entry
                  ));
                  onUpdate(next);
                }}
              >
                {item.visible ? <Eye size={11} /> : <EyeOff size={11} />}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="layout-editor">
      <div className="layout-editor__presets">
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`settings-activity-chip${layout.preset === preset.id ? ' is-active' : ''}`}
            onClick={() => onChange(cloneLayoutPreset(preset.id, layout.customShortcuts))}
          >
            <i className="settings-activity-chip__dot" aria-hidden="true" />
            <span>{preset.label}</span>
          </button>
        ))}
      </div>

      <div className="layout-editor__subtabs">
        {(['idle', 'launcher', 'tools'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            className={`layout-editor__subtab${section === tab ? ' is-active' : ''}`}
            onClick={() => {
              setSection(tab);
              setDragIndex(null);
            }}
          >
            {tab === 'idle' ? 'Idle' : tab === 'launcher' ? 'Launcher' : 'Tools'}
          </button>
        ))}
        <button
          type="button"
          className="layout-editor__reset"
          title={localize(language, 'Reset layout ke default', 'Reset layout to default')}
          onClick={() => onChange(cloneLayoutPreset('balanced', layout.customShortcuts))}
        >
          <RotateCcw size={11} />
        </button>
      </div>

      {section === 'idle' && renderReorderList(
        layout.idleWidgets,
        idleLabels,
        (idleWidgets) => onChange({ ...layout, preset: 'custom', idleWidgets })
      )}

      {section === 'launcher' && (
        <>
          <div className="layout-editor__option-row">
            <span>{localize(language, 'Kolom', 'Columns')}</span>
            <div className="layout-editor__seg">
              {([2, 3, 4] as LauncherColumns[]).map((cols) => (
                <button
                  key={cols}
                  type="button"
                  className={layout.launcherColumns === cols ? 'is-active' : ''}
                  onClick={() => onChange({ ...layout, preset: 'custom', launcherColumns: cols })}
                >
                  {cols}
                </button>
              ))}
            </div>
          </div>
          {renderReorderList(
            layout.launcherItems,
            launcherLabels,
            (launcherItems) => onChange({ ...layout, preset: 'custom', launcherItems })
          )}
          <div className="layout-editor__shortcuts">
            <span className="layout-editor__sublabel">{localize(language, 'Shortcut Kustom (App / URL)', 'Custom Shortcuts (App / URL)')}</span>
            <form
              className="layout-editor__shortcut-form"
              onSubmit={(event) => {
                event.preventDefault();
                const label = shortcutLabel.trim();
                const target = shortcutTarget.trim();
                if (!label || !target) return;
                onChange({
                  ...layout,
                  preset: 'custom',
                  customShortcuts: [
                    ...layout.customShortcuts,
                    { id: `sc-${Date.now()}`, label, target }
                  ].slice(0, 8)
                });
                setShortcutLabel('');
                setShortcutTarget('');
              }}
            >
              <input
                type="text"
                value={shortcutLabel}
                placeholder={localize(language, 'Nama (misal YouTube)', 'Label (e.g. YouTube)')}
                onChange={(event) => setShortcutLabel(event.target.value)}
              />
              <input
                type="text"
                value={shortcutTarget}
                placeholder="https://... / C:\app.exe"
                onChange={(event) => setShortcutTarget(event.target.value)}
              />
              <button type="submit" disabled={!shortcutLabel.trim() || !shortcutTarget.trim()} aria-label={localize(language, 'Tambah shortcut', 'Add shortcut')}>
                <Plus size={12} />
              </button>
            </form>
            {layout.customShortcuts.length > 0 && (
              <div className="layout-editor__list">
                {layout.customShortcuts.map((shortcut) => (
                  <div key={shortcut.id} className="layout-editor__row">
                    <span className="layout-editor__name" title={shortcut.target}>{shortcut.label}</span>
                    <button
                      type="button"
                      className="layout-editor__btn"
                      title={localize(language, 'Hapus shortcut', 'Remove shortcut')}
                      onClick={() => onChange({
                        ...layout,
                        preset: 'custom',
                        customShortcuts: layout.customShortcuts.filter((item) => item.id !== shortcut.id)
                      })}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {section === 'tools' && (
        <>
          <div className="layout-editor__option-row">
            <span>{localize(language, 'Navigasi', 'Nav bar')}</span>
            <div className="layout-editor__seg">
              {([
                ['auto', 'Auto'],
                ['top', localize(language, 'Atas', 'Top')],
                ['left', localize(language, 'Kiri', 'Left')],
                ['right', localize(language, 'Kanan', 'Right')]
              ] as [ToolsNavLayout, string][]).map(([nav, label]) => (
                <button
                  key={nav}
                  type="button"
                  className={layout.toolsNavLayout === nav ? 'is-active' : ''}
                  onClick={() => onChange({ ...layout, preset: 'custom', toolsNavLayout: nav })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <label className="layout-editor__option-row layout-editor__toggle-row">
            <span>{localize(language, 'Label teks tab', 'Show tab labels')}</span>
            <input
              className="settings-master-switch"
              type="checkbox"
              role="switch"
              checked={layout.toolsTabLabels}
              onChange={(event) => onChange({ ...layout, preset: 'custom', toolsTabLabels: event.target.checked })}
            />
          </label>
          {renderReorderList(
            layout.toolsTabs,
            tabLabels,
            (toolsTabs) => onChange({ ...layout, preset: 'custom', toolsTabs }),
            'settings'
          )}
        </>
      )}
    </div>
  );
}

