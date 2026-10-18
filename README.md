# Tripefy 制谱器

独立的网页制谱器。React、Vite、shadcn/ui 与 Canvas 2D；不依赖 Godot 运行。

## 启动

安装 Node.js 22.14 或更新版本，然后克隆仓库：

```sh
git clone git@github.com:yemaster/tripefy-maker.git
cd tripefy-maker
npm start
```

浏览器打开 `http://127.0.0.1:8770/`。仓库包含 `dist/` 构建产物，直接使用无需安装依赖或 Godot。

开发时先执行 `npm ci`，再执行 `npm run dev`，浏览器打开终端显示的本地地址。`npm test` 运行检查，`npm run build` 更新 `dist/`；提交构建产物后，其他设备拉取即可使用。

本目录可以单独移动。`.gdignore` 仅用于放在 Godot 项目内时跳过扫描，不影响独立运行。

## 换设备继续制谱

谱面自动保存和音频缓存属于当前浏览器，不会随 Git 同步。换设备前导出 `.chart.json`，并通过音频旁的“另存”保存原音频；在另一台设备分别导入这两个文件。保留音频文件名与谱面中的 `audio` 一致。

更新制谱器可执行 `git pull`，然后重新启动 `npm start`。自动保存仍属于原浏览器和本地地址，正式谱面请保留导出的文件。

## 制谱

- 默认使用选择工具：在空白处拖动框选，拖动已选音符可整体移动；Shift + 单击增减选择，Shift + 拖框追加选择。
- 按 2 切换单键工具后单击放置；按 3 切换长按工具，按下确定头部并向上拖出尾部。按 1 返回选择工具，按 4 切换擦除工具。
- 单选 Hold 后，双击身体添加路径节点，拖动圆点调整节点的位置和时间。左侧也可添加、选择节点并输入数值；“节点时间”是相对 Hold 头部的秒数。
- Hold 起点固定在 0 秒，终点随长按长度变化，首尾节点不能删除。节点的插值控制前一个节点到该节点之间的形状，可选线性、缓入、缓出、缓入缓出。拖动尾端可调整长按长度。
- 左侧音符属性提供透明度（0–100%）和速度（0.1–8×），可对多选音符批量修改；时间、位置、长度只在单选时编辑。水平翻转同时翻转 Hold 路径。
- 吸附的 `1 / n` 表示每拍 n 等分，包含 3、5、7。自定义支持 1–64 等分，跨 1、2、4 拍。Alt 临时关闭吸附。
- 鼠标滚轮前后移动时间，Ctrl + 滚轮缩放；底部单一进度条定位；时间框可输入秒数或 `mm:ss.mmm` 后回车。
- Space 播放/暂停；支持 0.25×、0.5×、0.75×、1×、1.25×、1.5×、2×。
- Ctrl+C/V 复制粘贴，Ctrl+X 剪切，Ctrl+A 全选；Ctrl+Z 撤销；Ctrl+Shift+Z 或 Ctrl+Y 重做；Delete 删除。顶部同时提供复制、粘贴、撤销、重做按钮。
- 可载入 MP3、OGG、WAV。谱面自动存于当前浏览器；最近音频缓存于 IndexedDB。

## 事件与预览

左侧“事件”页可添加速度、位置、透明度事件。目标可选全部音符或某一个音符；添加时优先使用单选音符，其次沿用当前事件的目标，否则作用于全部音符。在同一时刻继续添加时，会优先选择尚未被占用的属性通道。点击列表或画布左侧的事件标记可选择事件，拖动标记可调整开始时间。

事件以开始时间、持续时间、起始值、结束值和插值描述变化。事件时间使用有效播放秒数，包含谱面偏移；持续时间为 0 时立即切换到结束值。事件结束后保留结束值，直到同一目标、同一属性的后续事件生效。该通道内的事件不能重叠。

