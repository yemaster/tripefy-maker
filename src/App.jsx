import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { MousePointer2, RectangleHorizontal, RectangleVertical, Eraser, Undo2, Redo2, Copy, ClipboardPaste, Grid2X2, SkipBack, Play, X, Keyboard } from 'lucide-react'
import './editor.css'

const Btn = ({ children, ...props }) => <Button type="button" variant="ghost" size="sm" {...props}>{children}</Button>
const Field = ({ label, id, unit, children, ...props }) => <div className="editor-field"><Label htmlFor={id}>{label}{unit && <span>{unit}</span>}</Label>{children || <Input id={id} {...props} />}</div>
const Select = ({ children, ...props }) => <NativeSelect {...props}>{children}</NativeSelect>
const TipButton = ({ hint, children, ...props }) => <Tooltip><TooltipTrigger asChild><Btn {...props}>{children}</Btn></TooltipTrigger><TooltipContent side="bottom">{hint}</TooltipContent></Tooltip>

function PlaybackSymbols() {
  return <svg className="icon-library" aria-hidden="true"><defs>
    <symbol id="i-play" viewBox="0 0 24 24"><path d="m8 4 13 8-13 8Z" /></symbol>
    <symbol id="i-pause" viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" /></symbol>
  </defs></svg>
}

function Sidebar() {
  return <aside className="sidebar">
    <div className="tools" role="group" aria-label="编辑工具">
      <TipButton data-tool="select" hint="选择 / 框选 · 1"><MousePointer2 /><span>选择</span></TipButton>
      <TipButton data-tool="tap" className="active" hint="放置 Tap · 2"><RectangleHorizontal /><span>单键</span></TipButton>
      <TipButton data-tool="hold" hint="拖动放置 Hold · 3"><RectangleVertical /><span>长按</span></TipButton>
      <TipButton data-tool="erase" hint="擦除 · 4"><Eraser /><span>擦除</span></TipButton>
    </div>
    <div className="sidebar-tabs" role="tablist" aria-label="设置">
      <Btn className="active" role="tab" aria-selected="true" data-panel="chart">谱面</Btn>
      <Btn role="tab" aria-selected="false" data-panel="scene">场景</Btn>
    </div>
    <div className="sidebar-scroll">
      <div id="panel-chart" role="tabpanel">
        <section className="form-section">
          <h2>曲目信息</h2>
          <Field id="meta-title" label="曲名" maxLength={160} autoComplete="off" />
          <Field id="meta-artist" label="曲师" maxLength={160} autoComplete="off" />
          <Field id="meta-charter" label="谱师" maxLength={160} autoComplete="off" />
          <div className="field-row difficulty-row">
            <Field id="meta-difficulty" label="难度"><Select id="meta-difficulty" defaultValue="NORMAL">{['EASY', 'NORMAL', 'HARD', 'EXPERT', 'EXTRA'].map(item => <option key={item}>{item}</option>)}</Select></Field>
            <Field id="meta-level" label="等级" type="number" min="1" max="99" />
          </div>
        </section>
        <section className="form-section">
          <h2>节拍</h2>
          <div className="field-row"><Field id="bpm" label="BPM" type="number" min="20" max="400" step="0.001" /><Field id="beats-per-bar" label="每小节拍数" type="number" min="1" max="16" step="1" defaultValue="4" /></div>
          <div className="field-row"><Field id="offset" label="偏移" unit="ms" type="number" step="1" /><Field id="duration" label="时长" unit="s" type="number" min="1" step="0.001" /></div>
        </section>
        <section className="form-section audio-section">
          <div className="section-heading"><h2>音频</h2><Btn id="audio-download" disabled>另存</Btn></div>
          <Btn id="load-audio" className="audio-load"><span id="audio-name">载入音频</span></Btn>
          <small id="audio-detail" className="audio-detail">MP3 / OGG / WAV</small>
        </section>
      </div>
      <div id="panel-scene" role="tabpanel" hidden>
        <section className="form-section"><h2>谱面场景</h2><div className="scene-options" role="group" aria-label="场景选择">
          <Btn data-scene="dusk">黄昏</Btn><Btn data-scene="night">夜晚</Btn><Btn data-scene="clear">晴朗</Btn><Btn data-scene="overcast">阴天</Btn>
        </div></section>
      </div>
    </div>
    <section id="selection-section" hidden>
      <div className="section-heading"><h2>选中音符</h2><span id="selection-count">0</span></div>
      <div id="selection-empty" className="sr-only">未选择音符</div>
      <div id="selection-fields" hidden>
        <div className="field-row"><Field id="note-time" label="时间" unit="s" type="number" min="0" step="0.001" /><Field id="note-x" label="位置" unit="%" type="number" min="0" max="100" step="0.1" /></div>
        <Field id="note-duration" label="长度" unit="s" type="number" min="0" step="0.001" />
        <div className="selection-actions"><Btn id="mirror-selection">水平翻转</Btn><Btn id="delete-selection">删除</Btn></div>
      </div>
    </section>
    <div className="sidebar-footer"><Btn id="show-shortcuts"><Keyboard />快捷键</Btn><span id="note-total" className="sr-only">0 NOTES</span></div>
  </aside>
}

