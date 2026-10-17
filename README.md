# Tripefy 制谱器

独立的网页制谱器。React、Vite、shadcn/ui 与 Canvas 2D；不依赖 Godot 运行。

## 启动

已构建的版本：在此目录运行 `node server.mjs`，浏览器打开 `http://127.0.0.1:8770`。

开发：`npm install`，然后 `npm run dev`。构建：`npm run build`。数据检查：`npm test`。

可将整个 `chart-editor` 文件夹移到其他位置独立使用。`.gdignore` 使 Godot 跳过此目录。

## 制谱

- 单键：在画布中单击。长按：按下确定头部，向上拖出尾部。
- 选择工具可拖动、框选；Shift 多选。选中 Hold 后拖尾端调整长度。
- 吸附的 `1 / n` 表示每拍 n 等分，包含 3、5、7。自定义支持 1–64 等分，跨 1、2、4 拍。Alt 临时关闭吸附。
- 鼠标滚轮前后移动时间，Ctrl + 滚轮缩放；底部单一进度条定位；时间框可输入秒数或 `mm:ss.mmm` 后回车。
- Space 播放/暂停；支持 0.25×、0.5×、0.75×、1×、1.25×、1.5×、2×。
- Ctrl+C/V 复制粘贴；Ctrl+Z 撤销；Ctrl+Shift+Z 或 Ctrl+Y 重做；Delete 删除。
- 可载入 MP3、OGG、WAV。谱面自动存于当前浏览器；最近音频缓存于 IndexedDB。

## 导出与游戏接入

导出 `.chart.json`，把音频原文件放在同一目录。JSON 记录音频相对文件名，不嵌入音频；“另存”可下载已载入的原文件。网页中的音频和谱面都在浏览器本地处理。

JSON 格式：`format: "tripefy.chart"`，`version: 1`。元信息位于 `metadata`，音符位于 `notes`。音符包含 `time`（秒）、`x`（0–1）、`duration`（秒，0 表示单键）。实际判定时间为 `time + offset`。

`scene.preset` 为 `dusk / night / clear / overcast`。作者在制谱器中设定，游戏玩家不能切换。`beatsPerBar` 只控制编辑器小节线，不改变音符实际时间。

Godot 场景中的 `chart_path` 指向谱面，或启动时传入 `-- --chart=绝对路径`。完整合同位于原游戏项目的 `charts/FORMAT.md`。

## 参考

操作区划分参考 [osu! 编辑器](https://osu.ppy.sh/wiki/en/Client/Beatmap_editor) 与 [时间轴](https://osu.ppy.sh/wiki/en/Client/Beatmap_editor/Timelines)，吸附、选择与音频校时参考 [ArrowVortex 官方指南](https://arrowvortex.ddrnl.com/guide.html)。按用户要求，底部只保留进度条。

界面组件通过 [shadcn/ui 官方 CLI](https://ui.shadcn.com/docs/installation/vite) 安装，源文件位于 `src/components/ui`；图标来自 Lucide。

## 验证

模型测试覆盖 JSON 往返、非法数据、偏移边界、3/5/7 等分、跨拍连音、长时间精度及撤销重做。
`tests/fixtures/ui-export.chart.json` 是浏览器实际导出的测试谱；对应 Godot 的 `tests/editor_export_smoke.gd` 检查每个音符与音频结束后的时间推进。