| 属性 | 数值 | 含义 |
| --- | --- | --- |
| 速度 | 0.1–8× | 下落速度倍率，不改变音符判定时间 |
| 位置 | −100–100% | 相对横向偏移；0% 不移动，10% 向右移动场宽的 10% |
| 透明度 | 0–100% | 0% 为不可见，100% 为完全显示 |

全局与单音符的速度、透明度事件和音符基础值相乘；位置事件与基础位置、Hold 路径相加，最终限制在画面范围内。复制、移动、翻转和删除音符时，会同时处理绑定到这些音符的事件；全局事件保持独立。

“编辑”使用线性时间网格，便于吸附、框选和精确拖动；不把速度和位置事件烘入编辑坐标。低透明度音符仍保留可见轮廓。“预览”应用音符速度、透明度、Hold 路径及事件，配合播放或定位检查实际效果。

## 导出与游戏接入

导出 `.chart.json`，把音频原文件放在同一目录。JSON 记录音频相对文件名，不嵌入音频；“另存”可下载已载入的原文件。网页中的音频和谱面都在浏览器本地处理。

JSON 格式：`format: "tripefy.chart"`，`version: 1`。元信息位于 `metadata`，音符位于 `notes`。音符包含 `time`（秒）、`x`（0–1）、`duration`（秒，0 表示单键）。实际判定时间为 `time + offset`。

扩展音符字段为 `opacity`（0–1，默认 1）、`speed`（0.1–8，默认 1）和 `path`。Hold 的 `path` 是按时间递增的 `{ time, x, curve }` 列表，时间相对头部，从 0 到 `duration`；起点 x 必须与音符 x 一致。旧谱面没有路径时，自动补为等宽直线 Hold。

事件位于 `events`，每项包含 `{ id, target, property, time, duration, from, to, curve }`。`target` 为 `all` 或音符 ID；`property` 为 `speed / x / opacity`；事件实际开始时间同样为 `time + offset`。界面以百分比显示的位置与透明度，在 JSON 中分别存为 −1–1 和 0–1，例如位置 10% 存为 0.1。`curve` 支持 `linear / easeIn / easeOut / easeInOut`。旧谱面缺少 `events` 时按空列表处理。

`scene.preset` 为 `dusk / night / clear / overcast`。作者在制谱器中设定，游戏玩家不能切换。`beatsPerBar` 只控制编辑器小节线，不改变音符实际时间。

在单独的 Tripefy 游戏项目中，Godot 场景的 `chart_path` 指向谱面，或启动时传入 `-- --chart=绝对路径`。完整格式见本仓库的 [谱面格式](docs/chart-format.md)。

## 参考

操作区划分参考 [osu! 编辑器](https://osu.ppy.sh/wiki/en/Client/Beatmap_editor) 与 [时间轴](https://osu.ppy.sh/wiki/en/Client/Beatmap_editor/Timelines)，吸附、选择与音频校时参考 [ArrowVortex 官方指南](https://arrowvortex.ddrnl.com/guide.html)，事件类型、列表与参数分区参考 [ArcadeZero 场景控制文档](https://github.com/Tempestissiman/ArcadeScenecontrol#the-editing-window)。底部提供单一进度条。

界面组件通过 [shadcn/ui 官方 CLI](https://ui.shadcn.com/docs/installation/vite) 安装，使用原生 Neutral 主题，源文件位于 `src/components/ui`；图标来自 Lucide。没有自定义字体或组件样式覆盖。

## 验证

`npm test` 覆盖 JSON 往返、非法数据、3/5/7 等分、跨拍连音、撤销重做、路径框选、组复制、附属事件、速度积分、路径投影和打击特效时序。

`tests/fixtures/ui-export.chart.json` 与 `animation-ui-export.chart.json` 是从浏览器实际导出的测试谱，后者包含路径编辑、事件和多选复制结果。合成测试音频与说明位于 [tests/fixtures](tests/fixtures/README.md)。

与 Godot 的端到端判定及动画数值对照测试位于单独的 Tripefy 游戏项目，不是运行本仓库测试的依赖。