function Toolbar() {
  return <div className="workspace-toolbar">
    <div className="view-tabs" role="group" aria-label="画布模式"><Btn className="active" data-view="edit">编辑</Btn><Btn data-view="preview">预览</Btn></div>
    <div className="inline-control snap-control"><Label htmlFor="snap">吸附</Label><Select id="snap" title="每拍等分数量" defaultValue="4">
      {[1, 2, 3, 4, 5, 6, 7, 8, 12, 16].map(n => <option key={n} value={n}>1 / {n}</option>)}<option value="custom">自定义</option><option value="off">关闭</option>
    </Select></div>
    <div className="custom-snap" id="custom-snap" hidden><Input id="snap-division" type="number" min="1" max="64" defaultValue="5" aria-label="等分数" /><span>/</span><Select id="snap-span" title="跨越拍数" defaultValue="1"><option value="1">1 拍</option><option value="2">2 拍</option><option value="4">4 拍</option></Select></div>
    <div className="inline-control x-snap"><Label htmlFor="x-snap">横向</Label><Select id="x-snap" defaultValue="0"><option value="0">自由</option><option value="8">1 / 8</option><option value="16">1 / 16</option><option value="32">1 / 32</option></Select></div>
    <TipButton className="icon-button active" id="grid-toggle" hint="显示 / 隐藏网格" aria-label="网格"><Grid2X2 /></TipButton>
    <Label className="zoom-control" htmlFor="zoom"><span id="zoom-label">100%</span><input id="zoom" type="range" min="55" max="220" defaultValue="100" aria-label="纵向缩放" /></Label>
    <div className="toolbar-spacer" />
    <div className="edit-actions">
      <TipButton id="copy-selection" hint="复制 · Ctrl C"><Copy /><span>复制</span></TipButton>
      <TipButton id="paste-selection" hint="粘贴 · Ctrl V"><ClipboardPaste /><span>粘贴</span></TipButton>
      <TipButton id="undo" hint="撤销 · Ctrl Z" disabled><Undo2 /><span>撤销</span></TipButton>
      <TipButton id="redo" hint="重做 · Ctrl Shift Z" disabled><Redo2 /><span>重做</span></TipButton>
    </div>
  </div>
}

