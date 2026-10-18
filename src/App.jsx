import { memo, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { MousePointer2, RectangleHorizontal, RectangleVertical, Eraser, Undo2, Redo2, Copy, ClipboardPaste, Grid2X2, SkipBack, Play, X, Keyboard, Plus, Trash2 } from 'lucide-react'

const Btn = ({ children, ...props }) => <Button type="button" variant="ghost" size="sm" {...props}>{children}</Button>
const Field = ({ label, id, unit, children, ...props }) => <div className="grid min-w-0 gap-2"><Label htmlFor={id}>{label}{unit ? ` (${unit})` : ''}</Label>{children || <Input id={id} {...props} />}</div>
const Select = ({ children, ...props }) => <div className="min-w-0 [&_[data-slot=native-select-wrapper]]:w-full"><NativeSelect {...props}>{children}</NativeSelect></div>
const Option = NativeSelectOption
const TipButton = ({ hint, children, ...props }) => <Tooltip><TooltipTrigger asChild><Btn {...props}>{children}</Btn></TooltipTrigger><TooltipContent>{hint}</TooltipContent></Tooltip>
const curves = [['linear', '线性'], ['easeIn', '缓入'], ['easeOut', '缓出'], ['easeInOut', '缓入缓出']]
const propertyLabels = { speed: '速度', x: '位置', opacity: '透明度' }
const numberLabel = value => Number.isFinite(Number(value)) ? Number(value).toFixed(3).replace(/\.?0+$/, '') : '0'
const action = detail => window.dispatchEvent(new CustomEvent('editor:action', { detail }))

function useInspector() {
  const [inspector, setInspector] = useState({ pathNodes: [], events: [], selectedNodeIndex: null, selectedEventId: null, noteCount: 0 })
  useEffect(() => {
    const update = event => setInspector(previous => ({ ...previous, ...event.detail }))
    window.addEventListener('editor:inspector', update)
    return () => window.removeEventListener('editor:inspector', update)
  }, [])
  return inspector
}

function PlaybackSymbols() {
  return <svg className="absolute size-0 overflow-hidden" aria-hidden="true"><defs><symbol id="i-play" viewBox="0 0 24 24"><path d="m8 4 13 8-13 8Z" fill="none" stroke="currentColor" strokeWidth="1.6" /></symbol><symbol id="i-pause" viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" fill="none" stroke="currentColor" strokeWidth="1.6" /></symbol></defs></svg>
}

const Tools = memo(function Tools() {
  const [tool, setTool] = useState('select')
  useEffect(() => { const update = event => setTool(event.detail.tool); window.addEventListener('editor:tool', update); return () => window.removeEventListener('editor:tool', update) }, [])
  return <div className="flex items-center gap-1" role="group" aria-label="编辑工具">{[['select', '选择', MousePointer2], ['tap', '单键', RectangleHorizontal], ['hold', '长按', RectangleVertical], ['erase', '擦除', Eraser]].map(([key, label, Icon], index) => <TipButton key={key} data-tool={key} aria-label={label} aria-pressed={tool === key} variant={tool === key ? 'secondary' : 'ghost'} size="icon-sm" hint={`${label} · ${index + 1}`} onClick={() => setTool(key)}><Icon /></TipButton>)}</div>
})

const Views = memo(function Views() {
  const [view, setView] = useState('edit')
  useEffect(() => { const update = event => setView(event.detail.view); window.addEventListener('editor:view', update); return () => window.removeEventListener('editor:view', update) }, [])
  return <div className="flex gap-1" role="group" aria-label="画布模式">{[['edit', '编辑'], ['preview', '预览']].map(([key, label]) => <Btn key={key} data-view={key} aria-label={label} variant={view === key ? 'secondary' : 'ghost'} onClick={() => setView(key)}>{label}</Btn>)}</div>
})

const Scenes = memo(function Scenes() {
  const [scene, setScene] = useState('dusk')
  useEffect(() => { const update = event => { if (event.detail.scene) setScene(event.detail.scene) }; window.addEventListener('editor:inspector', update); return () => window.removeEventListener('editor:inspector', update) }, [])
  return <div className="grid grid-cols-2 gap-2" role="group" aria-label="场景选择">{[['dusk', '黄昏'], ['night', '夜晚'], ['clear', '晴朗'], ['overcast', '阴天']].map(([key, label]) => <Btn key={key} data-scene={key} aria-label={label} variant={scene === key ? 'secondary' : 'ghost'} onClick={() => setScene(key)}>{label}</Btn>)}</div>
})

const PathNodeList = memo(function PathNodeList() {
  const { pathNodes, selectedNodeIndex } = useInspector()
  return <div id="path-node-list"><Table><TableBody>{pathNodes.map(node => <TableRow key={node.index} data-state={node.index === selectedNodeIndex ? 'selected' : undefined}><TableCell className="p-0"><Btn className="h-auto w-full justify-between py-2" aria-label={`选择路径节点 ${node.index + 1}`} onClick={() => action({ type: 'select-path-node', index: node.index })}><span>{numberLabel(node.time)} s</span><span>{numberLabel(node.x * 100)}%</span></Btn></TableCell><TableCell className="w-8 p-0"><TipButton size="icon-xs" hint="删除节点" aria-label={`删除路径节点 ${node.index + 1}`} disabled={node.index === 0 || node.index === pathNodes.length - 1} onClick={() => action({ type: 'delete-path-node', index: node.index })}><Trash2 /></TipButton></TableCell></TableRow>)}</TableBody></Table></div>
})

const EventList = memo(function EventList() {
  const { events, selectedEventId } = useInspector()
  return <div id="event-list"><Table><TableBody>{events.map(event => <TableRow key={event.id} data-state={event.id === selectedEventId ? 'selected' : undefined}><TableCell className="p-0"><Btn className="h-auto w-full justify-start py-2" aria-label={`选择${propertyLabels[event.property] || event.property}事件 ${numberLabel(event.time)}秒`} onClick={() => action({ type: 'select-event', id: event.id })}><span className="w-14 shrink-0">{numberLabel(event.time)} s</span><span>{propertyLabels[event.property] || event.property}</span><span className="ml-auto truncate">{event.targetLabel}</span></Btn></TableCell></TableRow>)}</TableBody></Table></div>
})

const ChartFields = memo(function ChartFields() {
  return <div className="grid gap-6"><section className="grid gap-3"><Label>曲目信息</Label><Field id="meta-title" label="曲名" maxLength={160} autoComplete="off" /><Field id="meta-artist" label="曲师" maxLength={160} autoComplete="off" /><Field id="meta-charter" label="谱师" maxLength={160} autoComplete="off" /><div className="grid grid-cols-[1fr_64px] gap-3"><Field id="meta-difficulty" label="难度"><Select id="meta-difficulty" defaultValue="NORMAL">{['EASY', 'NORMAL', 'HARD', 'EXPERT', 'EXTRA'].map(item => <Option key={item}>{item}</Option>)}</Select></Field><Field id="meta-level" label="等级" type="number" min="1" max="99" /></div></section>
    <section className="grid gap-3"><Label>节拍</Label><div className="grid grid-cols-2 gap-3"><Field id="bpm" label="BPM" type="number" min="20" max="400" step="0.001" /><Field id="beats-per-bar" label="每小节拍数" type="number" min="1" max="16" step="1" defaultValue="4" /><Field id="offset" label="偏移" unit="ms" type="number" step="1" /><Field id="duration" label="时长" unit="s" type="number" min="1" step="0.001" /></div></section>
    <section className="grid gap-2"><div className="flex items-center justify-between"><Label>音频</Label><Btn id="audio-download" aria-label="另存音频" disabled>另存</Btn></div><Btn id="load-audio" className="w-full justify-start" variant="outline" aria-label="载入音频"><span id="audio-name" className="truncate">载入音频</span></Btn><span id="audio-detail" className="sr-only">MP3 / OGG / WAV</span></section></div>
})

const SelectionFields = memo(function SelectionFields() {
  return <section id="selection-section" className="grid gap-3" hidden><Separator /><div className="flex items-center justify-between"><Label>选中音符</Label><span id="selection-count">0</span></div><div id="selection-empty" className="sr-only">未选择音符</div>
    <div id="selection-fields" className="grid gap-3" hidden><div className="grid grid-cols-2 gap-3"><Field id="note-time" label="时间" unit="s" type="number" min="0" step="0.001" /><Field id="note-x" label="位置" unit="%" type="number" min="0" max="100" step="0.1" /><Field id="note-duration" label="长度" unit="s" type="number" min="0" step="0.001" /><Field id="note-opacity" label="透明度" unit="%" type="number" min="0" max="100" step="1" defaultValue="100" /><Field id="note-speed" label="速度" unit="×" type="number" min="0.1" max="8" step="0.1" defaultValue="1" /></div><div className="flex justify-between gap-2"><Btn id="mirror-selection" aria-label="水平翻转选中音符">水平翻转</Btn><Btn id="delete-selection" aria-label="删除选中音符">删除</Btn></div></div>
    <section id="path-section" className="grid gap-3" hidden><div className="flex items-center justify-between"><Label>路径节点</Label><TipButton id="add-path-node" size="icon-sm" hint="添加路径节点" aria-label="添加路径节点"><Plus /></TipButton></div><PathNodeList /><div className="grid grid-cols-2 gap-3"><Field id="path-time" label="节点时间" unit="s" type="number" min="0" step="0.001" /><Field id="path-x" label="位置" unit="%" type="number" min="0" max="100" step="0.1" /></div><Field id="path-curve" label="插值"><Select id="path-curve" defaultValue="linear">{curves.map(([key, label]) => <Option key={key} value={key}>{label}</Option>)}</Select></Field><Btn id="delete-path-node" aria-label="删除当前路径节点">删除节点</Btn></section>
  </section>
})

const EventFields = memo(function EventFields() {
  return <div className="grid gap-4"><div className="flex items-center justify-between"><Label>事件</Label><TipButton id="add-event" size="icon-sm" hint="添加事件" aria-label="添加事件"><Plus /></TipButton></div><EventList /><section id="event-fields" className="grid gap-3" hidden>
    <Field id="event-property" label="属性"><Select id="event-property" defaultValue="speed"><Option value="speed">速度</Option><Option value="x">位置</Option><Option value="opacity">透明度</Option></Select></Field><Field id="event-target" label="目标"><Select id="event-target" defaultValue="all"><Option value="all">全部音符</Option><Option value="selected">选中音符</Option></Select></Field>
    <div className="grid grid-cols-2 gap-3"><Field id="event-time" label="开始时间" unit="s" type="number" min="0" step="0.001" /><Field id="event-duration" label="持续时间" unit="s" type="number" min="0" step="0.001" /><Field id="event-from" label="起始值" type="number" step="0.01" /><Field id="event-to" label="结束值" type="number" step="0.01" /></div><Field id="event-curve" label="插值"><Select id="event-curve" defaultValue="linear">{curves.map(([key, label]) => <Option key={key} value={key}>{label}</Option>)}</Select></Field><Btn id="delete-event" aria-label="删除当前事件">删除事件</Btn></section></div>
})

const Sidebar = memo(function Sidebar() {
  const [panel, setPanel] = useState('chart')
  useEffect(() => { const update = event => setPanel(event.detail.panel); window.addEventListener('editor:panel', update); return () => window.removeEventListener('editor:panel', update) }, [])
  return <aside className="flex w-[260px] shrink-0 flex-col overflow-hidden"><Tabs value={panel} onValueChange={setPanel} className="min-h-0 flex-1 gap-0"><TabsList className="mx-3 my-3 w-auto"><TabsTrigger value="chart" data-panel="chart" aria-label="谱面设置">谱面</TabsTrigger><TabsTrigger value="scene" data-panel="scene" aria-label="场景设置">场景</TabsTrigger><TabsTrigger value="events" data-panel="events" aria-label="事件设置">事件</TabsTrigger></TabsList><ScrollArea className="min-h-0 flex-1"><div className="grid gap-6 px-3 pb-4"><SelectionFields /><TabsContent id="panel-chart" value="chart" forceMount className="data-[state=inactive]:hidden"><ChartFields /></TabsContent><TabsContent id="panel-scene" value="scene" forceMount className="data-[state=inactive]:hidden"><section className="grid gap-3"><Label>谱面场景</Label><Scenes /></section></TabsContent><TabsContent id="panel-events" value="events" forceMount className="data-[state=inactive]:hidden"><EventFields /></TabsContent></div></ScrollArea></Tabs><div className="flex h-12 shrink-0 items-center px-2"><Btn id="show-shortcuts" aria-label="查看快捷键"><Keyboard />快捷键</Btn><span id="note-total" className="sr-only">0 NOTES</span></div></aside>
})

const Toolbar = memo(function Toolbar() {
  return <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2"><Tools /><Views />
    <div className="flex items-center gap-2"><Label htmlFor="snap">吸附</Label><Select id="snap" size="sm" defaultValue="4">{[1, 2, 3, 4, 5, 6, 7, 8, 12, 16].map(n => <Option key={n} value={n}>1 / {n}</Option>)}<Option value="custom">自定义</Option><Option value="off">关闭</Option></Select></div>
    <div id="custom-snap" className="flex items-center gap-1" hidden><Input id="snap-division" className="w-14" type="number" min="1" max="64" defaultValue="5" aria-label="等分数" /><Select id="snap-span" size="sm" defaultValue="1" aria-label="跨越拍数"><Option value="1">1 拍</Option><Option value="2">2 拍</Option><Option value="4">4 拍</Option></Select></div>
    <div className="flex items-center gap-2"><Label htmlFor="x-snap">横向</Label><Select id="x-snap" size="sm" defaultValue="0"><Option value="0">自由</Option><Option value="8">1 / 8</Option><Option value="16">1 / 16</Option><Option value="32">1 / 32</Option></Select></div><TipButton id="grid-toggle" size="icon-sm" hint="显示 / 隐藏网格" aria-label="网格"><Grid2X2 /></TipButton><Label htmlFor="zoom" className="flex items-center gap-2"><span id="zoom-label" className="w-10">100%</span><input id="zoom" className="w-16" type="range" min="55" max="220" defaultValue="100" aria-label="纵向缩放" /></Label>
    <div className="ml-auto flex items-center gap-1"><TipButton id="copy-selection" hint="复制 · Ctrl C" aria-label="复制选中音符"><Copy /><span className="hidden 2xl:inline">复制</span></TipButton><TipButton id="paste-selection" hint="粘贴 · Ctrl V" aria-label="粘贴音符"><ClipboardPaste /><span className="hidden 2xl:inline">粘贴</span></TipButton><TipButton id="undo" hint="撤销 · Ctrl Z" aria-label="撤销" disabled><Undo2 /><span className="hidden 2xl:inline">撤销</span></TipButton><TipButton id="redo" hint="重做 · Ctrl Shift Z" aria-label="重做" disabled><Redo2 /><span className="hidden 2xl:inline">重做</span></TipButton></div>
  </div>
})

const Transport = memo(function Transport() {
  return <div className="shrink-0 px-3 pb-2"><div className="h-5"><canvas id="timeline" className="block h-5 w-full touch-none" tabIndex="0" aria-label="播放进度，单击或拖动定位" /><span id="waveform-empty" className="sr-only" hidden /></div><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-1"><TipButton id="rewind" size="icon-sm" hint="回到开头 · Home" aria-label="回到开头"><SkipBack /></TipButton><TipButton id="play" size="icon-sm" hint="播放 / 暂停 · Space" aria-label="播放"><Play /></TipButton><Input id="current-time" className="w-28" defaultValue="00:00.000" aria-label="当前时间，格式 分:秒 或 秒" /><span id="total-time" className="hidden 2xl:inline">/ 01:52.000</span></div>
    <div className="ml-auto flex items-center gap-3"><Label htmlFor="metronome" className="flex items-center gap-2"><input id="metronome" type="checkbox" />节拍器</Label><Label htmlFor="hitsound" className="flex items-center gap-2"><input id="hitsound" type="checkbox" defaultChecked />打击音</Label><div className="flex items-center gap-2"><Label htmlFor="playback-rate" className="hidden 2xl:block">倍速</Label><Select id="playback-rate" size="sm" defaultValue="1" aria-label="播放倍速">{[.25, .5, .75, 1, 1.25, 1.5, 2].map(rate => <Option key={rate} value={rate}>{rate}×</Option>)}</Select></div><Label htmlFor="volume" className="flex items-center gap-2"><span className="hidden 2xl:inline">音量</span><input id="volume" className="w-14 xl:w-20" type="range" min="0" max="100" defaultValue="65" aria-label="音量" /></Label></div></div></div>
})

function Dialogs() {
  const shortcuts = [['选择 / 单键 / 长按 / 擦除', '1 / 2 / 3 / 4'], ['框选 / 追加框选', '拖动 / Shift + 拖动'], ['增减选择', 'Shift + 单击'], ['添加路径节点', '双击 Hold 身体'], ['移动路径节点', '拖动圆点'], ['播放 / 暂停', 'Space'], ['移动时间', '滚轮 / ↑ ↓'], ['纵向缩放', 'Ctrl + 滚轮'], ['临时取消吸附', 'Alt'], ['删除选中音符或事件', 'Delete'], ['复制 / 粘贴 / 全选', 'Ctrl + C / V / A'], ['撤销 / 重做', 'Ctrl + Z / Shift Z'], ['导出 / 导入', 'Ctrl + S / O'], ['回到开头', 'Home']]
  const dialogClass = 'm-auto w-[min(460px,90vw)] rounded-lg border bg-background p-6 text-foreground shadow-lg backdrop:bg-black/50'
  return <><dialog id="shortcuts-dialog" className={dialogClass}><div className="mb-4 flex items-center justify-between"><Label>快捷键</Label><Btn data-close="shortcuts-dialog" size="icon-sm" aria-label="关闭快捷键"><X /></Btn></div><Table><TableBody>{shortcuts.map(([label, keys]) => <TableRow key={label}><TableCell>{label}</TableCell><TableCell>{keys}</TableCell></TableRow>)}</TableBody></Table></dialog><dialog id="new-dialog" className={dialogClass}><div className="mb-4 flex items-center justify-between"><Label>新建谱面</Label><Btn data-close="new-dialog" size="icon-sm" aria-label="关闭新建谱面"><X /></Btn></div><p className="mb-6">当前谱面将被替换。</p><div className="flex justify-end gap-2"><Btn id="export-before-new" aria-label="导出当前谱面">导出当前谱面</Btn><Button id="confirm-new" type="button" aria-label="创建空白谱面">创建空白谱面</Button></div></dialog></>
}

export default function App() {
  useEffect(() => { document.documentElement.classList.add('dark') }, [])
  return <TooltipProvider delayDuration={450}><div className="flex h-dvh min-h-[480px] flex-col overflow-hidden bg-background text-foreground"><PlaybackSymbols /><header className="flex h-12 shrink-0 items-center gap-6 px-3"><span>Tripefy</span><span id="document-title" className="max-w-64 truncate">Afterglow</span><span id="save-state" className="sr-only">本地已保存</span><nav className="ml-auto flex gap-1" aria-label="文件"><Btn id="new-chart" aria-label="新建谱面">新建</Btn><Btn id="import-chart" aria-label="导入谱面">导入</Btn><Btn id="export-chart" aria-label="导出谱面">导出</Btn></nav></header><Separator />
    <div className="flex min-h-0 flex-1"><Sidebar /><Separator orientation="vertical" /><main className="workspace flex min-h-0 min-w-0 flex-1 flex-col"><Toolbar /><div id="canvas-wrap" className="relative min-h-0 flex-1 overflow-hidden"><canvas id="editor" className="block size-full touch-none" tabIndex="0" aria-label="谱面编辑画布，使用鼠标放置和拖动音符" /><span id="canvas-mode" className="sr-only" /><span id="scene-label" className="sr-only" /><span id="canvas-hint" className="sr-only" /><span id="cursor-readout" className="sr-only" /><Btn id="back-to-start" className="absolute bottom-4 left-1/2 -translate-x-1/2" variant="secondary" aria-label="回到开头" hidden>回到开头</Btn></div><Transport /><footer className="sr-only"><span id="status-tool">选择</span><span id="status-snap">1 拍 / 4 等分</span><span id="status-selection">未选择</span><span id="status-position">第 1 小节 · 第 1 拍</span></footer></main></div>
    <input type="file" id="chart-file" accept=".json,application/json" hidden /><input type="file" id="audio-file" accept=".mp3,.ogg,.wav,audio/mpeg,audio/ogg,audio/wav" hidden /><div id="toast" className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-md border bg-popover px-4 py-3 text-popover-foreground shadow-md" role="status" aria-live="polite" hidden /><Dialogs />
  </div></TooltipProvider>
}
