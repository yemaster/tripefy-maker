# Tripefy chart v1 / v2

网页版制谱器导出的 `.chart.json` 直接用于 Godot 播放。制谱器独立运行，不需要安装 Godot；导出文件是两个项目之间的接口。

```json
{
  "format": "tripefy.chart",
  "version": 1,
  "metadata": {
    "title": "Afterglow",
    "artist": "余晖",
    "charter": "",
    "difficulty": "NORMAL",
    "level": 3
  },
  "bpm": 108,
  "offset": 0,
  "duration": 112,
  "audio": "afterglow.ogg",
  "scene": { "preset": "dusk" },
  "notes": [
    { "time": 1.2, "x": 0.39, "duration": 0 },
    { "time": 2.4, "x": 0.6, "duration": 1.1 }
  ]
}
```

## 时间与位置

- `time`：谱面中的音符时刻，单位秒，非负数。
- `offset`：所有音符相对音频的统一偏移，单位秒。实际命中时刻为 `time + offset`；正数让音符更晚命中。偏移后的时刻不能早于音频 0 秒。
- 音符 `type`：`tap`、`hold`、`drag` 或 `heartap`（界面名称 HearTap）。旧谱省略时按长度推断：大于 `0` 为 `hold`，否则为 `tap`。
- 音符 `duration`：持续秒数；Hold 必须大于 `0`，其他类型必须为 `0` 且不含路径。长按结束时刻为 `time + offset + duration`。
- 根节点 `duration`：完整播放时长，单位秒；必须覆盖全部音符尾端，包括偏移。
- `x`：屏幕横向归一化位置，`0` 为左边，`1` 为右边。游戏仍使用无轨自由位置；音符尺寸不随 `x` 改变。当前判定区居中，实际制谱建议主要使用 `0.14–0.86`，避免音符边缘超出场景。
- `bpm`：制谱网格速度，大于 `0`。可选 `bpmChanges` 用于多段 BPM 网格；播放按音符秒数执行，不会因修改玩家流速改变节奏。
- 可选 `beatsPerBar`：编辑器的小节拍数，整数 `1–16`，省略时为 `4`；不改变播放器按秒执行的时刻。
- 完全相同的 `time` 构成双押或多押，播放器自动绘制连接线；无需额外连线字段。导出时应复用同一个时间值，避免人为浮点差异。
- `notes` 可为空；导入时按时刻、横向位置排序。音符 `id` 是可选的唯一文本，用于事件定位；`all` 保留给全局事件。旧谱省略 `id` 时，播放器生成内部标识。

## 曲目与场景

`metadata` 的四个文本字段必须存在；`title` 非空。`level` 为非负数。HUD 显示 `title`、`artist` 和 `difficulty`。

`scene.preset` 仅接受以下值，由谱师写入谱面：

| 值 | 场景 | 轨道与歌曲卡片 | 音符 |
| --- | --- | --- | --- |
| `dusk` | 黄昏 | 深色 | 浅色 |
| `night` | 夜晚 | 深色 | 浅色 |
| `clear` | 晴朗 | 浅色 | 深色 |
| `overcast` | 阴天 | 浅色 | 深色 |

玩家暂停菜单没有场景切换。暂停、重新开始、自动演示和流速调整不会改变谱面指定的场景。

## 音频

`audio` 为可选文本，默认 `""`（静音谱面）。非空时指定相对于谱面目录的 `.ogg`、`.mp3` 或 `.wav` 文件，不支持绝对路径或 `..`。JSON 不嵌入音频；请把制谱器使用的原音频与 JSON 放在一起，保持文件名一致。

音频与谱面从 0 秒同时开始。播放器随音频时钟推进判定，暂停、继续、切换自动演示及重开同步控制音频。音频本身不受 `offset` 延迟；偏移只作用于音符。音频早于谱面总时长结束时，谱面继续到 `duration`。

## 在 Godot 里使用

本节中的场景、资源路径和 Godot 测试脚本属于单独的 Tripefy 游戏项目，不包含在制谱器仓库内。

1. 将导出的 JSON 和音频放在同一文件夹，例如 `charts/my-song/`。
2. 打开 `scenes/level.tscn`，选择根节点，将 Inspector 中的 `chart_path` 指向 JSON。
3. 运行场景。默认文件为 `res://charts/afterglow.chart.json`，保留原演示谱面内容。

