# Editor export fixture

`ui-export.chart.json` 是浏览器实际下载的谱面，保留原始字节：在制谱器中用鼠标添加 Tap 与 Hold，并使用五等分、七等分吸附后导出。它包含 59 个音符、112 秒总时长、黄昏场景和同目录音频引用。

`timing-test.wav` 是 8 秒的合成测试音频，用于验证波形、播放和音频早于谱面结束的情况。

`animation-ui-export.chart.json` 包含 61 个音符，是路径节点编辑、添加事件和多选复制后从浏览器实际导出的测试谱。

这些文件用于制谱器的回归验证，也可以直接导入界面检查。`timing-test.wav` 是合成测试数据，不是用户的歌曲文件。

原生端验证脚本位于单独的 Tripefy 游戏项目。它检查音符、场景、偏移、音频结束后的时钟推进以及路径与事件兼容性；本仓库的 `npm test` 不依赖 Godot 或游戏目录。

## 分组与预设导出样例

`authoring-ui-export.chart.json` 来自 `tests/browser/authoring.mjs` 的实际下载：包含两个音符组、多层组位置事件、自定义预设库和 BPM 变速点。使用 `version: 2`，对应新版 Tripefy 播放器；本样例不含音频。