function Transport() {
  return <div className="transport">
    <div className="timeline-wrap"><canvas id="timeline" tabIndex="0" aria-label="播放进度，单击或拖动定位" /><span id="waveform-empty" className="sr-only" hidden /></div>
    <div className="transport-controls">
      <div className="play-controls">
        <TipButton id="rewind" className="icon-button" hint="回到开头 · Home" aria-label="回到开头"><SkipBack /></TipButton>
        <TipButton id="play" className="icon-button play-button" hint="播放 / 暂停 · Space" aria-label="播放"><Play /></TipButton>
        <Input id="current-time" defaultValue="00:00.000" aria-label="当前时间，格式 分:秒 或 秒" /><span className="total-time" id="total-time">/ 01:52.000</span>
      </div>
      <div className="audio-controls">
        <Label className="check-label" htmlFor="metronome"><input id="metronome" type="checkbox" />节拍器</Label>
        <Label className="check-label" htmlFor="hitsound"><input id="hitsound" type="checkbox" defaultChecked />打击音</Label>
        <div className="inline-control rate-control"><Label htmlFor="playback-rate">倍速</Label><Select id="playback-rate" defaultValue="1">{[.25, .5, .75, 1, 1.25, 1.5, 2].map(rate => <option key={rate} value={rate}>{rate}×</option>)}</Select></div>
        <Label className="volume-control" htmlFor="volume">音量<input id="volume" type="range" min="0" max="100" defaultValue="65" /></Label>
      </div>
    </div>
  </div>
}

function Dialogs() {
  const shortcuts = [['选择 / 单键 / 长按 / 擦除', '1 / 2 / 3 / 4'], ['播放 / 暂停', 'Space'], ['移动时间', '滚轮 / ↑ ↓'], ['纵向缩放', 'Ctrl + 滚轮'], ['临时取消吸附', 'Alt'], ['多选', 'Shift + 单击'], ['删除', 'Delete'], ['复制 / 粘贴 / 全选', 'Ctrl + C / V / A'], ['撤销 / 重做', 'Ctrl + Z / Shift Z'], ['导出 / 导入', 'Ctrl + S / O'], ['回到开头', 'Home']]
  return <>
    <dialog id="shortcuts-dialog"><div className="dialog-heading"><h2>快捷键</h2><Btn data-close="shortcuts-dialog" className="icon-button" aria-label="关闭"><X /></Btn></div><div className="shortcut-list">{shortcuts.map(([label, keys]) => <div className="shortcut-row" key={label}><span>{label}</span><kbd>{keys}</kbd></div>)}</div></dialog>
    <dialog id="new-dialog"><div className="dialog-heading"><h2>新建谱面</h2><Btn data-close="new-dialog" className="icon-button" aria-label="关闭"><X /></Btn></div><p>当前谱面将被替换。</p><div className="dialog-actions"><Btn id="export-before-new">导出当前谱面</Btn><Btn id="confirm-new">创建空白谱面</Btn></div></dialog>
  </>
}

export default function App() {
  return <TooltipProvider delayDuration={450}><div className="editor-app">
    <PlaybackSymbols />
    <header className="app-header"><span className="app-name">Tripefy</span><div className="document"><span id="document-title">Afterglow</span><span id="save-state">本地已保存</span></div><nav className="file-actions" aria-label="文件"><Btn id="new-chart">新建</Btn><Btn id="import-chart">导入</Btn><Btn id="export-chart">导出</Btn></nav></header>
    <div className="application"><Sidebar /><main className="workspace"><Toolbar /><div className="canvas-wrap" id="canvas-wrap"><canvas id="editor" tabIndex="0" aria-label="谱面编辑画布，使用鼠标放置和拖动音符" /><span id="canvas-mode" className="sr-only" /><span id="scene-label" className="sr-only" /><span id="canvas-hint" className="sr-only" /><span id="cursor-readout" className="sr-only" /><Btn id="back-to-start" className="back-to-start" hidden>回到开头</Btn></div><Transport /><footer className="sr-only"><span id="status-tool">Tap</span><span id="status-snap">1 拍 / 4 等分</span><span id="status-selection">未选择</span><span id="status-position">第 1 小节 · 第 1 拍</span></footer></main></div>
    <input type="file" id="chart-file" accept=".json,application/json" hidden /><input type="file" id="audio-file" accept=".mp3,.ogg,.wav,audio/mpeg,audio/ogg,audio/wav" hidden /><div id="toast" role="status" aria-live="polite" /><Dialogs />
  </div></TooltipProvider>
}