也可从命令行指定独立文件，无需复制到项目：

```text
Godot --path /path/to/tripefy -- --chart=/path/to/my-song.chart.json
```

读取失败或内容无效时，会在 Godot 输出中报告具体原因，并回退到内置演示。音频缺失会报告警告并静音播放谱面。场景选择始终从成功加载的谱面读取。

导出 Godot 游戏时，导出预设须将 `charts/*.json` 加入非资源文件包含规则，确保内置 JSON 一并打包。项目内音频使用 Godot 资源导入；项目外音频运行时读取。

## 音符属性、蛇形 Hold 与事件

仍使用 `version: 1`；旧谱无需修改。新增字段默认值如下：

| 字段 | 默认 | 范围 / 含义 |
| --- | --- | --- |
| 音符 `opacity` | `1` | `0–1`，音符及 Hold 身体的透明度 |
| 音符 `speed` | `1` | `0.1–8`，音符下落速度倍率 |
| 音符 `path` | 直线 | Hold 的相对时间位置节点；其他类型为 `[]` |
| 根节点 `events` | `[]` | 控制全局或指定音符的速度、横向位置、透明度 |

Hold 路径示例：

```json
{
  "id": "hold-1", "time": 6, "x": 0.2, "duration": 2,
  "opacity": 0.75, "speed": 0.8,
  "path": [
    { "time": 0, "x": 0.2, "curve": "smooth" },
    { "time": 1, "x": 0.7, "curve": "smooth" },
    { "time": 2, "x": 0.4, "curve": "smooth" }
  ]
}
```

路径时间相对音符头部，单位秒，必须严格递增。首节点为 `0` 且位置等于音符 `x`，尾节点时间等于音符 `duration`，位置均在 `0–1`。端点接受 `1e-9` 的浮点误差。省略或空路径会成为直线 Hold。每个节点的 `curve` 表示从上一节点走向该节点的曲线。

每个内部路径节点也是 Hold 的中间判定节点，画面以高亮横条提醒。相邻节点之间构成一个计分段；例如头部 A、节点 B、节点 C、尾端共三段 AB、BC、C→尾端。每段与单个 Tap / Drag / HearTap 等权，头部和尾端不另增计分单位。必须由同一个输入连续完成一整段；段落失败后可从后续节点重新接入，最后一段允许提前 80 ms 松开。编辑器预览在头部显示接触效果，在各段结束时显示完成效果。

Tap 和 HearTap 要求新按下；Drag 在判定窗口内已有按住输入即可触发，可与其他音符共享输入。HearTap 使用淡紫色，所有可接受的点击时机均转换为 ExPerfect；Drag 的 ExPerfect / Perfect 时机也统一为 ExPerfect。具体判定和计分由游戏播放器执行。

路径支持 `smooth`、`linear`、`easeIn`、`easeOut`、`easeInOut`，显式节点省略曲线时仍为 `linear`。制谱器新路径默认 `smooth`，使用 PCHIP 保形三次 Hermite 插值：连续平滑段在节点处切线连续，方向反转或平台处切线归零，不超出相邻节点的位置范围；两个节点时为直线。算法参见 [SciPy PCHIP 文档](https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.PchipInterpolator.html)。既有缓动曲线保持原语义；「平滑曲线」操作可将整条旧 Hold 转换为平滑，保留节点的位置和时间，支持撤销。`smooth` 只用于路径，不适用于事件；导出后需使用支持它的新版游戏端。

事件示例：

```json
{
  "id": "event-1", "target": "hold-1", "property": "x",
  "time": 6, "duration": 2, "from": 0, "to": -0.2,
  "curve": "easeInOut"
}
```

- `target` 为音符 `id` 或 `"all"`。属性为 `speed`、`opacity`、`x`。
- 事件 `time` 为谱面秒数，实际开始时刻为 `time + offset`；`duration` 非负，`0` 表示瞬时变化。事件不能越出歌曲时长。
- 事件尚未开始时，速度和透明度倍率为 `1`，位置偏移为 `0`；结束后保持 `to`，直到同目标、同属性的下一事件接替。
- `speed` 事件的 `from / to` 范围是 `0.1–8`，`opacity` 为 `0–1`，`x` 为 `-1–1` 的相对横向偏移。
- 最终速度 = 音符速度 × 全局速度事件 × 音符速度事件；透明度同样相乘。最终位置 = 路径位置 + 全局位置事件 + 音符位置事件，再限制到 `0–1`。
- 同目标、同层、同属性的事件不能重叠或在同一时刻开始；前一事件结束时允许下一事件开始。不同属性和不同目标可同时变化。
- 支持 `linear`、`easeIn`、`easeOut`、`easeInOut`；后三者使用标准二次缓动，省略时为 `linear`。

