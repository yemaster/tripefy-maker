# Editor export fixture

`ui-export.chart.json` 是浏览器实际下载的谱面，保留原始字节：在制谱器中用鼠标添加 Tap 与 Hold，并使用五等分、七等分吸附后导出。它包含 59 个音符、112 秒总时长、黄昏场景和同目录音频引用。

`timing-test.wav` 是 8 秒的合成测试音频，用于验证波形、播放和音频早于谱面结束的情况。

原生端验证脚本位于项目根目录 `tests/editor_export_smoke.gd`。它检查全部音符参数、场景、偏移和音频路径，真实等待音频自然结束，再确认谱面时钟继续运行并最终在 112 秒结束：

```text
Godot --headless --path E:/Projects/tripefy --script res://tests/editor_export_smoke.gd
```

脚本约需 10 秒；后半段静音长尾采用模拟帧推进，前 8 秒音频按真实时钟播放。不会修改测试谱面。