速度只改变下落距离，不改变命中时刻。播放器对速度曲线按事件起止、缓动中点分段积分，因此暂停、定位和流速调整不会改变节奏。全局与音符事件均按当前播放时刻求值；Hold 身体各段的路径位置按各自相对时间计算。

鼠标和触摸长按需要跟随当前路径位置；横向偏差超过 `0.125` 会使当前段 Miss，该段变灰、变淡退场，后续节点仍可重新接入。键盘不限制横向位置，每个键同时绑定一个 Tap／Hold；Drag 可共享按压。演示模式自动跟随路径。

`charts/animation-example.chart.json` 提供可直接在 Godot 运行的示例。`tests/chart_animation_smoke.gd` 验证属性与触摸判定；先运行 `node tests/build_animation_parity.mjs`，再运行 `tests/animation_parity.gd`，可对照网页实际实现核对全部缓动组合的数值。

## v2 分组与事件叠加

含非空 `groups` 或 `layer > 0` 的事件时，编辑器导出 `version: 2`。新版 Godot 同时读取 v1 / v2；旧游戏不支持 v2，避免静默忽略组动画。没有这些字段的普通谱面仍导出 v1。

```json
{
  "groups": [
    {"id":"melody", "name":"旋律", "x":0, "opacity":1, "speed":1, "hidden":false, "locked":false}
  ],
  "notes": [
    {"id":"tap-a", "type":"tap", "time":8, "x":0.4, "duration":0, "group":"melody"}
  ],
  "events": [
    {"id":"enter", "target":"melody", "layer":1, "property":"x", "time":6, "duration":2, "from":-0.2, "to":0, "curve":"easeOut"}
  ]
}
```

上面是扩展字段示意；完整文件仍需元信息、场景、BPM、偏移、时长等根字段。

- 最多 256 个组，名称 1–80 字；组 ID 唯一，不得与音符 ID 或 `all` 冲突。音符至多属于一个组，省略 `group` 为未分组。
- 组 `x` 为 −1–1，`opacity` 为 0–1，`speed` 为 0.1–8，缺省分别为 0、1、1。
- `hidden / locked` 为编辑器标志，不影响播放器、自动演示、判定或得分。
- `target` 增加支持组 ID。`layer` 为整数 0–3，省略为 0；界面显示层 1–4。
- 同目标、同属性、同层不允许重叠；不同层可以叠加。每层在首事件前取默认值，末事件后保持结束值。
- 最终横向位置 = Hold 路径或单点位置 + 组基础偏移 + 全局／组／音符每层位置事件之和，限制到 0–1。
- 最终速度 = 音符基础速度 × 组基础速度 × 全局／组／音符每层速度事件之积；透明度同理。
- 网页与 Godot 对所有生效速度层的乘积做分段精确多项式积分，并缓存。分组与分层不改变音符判定时刻。

## 编辑数据：BPM 与预设库

`bpmChanges` 为可选数组，元素 `{time, bpm}`；`time` 为不含 offset 的谱面秒数，严格大于 0，不能重叠，必须在曲目结束前；BPM 20–400。从根 `bpm` 开始按时间连续积累拍数，在每个变速点切换 BPM。修改网格 BPM 不移动现有音符或事件。播放器按已导出的秒数执行，不需运行编辑器节拍换算。

`animationPresets` 为可选数组，最多 100 项，每项 `{id, name, events}`。每个预设 1–500 个事件；预设事件仅包含 `{property,time,duration,from,to,curve,layer}`。时间、时长归一化到 0–1，时间与时长之和不超过 1；层 0–3。应用时根据指定目标、起点、拍数长度与 BPM 表生成实际秒数和新的事件 ID。预设不是运行时引用，修改预设不会改动已生成的事件。

独立预设库格式为 `{ "format":"tripefy.presets", "version":1, "presets":[...] }`。导入生成新的预设 ID 并合并；导出谱面也携带自定义库。BPM 表和预设库是编辑数据，本身不要求升级到 v2。
